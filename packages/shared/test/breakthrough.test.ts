import { describe, expect, it } from 'vitest';
import {
  BREAKTHROUGH_BASE_CHANCE,
  BREAKTHROUGH_FAILURE_EXP_LOSS,
  BREAKTHROUGH_STAGE_INDEXES,
  MAX_BREAKTHROUGH_CHANCE,
  MAX_BREAKTHROUGH_PILLS,
  attemptBreakthrough,
  breakthroughChance,
  checkBreakthroughReadiness,
} from '../src/cultivation/breakthrough.js';
import { expRequired, stageName } from '../src/cultivation/realms.js';
import { createRng, type Rng } from '../src/core/rng.js';
import type { CharacterState } from '../src/domain/character.js';

const T0 = 1_700_000_000_000;

function makeChar(stageIndex: number, exp = expRequired(stageIndex)): CharacterState {
  return {
    id: 'c1',
    userId: 'u1',
    name: 'testdao',
    gender: 'male',
    avatarArt: 'avatar/m01',
    isBot: false,
    botArchetypeId: null,
    botParams: null,
    spiritRoot: { element: 'fire', quality: 'mortal' },
    stageIndex,
    exp,
    spiritStones: 0,
    skillSlots: [null, null, null, null],
    learnedSkillIds: [],
    techniqueId: null,
    learnedTechniqueIds: [],
    equipment: { treasure: null, robe: null, accessory: null, pet: null },
    buffs: [],
    hpPercent: 1,
    protectedUntil: 0,
    chapter: 1,
    quests: [],
    flags: {},
    lastSettledAt: T0,
    lastSeenAt: T0,
    createdAt: T0,
    dailyCounters: { date: '2023-11-14', dungeon: 0, arena: 0, gatherAt: {} },
    arenaRating: 1000,
    arenaWins: 0,
    arenaLosses: 0,
    powerScore: 0,
  };
}

/** An RNG whose `chance` is forced, so success/failure can be pinned. */
function fixedRng(alwaysSucceed: boolean): Rng {
  const base = createRng(1);
  return { ...base, chance: () => alwaysSucceed };
}

describe('breakthroughChance', () => {
  it('has exactly 8 major breakthroughs, at every 圆满 except the last', () => {
    expect(BREAKTHROUGH_STAGE_INDEXES).toEqual([3, 7, 11, 15, 19, 23, 27, 31]);
    expect(BREAKTHROUGH_BASE_CHANCE).toHaveLength(8);
    expect(stageName(3)).toBe('练气·圆满');
    expect(stageName(31)).toBe('大乘·圆满');
  });

  it('runs from 80% at 练气·圆满 down to 35% at 大乘·圆满', () => {
    expect(breakthroughChance(3, 0)).toBeCloseTo(0.8, 9);
    expect(breakthroughChance(31, 0)).toBeCloseTo(0.35, 9);
  });

  it('decreases monotonically across the ladder', () => {
    for (let i = 1; i < BREAKTHROUGH_STAGE_INDEXES.length; i += 1) {
      const prev = breakthroughChance(BREAKTHROUGH_STAGE_INDEXES[i - 1] as number, 0);
      const cur = breakthroughChance(BREAKTHROUGH_STAGE_INDEXES[i] as number, 0);
      expect(cur).toBeLessThan(prev);
    }
  });

  it('adds 15 percentage points per 破境丹', () => {
    expect(breakthroughChance(31, 1)).toBeCloseTo(0.5, 9);
    expect(breakthroughChance(31, 2)).toBeCloseTo(0.65, 9);
    expect(breakthroughChance(31, 3)).toBeCloseTo(0.8, 9);
  });

  it('caps at 95% no matter how many pills', () => {
    expect(breakthroughChance(3, 4)).toBe(MAX_BREAKTHROUGH_CHANCE);
    expect(breakthroughChance(3, 99)).toBe(MAX_BREAKTHROUGH_CHANCE);
    expect(breakthroughChance(31, 99)).toBe(MAX_BREAKTHROUGH_CHANCE);
  });

  it('ignores pills beyond the per-attempt limit', () => {
    const capped = breakthroughChance(31, MAX_BREAKTHROUGH_PILLS);
    expect(breakthroughChance(31, MAX_BREAKTHROUGH_PILLS + 10)).toBe(capped);
  });

  it('returns 1 for 小境界 (they never fail) and 0 at the ceiling', () => {
    for (const i of [0, 1, 2, 4, 5, 6]) expect(breakthroughChance(i, 0)).toBe(1);
    expect(breakthroughChance(35, 0)).toBe(0);
    expect(breakthroughChance(35, 4)).toBe(0);
  });

  it('honours the world breakthroughChanceMultiplier, still capped at 95%', () => {
    expect(breakthroughChance(31, 0, { breakthroughChanceMultiplier: 2 })).toBeCloseTo(0.7, 9);
    expect(breakthroughChance(3, 0, { breakthroughChanceMultiplier: 5 })).toBe(
      MAX_BREAKTHROUGH_CHANCE,
    );
    expect(breakthroughChance(31, 0, { breakthroughChanceMultiplier: 0 })).toBe(0);
  });
});

describe('readiness checks', () => {
  it('blocks anywhere but 圆满', () => {
    const r = checkBreakthroughReadiness(makeChar(2));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('not_at_perfection');
  });

  it('blocks when 修为 is not full', () => {
    const r = checkBreakthroughReadiness(makeChar(3, expRequired(3) - 1));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('exp_not_full');
  });

  it('blocks at the top of the ladder', () => {
    const r = checkBreakthroughReadiness(makeChar(35));
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('max_stage');
  });

  it('requires a won 天劫 at 大乘·圆满 only', () => {
    const blocked = checkBreakthroughReadiness(makeChar(31), 0, undefined, false);
    expect(blocked.ready).toBe(false);
    expect(blocked.reason).toBe('tribulation_required');
    expect(blocked.needsTribulation).toBe(true);

    const allowed = checkBreakthroughReadiness(makeChar(31), 0, undefined, true);
    expect(allowed.ready).toBe(true);

    // Every other 圆满 needs no tribulation.
    for (const i of [3, 7, 11, 15, 19, 23, 27]) {
      const r = checkBreakthroughReadiness(makeChar(i));
      expect(r.needsTribulation).toBe(false);
      expect(r.ready).toBe(true);
    }
  });
});

describe('attemptBreakthrough', () => {
  it('lands on 前期 of the next realm with 0 修为 on success', () => {
    const result = attemptBreakthrough(makeChar(3), fixedRng(true));
    expect(result.success).toBe(true);
    expect(result.fromStageIndex).toBe(3);
    expect(result.toStageIndex).toBe(4);
    expect(stageName(result.toStageIndex)).toBe('筑基·前期');
    expect(result.character.exp).toBe(0);
    expect(result.expLost).toBe(0);
  });

  it('jumps a whole realm from every 圆满', () => {
    for (const from of BREAKTHROUGH_STAGE_INDEXES) {
      const result = attemptBreakthrough(makeChar(from), fixedRng(true), {
        tribulationWon: true,
      });
      expect(result.success).toBe(true);
      expect(result.toStageIndex).toBe(from + 1);
      expect(result.toStageIndex % 4).toBe(0);
    }
  });

  it('deducts 20% of the stage requirement on failure and stays put', () => {
    const char = makeChar(3);
    const result = attemptBreakthrough(char, fixedRng(false));
    expect(result.success).toBe(false);
    expect(result.blocked).toBeNull();
    expect(result.toStageIndex).toBe(3);
    expect(result.expLost).toBeCloseTo(expRequired(3) * BREAKTHROUGH_FAILURE_EXP_LOSS, 6);
    expect(result.character.exp).toBeCloseTo(expRequired(3) * 0.8, 6);
    expect(result.character.stageIndex).toBe(3);
  });

  it('never drives 修为 below zero on repeated failures', () => {
    let char = makeChar(3);
    for (let i = 0; i < 30; i += 1) {
      char = attemptBreakthrough(char, fixedRng(false)).character;
      expect(char.exp).toBeGreaterThanOrEqual(0);
    }
  });

  it('consumes nothing when the attempt is blocked', () => {
    const char = makeChar(2);
    const result = attemptBreakthrough(char, fixedRng(true), { pills: 3 });
    expect(result.blocked).toBe('not_at_perfection');
    expect(result.pillsUsed).toBe(0);
    expect(result.character).toBe(char);
  });

  it('does not mutate the input character', () => {
    const char = makeChar(3);
    attemptBreakthrough(char, fixedRng(false));
    expect(char.exp).toBe(expRequired(3));
    expect(char.stageIndex).toBe(3);
  });

  it('reports the pills it actually spent and the capped chance', () => {
    // 练气·圆满 is already 80%; two pills would reach 110%, so the 95% cap bites.
    const capped = attemptBreakthrough(makeChar(3), fixedRng(true), { pills: 2 });
    expect(capped.pillsUsed).toBe(2);
    expect(capped.chance).toBe(MAX_BREAKTHROUGH_CHANCE);

    // 大乘·圆满 has room: 35% + 2 x 15pp = 65%.
    const uncapped = attemptBreakthrough(makeChar(31), fixedRng(true), {
      pills: 2,
      tribulationWon: true,
    });
    expect(uncapped.pillsUsed).toBe(2);
    expect(uncapped.chance).toBeCloseTo(0.65, 9);
  });

  it('converges on the declared success rate over many seeded trials', () => {
    const trials = 4000;
    let wins = 0;
    for (let seed = 0; seed < trials; seed += 1) {
      if (attemptBreakthrough(makeChar(31), createRng(seed), { tribulationWon: true }).success) {
        wins += 1;
      }
    }
    // Declared 35%; allow a generous band for sampling noise.
    expect(wins / trials).toBeGreaterThan(0.31);
    expect(wins / trials).toBeLessThan(0.39);
  });
});
