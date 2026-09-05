import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ChatMessage,
  ClientToServerEvents,
  Party,
  PartyUpdate,
  ServerToClientEvents,
} from '@xianxia/shared';
import { attachSocketIo } from '../src/socket.js';
import { partyHandlers } from '../src/modules/party/routes.js';
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from '../src/modules/party/store.js';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function once<T>(socket: ClientSocket, event: keyof ServerToClientEvents, ms = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event as never, ((payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

/** Waits for the first occurrence of `event` whose payload satisfies `match`. */
function onceWhere<T>(
  socket: ClientSocket,
  event: keyof ServerToClientEvents,
  match: (payload: T) => boolean,
  ms = 4000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    const listener = (payload: T): void => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event as never, listener as never);
      resolve(payload);
    };
    socket.on(event as never, listener as never);
  });
}

function connected(socket: ClientSocket, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out connecting')), ms);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('party', () => {
  let h: Harness;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness({ handlers: partyHandlers });
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    await h.app.ready();
    attachSocketIo(h.app, h.ctx);
    const address = h.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of open.splice(0)) socket.disconnect();
    await h.close();
  });

  const openSocket = async (token: string): Promise<ClientSocket> => {
    const socket: ClientSocket = connect(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    open.push(socket);
    await connected(socket);
    return socket;
  };

  const post = (token: string, path: string, payload: Record<string, unknown> = {}) =>
    h.app.inject({ method: 'POST', url: path, headers: auth(token), payload });

  const get = (token: string, path: string) =>
    h.app.inject({ method: 'GET', url: path, headers: auth(token) });

  const create = async (player: Player): Promise<Party> =>
    expectOk<Party>((await post(player.token, '/api/party/create')).json());

  it('creates a party with a readable six-character invite code', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const party = await create(alice);

    expect(party.code).toHaveLength(PARTY_CODE_LENGTH);
    for (const char of party.code) expect(PARTY_CODE_ALPHABET).toContain(char);
    expect(party.leaderId).toBe(alice.characterId);
    expect(party.members).toHaveLength(1);
    expect(party.members[0]!.isLeader).toBe(true);
    expect(party.members[0]!.name).toBe('林素');
    expect(party.maxSize).toBe(h.ctx.settings.get().maxPartySize);
  });

  it('refuses a second party while already in one', async () => {
    const alice = await makePlayer(h);
    await create(alice);
    const again = await post(alice.token, '/api/party/create');
    expect(again.statusCode).toBe(409);
    expect(expectFail(again.json()).code).toBe('ALREADY_IN_PARTY');
  });

  it('joins by code and pushes party:update to both members', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const aliceSocket = await openSocket(alice.token);
    const bobSocket = await openSocket(bob.token);
    const party = await create(alice);

    // The creator's own `joined` broadcast is already in flight, so both sides
    // wait for the update that actually carries two members.
    const twoMembers = (update: PartyUpdate): boolean => update.party?.members.length === 2;
    const leaderSees = onceWhere<PartyUpdate>(aliceSocket, 'party:update', twoMembers);
    const joinerSees = onceWhere<PartyUpdate>(bobSocket, 'party:update', twoMembers);

    const joined = expectOk<Party>(
      (await post(bob.token, '/api/party/join', { code: party.code })).json(),
    );
    expect(joined.members.map((m) => m.characterId)).toEqual([
      alice.characterId,
      bob.characterId,
    ]);

    for (const update of [await leaderSees, await joinerSees]) {
      expect(update.reason).toBe('joined');
      expect(update.actorName).toBe('陈墨');
      expect(update.party?.members).toHaveLength(2);
    }

    // Both members read the same party back.
    for (const player of [alice, bob]) {
      const state = expectOk<{ party: Party | null }>((await get(player.token, '/api/party')).json());
      expect(state.party?.id).toBe(party.id);
    }
  });

  it('rejects an unknown code and a malformed one', async () => {
    const alice = await makePlayer(h);
    const unknown = await post(alice.token, '/api/party/join', { code: 'ZZZZZZ' });
    expect(unknown.statusCode).toBe(404);
    expect(expectFail(unknown.json()).code).toBe('PARTY_NOT_FOUND');

    const malformed = await post(alice.token, '/api/party/join', { code: 'a-b-c' });
    expect(expectFail(malformed.json()).code).toBe('INVALID_PARTY_CODE');
  });

  it('refuses a join once the party is at maxPartySize', async () => {
    h.ctx.settings.patch({ maxPartySize: 2 });
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    const carol = await makePlayer(h);

    const party = await create(alice);
    expectOk<Party>((await post(bob.token, '/api/party/join', { code: party.code })).json());

    const full = await post(carol.token, '/api/party/join', { code: party.code });
    expect(full.statusCode).toBe(409);
    expect(expectFail(full.json()).code).toBe('PARTY_FULL');
  });

  it('hands the party to the earliest remaining member when the leader leaves', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    const carol = await makePlayer(h, { name: '苏合' });

    const party = await create(alice);
    await post(bob.token, '/api/party/join', { code: party.code });
    await post(carol.token, '/api/party/join', { code: party.code });

    expectOk((await post(alice.token, '/api/party/leave')).json());

    const remaining = expectOk<{ party: Party | null }>((await get(bob.token, '/api/party')).json());
    expect(remaining.party?.leaderId).toBe(bob.characterId);
    expect(remaining.party?.members.map((m) => m.characterId)).toEqual([
      bob.characterId,
      carol.characterId,
    ]);

    const gone = expectOk<{ party: Party | null }>((await get(alice.token, '/api/party')).json());
    expect(gone.party).toBeNull();
  });

  it('disbands the party when the last member leaves', async () => {
    const alice = await makePlayer(h);
    await create(alice);
    expect(h.ctx.parties.size).toBe(1);

    expectOk((await post(alice.token, '/api/party/leave')).json());
    expect(h.ctx.parties.size).toBe(0);

    const empty = await post(alice.token, '/api/party/leave');
    expect(empty.statusCode).toBe(409);
    expect(expectFail(empty.json()).code).toBe('NOT_IN_PARTY');
  });

  it('lets only the leader kick, and tells the kicked member directly', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const bobSocket = await openSocket(bob.token);
    const party = await create(alice);
    await post(bob.token, '/api/party/join', { code: party.code });

    const notLeader = await post(bob.token, '/api/party/kick', {
      characterId: alice.characterId,
    });
    expect(notLeader.statusCode).toBe(403);
    expect(expectFail(notLeader.json()).code).toBe('NOT_PARTY_LEADER');

    const kicked = once<PartyUpdate>(bobSocket, 'party:update');
    const after = expectOk<Party>(
      (await post(alice.token, '/api/party/kick', { characterId: bob.characterId })).json(),
    );
    expect(after.members).toHaveLength(1);

    const notice = await kicked;
    expect(notice.party).toBeNull();
    expect(notice.reason).toBe('kicked');
    expect(notice.actorName).toBe('林素');
  });

  it('routes 队伍频道 to the party room only', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    const outsider = await makePlayer(h, { name: '路人' });

    const aliceSocket = await openSocket(alice.token);
    const bobSocket = await openSocket(bob.token);
    const outsiderSocket = await openSocket(outsider.token);

    const party = await create(alice);
    await post(bob.token, '/api/party/join', { code: party.code });

    let leaked = false;
    outsiderSocket.on('chat:message', () => {
      leaked = true;
    });

    const heard = once<ChatMessage>(bobSocket, 'chat:message');
    aliceSocket.emit('chat:send', { channel: 'party', text: '进秘境了' });
    const message = await heard;

    expect(message.channel).toBe('party');
    expect(message.senderName).toBe('林素');
    expect(message.text).toBe('进秘境了');

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(leaked).toBe(false);
    // Party talk is live-only; it must not land in the world scrollback.
    expect(h.ctx.chat.history('party', 50)).toHaveLength(0);
    expect(h.ctx.chat.history('world', 50)).toHaveLength(0);
  });

  it('puts a reconnecting member straight back in the party room', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const party = await create(alice);
    await post(bob.token, '/api/party/join', { code: party.code });

    // Both connect *after* the party exists, which is the reconnect path.
    const aliceSocket = await openSocket(alice.token);
    const bobSocket = await openSocket(bob.token);

    const heard = once<ChatMessage>(bobSocket, 'chat:message');
    aliceSocket.emit('chat:send', { channel: 'party', text: '我回来了' });
    expect((await heard).text).toBe('我回来了');
  });
});
