/**
 * Realm and stage table.
 *
 * Nine major realms (大境界) x four sub-stages (前期/中期/后期/圆满) = 36 stages,
 * addressed everywhere by a flat `stageIndex` in [0, 35].
 *
 * Pacing model
 * ------------
 * A stage's target duration at the baseline (凡灵根 1.0, no technique, no pill,
 * world multiplier 1) is:
 *
 *     durationSec(realm, sub) = REALM_BASE_SEC[realm] * SUB_DURATION_MULT[sub]
 *
 * and the stored `expRequired` is that duration multiplied by the stage's
 * `baseRatePerSec`, so `expRequired / baseRatePerSec` reproduces the target.
 * Rate climbs with the realm purely so that displayed 修为 numbers grow in a
 * xianxia-flavoured way; it never changes the pacing, which is set by
 * `REALM_BASE_SEC` alone.
 *
 * Design bands (asserted by tests):
 *   练气 2-10 min/stage, 筑基 20-60 min, 金丹 2-6 h, 元婴 8-24 h,
 *   and from 化神 on, each realm's total is 1.5x-2x the previous realm's
 *   (the table uses a flat 1.8x).
 */

export const REALM_NAMES = [
  '练气',
  '筑基',
  '金丹',
  '元婴',
  '化神',
  '炼虚',
  '合体',
  '大乘',
  '渡劫',
] as const;

export type RealmName = (typeof REALM_NAMES)[number];

export const SUB_STAGE_NAMES = ['前期', '中期', '后期', '圆满'] as const;
export type SubStageName = (typeof SUB_STAGE_NAMES)[number];

export const REALM_COUNT = REALM_NAMES.length; // 9
export const SUB_STAGES_PER_REALM = SUB_STAGE_NAMES.length; // 4
export const STAGE_COUNT = REALM_COUNT * SUB_STAGES_PER_REALM; // 36
export const MAX_STAGE_INDEX = STAGE_COUNT - 1; // 35

/** Sub-stage index of 圆满, the only stage a major breakthrough departs from. */
export const PERFECTION_SUB = SUB_STAGES_PER_REALM - 1; // 3

/**
 * Baseline seconds for the 前期 stage of each realm.
 * 练气..元婴 are pinned to the design bands; 化神 onward is the previous
 * realm x1.8, rounded to a whole minute.
 */
const REALM_BASE_SEC = [
  180, // 练气   3 min
  1500, // 筑基  25 min
  9000, // 金丹   2.5 h
  36000, // 元婴  10 h
  64800, // 化神  18 h      (x1.8 of 元婴)
  116640, // 炼虚 32.4 h    (x1.8)
  209940, // 合体 58.3 h    (x1.8)
  377880, // 大乘 105 h     (x1.8)
  680160, // 渡劫 189 h     (x1.8)
] as const;

/** Relative length of each sub-stage inside a realm. Sums to 6.4. */
const SUB_DURATION_MULT = [1, 1.4, 1.8, 2.2] as const;

/** Cultivation rate scale per realm; doubles each realm (1 -> 256). */
const REALM_RATE = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;

/** Cultivation rate scale within a realm. */
const SUB_RATE_MULT = [1, 1.1, 1.2, 1.3] as const;

export interface StageInfo {
  /** Flat index, 0-35. */
  stageIndex: number;
  /** Major realm index, 0-8. */
  realm: number;
  /** Sub-stage index within the realm, 0-3. */
  sub: number;
  realmName: RealmName;
  subName: SubStageName;
  /** Display name, e.g. `练气·前期`. */
  name: string;
  /** Cultivation points required to fill this stage. */
  expRequired: number;
  /** Baseline cultivation points per second at this stage. */
  baseRatePerSec: number;
  /** Baseline seconds to clear this stage: `expRequired / baseRatePerSec`. */
  durationSec: number;
  /** True at 圆满, where progress stops until a breakthrough is attempted. */
  isPerfection: boolean;
}

function buildStages(): readonly StageInfo[] {
  const stages: StageInfo[] = [];
  for (let realm = 0; realm < REALM_COUNT; realm += 1) {
    for (let sub = 0; sub < SUB_STAGES_PER_REALM; sub += 1) {
      const stageIndex = realm * SUB_STAGES_PER_REALM + sub;
      const baseRatePerSec = (REALM_RATE[realm] as number) * (SUB_RATE_MULT[sub] as number);
      const targetSec = (REALM_BASE_SEC[realm] as number) * (SUB_DURATION_MULT[sub] as number);
      const expRequired = Math.round(targetSec * baseRatePerSec);
      const realmName = REALM_NAMES[realm] as RealmName;
      const subName = SUB_STAGE_NAMES[sub] as SubStageName;
      stages.push({
        stageIndex,
        realm,
        sub,
        realmName,
        subName,
        name: `${realmName}·${subName}`,
        expRequired,
        baseRatePerSec,
        durationSec: expRequired / baseRatePerSec,
        isPerfection: sub === PERFECTION_SUB,
      });
    }
  }
  return stages;
}

/** The full 36-stage table, indexed by `stageIndex`. */
export const STAGES: readonly StageInfo[] = buildStages();

/** Throws unless `stageIndex` is an integer in [0, 35]. */
export function assertStageIndex(stageIndex: number): void {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex > MAX_STAGE_INDEX) {
    throw new RangeError(`stageIndex out of range: ${stageIndex}`);
  }
}

export function getStage(stageIndex: number): StageInfo {
  assertStageIndex(stageIndex);
  return STAGES[stageIndex] as StageInfo;
}

/** Display name for a stage, e.g. `金丹·后期`. */
export function stageName(stageIndex: number): string {
  return getStage(stageIndex).name;
}

export function realmOf(stageIndex: number): number {
  return Math.floor(stageIndex / SUB_STAGES_PER_REALM);
}

export function subOf(stageIndex: number): number {
  return stageIndex % SUB_STAGES_PER_REALM;
}

export function realmNameOf(stageIndex: number): RealmName {
  return REALM_NAMES[realmOf(stageIndex)] as RealmName;
}

/** Cultivation points needed to clear the stage. */
export function expRequired(stageIndex: number): number {
  return getStage(stageIndex).expRequired;
}

/** Baseline (unmodified) cultivation points per second at the stage. */
export function baseRatePerSec(stageIndex: number): number {
  return getStage(stageIndex).baseRatePerSec;
}

/** Baseline seconds to clear the stage with no bonuses at all. */
export function stageDurationSec(stageIndex: number): number {
  return getStage(stageIndex).durationSec;
}

/** True at 圆满 stages, where a breakthrough is required to continue. */
export function isPerfection(stageIndex: number): boolean {
  return subOf(stageIndex) === PERFECTION_SUB;
}

/** True at 大乘·圆满, the only breakthrough gated behind a 天劫 battle. */
export function requiresTribulation(stageIndex: number): boolean {
  return stageIndex === REALM_NAMES.indexOf('大乘') * SUB_STAGES_PER_REALM + PERFECTION_SUB;
}

/** First stageIndex of a realm, e.g. `stageIndexOfRealm(2)` -> 金丹·前期. */
export function stageIndexOfRealm(realm: number): number {
  if (!Number.isInteger(realm) || realm < 0 || realm >= REALM_COUNT) {
    throw new RangeError(`realm out of range: ${realm}`);
  }
  return realm * SUB_STAGES_PER_REALM;
}

/** Baseline seconds to clear an entire realm (all four sub-stages). */
export function realmDurationSec(realm: number): number {
  const start = stageIndexOfRealm(realm);
  let total = 0;
  for (let i = start; i < start + SUB_STAGES_PER_REALM; i += 1) {
    total += (STAGES[i] as StageInfo).durationSec;
  }
  return total;
}

/** Baseline seconds from 练气·前期 to the end of `stageIndex`. */
export function cumulativeDurationSec(stageIndex: number): number {
  assertStageIndex(stageIndex);
  let total = 0;
  for (let i = 0; i <= stageIndex; i += 1) total += (STAGES[i] as StageInfo).durationSec;
  return total;
}
