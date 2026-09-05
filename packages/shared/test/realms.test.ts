import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE_INDEX,
  REALM_COUNT,
  REALM_NAMES,
  STAGES,
  STAGE_COUNT,
  SUB_STAGES_PER_REALM,
  baseRatePerSec,
  expRequired,
  getStage,
  isPerfection,
  realmDurationSec,
  realmOf,
  requiresTribulation,
  stageDurationSec,
  stageIndexOfRealm,
  stageName,
  subOf,
} from '../src/cultivation/realms.js';
import { baseStatsForStage, powerScore } from '../src/cultivation/attributes.js';

const MIN = 60;
const HOUR = 3600;

describe('realm table shape', () => {
  it('has 9 realms x 4 sub-stages = 36 stages', () => {
    expect(REALM_COUNT).toBe(9);
    expect(SUB_STAGES_PER_REALM).toBe(4);
    expect(STAGE_COUNT).toBe(36);
    expect(MAX_STAGE_INDEX).toBe(35);
    expect(STAGES).toHaveLength(36);
  });

  it('names stages as 大境界·小境界', () => {
    expect(stageName(0)).toBe('练气·前期');
    expect(stageName(3)).toBe('练气·圆满');
    expect(stageName(8)).toBe('金丹·前期');
    expect(stageName(35)).toBe('渡劫·圆满');
    for (let i = 0; i <= MAX_STAGE_INDEX; i += 1) {
      expect(stageName(i)).toMatch(/^[一-龥]{2}·(前期|中期|后期|圆满)$/);
    }
  });

  it('keeps realm/sub decomposition consistent with the flat index', () => {
    for (let i = 0; i <= MAX_STAGE_INDEX; i += 1) {
      const s = getStage(i);
      expect(s.stageIndex).toBe(i);
      expect(realmOf(i) * 4 + subOf(i)).toBe(i);
      expect(s.realmName).toBe(REALM_NAMES[realmOf(i)]);
      expect(s.isPerfection).toBe(subOf(i) === 3);
    }
  });

  it('rejects out-of-range stage indexes', () => {
    expect(() => getStage(-1)).toThrow(RangeError);
    expect(() => getStage(36)).toThrow(RangeError);
    expect(() => getStage(1.5)).toThrow(RangeError);
  });

  it('marks only 大乘·圆满 as needing a tribulation', () => {
    const tribulationStages = Array.from({ length: 36 }, (_, i) => i).filter(requiresTribulation);
    expect(tribulationStages).toEqual([31]);
    expect(stageName(31)).toBe('大乘·圆满');
  });

  it('places 圆满 at every 4th stage', () => {
    expect(Array.from({ length: 36 }, (_, i) => i).filter(isPerfection)).toEqual([
      3, 7, 11, 15, 19, 23, 27, 31, 35,
    ]);
  });
});

describe('pacing bands', () => {
  /** durationSec must equal expRequired / baseRatePerSec by construction. */
  it('derives duration from exp and rate', () => {
    for (let i = 0; i <= MAX_STAGE_INDEX; i += 1) {
      expect(stageDurationSec(i)).toBeCloseTo(expRequired(i) / baseRatePerSec(i), 9);
    }
  });

  it('练气 four stages take 2-10 minutes each', () => {
    for (let i = 0; i < 4; i += 1) {
      const d = stageDurationSec(i);
      expect(d).toBeGreaterThanOrEqual(2 * MIN);
      expect(d).toBeLessThanOrEqual(10 * MIN);
    }
  });

  it('筑基 takes 20-60 minutes per stage', () => {
    for (let i = 4; i < 8; i += 1) {
      const d = stageDurationSec(i);
      expect(d).toBeGreaterThanOrEqual(20 * MIN);
      expect(d).toBeLessThanOrEqual(60 * MIN);
    }
  });

  it('金丹 takes 2-6 hours per stage', () => {
    for (let i = 8; i < 12; i += 1) {
      const d = stageDurationSec(i);
      expect(d).toBeGreaterThanOrEqual(2 * HOUR);
      expect(d).toBeLessThanOrEqual(6 * HOUR);
    }
  });

  it('元婴 takes 8-24 hours per stage', () => {
    for (let i = 12; i < 16; i += 1) {
      const d = stageDurationSec(i);
      expect(d).toBeGreaterThanOrEqual(8 * HOUR);
      expect(d).toBeLessThanOrEqual(24 * HOUR);
    }
  });

  it('scales each realm from 化神 on by 1.5x-2x the previous realm', () => {
    // 化神 is realm index 4; compare realms 4..8 against their predecessor.
    for (let realm = 4; realm < REALM_COUNT; realm += 1) {
      const ratio = realmDurationSec(realm) / realmDurationSec(realm - 1);
      expect(ratio).toBeGreaterThanOrEqual(1.5);
      expect(ratio).toBeLessThanOrEqual(2.0);
    }
  });

  it('increases duration monotonically within and across realms', () => {
    for (let i = 1; i <= MAX_STAGE_INDEX; i += 1) {
      // The only permitted dip is realm rollover: a realm's 前期 may be shorter
      // than the previous realm's 圆满, which is by design (the 圆满 grind is
      // the wall, the next 前期 is the reward).
      if (subOf(i) === 0) continue;
      expect(stageDurationSec(i)).toBeGreaterThan(stageDurationSec(i - 1));
    }
  });

  it('requires more exp at every later stage', () => {
    for (let i = 1; i <= MAX_STAGE_INDEX; i += 1) {
      expect(expRequired(i)).toBeGreaterThan(expRequired(i - 1));
    }
  });

  it('keeps the whole ladder inside a sane wall-clock budget', () => {
    let total = 0;
    for (let i = 0; i <= MAX_STAGE_INDEX; i += 1) total += stageDurationSec(i);
    const days = total / 86400;
    // Baseline (凡灵根, no bonuses). With 天灵根 + 功法 this lands near 40 days.
    expect(days).toBeGreaterThan(60);
    expect(days).toBeLessThan(200);
  });
});

describe('stage index helpers', () => {
  it('maps realm to its first stage', () => {
    expect(stageIndexOfRealm(0)).toBe(0);
    expect(stageIndexOfRealm(2)).toBe(8);
    expect(stageIndexOfRealm(8)).toBe(32);
    expect(() => stageIndexOfRealm(9)).toThrow(RangeError);
  });
});

describe('baseline attributes', () => {
  it('grows every absolute stat monotonically', () => {
    for (let i = 1; i <= MAX_STAGE_INDEX; i += 1) {
      const prev = baseStatsForStage(i - 1);
      const cur = baseStatsForStage(i);
      expect(cur.hp).toBeGreaterThan(prev.hp);
      expect(cur.atk).toBeGreaterThan(prev.atk);
      expect(cur.def).toBeGreaterThan(prev.def);
      expect(cur.spd).toBeGreaterThan(prev.spd);
    }
  });

  it('keeps rate stats inside their legal range', () => {
    for (let i = 0; i <= MAX_STAGE_INDEX; i += 1) {
      const s = baseStatsForStage(i);
      for (const v of [s.crit, s.critResist, s.eva]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(s.acc).toBeGreaterThan(0.5);
      expect(s.acc).toBeLessThanOrEqual(1);
      // Hit chance must stay meaningfully above dodge at every stage.
      expect(s.acc - s.eva).toBeGreaterThan(0.7);
    }
  });

  it('increases 战力 monotonically', () => {
    for (let i = 1; i <= MAX_STAGE_INDEX; i += 1) {
      expect(powerScore(baseStatsForStage(i))).toBeGreaterThan(
        powerScore(baseStatsForStage(i - 1)),
      );
    }
  });
});
