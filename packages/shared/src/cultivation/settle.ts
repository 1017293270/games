/**
 * Lazy cultivation settlement.
 *
 * Nothing ticks. A character's 修为 is a pure function of the wall clock:
 * whenever the server touches a character it calls `settleCultivation`, which
 * replays the elapsed window at the correct rate for each segment.
 *
 * Rules:
 *   - Elapsed time beyond `world.offlineCapHours` is forfeited outright.
 *   - Rate changes mid-window (a pill expiring, a stage advancing) split the
 *     window into segments, each integrated exactly.
 *   - 小境界 (前期 -> 中期 -> 后期 -> 圆满) advance automatically.
 *   - 圆满 parks: 修为 caps at `expRequired` and the character waits for an
 *     explicit breakthrough. Overflow time is discarded, not banked.
 */

import { getStage, isPerfection, MAX_STAGE_INDEX } from './realms.js';
import { spiritRootMultiplier } from './spiritRoot.js';
import type { CharacterState, CultivationBuff } from '../domain/character.js';
import type { Technique } from '../domain/technique.js';
import type { WorldSettings } from '../domain/world.js';

/**
 * Tolerance, in seconds, for "this stage is exactly full".
 *
 * Timestamps are epoch milliseconds, and a double at that magnitude carries
 * roughly 1e-7 s of representation error once a duration has round-tripped
 * through one. A microsecond of slack absorbs that without being observable
 * in gameplay.
 */
const SETTLE_EPSILON_SEC = 1e-6;

export interface CultivationRateInput {
  stageIndex: number;
  spiritRootQuality: CharacterState['spiritRoot']['quality'];
  /** Additive bonus from the studied 功法. */
  techniqueBonus?: number;
  /** Additive bonus from active pill buffs. */
  pillBonus?: number;
  world: Pick<WorldSettings, 'cultivationMultiplier'>;
  /** Bot `talent` x (1 + `insight`); 1 for human players. */
  botMultiplier?: number;
}

/**
 * 修炼速率 = baseRate(stage) x 灵根品质 x (1 + 功法) x (1 + 丹药) x 世界倍率.
 */
export function cultivationRatePerSec(input: CultivationRateInput): number {
  const base = getStage(input.stageIndex).baseRatePerSec;
  return (
    base *
    spiritRootMultiplier(input.spiritRootQuality) *
    (1 + (input.techniqueBonus ?? 0)) *
    (1 + (input.pillBonus ?? 0)) *
    (input.world.cultivationMultiplier ?? 1) *
    (input.botMultiplier ?? 1)
  );
}

/** Sum of the additive bonuses of every buff active at `atMs`. */
export function activePillBonus(buffs: readonly CultivationBuff[], atMs: number): number {
  let bonus = 0;
  for (const buff of buffs) {
    if (buff.expiresAt > atMs) bonus += buff.bonus;
  }
  return bonus;
}

/** Drops buffs that expired at or before `atMs`. */
export function pruneBuffs(
  buffs: readonly CultivationBuff[],
  atMs: number,
): CultivationBuff[] {
  return buffs.filter((b) => b.expiresAt > atMs);
}

export interface SettleResult {
  /** A new character record; the input is never mutated. */
  character: CharacterState;
  /** Cultivation points added across the whole window. */
  gainedExp: number;
  /** Wall-clock seconds since `lastSettledAt`. */
  elapsedSec: number;
  /** Seconds actually credited after the offline cap. */
  creditedSec: number;
  /** Seconds discarded by the offline cap. */
  forfeitedSec: number;
  /** 小境界 advances that happened during the window. */
  stageUps: number;
  /** Stage index before settling. */
  fromStageIndex: number;
  /** True when the character is parked at 圆满 awaiting a breakthrough. */
  atPerfection: boolean;
  /** Seconds of the credited window that produced nothing (parked at 圆满). */
  wastedSec: number;
}

export interface SettleOptions {
  /** The studied 功法, for its cultivation bonus. */
  technique?: Technique | null;
  /**
   * Overrides the elapsed window's start. Callers that track presence can pass
   * `lastSeenAt` to bill an online stretch and an offline stretch separately;
   * by default the window starts at `character.lastSettledAt`.
   */
  fromMs?: number;
}

/**
 * Advances a character's cultivation to `nowMs`.
 *
 * Pure: returns a new `CharacterState` and leaves the argument untouched.
 */
export function settleCultivation(
  character: CharacterState,
  nowMs: number,
  world: Pick<WorldSettings, 'cultivationMultiplier' | 'offlineCapHours'>,
  options: SettleOptions = {},
): SettleResult {
  const fromMs = options.fromMs ?? character.lastSettledAt;
  const elapsedSec = Math.max(0, (nowMs - fromMs) / 1000);
  const capSec = Math.max(0, world.offlineCapHours) * 3600;
  const creditedSec = Math.min(elapsedSec, capSec);
  const forfeitedSec = elapsedSec - creditedSec;

  // The credited window starts where the forfeited part ends, so a buff that
  // expired during the discarded stretch is correctly already gone.
  const windowStartMs = nowMs - creditedSec * 1000;

  const techniqueBonus = options.technique?.cultivationBonus ?? 0;
  const botMultiplier =
    character.isBot && character.botParams
      ? character.botParams.talent * (1 + character.botParams.insight)
      : 1;

  // Split the window at every buff expiry that falls inside it, so each
  // segment has one constant pill bonus.
  const breakpoints = new Set<number>([windowStartMs, nowMs]);
  for (const buff of character.buffs) {
    if (buff.expiresAt > windowStartMs && buff.expiresAt < nowMs) breakpoints.add(buff.expiresAt);
  }
  const marks = [...breakpoints].sort((a, b) => a - b);

  let stageIndex = character.stageIndex;
  let exp = character.exp;
  let stageUps = 0;
  let gainedExp = 0;
  let wastedSec = 0;

  for (let i = 0; i < marks.length - 1; i += 1) {
    const segStart = marks[i] as number;
    const segEnd = marks[i + 1] as number;
    let remaining = (segEnd - segStart) / 1000;
    if (remaining <= 0) continue;

    const pillBonus = activePillBonus(character.buffs, segStart);

    while (remaining > 0) {
      const stage = getStage(stageIndex);
      const rate = cultivationRatePerSec({
        stageIndex,
        spiritRootQuality: character.spiritRoot.quality,
        techniqueBonus,
        pillBonus,
        world,
        botMultiplier,
      });

      if (rate <= 0) {
        wastedSec += remaining;
        break;
      }

      const missing = stage.expRequired - exp;
      if (missing <= 0) {
        // Already full. Either roll into the next 小境界 or park at 圆满.
        if (isPerfection(stageIndex) || stageIndex >= MAX_STAGE_INDEX) {
          wastedSec += remaining;
          break;
        }
        stageIndex += 1;
        exp = 0;
        stageUps += 1;
        continue;
      }

      const secondsToFill = missing / rate;
      // The epsilon absorbs float representation error so that cultivating for
      // exactly `stageDurationSec` does tip the stage over rather than landing
      // a fraction of a point short.
      if (secondsToFill - remaining > SETTLE_EPSILON_SEC) {
        exp += rate * remaining;
        gainedExp += rate * remaining;
        break;
      }

      exp = stage.expRequired;
      gainedExp += missing;
      remaining -= secondsToFill;

      if (isPerfection(stageIndex) || stageIndex >= MAX_STAGE_INDEX) {
        wastedSec += remaining;
        break;
      }
      stageIndex += 1;
      exp = 0;
      stageUps += 1;
    }
  }

  const character2: CharacterState = {
    ...character,
    stageIndex,
    exp,
    buffs: pruneBuffs(character.buffs, nowMs),
    lastSettledAt: nowMs,
  };

  return {
    character: character2,
    gainedExp,
    elapsedSec,
    creditedSec,
    forfeitedSec,
    stageUps,
    fromStageIndex: character.stageIndex,
    atPerfection: isPerfection(stageIndex) && exp >= getStage(stageIndex).expRequired,
    wastedSec,
  };
}

/**
 * Seconds until the current stage fills at the present rate.
 * `Infinity` when the character is parked at 圆满 or the rate is zero.
 */
export function secondsToNextStage(
  character: CharacterState,
  world: Pick<WorldSettings, 'cultivationMultiplier'>,
  options: { technique?: Technique | null; nowMs?: number } = {},
): number {
  const nowMs = options.nowMs ?? character.lastSettledAt;
  const stage = getStage(character.stageIndex);
  const missing = stage.expRequired - character.exp;
  if (missing <= 0) return 0;

  const rate = cultivationRatePerSec({
    stageIndex: character.stageIndex,
    spiritRootQuality: character.spiritRoot.quality,
    techniqueBonus: options.technique?.cultivationBonus ?? 0,
    pillBonus: activePillBonus(character.buffs, nowMs),
    world,
    botMultiplier:
      character.isBot && character.botParams
        ? character.botParams.talent * (1 + character.botParams.insight)
        : 1,
  });
  if (rate <= 0) return Number.POSITIVE_INFINITY;
  return missing / rate;
}
