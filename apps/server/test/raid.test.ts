import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { getStage, MAX_STAGE_INDEX } from '@xianxia/shared';
import type {
  ClientToServerEvents,
  Party,
  RaidAttackResponse,
  RaidTarget,
  RaidUpdateEvent,
  ServerToClientEvents,
} from '@xianxia/shared';
import { attachSocketIo } from '../src/socket.js';
import { partyHandlers } from '../src/modules/party/routes.js';
import { raidHandlers } from '../src/modules/raid/routes.js';
import { bountyFor, RAID_STAGE_FLOOR } from '../src/modules/raid/service.js';
import { prestigeOf } from '../src/modules/raid/repo.js';
import { generateBots } from '../src/engine/bots/generate.js';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
} from './helpers.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

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

describe('raid', () => {
  let h: Harness;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness({ handlers: { ...partyHandlers, ...raidHandlers } });
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
   * `attackOnly` drops 木灵愈体 — which nearly every starter loadout carries —
   * so a fight is a pure damage race. The 血池 tests need that: a heal on either
   * side makes the pool's fall non-monotonic per attack.
   */
  const ATTACK_ONLY: (string | null)[] = ['skill-fire-1', null, null, null];

  const setStage = (characterId: string, stageIndex: number, attackOnly = false): void => {
    const state = h.ctx.characters.byId(characterId)!;
    h.ctx.characters.save({
      ...state,
      stageIndex,
      exp: getStage(stageIndex).expRequired * 0.5,
      skillSlots: attackOnly ? [...ATTACK_ONLY] : state.skillSlots,
      lastSettledAt: h.clock.now(),
      lastSeenAt: h.clock.now(),
    });
  };

  /** One raidable bot pinned to `stageIndex`. */
  const makeBot = (stageIndex: number, seed: number, attackOnly = false): string => {
    const [bot] = generateBots(
      h.ctx,
      { count: 1, minStageIndex: stageIndex, maxStageIndex: stageIndex, seed },
      h.clock.now(),
    );
    if (attackOnly) h.ctx.characters.save({ ...bot!, skillSlots: [...ATTACK_ONLY] });
    return bot!.id;
  };

  const attack = (token: string, botId: string, withParty = false) =>
    post(token, '/api/raid/attack', { botId, withParty });

  const targets = async (token: string): Promise<RaidTarget[]> =>
    expectOk<{ targets: RaidTarget[] }>((await get(token, '/api/raid/targets')).json()).targets;

  it('lists only 金丹 and above, strongest first, with 血池 and bounty', async () => {
    const alice = await makePlayer(h);
    generateBots(
      h.ctx,
      { count: 12, minStageIndex: RAID_STAGE_FLOOR, maxStageIndex: 16, seed: 5 },
      h.clock.now(),
    );
    // Too weak to be worth ganging up on.
    generateBots(h.ctx, { count: 5, minStageIndex: 0, maxStageIndex: 5, seed: 6 }, h.clock.now());

    const list = await targets(alice.token);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(20);

    for (const target of list) {
      expect(target.isBot).toBe(true);
      expect(target.stageIndex).toBeGreaterThanOrEqual(RAID_STAGE_FLOOR);
      expect(target.hpPercent).toBe(1);
      expect(target.protectedUntil).toBe(0);
      expect(target.bounty).toBe(bountyFor(target.stageIndex));
    }
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i]!.powerScore).toBeLessThanOrEqual(list[i - 1]!.powerScore);
    }
  });

  it('doubles the bounty with every major realm', () => {
    expect(bountyFor(0)).toBe(500);
    expect(bountyFor(RAID_STAGE_FLOOR)).toBe(2000);
    expect(bountyFor(12)).toBe(4000);
    expect(bountyFor(16)).toBe(8000);
  });

  it('refuses a player target', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);

    const response = await attack(alice.token, bob.characterId);
    expect(response.statusCode).toBe(400);
    expect(expectFail(response.json()).code).toBe('TARGET_NOT_BOT');

    const missing = await attack(alice.token, 'nobody');
    expect(missing.statusCode).toBe(404);
    expect(expectFail(missing.json()).code).toBe('CHARACTER_NOT_FOUND');
  });

  it('drains the 血池 across attacks instead of resetting it', async () => {
    const alice = await makePlayer(h);
    // A target above the raider: one pass dents it, it takes several to fell.
    setStage(alice.characterId, 12, true);
    const botId = makeBot(14, 41, true);

    const first = expectOk<RaidAttackResponse>((await attack(alice.token, botId)).json());
    expect(first.defeated).toBe(false);
    expect(first.remainingHpPercent).toBeLessThan(1);
    expect(first.remainingHpPercent).toBeGreaterThan(0);
    expect(first.participantIds).toEqual([alice.characterId]);
    expect(first.target.hpPercent).toBe(first.remainingHpPercent);

    // Long enough for the raider's own 气血 to come back; the target's does not.
    h.clock.advance(10 * 60 * 1000);
    expect(h.ctx.characters.byId(alice.characterId)!.hpPercent).toBeLessThan(1);

    const second = expectOk<RaidAttackResponse>((await attack(alice.token, botId)).json());
    expect(second.remainingHpPercent).toBeLessThan(first.remainingHpPercent);

    // The board agrees with the fight.
    const listed = (await targets(alice.token)).find((t) => t.id === botId)!;
    expect(listed.hpPercent).toBe(second.remainingHpPercent);
  });

  it('brings a target down, splits the bounty, pays 声望 and raises the shield', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    setStage(alice.characterId, MAX_STAGE_INDEX);
    setStage(bob.characterId, MAX_STAGE_INDEX);

    const watcher = await openSocket(bob.token);
    const botId = makeBot(RAID_STAGE_FLOOR, 42);
    const bounty = bountyFor(h.ctx.characters.byId(botId)!.stageIndex);

    const party = expectOk<Party>((await post(alice.token, '/api/party/create')).json());
    expectOk<Party>((await post(bob.token, '/api/party/join', { code: party.code })).json());

    const before = {
      alice: h.ctx.characters.byId(alice.characterId)!.spiritStones,
      bob: h.ctx.characters.byId(bob.characterId)!.spiritStones,
    };
    const broadcast = once<RaidUpdateEvent>(watcher, 'raid:update');

    let result: RaidAttackResponse | null = null;
    for (let i = 0; i < 12 && result?.defeated !== true; i += 1) {
      h.clock.advance(1000);
      result = expectOk<RaidAttackResponse>((await attack(alice.token, botId, true)).json());
    }

    expect(result?.defeated).toBe(true);
    expect(result!.remainingHpPercent).toBe(0);
    expect(result!.participantIds.sort()).toEqual(
      [alice.characterId, bob.characterId].sort(),
    );

    const each = Math.floor(bounty / 2);
    const after = {
      alice: h.ctx.characters.byId(alice.characterId)!.spiritStones,
      bob: h.ctx.characters.byId(bob.characterId)!.spiritStones,
    };
    expect(after.alice - before.alice).toBe(each);
    expect(after.bob - before.bob).toBe(each);
    expect(prestigeOf(h.ctx, alice.characterId)).toBe(1);
    expect(prestigeOf(h.ctx, bob.characterId)).toBe(1);

    const shieldUntil = h.clock.now() + h.ctx.settings.get().raidRecoverMinutes * 60_000;
    expect(h.ctx.characters.byId(botId)!.protectedUntil).toBe(shieldUntil);
    expect(result!.target.protectedUntil).toBe(shieldUntil);

    // The world hears about it.
    const event = await broadcast;
    expect(event.botId).toBe(botId);
    expect(event.attackerNames.sort()).toEqual(['林素', '陈墨'].sort());
    expect(event.lastDamage).toBeGreaterThan(0);
  });

  it('locks the target behind TARGET_PROTECTED, then returns it whole', async () => {
    const alice = await makePlayer(h);
    setStage(alice.characterId, MAX_STAGE_INDEX);
    const botId = makeBot(RAID_STAGE_FLOOR, 43);

    let result: RaidAttackResponse | null = null;
    for (let i = 0; i < 12 && result?.defeated !== true; i += 1) {
      h.clock.advance(1000);
      result = expectOk<RaidAttackResponse>((await attack(alice.token, botId)).json());
    }
    expect(result?.defeated).toBe(true);

    const blocked = await attack(alice.token, botId);
    expect(blocked.statusCode).toBe(409);
    expect(expectFail(blocked.json()).code).toBe('TARGET_PROTECTED');

    const shielded = (await targets(alice.token)).find((t) => t.id === botId)!;
    expect(shielded.hpPercent).toBe(0);
    expect(shielded.protectedUntil).toBeGreaterThan(h.clock.now());

    // Once the shield lapses the 血池 is whole again.
    h.clock.advance(h.ctx.settings.get().raidRecoverMinutes * 60_000 + 1000);
    const recovered = (await targets(alice.token)).find((t) => t.id === botId)!;
    expect(recovered.hpPercent).toBe(1);
    expect(recovered.protectedUntil).toBe(0);

    h.clock.advance(1000);
    const again = expectOk<RaidAttackResponse>((await attack(alice.token, botId)).json());
    expect(again.remainingHpPercent).toBeLessThan(1);
  });

  it('a party hits harder than one cultivator alone', async () => {
    const alice = await makePlayer(h);
    const bob = await makePlayer(h);
    setStage(alice.characterId, 12, true);
    setStage(bob.characterId, 12, true);
    // Only members holding a live socket join the fight.
    await openSocket(bob.token);

    const soloBot = makeBot(14, 51, true);
    const partyBot = makeBot(14, 51, true);

    const solo = expectOk<RaidAttackResponse>((await attack(alice.token, soloBot)).json());

    const party = expectOk<Party>((await post(alice.token, '/api/party/create')).json());
    await post(bob.token, '/api/party/join', { code: party.code });

    // Heal the solo wounds off first, so the comparison is two fresh raiders
    // against one, not one tired raider against one fresh.
    h.clock.advance(10 * 60 * 1000);
    const together = expectOk<RaidAttackResponse>(
      (await attack(alice.token, partyBot, true)).json(),
    );

    expect(together.participantIds).toHaveLength(2);
    expect(together.remainingHpPercent).toBeLessThan(solo.remainingHpPercent);
  });
});
