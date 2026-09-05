import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { DUNGEON_BY_ID, getStage, stageName } from '@xianxia/shared';
import type {
  ClientToServerEvents,
  DungeonResultEvent,
  DungeonStartEvent,
  DungeonStartResponse,
  Party,
  ServerToClientEvents,
} from '@xianxia/shared';
import { attachSocketIo } from '../src/socket.js';
import { partyHandlers } from '../src/modules/party/routes.js';
import { dungeonHandlers } from '../src/modules/dungeon/routes.js';
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

interface DungeonListEntry {
  id: string;
  name: string;
  unlocked: boolean;
  runsToday: number;
  dailyLimit: number;
  boss: { id: string; name: string };
}

function once<T>(socket: ClientSocket, event: keyof ServerToClientEvents, ms = 6000): Promise<T> {
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

const QINGYUN = DUNGEON_BY_ID.get('dungeon-qingyun')!;

describe('dungeon', () => {
  let h: Harness;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness({ handlers: { ...partyHandlers, ...dungeonHandlers } });
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

  /**
   * Puts a cultivator at `stageIndex` so a 秘境 is both unlocked and winnable.
   * `attackOnly` strips 木灵愈体 out of the rotation, which every starter
   * loadout carries — a mid-run heal is legitimate play but makes 气血 across
   * waves non-monotonic, and one test wants to watch it only fall.
   */
  const setStage = (player: Player, stageIndex: number, attackOnly = false): void => {
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex,
      exp: getStage(stageIndex).expRequired * 0.5,
      skillSlots: attackOnly ? ['skill-fire-1', null, null, null] : state.skillSlots,
      lastSettledAt: h.clock.now(),
      lastSeenAt: h.clock.now(),
    });
  };

  const start = (token: string, dungeonId: string, withParty = false) =>
    post(token, '/api/dungeon/start', { dungeonId, withParty });

  it('lists four 秘境 with unlock state, quota and BOSS', async () => {
    const alice = await makePlayer(h);
    const list = expectOk<{ dungeons: DungeonListEntry[] }>(
      (await get(alice.token, '/api/dungeon')).json(),
    );

    expect(list.dungeons).toHaveLength(4);
    const qingyun = list.dungeons.find((d) => d.id === QINGYUN.id)!;
    expect(qingyun.unlocked).toBe(false);
    expect(qingyun.runsToday).toBe(0);
    expect(qingyun.dailyLimit).toBe(
      h.ctx.settings.get().dungeonDailyLimit + QINGYUN.bonusDailyEntries,
    );
    expect(qingyun.boss.id).toBe(QINGYUN.bossId);
  });

  it('locks a 秘境 below its unlock stage', async () => {
    const alice = await makePlayer(h);
    const response = await start(alice.token, QINGYUN.id);
    expect(response.statusCode).toBe(403);
    const error = expectFail(response.json());
    expect(error.code).toBe('DUNGEON_LOCKED');
    expect(error.message).toContain(stageName(QINGYUN.unlockStage));
  });

  it('runs every wave with the BOSS last and hands out the reward', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    setStage(alice, 20);

    const result = expectOk<DungeonStartResponse>((await start(alice.token, QINGYUN.id)).json());

    expect(result.cleared).toBe(true);
    expect(result.battles).toHaveLength(QINGYUN.waves.length + 1);
    // The BOSS is the last thing standing on team B of the final wave.
    expect(Object.keys(result.battles.at(-1)!.finalHp)).toContain(QINGYUN.bossId);
    expect(result.participantIds).toEqual([alice.characterId]);
    expect(result.reward.exp).toBeGreaterThan(0);
    expect(result.reward.spiritStones).toBeGreaterThan(0);

    const runs = h.ctx.dungeonRuns.forParticipant(alice.characterId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.dungeonId).toBe(QINGYUN.id);
    expect(runs[0]!.cleared).toBe(true);
    expect(runs[0]!.leaderId).toBe(alice.characterId);
    expect(runs[0]!.participantIds).toEqual([alice.characterId]);
    expect(h.ctx.dungeonRuns.countCleared(alice.characterId, QINGYUN.id)).toBe(1);
  });

  it('carries 气血 from one wave into the next', async () => {
    const alice = await makePlayer(h);
    setStage(alice, 12, true);

    const result = expectOk<DungeonStartResponse>((await start(alice.token, QINGYUN.id)).json());
    const shares = result.battles.map((battle) => battle.finalHp[alice.characterId] ?? 0);

    // Each wave opens on what the previous one left, so 气血 only ever falls
    // across a run. The one point of slack is the integer rounding
    // `characterCombatant` does when it turns a share back into 气血.
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[i]!).toBeLessThanOrEqual(shares[i - 1]! + 1);
    }

    const after = h.ctx.characters.byId(alice.characterId)!;
    expect(after.hpPercent).toBeLessThan(1);
    expect(after.hpPercent).toBeGreaterThan(0);
  });

  it('spends one daily entry per run and refuses the run past the quota', async () => {
    h.ctx.settings.patch({ dungeonDailyLimit: 1 });
    const alice = await makePlayer(h);
    setStage(alice, 20);

    expectOk<DungeonStartResponse>((await start(alice.token, QINGYUN.id)).json());
    expect(h.ctx.characters.byId(alice.characterId)!.dailyCounters.dungeon).toBe(1);

    const second = await start(alice.token, QINGYUN.id);
    expect(second.statusCode).toBe(429);
    expect(expectFail(second.json()).code).toBe('DAILY_LIMIT_REACHED');
  });

  it('needs a party for a party run, and only the leader may open the gate', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    setStage(alice, 20);
    setStage(bob, 20);

    const solo = await start(alice.token, QINGYUN.id, true);
    expect(solo.statusCode).toBe(409);
    expect(expectFail(solo.json()).code).toBe('NOT_IN_PARTY');

    const party = expectOk<Party>((await post(alice.token, '/api/party/create')).json());
    await post(bob.token, '/api/party/join', { code: party.code });

    const notLeader = await start(bob.token, QINGYUN.id, true);
    expect(notLeader.statusCode).toBe(403);
    expect(expectFail(notLeader.json()).code).toBe('NOT_PARTY_LEADER');
  });

  it('runs a party 秘境: both fight, both get loot, both hear the events', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    setStage(alice, 20);
    setStage(bob, 20);

    const aliceSocket = await openSocket(alice.token);
    const bobSocket = await openSocket(bob.token);

    const party = expectOk<Party>((await post(alice.token, '/api/party/create')).json());
    await post(bob.token, '/api/party/join', { code: party.code });

    const bobStart = once<DungeonStartEvent>(bobSocket, 'dungeon:start');
    const bobResult = once<DungeonResultEvent>(bobSocket, 'dungeon:result');
    const aliceResult = once<DungeonResultEvent>(aliceSocket, 'dungeon:result');

    const before = {
      alice: h.ctx.characters.byId(alice.characterId)!.spiritStones,
      bob: h.ctx.characters.byId(bob.characterId)!.spiritStones,
    };

    const result = expectOk<DungeonStartResponse>(
      (await start(alice.token, QINGYUN.id, true)).json(),
    );

    expect(result.participantIds.sort()).toEqual([alice.characterId, bob.characterId].sort());
    expect(result.cleared).toBe(true);

    const startEvent = await bobStart;
    expect(startEvent.dungeonId).toBe(QINGYUN.id);
    expect(startEvent.dungeonName).toBe(QINGYUN.name);
    expect(startEvent.partyMemberIds).toHaveLength(2);

    for (const event of [await aliceResult, await bobResult]) {
      expect(event.cleared).toBe(true);
      expect(event.replay).toHaveLength(QINGYUN.waves.length + 1);
      expect(event.reward.spiritStones).toBe(result.reward.spiritStones);
      expect(event.participantIds).toHaveLength(2);
    }

    // Every participant is paid in full, not a split share.
    const after = {
      alice: h.ctx.characters.byId(alice.characterId)!.spiritStones,
      bob: h.ctx.characters.byId(bob.characterId)!.spiritStones,
    };
    expect(after.alice - before.alice).toBe(result.reward.spiritStones);
    expect(after.bob - before.bob).toBe(result.reward.spiritStones);

    // Both fought: team A of every wave carries both cultivators.
    for (const battle of result.battles) {
      expect(Object.keys(battle.finalHp)).toEqual(
        expect.arrayContaining([alice.characterId, bob.characterId]),
      );
    }

    for (const player of [alice, bob]) {
      expect(h.ctx.characters.byId(player.characterId)!.dailyCounters.dungeon).toBe(1);
    }

    const run = h.ctx.dungeonRuns.forParticipant(bob.characterId)[0]!;
    expect(run.leaderId).toBe(alice.characterId);
    expect(run.participantIds).toHaveLength(2);
    expect(run.cleared).toBe(true);
  });

  it('records a failed run and hands out nothing', async () => {
    const alice = await makePlayer(h);
    // Just past the gate but far below the recommended stage: the BOSS wins.
    setStage(alice, QINGYUN.unlockStage);

    const stones = h.ctx.characters.byId(alice.characterId)!.spiritStones;
    const result = expectOk<DungeonStartResponse>((await start(alice.token, QINGYUN.id)).json());

    expect(result.cleared).toBe(false);
    expect(result.reward.exp).toBe(0);
    expect(result.reward.spiritStones).toBe(0);
    expect(h.ctx.characters.byId(alice.characterId)!.spiritStones).toBe(stones);

    const run = h.ctx.dungeonRuns.forParticipant(alice.characterId)[0]!;
    expect(run.cleared).toBe(false);
    expect(h.ctx.dungeonRuns.countCleared(alice.characterId)).toBe(0);
    // The entry is still spent — a wipe costs the attempt.
    expect(h.ctx.characters.byId(alice.characterId)!.dailyCounters.dungeon).toBe(1);
  });
});
