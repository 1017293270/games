import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeStats,
  createRng,
  ITEM_BY_ID,
  powerScore,
  MONSTER_BY_ID,
  ZONE_BY_ID,
  ZONE_PVP_PROTECT_MS,
  type CharacterState,
  type Stats,
  type ZoneKill,
} from '@xianxia/shared';
import { buildApp } from '../src/app.js';
import { resolveEquipment, statsOf } from '../src/game/character.js';
import type { ZoneServiceImpl } from '../src/engine/zone/service.js';
import { zoneKillRewards } from '../src/engine/zone/rewards.js';
import { auth, createHarness, expectOk, makePlayer, type Harness } from './helpers.js';

/**
 * The 战斗大地图 loop.
 *
 * Every test drives the clock by hand: `createHarness` leaves the timers off,
 * so `ctx.zones.step` / `ctx.zones.flush` advance the field exactly as far as
 * the test wants and nothing happens in between.
 */

const ZONE = 'map-qingyun-mountain';
const ZONE_2 = 'map-luoshui-city';
const TICK = 250;

function zones(h: Harness): ZoneServiceImpl {
  return h.ctx.zones as ZoneServiceImpl;
}

function worldOf(h: Harness, zoneId = ZONE) {
  const world = zones(h).worlds.get(zoneId);
  if (!world) throw new Error(`no zone world ${zoneId}`);
  return world;
}

/** Moves a cultivator to a stage that can actually clear the 山道. */
function promote(h: Harness, characterId: string, stageIndex: number): CharacterState {
  const state = h.ctx.characters.byId(characterId);
  if (!state) throw new Error('no character');
  const next: CharacterState = { ...state, stageIndex, exp: 0, lastSettledAt: h.clock.now() };
  h.ctx.characters.save(next);
  return next;
}

/** Runs `ticks` simulation steps of `TICK` ms each. */
function run(h: Harness, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    h.clock.advance(TICK);
    h.ctx.zones.step(h.clock.now());
  }
}

function plainStats(stageIndex: number): Stats {
  return computeStats({ stageIndex, equipment: [], technique: undefined });
}

describe('zone world', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
    // 修为 is otherwise a function of the wall clock, and these tests advance
    // the clock a lot: zeroing the passive rate makes every point of 修为 in a
    // character row attributable to a kill on the field.
    h.ctx.settings.patch({ cultivationMultiplier: 0, dropRateMultiplier: 10 });
  });
  afterEach(async () => {
    await h.close();
  });

  it('banks 修为, 灵石, 掉落 and 击杀 quest counters on flush', async () => {
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);
    // An active 清剿山狼 so the flush has an objective to bump. Written straight
    // onto the row because the quest chain in front of it is not what is under
    // test here.
    const seeded = h.ctx.characters.byId(p.characterId) as CharacterState;
    h.ctx.characters.save({
      ...seeded,
      quests: [
        {
          questId: 'quest-c1-02',
          state: 'active',
          counters: [0],
          acceptedAt: h.clock.now(),
          claimedAt: null,
        },
      ],
    });

    const entered = h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;
    expect(entered.zoneId).toBe(ZONE);
    expect(entered.frame.full).toBe(true);
    expect(entered.frame.add.some((row) => row.id === p.characterId)).toBe(true);

    const before = h.ctx.characters.byId(p.characterId) as CharacterState;
    run(h, 240); // one minute on the field

    const world = worldOf(h);
    const delta = world.deltas.get(p.characterId);
    expect(delta).toBeDefined();
    if (!delta) return;
    expect(delta.kills).toBeGreaterThan(0);
    expect(delta.exp).toBeGreaterThan(0);
    expect(delta.items.size).toBeGreaterThan(0);

    const bankedExp = delta.exp;
    const bankedStones = delta.stones;
    const drops = [...delta.items.entries()].map(
      ([itemId, qty]) =>
        [itemId, qty, h.ctx.inventory.quantityOf(p.characterId, itemId)] as const,
    );
    const wolves = delta.monsterKills.get('monster-qingyun-wolf') ?? 0;
    expect(wolves).toBeGreaterThan(0);

    h.ctx.zones.flush(h.clock.now());
    expect(world.deltas.get(p.characterId)?.exp ?? 0).toBe(0);

    const after = h.ctx.characters.byId(p.characterId) as CharacterState;
    expect(after.spiritStones).toBe(before.spiritStones + bankedStones);
    expect(after.exp).toBe(before.exp + bankedExp);
    expect(after.stageIndex).toBe(before.stageIndex);
    for (const [itemId, qty, held] of drops) {
      expect(h.ctx.inventory.quantityOf(p.characterId, itemId)).toBe(held + qty);
    }
    const progress = after.quests.find((q) => q.questId === 'quest-c1-02');
    expect(progress?.counters[0]).toBe(Math.min(wolves, 5));
  });

  it('keeps gear equipped over REST mid-window, and re-rates the field from it', async () => {
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);
    h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    run(h, 40);

    const world = worldOf(h);
    const slot = world.entityOf(p.characterId)?.i;
    expect(slot).toBeDefined();
    const beforeAtk = world.sim.entities[slot as number]?.stats.atk ?? 0;

    // A gear change lands through the ordinary REST path, on the ordinary
    // read-settle-write cycle, while the field is mid-window.
    const [uid] = h.ctx.inventory.add(p.characterId, 'treasure-sword', 1);
    expectOk(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/inventory/equip',
          headers: auth(p.token),
          payload: { uid },
        })
      ).json(),
    );

    run(h, 40);
    h.ctx.zones.flush(h.clock.now());

    const after = h.ctx.characters.byId(p.characterId) as CharacterState;
    expect(after.equipment.treasure).toBe(uid);
    expect(ITEM_BY_ID.get('treasure-sword')?.kind).toBe('equipment');
    expect(after.powerScore).toBe(
      powerScore(statsOf(after, resolveEquipment(after, h.ctx.inventory))),
    );
    // The flush rebuilt the field's copy from the row it just wrote, so the
    // sword is now swinging in the simulation too.
    const afterAtk = world.sim.entities[slot as number]?.stats.atk ?? 0;
    expect(afterAtk).toBeGreaterThan(beforeAtk);
    expect(afterAtk).toBe(statsOf(after, resolveEquipment(after, h.ctx.inventory)).atk);
  });

  it('pays a 机器人修士 修为 without ever writing it an inventory row', () => {
    h.ctx.settings.patch({ botCount: 3 });
    h.ctx.bots.ensurePopulation(h.clock.now());
    const bots = h.ctx.characters.allBots();
    expect(bots.length).toBe(3);

    const world = worldOf(h);
    for (const bot of bots) {
      expect(h.ctx.zones.enterBot({ ...bot, stageIndex: 12 }, ZONE, h.clock.now())).toBe(true);
    }
    run(h, 240);

    const banked = new Map(
      bots.map((b) => [b.id, { ...(world.deltas.get(b.id) ?? { exp: 0, stones: 0 }) }]),
    );
    expect([...banked.values()].some((d) => d.exp > 0)).toBe(true);
    expect(bots.some((b) => (world.deltas.get(b.id)?.items.size ?? 0) > 0)).toBe(true);

    const before = new Map(bots.map((b) => [b.id, h.ctx.characters.byId(b.id) as CharacterState]));
    h.ctx.zones.flush(h.clock.now());

    for (const bot of bots) {
      const after = h.ctx.characters.byId(bot.id) as CharacterState;
      const start = before.get(bot.id) as CharacterState;
      expect(after.spiritStones).toBe(start.spiritStones + (banked.get(bot.id)?.stones ?? 0));
      // Bot loadouts are derived from id and 大境界, so a bot owns no rows.
      expect(h.ctx.inventory.list(bot.id).length).toBe(0);
    }
  });

  it('scales rewards by zoneRewardScale and halves an offline player', async () => {
    const settings = h.ctx.settings.get();
    const wolf = MONSTER_BY_ID.get('monster-qingyun-wolf') as NonNullable<
      ReturnType<typeof MONSTER_BY_ID.get>
    >;
    const kill: ZoneKill = {
      killerI: 0,
      victimI: 1,
      victimKind: 'monster',
      monsterId: wolf.id,
      isBoss: false,
      damageShares: [[0, 1]],
    };
    const online = zoneKillRewards(kill, settings, createRng(1), () => true);
    const offline = zoneKillRewards(kill, settings, createRng(1), () => false);
    expect(online[0]?.exp).toBe(Math.round(wolf.expReward * settings.zoneRewardScale));
    expect(offline[0]?.exp).toBe(
      Math.round(wolf.expReward * settings.zoneRewardScale * settings.zoneOfflineYield),
    );
    expect(zoneKillRewards(kill, settings, createRng(1), () => null)).toEqual([]);

    // And the same arithmetic end to end: a player nobody is connected as keeps
    // farming, at `zoneOfflineYield` of the rate.
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);
    h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    expect(h.ctx.presence.isOnline(p.characterId)).toBe(false);
    run(h, 240);

    const delta = worldOf(h).deltas.get(p.characterId);
    expect(delta?.kills).toBeGreaterThan(0);
    let expected = 0;
    for (const [monsterId, n] of delta?.monsterKills ?? []) {
      const monster = MONSTER_BY_ID.get(monsterId);
      if (!monster) continue;
      expected +=
        n *
        Math.round(
          monster.expReward * settings.zoneRewardScale * settings.zoneOfflineYield,
        );
    }
    expect(delta?.exp).toBe(expected);
  });

  it('sweeps a player out once it has been away longer than offlineCapHours', async () => {
    const p = await makePlayer(h);
    h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    const world = worldOf(h);
    expect(world.entityOf(p.characterId)).not.toBeNull();
    expect(h.ctx.zones.zoneOf(p.characterId)).toBe(ZONE);

    const cap = h.ctx.settings.get().offlineCapHours;
    h.clock.advance(cap * 3_600_000 - 60_000);
    h.ctx.zones.flush(h.clock.now());
    expect(world.entityOf(p.characterId)).not.toBeNull();

    h.clock.advance(120_000);
    h.ctx.zones.flush(h.clock.now());
    expect(world.entityOf(p.characterId)).toBeNull();
    expect(h.ctx.zones.zoneOf(p.characterId)).toBeNull();
    expect(memberRow(h, p.characterId)).toBeUndefined();
  });

  it('rebuilds the field from 图籍 after a restart, at the entrance and logged out', async () => {
    const fresh = createHarness();
    let second: ReturnType<typeof buildApp> | null = null;
    try {
      const p = await makePlayer(fresh);
      const entered = fresh.ctx.zones.enter(p.characterId, ZONE, fresh.clock.now());
      expect(entered.ok).toBe(true);
      expect(memberRow(fresh, p.characterId)?.zone_id).toBe(ZONE);

      const config = fresh.ctx.config;
      await fresh.app.close();

      second = buildApp({ config, now: fresh.clock.now, startBots: false, startZones: false });
      const rebuilt = second.ctx.zones as ZoneServiceImpl;
      rebuilt.start();
      try {
        const world = rebuilt.worlds.get(ZONE);
        const entity = world?.entityOf(p.characterId);
        expect(entity).toBeTruthy();
        expect(entity?.kind).toBe('player');
        expect(entity?.online).toBe(false);
        const gate = ZONE_BY_ID.get(ZONE);
        expect(Math.abs((entity?.x ?? 0) - (gate?.entrance.x ?? 0))).toBeLessThanOrEqual(3);
        expect(Math.abs((entity?.y ?? 0) - (gate?.entrance.y ?? 0))).toBeLessThanOrEqual(2);
        expect(rebuilt.zoneOf(p.characterId)).toBe(ZONE);
      } finally {
        rebuilt.stop();
      }
    } finally {
      if (second) await second.app.close();
      rmSync(fresh.dataDir, { recursive: true, force: true });
    }
  });

  it('moves the loser 灵石 to the winner the moment a PvP kill lands', async () => {
    h.ctx.settings.patch({ mapPvp: true, mapPvpStoneLoss: 0.05 });
    const killer = await makePlayer(h);
    const victim = await makePlayer(h);
    for (const p of [killer, victim]) promote(h, p.characterId, 12);
    const rich = h.ctx.characters.byId(victim.characterId) as CharacterState;
    h.ctx.characters.save({ ...rich, spiritStones: 1000 });
    h.ctx.presence.join(victim.characterId);

    h.ctx.zones.enter(killer.characterId, ZONE, h.clock.now());
    h.ctx.zones.enter(victim.characterId, ZONE, h.clock.now());
    const world = worldOf(h);
    const a = world.entityOf(killer.characterId);
    const b = world.entityOf(victim.characterId);
    expect(a && b).toBeTruthy();
    if (!a || !b) return;

    // Put them on top of each other with the grace period spent, which is what
    // a minute of walking would have produced anyway, and strip the 神通 —
    // two cultivators count as allies to a heal, so a 木系 rotation would keep
    // patching the victim up faster than a 普攻 takes it down.
    h.clock.advance(ZONE_PVP_PROTECT_MS + TICK);
    for (const e of [a, b]) {
      e.protectedUntil = 0;
      e.skills = [];
      e.cooldowns = [];
      e.modifiers = [];
    }
    a.aggression = 1;
    b.aggression = 0;

    for (let i = 0; i < 60 && b.state !== 'dead'; i += 1) {
      a.x = b.x;
      a.y = b.y;
      a.targetI = b.i;
      b.targetI = a.i;
      b.hp = 1;
      run(h, 1);
    }
    expect(b.state).toBe('dead');

    const loser = h.ctx.characters.byId(victim.characterId) as CharacterState;
    expect(loser.spiritStones).toBe(950);
    expect(world.deltas.get(killer.characterId)?.stones).toBeGreaterThanOrEqual(50);
  });

  it('is idempotent on re-entry and banks the old field when moving', async () => {
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);

    const first = h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    run(h, 120);

    const again = h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.self).toBe(first.self);
    expect(again.enteredAt).toBe(first.enteredAt);
    expect(worldOf(h).cultivators).toBe(1);

    const owed = worldOf(h).deltas.get(p.characterId)?.stones ?? 0;
    expect(owed).toBeGreaterThan(0);
    const before = h.ctx.characters.byId(p.characterId) as CharacterState;

    const moved = h.ctx.zones.enter(p.characterId, ZONE_2, h.clock.now());
    expect(moved.ok).toBe(true);
    expect(worldOf(h).entityOf(p.characterId)).toBeNull();
    expect(worldOf(h, ZONE_2).entityOf(p.characterId)).not.toBeNull();
    expect(h.ctx.zones.zoneOf(p.characterId)).toBe(ZONE_2);
    expect(memberRow(h, p.characterId)?.zone_id).toBe(ZONE_2);
    // Nothing the old field owed was dropped on the way across.
    const after = h.ctx.characters.byId(p.characterId) as CharacterState;
    expect(after.spiritStones).toBe(before.spiritStones + owed);
  });

  it('refuses a locked map and a full one', async () => {
    const newbie = await makePlayer(h);
    const locked = h.ctx.zones.enter(newbie.characterId, ZONE_2, h.clock.now());
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.code).toBe('MAP_LOCKED');

    const missing = h.ctx.zones.enter(newbie.characterId, 'map-nowhere', h.clock.now());
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe('NOT_FOUND');

    // Fill the field to its content capacity. `world.add` is the same call
    // `enter` makes, minus the gate under test.
    const world = worldOf(h);
    const zone = ZONE_BY_ID.get(ZONE);
    const stats = plainStats(1);
    while (world.cultivators < (zone?.capacity ?? 0)) {
      world.add(
        {
          id: `filler-${world.cultivators}`,
          kind: 'bot',
          name: '填场散修',
          art: null,
          stageIndex: 1,
          stats,
          skills: [],
          hpShare: 1,
          online: true,
          aggression: 0,
        },
        h.clock.now(),
      );
    }
    const full = h.ctx.zones.enter(newbie.characterId, ZONE, h.clock.now());
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.code).toBe('ZONE_FULL');

    // Bots stop `ZONE_BOT_CAPACITY_MARGIN` short of the same cap.
    const bot = h.ctx.characters.byId(newbie.characterId) as CharacterState;
    expect(h.ctx.zones.enterBot({ ...bot, isBot: true }, ZONE, h.clock.now())).toBe(false);
  });

  it('reports nothing until the loop has run, then one row per field', async () => {
    expect(h.ctx.zones.stats()).toEqual([]);
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);
    h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    run(h, 4);

    const rows = h.ctx.zones.stats();
    expect(rows.length).toBe(ZONE_BY_ID.size);
    const row = rows.find((r) => r.zoneId === ZONE);
    expect(row?.players).toBe(1);
    expect(row?.bots).toBe(0);
    expect(row?.monsters).toBeGreaterThan(0);
    expect(row?.bossAlive).toBe(false);
    expect(row?.watchers).toBe(0);
    expect(row?.lastStepMs).toBeGreaterThanOrEqual(0);
  });

  it('steps 200 修士 and 40 妖兽 in well under a frame', () => {
    h.ctx.settings.patch({ botCount: 200, monsterDensity: 1.3 });
    h.ctx.bots.ensurePopulation(h.clock.now());
    const bots = h.ctx.characters.allBots();
    expect(bots.length).toBe(200);

    // Straight onto the field: `enterBot` deliberately stops 20 short of the
    // 120-cultivator capacity, and the number under test here is the cost of a
    // step, not of the gate.
    const world = worldOf(h);
    for (const bot of bots) {
      world.add(
        {
          id: bot.id,
          kind: 'bot',
          name: bot.name,
          art: bot.avatarArt,
          stageIndex: bot.stageIndex,
          stats: plainStats(bot.stageIndex),
          skills: bot.skillSlots,
          hpShare: 1,
          online: true,
          aggression: bot.botParams?.aggression ?? 0,
        },
        h.clock.now(),
      );
    }
    const monsters = world.stats().monsters;
    expect(monsters).toBeGreaterThanOrEqual(38);
    expect(world.stats().bots).toBe(200);

    // Half a minute of field time first, so the measurement is taken with the
    // whole population in melee rather than still walking out of the gate.
    run(h, 120);
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      h.clock.advance(TICK);
      const started = performance.now();
      h.ctx.zones.step(h.clock.now());
      samples.push(performance.now() - started);
    }
    const worst = Math.max(...samples);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

    const earners = [...world.deltas.values()].filter((d) => d.kills > 0).length;
    const flushStarted = performance.now();
    h.ctx.zones.flush(h.clock.now());
    const flushMs = performance.now() - flushStarted;

    console.log(
      `[zone] ${world.stats().bots} 修士 + ${monsters} 妖兽:` +
        ` step mean ${mean.toFixed(2)}ms worst ${worst.toFixed(2)}ms,` +
        ` flush ${flushMs.toFixed(2)}ms over ${earners} 有斩获修士`,
    );
    expect(earners).toBeGreaterThan(0);
    expect(worst).toBeLessThan(30);
  });

  it('takes a player off the field for good on retreat', async () => {
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);
    h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    run(h, 120);
    const owed = worldOf(h).deltas.get(p.characterId)?.stones ?? 0;
    const before = h.ctx.characters.byId(p.characterId) as CharacterState;

    expect(h.ctx.zones.retreat(p.characterId, h.clock.now())).toBe(true);
    expect(h.ctx.zones.retreat(p.characterId, h.clock.now())).toBe(false);
    expect(worldOf(h).entityOf(p.characterId)).toBeNull();
    expect(memberRow(h, p.characterId)).toBeUndefined();
    const after = h.ctx.characters.byId(p.characterId) as CharacterState;
    expect(after.spiritStones).toBe(before.spiritStones + owed);
  });

  it('resumes whichever field the character was left standing on', async () => {
    const p = await makePlayer(h);
    promote(h, p.characterId, 12);
    expect(h.ctx.zones.resume(p.characterId, h.clock.now())).toBeNull();

    const entered = h.ctx.zones.enter(p.characterId, ZONE, h.clock.now());
    expect(entered.ok).toBe(true);
    const resumed = h.ctx.zones.resume(p.characterId, h.clock.now());
    expect(resumed?.ok).toBe(true);
    if (!resumed?.ok) return;
    expect(resumed.zoneId).toBe(ZONE);
    expect(resumed.frame.full).toBe(true);
  });
});

/** The stored 图籍 row, straight out of SQLite. */
function memberRow(h: Harness, characterId: string): { zone_id: string } | undefined {
  return h.ctx.db
    .prepare('SELECT zone_id FROM zone_members WHERE character_id = ?')
    .get(characterId) as { zone_id: string } | undefined;
}
