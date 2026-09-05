/**
 * 突破.
 *
 * 小境界 (前期 -> 中期 -> 后期 -> 圆满) advance on their own inside
 * `settleCultivation`. Only 圆满 -> the next 大境界 requires an explicit
 * attempt, which can fail.
 *
 * Base success runs from 80% at 练气·圆满 down to 35% at 大乘·圆满, each
 * 破境丹 adds +15pp, and the total is capped at 95%. A failure costs 20% of
 * the 修为 accumulated in the current stage.
 *
 * The final step, 大乘·圆满 -> 渡劫·前期, additionally requires surviving a
 * 天劫 battle; the caller runs that fight through the combat engine and passes
 * its outcome in.
 */

import { clamp } from '../core/util.js';
import type { Rng } from '../core/rng.js';
import {
  getStage,
  isPerfection,
  MAX_STAGE_INDEX,
  PERFECTION_SUB,
  realmOf,
  requiresTribulation,
  SUB_STAGES_PER_REALM,
} from './realms.js';
import type { CharacterState } from '../domain/character.js';
import type { WorldSettings } from '../domain/world.js';

/**
 * Base success chance per 圆满 stage, indexed by the departing realm.
 * 练气 -> 筑基 is index 0; 大乘 -> 渡劫 is index 7.
 */
export const BREAKTHROUGH_BASE_CHANCE = [0.8, 0.74, 0.67, 0.61, 0.54, 0.48, 0.41, 0.35] as const;

/** Each 破境丹 adds this much to the success chance. */
export const PILL_BONUS_PER_UNIT = 0.15;

/** No amount of pills pushes a breakthrough past this. */
export const MAX_BREAKTHROUGH_CHANCE = 0.95;

/** Fraction of the stage's accumulated 修为 lost on a failed attempt. */
export const BREAKTHROUGH_FAILURE_EXP_LOSS = 0.2;

/** Most 破境丹 a single attempt will consume. */
export const MAX_BREAKTHROUGH_PILLS = 4;

/**
 * Success chance for a breakthrough out of `stageIndex`.
 *
 * Returns 1 for non-圆满 stages (小境界 advances never fail) and 0 at the very
 * top of the ladder, where there is nothing left to break through to.
 */
export function breakthroughChance(
  stageIndex: number,
  pills = 0,
  world?: Pick<WorldSettings, 'breakthroughChanceMultiplier'>,
): number {
  const stage = getStage(stageIndex);
  if (stageIndex >= MAX_STAGE_INDEX) return 0;
  if (!isPerfection(stageIndex)) return 1;

  const base = BREAKTHROUGH_BASE_CHANCE[stage.realm];
  if (base === undefined) return 0;

  const usedPills = clamp(Math.floor(pills), 0, MAX_BREAKTHROUGH_PILLS);
  const multiplier = world?.breakthroughChanceMultiplier ?? 1;
  const raw = (base + usedPills * PILL_BONUS_PER_UNIT) * multiplier;
  return clamp(raw, 0, MAX_BREAKTHROUGH_CHANCE);
}

export const BREAKTHROUGH_BLOCK_REASONS = [
  'not_at_perfection',
  'exp_not_full',
  'max_stage',
  'tribulation_required',
] as const;
export type BreakthroughBlockReason = (typeof BREAKTHROUGH_BLOCK_REASONS)[number];

export interface BreakthroughReadiness {
  ready: boolean;
  reason: BreakthroughBlockReason | null;
  /** True at 大乘·圆满, where a 天劫 battle must be won first. */
  needsTribulation: boolean;
  chance: number;
}

/** Checks whether a character may attempt a breakthrough right now. */
export function checkBreakthroughReadiness(
  character: CharacterState,
  pills = 0,
  world?: Pick<WorldSettings, 'breakthroughChanceMultiplier'>,
  tribulationWon = false,
): BreakthroughReadiness {
  const stageIndex = character.stageIndex;
  const stage = getStage(stageIndex);
  const needsTribulation = requiresTribulation(stageIndex);
  const chance = breakthroughChance(stageIndex, pills, world);

  if (stageIndex >= MAX_STAGE_INDEX) {
    return { ready: false, reason: 'max_stage', needsTribulation, chance };
  }
  if (!isPerfection(stageIndex)) {
    return { ready: false, reason: 'not_at_perfection', needsTribulation, chance };
  }
  if (character.exp < stage.expRequired) {
    return { ready: false, reason: 'exp_not_full', needsTribulation, chance };
  }
  if (needsTribulation && !tribulationWon) {
    return { ready: false, reason: 'tribulation_required', needsTribulation, chance };
  }
  return { ready: true, reason: null, needsTribulation, chance };
}

export interface BreakthroughResult {
  success: boolean;
  /** Non-null when the attempt was rejected outright; nothing was consumed. */
  blocked: BreakthroughBlockReason | null;
  chance: number;
  /** 破境丹 actually consumed (0 when blocked). */
  pillsUsed: number;
  fromStageIndex: number;
  toStageIndex: number;
  /** 修为 lost to a failure. */
  expLost: number;
  character: CharacterState;
}

export interface AttemptBreakthroughOptions {
  pills?: number;
  world?: Pick<WorldSettings, 'breakthroughChanceMultiplier'>;
  /** Result of the 天劫 battle; only consulted at 大乘·圆满. */
  tribulationWon?: boolean;
}

/**
 * Rolls a major breakthrough. Pure: returns a new character record.
 * On success the character lands on 前期 of the next realm with 0 修为.
 */
export function attemptBreakthrough(
  character: CharacterState,
  rng: Rng,
  options: AttemptBreakthroughOptions = {},
): BreakthroughResult {
  const pills = clamp(Math.floor(options.pills ?? 0), 0, MAX_BREAKTHROUGH_PILLS);
  const readiness = checkBreakthroughReadiness(
    character,
    pills,
    options.world,
    options.tribulationWon ?? false,
  );

  if (!readiness.ready) {
    return {
      success: false,
      blocked: readiness.reason,
      chance: readiness.chance,
      pillsUsed: 0,
      fromStageIndex: character.stageIndex,
      toStageIndex: character.stageIndex,
      expLost: 0,
      character,
    };
  }

  const success = rng.chance(readiness.chance);
  const stage = getStage(character.stageIndex);

  if (success) {
    const toStageIndex = (realmOf(character.stageIndex) + 1) * SUB_STAGES_PER_REALM;
    return {
      success: true,
      blocked: null,
      chance: readiness.chance,
      pillsUsed: pills,
      fromStageIndex: character.stageIndex,
      toStageIndex,
      expLost: 0,
      character: { ...character, stageIndex: toStageIndex, exp: 0 },
    };
  }

  const expLost = stage.expRequired * BREAKTHROUGH_FAILURE_EXP_LOSS;
  return {
    success: false,
    blocked: null,
    chance: readiness.chance,
    pillsUsed: pills,
    fromStageIndex: character.stageIndex,
    toStageIndex: character.stageIndex,
    expLost,
    character: { ...character, exp: Math.max(0, character.exp - expLost) },
  };
}

/** Every stageIndex a major breakthrough departs from (8 entries). */
export const BREAKTHROUGH_STAGE_INDEXES: readonly number[] = BREAKTHROUGH_BASE_CHANCE.map(
  (_, realm) => realm * SUB_STAGES_PER_REALM + PERFECTION_SUB,
);
