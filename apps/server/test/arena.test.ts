import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { getStage, stageName } from '@xianxia/shared';
import type {
  ArenaChallengedEvent,
  ArenaChallengeResponse,
  ArenaRecord,
  ClientToServerEvents,
  PublicProfile,
  ServerToClientEvents,
} from '@xianxia/shared';
import { attachSocketIo } from '../src/socket.js';
import { arenaHandlers } from '../src/modules/arena/routes.js';
import { OPPONENT_STAGE_WINDOW, winHint } from '../src/modules/arena/service.js';
import { REPLAY_KEEP } from '../src/modules/arena/repo.js';
import { generateBots } from '../src/engine/bots/generate.js';
import { auth, createHarness, expectFail, expectOk, makePlayer, type Harness } from './helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface OpponentList {
  opponents: (PublicProfile & { winHint: number })[];
  challengesToday: number;
  dailyLimit: number;
  rating: number;
}

interface RecordPage {
  items: ArenaRecord[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function once<T>(socket: ClientSocket, event: keyof ServerToClientEvents, ms = 6000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(
      event as never,
      ((payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      }) as never,
    );
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

describe('arena', () => {
  let h: Harness;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness({ handlers: arenaHandlers });
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

  const setStage = (characterId: string, stageIndex: number): void => {
    const state = h.ctx.characters.byId(characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex,
      exp: getStage(stageIndex).expRequired * 0.5,
      lastSettledAt: h.clock.now(),
      lastSeenAt: h.clock.now(),
    });
  };

  const challenge = (token: string, targetId: string) =>
    post(token, '/api/arena/challenge', { targetId });

  it('offers nearby cultivators with a hedged win hint', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    setStage(alice.characterId, 6);
    setStage(bob.characterId, 7);

    // Far out of the window, so it must not be offered.
    const distant = await makePlayer(h);
    setStage(distant.characterId, 6 + OPPONENT_STAGE_WINDOW + 1);

    generateBots(h.ctx, { count: 6, minStageIndex: 6, maxStageIndex: 8, seed: 7 }, h.clock.now());

    const list = expectOk<OpponentList>((await get(alice.token, '/api/arena/opponents')).json());

    const ids = list.opponents.map((o) => o.id);
    expect(ids).toContain(bob.characterId);
    expect(ids).not.toContain(alice.characterId);
    expect(ids).not.toContain(distant.characterId);
    expect(list.opponents.some((o) => o.isBot)).toBe(true);

    expect(list.rating).toBe(1000);
    expect(list.challengesToday).toBe(0);
    expect(list.dailyLimit).toBe(h.ctx.settings.get().arenaDailyLimit);
    for (const opponent of list.opponents) {
      expect(opponent.winHint).toBeGreaterThanOrEqual(0.1);
      expect(opponent.winHint).toBeLessThanOrEqual(0.9);
    }
  });

  it('clamps the win hint even against a hopeless mismatch', () => {
    expect(winHint(1, 1_000_000)).toBe(0.1);
    expect(winHint(1_000_000, 1)).toBe(0.9);
    expect(winHint(100, 100)).toBe(0.5);
    expect(winHint(0, 0)).toBe(0.5);
  });

  it('refuses to challenge yourself and anyone too far away', async () => {
    const alice = await makePlayer(h);
    const distant = await makePlayer(h);
    setStage(alice.characterId, 4);
    setStage(distant.characterId, 4 + OPPONENT_STAGE_WINDOW + 1);

    const self = await challenge(alice.token, alice.characterId);
    expect(self.statusCode).toBe(400);
    expect(expectFail(self.json()).code).toBe('SELF_CHALLENGE');

    const missing = await challenge(alice.token, 'nobody');
    expect(missing.statusCode).toBe(404);
    expect(expectFail(missing.json()).code).toBe('CHARACTER_NOT_FOUND');

    const far = await challenge(alice.token, distant.characterId);
    expect(far.statusCode).toBe(400);
    expect(expectFail(far.json()).code).toBe('INVALID_OPPONENT');
  });

  it('moves both ratings by the same amount and notifies the defender', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    // A decisive gap so the result is not a draw.
    setStage(alice.characterId, 10);
    setStage(bob.characterId, 7);

    const bobSocket = await openSocket(bob.token);
    const challenged = once<ArenaChallengedEvent>(bobSocket, 'arena:challenged');

    const result = expectOk<ArenaChallengeResponse>(
      (await challenge(alice.token, bob.characterId)).json(),
    );

    expect(result.won).toBe(true);
    expect(result.ratingBefore).toBe(1000);
    expect(result.ratingAfter).toBeGreaterThan(result.ratingBefore);
    expect(result.opponent.id).toBe(bob.characterId);
    expect(result.battle.log.at(-1)?.type).toBe('battle_end');
    expect(result.reward.exp).toBeGreaterThan(0);
    expect(result.reward.spiritStones).toBeGreaterThan(0);

    const delta = result.ratingAfter - result.ratingBefore;
    const defender = h.ctx.characters.byId(bob.characterId)!;
    expect(defender.arenaRating).toBe(1000 - delta);
    expect(defender.arenaLosses).toBe(1);
    expect(h.ctx.characters.byId(alice.characterId)!.arenaWins).toBe(1);

    const event = await challenged;
    expect(event.attackerId).toBe(alice.characterId);
    expect(event.attackerName).toBe('林素');
    expect(event.attackerStageName).toBe(stageName(10));
    expect(event.defenderLost).toBe(true);
    expect(event.ratingDelta).toBe(-delta);
    expect(event.battle.winner).toBe('A');
  });

  it('leaves both sides wounded and heals them back over ten minutes', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    setStage(alice.characterId, 9);
    setStage(bob.characterId, 9);

    expectOk<ArenaChallengeResponse>((await challenge(alice.token, bob.characterId)).json());
    const wounded = h.ctx.characters.byId(alice.characterId)!.hpPercent;
    expect(wounded).toBeLessThan(1);

    // Half the recovery window gets roughly half the missing 气血 back.
    h.clock.advance(5 * 60 * 1000);
    expectOk((await get(alice.token, '/api/arena/opponents')).json());
    const half = h.ctx.characters.byId(alice.characterId)!.hpPercent;
    expect(half).toBeGreaterThan(wounded);
    expect(half).toBeLessThanOrEqual(1);
    expect(half).toBeCloseTo(Math.min(1, wounded + 0.5), 5);

    h.clock.advance(10 * 60 * 1000);
    expectOk((await get(alice.token, '/api/arena/opponents')).json());
    expect(h.ctx.characters.byId(alice.characterId)!.hpPercent).toBe(1);
  });

  it('spends one challenge a day and stops at arenaDailyLimit', async () => {
    h.ctx.settings.patch({ arenaDailyLimit: 2 });
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    setStage(alice.characterId, 8);
    setStage(bob.characterId, 8);

    for (let i = 0; i < 2; i += 1) {
      h.clock.advance(1000);
      expectOk<ArenaChallengeResponse>((await challenge(alice.token, bob.characterId)).json());
    }
    expect(h.ctx.characters.byId(alice.characterId)!.dailyCounters.arena).toBe(2);
    expect(h.ctx.characters.byId(alice.characterId)!.progression?.daily.arena).toBe(2);

    const blocked = await challenge(alice.token, bob.characterId);
    expect(blocked.statusCode).toBe(429);
    expect(expectFail(blocked.json()).code).toBe('DAILY_LIMIT_REACHED');
  });

  it('fights a bot without a socket on the other end', async () => {
    const alice = await makePlayer(h);
    setStage(alice.characterId, 9);
    const [bot] = generateBots(
      h.ctx,
      { count: 1, minStageIndex: 9, maxStageIndex: 9, seed: 31 },
      h.clock.now(),
    );

    const before = h.ctx.characters.byId(bot!.id)!;
    const result = expectOk<ArenaChallengeResponse>((await challenge(alice.token, bot!.id)).json());

    expect(result.opponent.isBot).toBe(true);
    const after = h.ctx.characters.byId(bot!.id)!;
    expect(after.arenaRating).not.toBe(before.arenaRating);
    // 论道 must not touch the bot's 围攻 血池.
    expect(after.hpPercent).toBe(before.hpPercent);
  });

  it('pages the record list from both sides of the fight, replay included', async () => {
    h.ctx.settings.patch({ arenaDailyLimit: 100 });
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    setStage(alice.characterId, 8);
    setStage(bob.characterId, 8);

    for (let i = 0; i < 3; i += 1) {
      h.clock.advance(1000);
      expectOk<ArenaChallengeResponse>((await challenge(alice.token, bob.characterId)).json());
    }

    const first = expectOk<RecordPage>(
      (await get(alice.token, '/api/arena/records?page=1&pageSize=2')).json(),
    );
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.items[0]!.foughtAt).toBeGreaterThanOrEqual(first.items[1]!.foughtAt);
    expect(first.items[0]!.attackerName).toBe('林素');
    expect(first.items[0]!.defenderName).toBe('陈墨');
    expect(first.items[0]!.battle?.log.length).toBeGreaterThan(0);

    const second = expectOk<RecordPage>(
      (await get(alice.token, '/api/arena/records?page=2&pageSize=2')).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    // The defender sees the same three fights.
    const theirs = expectOk<RecordPage>(
      (await get(bob.token, '/api/arena/records?page=1&pageSize=20')).json(),
    );
    expect(theirs.total).toBe(3);
    expect(theirs.items.every((r) => r.defenderId === bob.characterId)).toBe(true);
  });

  it('keeps only the newest REPLAY_KEEP replays per cultivator', async () => {
    h.ctx.settings.patch({ arenaDailyLimit: 100 });
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    setStage(alice.characterId, 8);
    setStage(bob.characterId, 8);

    const total = REPLAY_KEEP + 3;
    for (let i = 0; i < total; i += 1) {
      h.clock.advance(1000);
      expectOk<ArenaChallengeResponse>((await challenge(alice.token, bob.characterId)).json());
    }

    const page = expectOk<RecordPage>(
      (await get(alice.token, `/api/arena/records?page=1&pageSize=${total}`)).json(),
    );
    expect(page.total).toBe(total);

    const withReplay = page.items.filter((r) => r.battle !== null);
    expect(withReplay).toHaveLength(REPLAY_KEEP);
    // The ones that lost their replay are the oldest, and they are still rows.
    for (const record of page.items.slice(REPLAY_KEEP)) expect(record.battle).toBeNull();
    for (const record of page.items) expect(record.winnerId).not.toBeUndefined();
  });
});
