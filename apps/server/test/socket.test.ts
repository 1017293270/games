import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ChatMessage,
  ClientToServerEvents,
  PresenceUpdate,
  ServerToClientEvents,
} from '@xianxia/shared';
import { attachSocketIo } from '../src/socket.js';
import { auth, createHarness, expectOk, makePlayer, type Harness, type Player } from './helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Resolves on the next occurrence of `event`, or rejects after `ms`. */
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

describe('socket.io', () => {
  let h: Harness;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness();
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

  it('rejects a handshake without a valid session token', async () => {
    const socket: ClientSocket = connect(url, {
      auth: { token: 'not-a-real-token' },
      transports: ['websocket'],
      reconnection: false,
    });
    open.push(socket);
    await expect(connected(socket, 3000)).rejects.toThrow();
  });

  it('marks a cultivator online on connect and offline on disconnect', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const watcher = await openSocket(alice.token);
    expect(h.ctx.presence.count).toBe(1);

    const joined = once<PresenceUpdate>(watcher, 'presence:update');
    const second = await openSocket(bob.token);
    const update = await joined;

    expect(update.characterId).toBe(bob.characterId);
    expect(update.name).toBe('陈墨');
    expect(update.online).toBe(true);
    expect(update.onlineCount).toBe(2);

    const left = once<PresenceUpdate>(watcher, 'presence:update');
    second.disconnect();
    const goodbye = await left;
    expect(goodbye.characterId).toBe(bob.characterId);
    expect(goodbye.online).toBe(false);
    expect(goodbye.onlineCount).toBe(1);
  });

  it('broadcasts chat:send to the world and stores it for the scrollback', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const listener = await openSocket(bob.token);
    const sender = await openSocket(alice.token);

    const incoming = once<ChatMessage>(listener, 'chat:message');
    sender.emit('chat:send', { channel: 'world', text: '哪位道友一同下秘境？' });
    const message = await incoming;

    expect(message.channel).toBe('world');
    expect(message.senderId).toBe(alice.characterId);
    expect(message.senderName).toBe('林素');
    expect(message.senderStageName).toBe('练气·前期');
    expect(message.text).toBe('哪位道友一同下秘境？');

    const history = expectOk<{ messages: ChatMessage[] }>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/chat/history?channel=world&limit=20',
          headers: auth(bob.token),
        })
      ).json(),
    );
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]!.text).toBe('哪位道友一同下秘境？');
  });

  it('throttles a sender to one line a second and drops malformed frames', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const sender = await openSocket(alice.token);

    const first = once<ChatMessage>(sender, 'chat:message');
    sender.emit('chat:send', { channel: 'world', text: '第一句' });
    await first;

    sender.emit('chat:send', { channel: 'world', text: '第二句' });
    sender.emit('chat:send', { channel: 'world', text: '' } as never);
    sender.emit('chat:send', { text: '没有频道' } as never);

    // Give the server a beat to process anything it was going to.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const stored = h.ctx.chat.history('world', 50);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toBe('第一句');
  });

  it('delivers character:update to the owner room only', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });

    const mine = await openSocket(alice.token);
    const theirs = await openSocket(bob.token);

    let leaked = false;
    theirs.on('character:update', () => {
      leaked = true;
    });

    const update = once<{ id: string; exp: number }>(mine, 'character:update');
    h.clock.advance(120_000);
    await h.app.inject({
      method: 'POST',
      url: '/api/character/settle',
      headers: auth(alice.token),
      payload: {},
    });

    const payload = await update;
    expect(payload.id).toBe(alice.characterId);
    expect(payload.exp).toBeGreaterThan(0);
    expect(leaked).toBe(false);
  });

  it('broadcasts a bot breakthrough as a system notice', async () => {
    const alice: Player = await makePlayer(h, { name: '林素' });
    const watcher = await openSocket(alice.token);

    const { getStage } = await import('@xianxia/shared');
    const { generateBots } = await import('../src/engine/bots/generate.js');
    const now = h.clock.now();
    const [bot] = generateBots(
      h.ctx,
      { count: 1, archetypeId: 'bot-kuxiu', minStageIndex: 3, maxStageIndex: 3, seed: 21 },
      now,
    );
    h.ctx.settings.patch({ botCount: 1, breakthroughChanceMultiplier: 10 });

    const notice = once<{ kind: string; text: string }>(watcher, 'system:notice', 8000);
    for (let i = 0; i < 15; i += 1) {
      h.clock.advance(60_000);
      const current = h.ctx.characters.byId(bot!.id)!;
      if (current.stageIndex >= 4) break;
      h.ctx.characters.save({
        ...current,
        stageIndex: 3,
        exp: getStage(3).expRequired,
        lastSettledAt: h.clock.now(),
      });
      h.ctx.bots.tick(h.clock.now());
    }

    const payload = await notice;
    expect(payload.kind).toBe('breakthrough');
    expect(payload.text).toContain('突破至');
  });
});
