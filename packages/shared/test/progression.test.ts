import { describe, it, expect } from 'vitest';
import {
  getProgression,
  drawProgression,
  claimProgression,
  upgradeProgression,
  progressionBonuses,
  mainTreasureCombat,
  botProgression,
  awardProgressionMaterials,
} from '../src/progression/index.js';
import { TREASURES, RELICS } from '../src/content/progression.js';
import { simulateBattle } from '../src/combat/engine.js';
import {
  createTreasureRuntime,
  stepTreasure,
  absorbTreasureShield,
  treasureAttackBonus,
} from '../src/combat/treasure.js';
import { baseStatsForStage } from '../src/cultivation/attributes.js';
import { createZoneSim, addCultivator, stepZone } from '../src/zone/sim.js';
import { ZONES } from '../src/content/zones.js';
import { type MainTreasureCombat, type TreasureForm } from '../src/domain/progression.js';
const now = 1800000000000;
function rich() {
  const p = getProgression(undefined, now);
  p.materials = { jade: 1e8, starStones: 1e8, stardust: 1e8, breakthroughWood: 1e8 };
  return p;
}
function projection(form: TreasureForm): MainTreasureCombat {
  return {
    definitionId: `test-${form}`,
    name: form,
    art: 'item/treasure-bell',
    form,
    power: 1,
    intervalMs: { bell: 1000, tower: 2500, chain: 3500, seal: 4000, banner: 6000, shield: 8000 }[
      form
    ],
    awakened: false,
  };
}
describe('progression closed loop', () => {
  it('has distinct complete catalogs', () => {
    expect(TREASURES).toHaveLength(20);
    expect(RELICS).toHaveLength(24);
    expect(new Set([...TREASURES, ...RELICS].map((v) => v.id)).size).toBe(44);
  });
  it('starter supports immediate upgrades and a paid draw without mutating input', () => {
    const p = getProgression(undefined, now);
    let q = claimProgression(p, { kind: 'starter', id: 'starter' }, now);
    expect(q.treasures.map((t) => [t.definitionId, t.slot])).toEqual([
      ['t-starter-bell', 0],
      ['t-starter-shield', null],
    ]);
    q = upgradeProgression(q, { kind: 'treasure', id: q.treasures[0]!.uid, action: 'level' });
    q = upgradeProgression(q, { kind: 'treasure', id: q.treasures[0]!.uid, action: 'infuse' });
    expect(mainTreasureCombat(q)).toBeDefined();
    expect(
      drawProgression(q, { pool: 'relic', count: 1, requestId: 'a' }, 3, now).results,
    ).toHaveLength(1);
    expect(p.treasures).toEqual([]);
    expect(() => claimProgression(q, { kind: 'starter', id: 'starter' }, now)).toThrow();
  });
  it('free draws are per pool per UTC day; ten free rejected', () => {
    const r = { pool: 'treasure', count: 1, free: true, requestId: 'a' } as const;
    const q = drawProgression(undefined, r, 1, now).progression;
    expect(() => drawProgression(q, r, 1, now)).toThrow();
    expect(drawProgression(q, { ...r, pool: 'relic' }, 1, now).results).toHaveLength(1);
    expect(() => drawProgression(q, { ...r, count: 10 }, 1, now)).toThrow();
    expect(drawProgression(q, r, 1, now + 86400000).results).toHaveLength(1);
  });
  it('hard pity wins over ten guarantee and resets inside batch independently', () => {
    const p = rich();
    p.gacha.treasure.pity = 69;
    p.gacha.relic.pity = 27;
    const a = drawProgression(p, { pool: 'treasure', count: 10, requestId: 'a' }, 92, now);
    expect(a.results[0]!.grade).toBe('divine');
    expect(a.results[0]!.pity).toBe(0);
    expect(a.progression.gacha.relic.pity).toBe(27);
    expect(a).toEqual(drawProgression(p, { pool: 'treasure', count: 10, requestId: 'a' }, 92, now));
  });
  it('each ten batch has saint or divine and repeats become fragments', () => {
    let p = rich();
    for (let i = 0; i < 100; i++) {
      const r = drawProgression(p, { pool: 'relic', count: 10, requestId: String(i) }, i, now);
      expect(r.results.some((v) => v.grade === 'saint' || v.grade === 'divine')).toBe(true);
      p = r.progression;
    }
    expect(p.relics.length).toBeLessThanOrEqual(24);
    expect(p.relics.some((v) => v.fragments > 0)).toBe(true);
  });
  it('requires wood at a level gate and every star has a cost', () => {
    let p = claimProgression(rich(), { kind: 'starter', id: 'starter' }, now);
    p.treasures[0]!.level = 10;
    p.materials.breakthroughWood = 0;
    expect(() =>
      upgradeProgression(p, { kind: 'treasure', id: p.treasures[0]!.uid, action: 'level' }),
    ).toThrow();
    p.treasures[0]!.fragments = 270;
    for (let i = 0; i < 5; i++)
      p = upgradeProgression(p, { kind: 'treasure', id: p.treasures[0]!.uid, action: 'star' });
    expect(p.treasures[0]!.stars).toBe(5);
    expect(p.treasures[0]!.fragments).toBe(0);
    expect(mainTreasureCombat(p)?.awakened).toBe(true);
  });
  it('collection gives bonuses without equip; daily claims and material overflow guarded', () => {
    const p = rich();
    p.relics = RELICS.slice(0, 6).map((v) => ({
      definitionId: v.id,
      spiritLevel: 0,
      stars: 0,
      fragments: 0,
    }));
    expect(progressionBonuses(p).cultivationBonus).toBeGreaterThan(0);
    expect(progressionBonuses(p).extraPercent.atk).toBeGreaterThan(0);
    p.daily.kills = 50;
    const q = claimProgression(p, { kind: 'daily', id: 'kills' }, now);
    expect(() => claimProgression(q, { kind: 'daily', id: 'kills' }, now)).toThrow();
    p.materials.jade = Number.MAX_SAFE_INTEGER;
    expect(() => awardProgressionMaterials(p, { jade: 1 })).toThrow();
    expect(botProgression('a', 12)).toEqual(botProgression('a', 12));
  });
  it('fixed-seed single-draw sample has plausible pity-adjusted distribution', () => {
    let p = rich(),
      red = 0;
    for (let i = 0; i < 20000; i++) {
      const r = drawProgression(
        p,
        { pool: 'treasure', count: 1, requestId: String(i) },
        i + 312,
        now,
      );
      p = r.progression;
      if (r.results[0]!.grade === 'divine') red++;
    }
    expect(red / 20000).toBeGreaterThan(0.015);
    expect(red / 20000).toBeLessThan(0.035);
  });
});
describe('treasure battle effects', () => {
  for (const form of ['bell', 'tower', 'chain', 'seal', 'banner', 'shield'] as const) {
    it(`${form} affects both engines`, () => {
      const t = projection(form),
        base = baseStatsForStage(4);
      const a = { id: 'a', name: 'a', stats: { ...base, hp: 10000 }, skills: [], mainTreasure: t };
      const b = { id: 'b', name: 'b', stats: { ...base, hp: 10000 }, skills: [] };
      const battle = simulateBattle({ seed: 72, teamA: [a], teamB: [b], maxRounds: 12 });
      expect(battle.log.some((v) => v.type === 'skill_cast' && v.skillId === t.definitionId)).toBe(
        true,
      );
      expect(battle).toEqual(simulateBattle({ seed: 72, teamA: [a], teamB: [b], maxRounds: 12 }));
      if (form === 'shield' || form === 'chain')
        expect(battle.log.some((v) => v.type === 'buff' && v.skillId === t.definitionId)).toBe(
          true,
        );
      else
        expect(
          battle.log.some(
            (v) => v.type === 'damage' && v.skillId === t.definitionId && v.amount > 0,
          ),
        ).toBe(true);
      const sim = createZoneSim(
        ZONES[0]!,
        {
          tickMs: 250,
          mapPvp: false,
          mapPvpStoneLoss: 0,
          mapDeathRespawnSec: 10,
          monsterDensity: 1,
          respawnMultiplier: 1,
          bossIntervalMinutes: 30,
        },
        72,
        now,
      );
      const e = addCultivator(sim, {
        id: 'a',
        name: 'a',
        kind: 'player',
        art: null,
        stageIndex: 4,
        stats: { ...base, hp: 100000 },
        skills: [],
        hpShare: 1,
        online: true,
        aggression: 0,
        mainTreasure: t,
      });
      const mob = sim.entities.find((v) => v?.kind === 'monster')!;
      e.x = mob.x;
      e.y = mob.y;
      mob.hp = mob.maxHp = 100000;
      mob.nextActionAt = now + 999999;
      e.nextActionAt = now + 999999;
      for (let i = 1; i <= 32; i++) stepZone(sim, now + i * 250);
      expect(e.treasureRuntime!.nextAt).toBeGreaterThan(now);
      if (form === 'shield') expect(e.treasureRuntime!.shield).toBeGreaterThan(0);
      else expect(mob.hp).toBeLessThan(100000);
    });
  }
  it('banner pulses over time and shield absorbs finite damage', () => {
    const r = createTreasureRuntime(0),
      t = projection('banner');
    expect(stepTreasure(t, r, 0)).toHaveLength(1);
    expect(stepTreasure(t, r, 500)).toHaveLength(0);
    expect(stepTreasure(t, r, 1000)).toHaveLength(1);
    r.shield = 20;
    expect(absorbTreasureShield(r, 30)).toBe(10);
    expect(r.shield).toBe(0);
  });
});

it('chain clock refreshes a single ten-percent bonus without stacking', () => {
  const r = createTreasureRuntime(0),
    t = projection('chain');
  for (let at = 0; at < 60000; at += 250) {
    stepTreasure(t, r, at);
    expect(treasureAttackBonus(r, at)).toBe(0.1);
  }
  expect(treasureAttackBonus(r, r.attackUntil)).toBe(0);
});
it('bell keeps a one-second independent clock across 1.2-second rounds', () => {
  const r = createTreasureRuntime(0),
    t = projection('bell');
  let casts = 0;
  for (let at = 0; at <= 12000; at += 1200) casts += stepTreasure(t, r, at).length;
  expect(casts).toBe(13);
});
