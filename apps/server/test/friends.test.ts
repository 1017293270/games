import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  Friend,
  FriendRequestEvent,
  ServerToClientEvents,
} from '@xianxia/shared';
import { attachSocketIo } from '../src/socket.js';
import { friendHandlers } from '../src/modules/friend/routes.js';
import { generateBots } from '../src/engine/bots/generate.js';
import { FRIEND_LIMIT } from '../src/modules/friend/service.js';
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

describe('friends', () => {
  let h: Harness;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness({ handlers: friendHandlers });
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

  const list = async (token: string): Promise<Friend[]> =>
    expectOk<{ friends: Friend[] }>(
      (await h.app.inject({ method: 'GET', url: '/api/friends', headers: auth(token) })).json(),
    ).friends;

  const request = (from: Player, to: Player) =>
    post(from.token, '/api/friends/request', { characterId: to.characterId });

  const accept = (who: Player, other: Player) =>
    post(who.token, '/api/friends/accept', { characterId: other.characterId });

  const remove = (who: Player, other: Player) =>
    post(who.token, '/api/friends/remove', { characterId: other.characterId });

  it('sends a request, labels both sides and pushes friend:request', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const bobSocket = await openSocket(bob.token);
    const incoming = once<FriendRequestEvent>(bobSocket, 'friend:request');

    expectOk((await request(alice, bob)).json());

    const event = await incoming;
    expect(event.fromCharacterId).toBe(alice.characterId);
    expect(event.fromName).toBe('林素');
    expect(event.fromStageName).toBe('练气·前期');

    const mine = await list(alice.token);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.characterId).toBe(bob.characterId);
    expect(mine[0]!.name).toBe('陈墨');
    expect(mine[0]!.state).toBe('pending_out');

    const theirs = await list(bob.token);
    expect(theirs[0]!.state).toBe('pending_in');
    expect(theirs[0]!.characterId).toBe(alice.characterId);
    // 林素 never opened a socket, so presence says so.
    expect(theirs[0]!.online).toBe(false);
  });

  it('accepts a request and makes both sides friends', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    await request(alice, bob);
    const after = expectOk<{ friends: Friend[] }>((await accept(bob, alice)).json());

    expect(after.friends).toHaveLength(1);
    expect(after.friends[0]!.state).toBe('accepted');
    expect(after.friends[0]!.characterId).toBe(alice.characterId);
    expect((await list(alice.token))[0]!.state).toBe('accepted');
  });

  it('refuses a duplicate request, a self-request and an unknown cultivator', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    const self = await post(alice.token, '/api/friends/request', {
      characterId: alice.characterId,
    });
    expect(expectFail(self.json()).code).toBe('VALIDATION_ERROR');

    const nobody = await post(alice.token, '/api/friends/request', { characterId: 'nobody' });
    expect(nobody.statusCode).toBe(404);
    expect(expectFail(nobody.json()).code).toBe('CHARACTER_NOT_FOUND');

    expectOk((await request(alice, bob)).json());
    const again = await request(alice, bob);
    expect(again.statusCode).toBe(409);
    expect(expectFail(again.json()).code).toBe('FRIEND_REQUEST_EXISTS');

    await accept(bob, alice);
    const already = await request(alice, bob);
    expect(already.statusCode).toBe(409);
    expect(expectFail(already.json()).code).toBe('ALREADY_FRIENDS');
  });

  it('treats a crossed pair of requests as a friendship', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    expectOk((await request(alice, bob)).json());
    expectOk((await request(bob, alice)).json());

    expect((await list(alice.token))[0]!.state).toBe('accepted');
    expect((await list(bob.token))[0]!.state).toBe('accepted');
  });

  it('refuses to accept a request that was never sent', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    const missing = await accept(alice, bob);
    expect(missing.statusCode).toBe(404);
    expect(expectFail(missing.json()).code).toBe('FRIEND_NOT_FOUND');

    // The sender cannot accept their own request either.
    await request(alice, bob);
    expect(expectFail((await accept(alice, bob)).json()).code).toBe('FRIEND_NOT_FOUND');
  });

  it('removes a friendship from both sides, and refuses a pending one', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    await request(alice, bob);
    await accept(bob, alice);

    const after = expectOk<{ friends: Friend[] }>((await remove(alice, bob)).json());
    expect(after.friends).toHaveLength(0);
    expect(await list(bob.token)).toHaveLength(0);

    const gone = await remove(alice, bob);
    expect(gone.statusCode).toBe(404);
    expect(expectFail(gone.json()).code).toBe('FRIEND_NOT_FOUND');
  });

  it('uses remove to refuse an incoming request', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    await request(alice, bob);
    expectOk((await remove(bob, alice)).json());

    expect(await list(alice.token)).toHaveLength(0);
    expect(await list(bob.token)).toHaveLength(0);
  });

  it('stops at FRIEND_LIMIT accepted friends', async () => {
    const alice = await makePlayer(h);
    const now = h.clock.now();

    // Fill the book straight through the repo; making 50 accounts over HTTP
    // would only be testing registration. The rows still need real cultivators
    // on the other end — `friends` has a foreign key to `characters`.
    const filler = generateBots(h.ctx, { count: FRIEND_LIMIT, seed: 77 }, now);
    expect(filler).toHaveLength(FRIEND_LIMIT);
    for (const bot of filler) h.ctx.friends.put(alice.characterId, bot.id, 'accepted', now);
    expect(h.ctx.friends.countAccepted(alice.characterId)).toBe(FRIEND_LIMIT);

    const bob = await makePlayer(h);
    const full = await request(alice, bob);
    expect(full.statusCode).toBe(409);
    expect(expectFail(full.json()).code).toBe('FRIEND_LIMIT');

    // The full book also blocks someone trying to add *them*.
    const inbound = await request(bob, alice);
    expect(expectFail(inbound.json()).code).toBe('FRIEND_LIMIT');
  });

  it('sorts accepted friends ahead of pending ones and reports presence', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const friend = await makePlayer(h, { name: '故人' });
    const suitor = await makePlayer(h, { name: '来客' });

    await request(alice, friend);
    await accept(friend, alice);
    await request(suitor, alice);

    await openSocket(friend.token);

    const mine = await list(alice.token);
    expect(mine.map((f) => f.state)).toEqual(['accepted', 'pending_in']);
    expect(mine[0]!.name).toBe('故人');
    expect(mine[0]!.online).toBe(true);
    expect(mine[0]!.lastSeenAt).toBeGreaterThan(0);
    expect(mine[1]!.name).toBe('来客');
    expect(mine[1]!.online).toBe(false);
  });
});
