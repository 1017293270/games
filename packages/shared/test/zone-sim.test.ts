import { describe, expect, it } from 'vitest';
import { ZoneSchema, type Zone } from '../src/domain/zone.js';
import { DEFAULT_WORLD_SETTINGS } from '../src/domain/world.js';
import { baseStatsForStage } from '../src/cultivation/attributes.js';
import { ZONES, ZONE_BY_ID, ZONE_PVP_PROTECT_MS, zoneFor } from '../src/content/zones.js';
import { EXPLORE_MAP_BY_ID } from '../src/content/maps.js';
import { ZONE_FLAGS } from '../src/protocol/zone.js';
import {
  addCultivator,
  buildFrame,
  createZoneSim,
  refreshCultivator,
  removeEntity,
  setOnline,
  setRules,
  stepZone,
  zoneBotCount,
  zoneMonsterCount,
  zonePlayerCount,
  type AddCultivatorInput,
  type ZoneEntity,
  type ZoneRules,
  type ZoneSim,
} from '../src/zone/sim.js';

const RULES: ZoneRules = {
  tickMs: DEFAULT_WORLD_SETTINGS.zoneTickMs,
  mapPvp: DEFAULT_WORLD_SETTINGS.mapPvp,
  mapPvpStoneLoss: DEFAULT_WORLD_SETTINGS.mapPvpStoneLoss,
  mapDeathRespawnSec: DEFAULT_WORLD_SETTINGS.mapDeathRespawnSec,
  monsterDensity: DEFAULT_WORLD_SETTINGS.monsterDensity,
  respawnMultiplier: DEFAULT_WORLD_SETTINGS.respawnMultiplier,
  bossIntervalMinutes: DEFAULT_WORLD_SETTINGS.bossIntervalMinutes,
};

function rules(overrides: Partial<ZoneRules> = {}): ZoneRules {
  return { ...RULES, ...overrides };
}

const T0 = 1_800_000_000_000;

/** A small hand-built field, so a test can reason about every occupant. */
function testZone(overrides: Partial<Zone> = {}): Zone {
  return ZoneSchema.parse({
    id: 'map-qingyun-mountain',
    floorArt: 'zone/qingyun-mountain',
    width: 40,
    height: 40,
    entrance: { x: 20, y: 36 },
    spawns: [
      {
        monsterId: 'monster-qingyun-wolf',
        count: 4,
        respawnSec: 5,
        area: { x: 16, y: 16, w: 8, h: 8 },
      },
    ],
    boss: { monsterId: 'boss-qingyun-tiger-king', area: { x: 16, y: 2, w: 8, h: 6 } },
    capacity: 60,
    ...overrides,
  } satisfies Zone);
}

function cultivator(
  id: string,
  stageIndex: number,
  overrides: Partial<AddCultivatorInput> = {},
): AddCultivatorInput {
  return {
    id,
    kind: 'player',
    name: id,
    art: 'avatar/m01',
    stageIndex,
    stats: baseStatsForStage(stageIndex),
    skills: ['skill-fire-1'],
    hpShare: 1,
    online: true,
    aggression: 0,
    ...overrides,
  };
}

/** Runs `steps` whole ticks, one `stepZone` call each, like the real loop. */
function run(sim: ZoneSim, steps: number): void {
  for (let n = 0; n < steps; n += 1) stepZone(sim, sim.now + sim.rules.tickMs);
}

function snapshot(sim: ZoneSim): string {
  const rows = sim.entities.map((e) =>
    e === null
      ? 'x'
      : [
          e.i,
          e.id,
          e.state,
          Math.round(e.x * 1000),
          Math.round(e.y * 1000),
          Math.round(e.hp),
          e.flags,
          e.targetI,
          e.mana,
          e.rotation,
        ].join(','),
  );
  return `${sim.tick}|${sim.now}|${sim.nextBossAt}|${sim.bossI ?? -1}|${rows.join(';')}`;
}

function monstersOf(sim: ZoneSim): ZoneEntity[] {
  return sim.entities.filter(
    (e): e is ZoneEntity => e !== null && (e.kind === 'monster' || e.kind === 'boss'),
  );
}

function entity(sim: ZoneSim, i: number): ZoneEntity {
  const e = sim.entities[i];
  if (!e) throw new Error(`no entity at slot ${i}`);
  return e;
}

describe('determinism', () => {
  it('reproduces 500 steps byte for byte from the same seed', () => {
    const build = (): ZoneSim => {
      const sim = createZoneSim(testZone(), rules(), 4242, T0);
      addCultivator(sim, cultivator('a', 6, { skills: ['skill-fire-1', 'skill-earth-1'] }));
      addCultivator(sim, cultivator('b', 4, { kind: 'bot', skills: ['skill-metal-1'] }));
      return sim;
    };
    const a = build();
    const b = build();
    const traceA: string[] = [];
    const traceB: string[] = [];
    for (let n = 0; n < 500; n += 1) {
      stepZone(a, a.now + a.rules.tickMs);
      traceA.push(snapshot(a));
      stepZone(b, b.now + b.rules.tickMs);
      traceB.push(snapshot(b));
    }
    expect(traceA.join('\n')).toBe(traceB.join('\n'));
    // A live map, not a frozen one: something must actually have happened.
    expect(new Set(traceA).size).toBeGreaterThan(400);
  });

  it('diverges for different seeds', () => {
    const trace = (seed: number): string => {
      const sim = createZoneSim(testZone(), rules(), seed, T0);
      addCultivator(sim, cultivator('a', 6));
      const rows: string[] = [];
      for (let n = 0; n < 120; n += 1) {
        stepZone(sim, sim.now + sim.rules.tickMs);
        rows.push(snapshot(sim));
      }
      return rows.join('\n');
    };
    const traces = new Set([trace(1), trace(2), trace(3), trace(4), trace(5)]);
    expect(traces.size).toBe(5);
  });

  it('reaches the same state whether stepped once or caught up in a batch', () => {
    const fine = createZoneSim(testZone(), rules(), 99, T0);
    addCultivator(fine, cultivator('a', 6));
    const coarse = createZoneSim(testZone(), rules(), 99, T0);
    addCultivator(coarse, cultivator('a', 6));

    for (let n = 0; n < 8; n += 1) stepZone(fine, fine.now + fine.rules.tickMs);
    // One late call covering the same eight ticks.
    stepZone(coarse, T0 + 8 * coarse.rules.tickMs);

    expect(snapshot(coarse)).toBe(snapshot(fine));
  });

  it('drops a backlog deeper than the catch-up cap instead of burning through it', () => {
    const sim = createZoneSim(testZone(), rules(), 7, T0);
    addCultivator(sim, cultivator('a', 6));
    stepZone(sim, T0 + 3_600_000);
    expect(sim.tick).toBe(8);
    expect(sim.now).toBe(T0 + 3_600_000);
  });
});

describe('妖兽 behaviour', () => {
  it('fights back only once it has been hit', () => {
    const sim = createZoneSim(testZone(), rules(), 11, T0);
    const hero = addCultivator(sim, cultivator('hero', 12));
    const wolves = monstersOf(sim);
    const wolf = wolves[0] as ZoneEntity;
    // Alone with one 妖兽, right on top of it.
    for (const other of wolves.slice(1)) removeEntity(sim, other.i);
    hero.x = wolf.x + 1;
    hero.y = wolf.y;
    // Tough enough to live through the opening blows and answer them.
    wolf.maxHp = 1_000_000;
    wolf.hp = 1_000_000;

    expect(wolf.targetI).toBe(-1);
    run(sim, 40);
    expect(wolf.hp).toBeLessThan(wolf.maxHp);
    expect(wolf.lastHitBy).toBe(hero.i);
    expect(wolf.targetI).toBe(hero.i);
  });

  it('walks home and heals up once dragged past the leash', () => {
    const sim = createZoneSim(testZone(), rules(), 13, T0);
    const wolf = monstersOf(sim)[0] as ZoneEntity;
    for (const other of monstersOf(sim).slice(1)) removeEntity(sim, other.i);

    wolf.hp = Math.round(wolf.maxHp / 2);
    wolf.x = Math.min(sim.zone.width, wolf.home.x + 15);
    wolf.targetI = 0;
    wolf.lastHitBy = 0;

    stepZone(sim, sim.now + sim.rules.tickMs);
    expect(wolf.state).toBe('returning');
    expect(wolf.targetI).toBe(-1);
    expect(wolf.flags & ZONE_FLAGS.MOVING).toBe(ZONE_FLAGS.MOVING);

    run(sim, 80);
    expect(wolf.state).toBe('idle');
    expect(wolf.hp).toBe(wolf.maxHp);
    const dx = wolf.x - wolf.home.x;
    const dy = wolf.y - wolf.home.y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(0.5);
  });

  it('respawns in its own spawn area, keeping its slot', () => {
    const sim = createZoneSim(testZone(), rules({ mapPvp: false }), 17, T0);
    const wolf = monstersOf(sim)[0] as ZoneEntity;
    const slot = wolf.i;
    const spawn = sim.zone.spawns[0];
    if (!spawn) throw new Error('no spawn');

    const hero = addCultivator(sim, cultivator('hero', 20));
    hero.x = wolf.x;
    hero.y = wolf.y;
    run(sim, 60);
    expect(entity(sim, slot).state).toBe('dead');

    removeEntity(sim, hero.i); // otherwise it is cut down again on arrival
    run(sim, 40); // respawnSec 5 at multiplier 1
    const back = entity(sim, slot);
    expect(back.state).not.toBe('dead');
    expect(back.hp).toBe(back.maxHp);
    expect(back.x).toBeGreaterThanOrEqual(spawn.area.x);
    expect(back.x).toBeLessThanOrEqual(spawn.area.x + spawn.area.w);
    expect(back.y).toBeGreaterThanOrEqual(spawn.area.y);
    expect(back.y).toBeLessThanOrEqual(spawn.area.y + spawn.area.h);
  });
});

describe('BOSS', () => {
  it('appears on the interval and stands in its clearing', () => {
    const sim = createZoneSim(testZone(), rules({ bossIntervalMinutes: 1 }), 21, T0);
    expect(sim.bossI).toBeNull();
    expect(sim.nextBossAt).toBe(T0 + 60_000);

    let spawned = false;
    for (let n = 0; n < 300 && !spawned; n += 1) {
      spawned = stepZone(sim, sim.now + sim.rules.tickMs).bossSpawned;
    }
    expect(spawned).toBe(true);
    expect(sim.bossI).not.toBeNull();

    const boss = entity(sim, sim.bossI as number);
    expect(boss.kind).toBe('boss');
    expect(boss.monsterId).toBe('boss-qingyun-tiger-king');
    const area = sim.zone.boss.area;
    expect(boss.x).toBeGreaterThanOrEqual(area.x);
    expect(boss.x).toBeLessThanOrEqual(area.x + area.w);

    const frame = buildFrame(sim, false);
    expect(frame.boss.alive).toBe(true);
    expect(frame.boss.nextAt).toBeNull();
  });

  it('frees its slot when slain, and the next arrival reuses it', () => {
    const sim = createZoneSim(testZone(), rules({ bossIntervalMinutes: 1 }), 23, T0);
    stepZone(sim, T0 + 61_000);
    const bossSlot = sim.bossI as number;
    expect(bossSlot).toBeGreaterThanOrEqual(0);

    const boss = entity(sim, bossSlot);
    const hero = addCultivator(sim, cultivator('hero', 24));
    hero.x = boss.x;
    hero.y = boss.y;
    boss.hp = 1;

    let slain = false;
    for (let n = 0; n < 200 && !slain; n += 1) {
      const out = stepZone(sim, sim.now + sim.rules.tickMs);
      slain = out.bossSlain;
      if (slain) {
        expect(out.kills.some((k) => k.isBoss && k.killerI === hero.i)).toBe(true);
      }
    }
    expect(slain).toBe(true);
    expect(sim.bossI).toBeNull();
    expect(sim.entities[bossSlot]).toBeNull();
    expect(sim.free).toContain(bossSlot);
    expect(sim.nextBossAt).toBeGreaterThan(sim.now);

    const late = addCultivator(sim, cultivator('late', 10));
    expect(late.i).toBe(bossSlot);
    // Nobody may still be pointing at the recycled slot.
    for (const e of sim.entities) {
      if (e && e.i !== late.i) expect(e.targetI).not.toBe(bossSlot);
    }
  });
});

describe('PvP', () => {
  function duel(pvp: boolean, aggression: number): { sim: ZoneSim; a: ZoneEntity; b: ZoneEntity } {
    const sim = createZoneSim(testZone(), rules({ mapPvp: pvp }), 31, T0);
    for (const m of monstersOf(sim)) removeEntity(sim, m.i);
    const a = addCultivator(sim, cultivator('a', 20, { aggression }));
    const b = addCultivator(sim, cultivator('b', 18));
    a.x = 20;
    a.y = 20;
    b.x = 21;
    b.y = 20;
    return { sim, a, b };
  }

  it('never lets cultivators target each other while mapPvp is off', () => {
    const { sim, a, b } = duel(false, 1);
    b.protectedUntil = 0;
    a.protectedUntil = 0;
    run(sim, 200);
    expect(a.targetI).toBe(-1);
    expect(b.targetI).toBe(-1);
    expect(b.hp).toBe(b.maxHp);
  });

  it('opens a fight at aggression 1 once the grace period is over', () => {
    const { sim, a, b } = duel(true, 1);
    run(sim, 8);
    // Still under the entry grace: nobody is a legal target yet.
    expect(a.targetI).toBe(-1);

    b.protectedUntil = 0;
    b.maxHp = 10_000_000;
    b.hp = 10_000_000;
    run(sim, 16);
    expect(a.targetI).toBe(b.i);
    run(sim, 40);
    expect(b.hp).toBeLessThan(b.maxHp);
    // Being hit forces a defender to fight back, whatever its aggression.
    expect(b.targetI).toBe(a.i);
  });

  it('leaves an offline player alone', () => {
    const { sim, a, b } = duel(true, 1);
    b.protectedUntil = 0;
    setOnline(sim, b.i, false);
    for (let n = 0; n < 200; n += 1) {
      stepZone(sim, sim.now + sim.rules.tickMs);
      expect(a.targetI).not.toBe(b.i);
    }
    expect(b.hp).toBe(b.maxHp);
    expect(b.flags & ZONE_FLAGS.OFFLINE).toBe(ZONE_FLAGS.OFFLINE);
  });

  it('will not reach across more than the 境界 window', () => {
    const sim = createZoneSim(testZone(), rules({ mapPvp: true }), 37, T0);
    for (const m of monstersOf(sim)) removeEntity(sim, m.i);
    const strong = addCultivator(sim, cultivator('strong', 20, { aggression: 1 }));
    const weak = addCultivator(sim, cultivator('weak', 10));
    strong.x = 20;
    strong.y = 20;
    weak.x = 21;
    weak.y = 20;
    weak.protectedUntil = 0;
    run(sim, 100);
    expect(strong.targetI).toBe(-1);
    expect(weak.hp).toBe(weak.maxHp);
  });

  it('reports a kill, then respawns the loser at the entrance under protection', () => {
    const { sim, a, b } = duel(true, 1);
    b.protectedUntil = 0;
    b.hp = 1;

    let killedAt = -1;
    for (let n = 0; n < 400 && killedAt < 0; n += 1) {
      const out = stepZone(sim, sim.now + sim.rules.tickMs);
      if (out.pvpKills.length > 0) {
        expect(out.pvpKills[0]).toEqual({ killerI: a.i, victimI: b.i });
        expect(out.deaths[0]?.victimI).toBe(b.i);
        expect(out.deaths[0]?.killerKind).toBe('player');
        killedAt = sim.now;
      }
    }
    expect(killedAt).toBeGreaterThan(0);
    expect(b.state).toBe('dead');
    expect(b.respawnAt).toBe(killedAt + RULES.mapDeathRespawnSec * 1000);

    run(sim, Math.ceil((RULES.mapDeathRespawnSec * 1000) / RULES.tickMs) + 2);
    expect(b.state).not.toBe('dead');
    expect(b.hp).toBe(b.maxHp);
    expect(b.protectedUntil).toBeGreaterThanOrEqual(sim.now);
    expect(b.protectedUntil - sim.now).toBeLessThanOrEqual(ZONE_PVP_PROTECT_MS);
    expect(b.flags & ZONE_FLAGS.PROTECTED).toBe(ZONE_FLAGS.PROTECTED);
    const dx = b.x - sim.zone.entrance.x;
    const dy = b.y - sim.zone.entrance.y;
    expect(Math.abs(dx)).toBeLessThanOrEqual(3);
    expect(Math.abs(dy)).toBeLessThanOrEqual(2);
  });
});

describe('rules and refresh', () => {
  it('drops every cultivator-on-cultivator target when PvP is switched off', () => {
    const sim = createZoneSim(testZone(), rules({ mapPvp: true }), 41, T0);
    for (const m of monstersOf(sim)) removeEntity(sim, m.i);
    const a = addCultivator(sim, cultivator('a', 20, { aggression: 1 }));
    const b = addCultivator(sim, cultivator('b', 20));
    a.x = 20;
    a.y = 20;
    b.x = 21;
    b.y = 20;
    b.protectedUntil = 0;
    run(sim, 16);
    expect(a.targetI).toBe(b.i);

    setRules(sim, rules({ mapPvp: false }));
    expect(a.targetI).toBe(-1);
    run(sim, 40);
    expect(a.targetI).toBe(-1);
  });

  it('rescales the 妖兽 population when the density changes', () => {
    const sim = createZoneSim(testZone(), rules(), 43, T0);
    expect(zoneMonsterCount(sim)).toBe(4);
    setRules(sim, rules({ monsterDensity: 3 }));
    expect(zoneMonsterCount(sim)).toBe(12);
    setRules(sim, rules({ monsterDensity: 0.5 }));
    expect(zoneMonsterCount(sim)).toBe(2);
  });

  it('recomputes the next BOSS when the interval changes', () => {
    const sim = createZoneSim(testZone(), rules({ bossIntervalMinutes: 30 }), 47, T0);
    expect(sim.nextBossAt).toBe(T0 + 30 * 60_000);
    run(sim, 4);
    setRules(sim, rules({ bossIntervalMinutes: 1 }));
    expect(sim.nextBossAt).toBe(sim.now + 60_000);
  });

  it('keeps 气血 proportional when a character is re-read', () => {
    const sim = createZoneSim(testZone(), rules(), 53, T0);
    const hero = addCultivator(sim, cultivator('hero', 6));
    hero.hp = Math.round(hero.maxHp / 2);
    const before = hero.hp / hero.maxHp;

    const stats = baseStatsForStage(12);
    refreshCultivator(sim, hero.i, {
      stats,
      skills: ['skill-fire-1', 'skill-fire-3'],
      stageIndex: 12,
      maxHp: Math.round(stats.hp),
    });

    expect(hero.maxHp).toBe(Math.round(stats.hp));
    expect(hero.hp / hero.maxHp).toBeCloseTo(before, 3);
    expect(hero.stageIndex).toBe(12);
    expect(hero.skills).toEqual(['skill-fire-1', 'skill-fire-3']);
  });

  it('counts its population by kind', () => {
    const sim = createZoneSim(testZone(), rules(), 59, T0);
    addCultivator(sim, cultivator('p1', 6));
    addCultivator(sim, cultivator('b1', 6, { kind: 'bot' }));
    addCultivator(sim, cultivator('b2', 6, { kind: 'bot' }));
    expect(zonePlayerCount(sim)).toBe(1);
    expect(zoneBotCount(sim)).toBe(2);
    expect(zoneMonsterCount(sim)).toBe(4);
  });
});

describe('神通', () => {
  it('splashes an all_enemies cast onto at most four targets', () => {
    const zone = testZone({
      spawns: [
        {
          monsterId: 'monster-qingyun-wolf',
          count: 8,
          respawnSec: 60,
          area: { x: 18, y: 18, w: 2, h: 2 },
        },
      ],
    });
    const sim = createZoneSim(zone, rules(), 61, T0);
    const wolves = monstersOf(sim);
    expect(wolves.length).toBe(8);
    // A tight knot, every wolf inside the splash radius of every other.
    for (const [n, wolf] of wolves.entries()) {
      wolf.x = 20 + (n % 2) * 0.4;
      wolf.y = 20 + Math.floor(n / 2) * 0.4;
    }
    const hero = addCultivator(sim, cultivator('hero', 20, { skills: ['skill-fire-3'] }));
    hero.x = 20;
    hero.y = 22;

    stepZone(sim, sim.now + sim.rules.tickMs);
    const touched = wolves.filter(
      (w) => (w.flags & (ZONE_FLAGS.HIT | ZONE_FLAGS.DODGED)) !== 0 || w.hp < w.maxHp,
    );
    expect(touched.length).toBe(4);
  });

  it('spends 灵力 and walks the rotation exactly as a 秘境 fight does', () => {
    const sim = createZoneSim(testZone(), rules(), 67, T0);
    const wolves = monstersOf(sim);
    for (const other of wolves.slice(1)) removeEntity(sim, other.i);
    const wolf = wolves[0] as ZoneEntity;
    const hero = addCultivator(
      sim,
      cultivator('hero', 20, { skills: ['skill-fire-1', 'skill-earth-1'] }),
    );
    hero.x = wolf.x;
    hero.y = wolf.y;
    wolf.hp = wolf.maxHp * 1000; // survive long enough to watch the rotation

    stepZone(sim, sim.now + sim.rules.tickMs);
    // 100 灵力 capped, +15 regen, minus 焚天诀's 14.
    expect(hero.mana).toBe(100 - 14);
    expect(hero.rotation).toBe(1);
    expect(hero.nextActionAt).toBeGreaterThan(sim.now);
  });
});

describe('frames', () => {
  it('opens with a full frame and then sends only what changed', () => {
    const sim = createZoneSim(testZone(), rules(), 71, T0);
    const hero = addCultivator(sim, cultivator('hero', 6));

    const full = buildFrame(sim, true);
    expect(full.full).toBe(true);
    expect(full.seq).toBe(1);
    expect(full.add).toHaveLength(5);
    expect(full.ents).toHaveLength(5);
    expect(full.remove).toEqual([]);
    expect(full.add.some((row) => row.id === 'hero' && row.kind === 'player')).toBe(true);
    expect(
      full.add.some((row) => row.id.startsWith('m:') && row.art === 'sprite/qingyun-wolf'),
    ).toBe(true);

    // Nothing has moved since, so the very next delta is empty.
    const quiet = buildFrame(sim, false);
    expect(quiet.seq).toBe(2);
    expect(quiet.add).toEqual([]);
    expect(quiet.ents).toEqual([]);
    expect(quiet.remove).toEqual([]);

    run(sim, 4);
    const moved = buildFrame(sim, false);
    expect(moved.seq).toBe(3);
    expect(moved.ents.length).toBeGreaterThan(0);
    expect(moved.ents.length).toBeLessThanOrEqual(5);
    expect(moved.ents.some((t) => t[0] === hero.i)).toBe(true);
    for (const t of moved.ents) expect(t).toHaveLength(7);
  });

  it('reports arrivals and departures, and hides one that never lasted a frame', () => {
    const sim = createZoneSim(testZone(), rules(), 73, T0);
    buildFrame(sim, true);

    const wolf = monstersOf(sim)[0] as ZoneEntity;
    removeEntity(sim, wolf.i);
    const arrival = addCultivator(sim, cultivator('arrival', 6));
    const frame = buildFrame(sim, false);
    expect(frame.remove).toEqual([wolf.i]);
    expect(frame.add.map((row) => row.id)).toEqual(['arrival']);

    // In and out inside one window: the client is told nothing at all.
    const fleeting = addCultivator(sim, cultivator('fleeting', 6));
    removeEntity(sim, fleeting.i);
    const next = buildFrame(sim, false);
    expect(next.add).toEqual([]);
    expect(next.remove).toEqual([]);
    expect(arrival.i).toBeGreaterThanOrEqual(0);
  });

  it('clears pulse flags once they have been delivered', () => {
    const sim = createZoneSim(testZone(), rules(), 79, T0);
    const wolf = monstersOf(sim)[0] as ZoneEntity;
    for (const other of monstersOf(sim).slice(1)) removeEntity(sim, other.i);
    const hero = addCultivator(sim, cultivator('hero', 20));
    hero.x = wolf.x;
    hero.y = wolf.y;
    wolf.hp = wolf.maxHp * 1000;
    buildFrame(sim, true);

    run(sim, 2);
    const frame = buildFrame(sim, false);
    const pulses = frame.ents.some(
      (t) => (t[4] & (ZONE_FLAGS.HIT | ZONE_FLAGS.CASTING | ZONE_FLAGS.DODGED)) !== 0,
    );
    expect(pulses).toBe(true);
    for (const e of sim.entities) {
      if (e) expect(e.flags & (ZONE_FLAGS.HIT | ZONE_FLAGS.CASTING | ZONE_FLAGS.DODGED)).toBe(0);
    }
  });

  it('numbers frames monotonically and drains its event queue', () => {
    const sim = createZoneSim(testZone(), rules({ bossIntervalMinutes: 1 }), 83, T0);
    let last = 0;
    for (let n = 0; n < 30; n += 1) {
      run(sim, 10);
      const frame = buildFrame(sim, false);
      expect(frame.seq).toBe(last + 1);
      last = frame.seq;
    }
    const spawn = buildFrame(sim, false);
    expect(spawn.events).toEqual([]);
  });

  it('sends coordinates as tenths of a cell', () => {
    const sim = createZoneSim(testZone(), rules(), 89, T0);
    const hero = addCultivator(sim, cultivator('hero', 6));
    hero.x = 12.34;
    hero.y = 7.89;
    hero.dirty = true;
    const frame = buildFrame(sim, false);
    const tuple = frame.ents.find((t) => t[0] === hero.i);
    expect(tuple?.[1]).toBe(123);
    expect(tuple?.[2]).toBe(79);
  });
});

describe('zone content', () => {
  it('gives every ExploreMap a field with a matching id', () => {
    expect(ZONES).toHaveLength(4);
    for (const zone of ZONES) {
      const map = EXPLORE_MAP_BY_ID.get(zone.id);
      expect(map).toBeDefined();
      expect(zone.spawns.length).toBeGreaterThanOrEqual(3);
      const population = zone.spawns.reduce((sum, s) => sum + s.count, 0);
      expect(population).toBeGreaterThanOrEqual(24);
      expect(population).toBeLessThanOrEqual(36);
      // Every 妖兽 on the field belongs to the map it stands on.
      for (const spawn of zone.spawns) expect(map?.monsterIds).toContain(spawn.monsterId);
      expect(zone.entrance.y).toBeGreaterThan(zone.height * 0.75);
      expect(zone.boss.area.y).toBeLessThan(zone.height * 0.25);
      expect(zone.capacity).toBe(120);
    }
  });

  it('sends a cultivator to the field its 境界 is tuned for', () => {
    expect(zoneFor(0).id).toBe('map-qingyun-mountain');
    expect(zoneFor(6).id).toBe('map-luoshui-city');
    expect(zoneFor(10).id).toBe('map-youming-valley');
    expect(zoneFor(35).id).toBe('map-kunlun-ruins');
    expect(ZONE_BY_ID.get('map-kunlun-ruins')?.floorArt).toBe('zone/kunlun-ruins');
  });
});

describe('performance', () => {
  it('steps a busy field well inside one tick', () => {
    const zone = ZONE_BY_ID.get('map-kunlun-ruins') as Zone;
    // 36 authored 妖兽 at density 1.1 -> 40 on the field.
    const sim = createZoneSim(zone, rules({ monsterDensity: 1.1, mapPvp: true }), 101, T0);
    expect(zoneMonsterCount(sim)).toBe(40);
    for (let n = 0; n < 100; n += 1) {
      addCultivator(
        sim,
        cultivator(`c${n}`, 14 + (n % 6), {
          kind: n % 4 === 0 ? 'player' : 'bot',
          aggression: (n % 5) / 4,
          skills: ['skill-fire-1', 'skill-earth-1', 'skill-fire-3', 'skill-water-1'],
        }),
      );
    }
    // Warm the JIT before timing.
    for (let n = 0; n < 40; n += 1) stepZone(sim, sim.now + sim.rules.tickMs);

    const samples = 200;
    const started = performance.now();
    for (let n = 0; n < samples; n += 1) {
      stepZone(sim, sim.now + sim.rules.tickMs);
      buildFrame(sim, false);
    }
    const perStep = (performance.now() - started) / samples;
    console.log(`zone step: ${perStep.toFixed(3)} ms/step (100 修士 + 40 妖兽, frame included)`);
    expect(perStep).toBeLessThan(5);
  });
});
