import type { CharacterState, WorldSettings } from '@xianxia/shared';
import type { AppContext } from '../context.js';
import type { HandlerContext } from '../http/handler.js';
import { loadOwn, settleAndSave, type LoadedCharacter } from './access.js';

/**
 * 气血 bookkeeping.
 *
 * 论道 and 围攻 leave the loser wounded: `CharacterState.hpPercent` carries the
 * share of 气血 a cultivator walks away with, and the next fight starts from
 * there. Recovery is lazy in exactly the way cultivation is (ARCHITECTURE §8) —
 * no timer refills anyone; a read computes what the wall clock already healed.
 *
 * The elapsed window comes from `SettleResult.elapsedSec`, which is measured
 * against the *pre-settle* `lastSettledAt`, so folding recovery in right after a
 * settle costs no extra read and telescopes correctly across many small settles.
 */

/** 气血 goes from empty to full in this long. */
export const HP_FULL_RECOVER_MS = 10 * 60 * 1000;

/** Linear regeneration over `HP_FULL_RECOVER_MS`, clamped to 1. */
export function recoveredHpPercent(hpPercent: number, elapsedMs: number): number {
  if (hpPercent >= 1 || elapsedMs <= 0) return Math.min(1, Math.max(0, hpPercent));
  return Math.min(1, hpPercent + elapsedMs / HP_FULL_RECOVER_MS);
}

/** Returns `state` with `hpPercent` advanced by `elapsedMs` of healing. */
export function applyHpRecovery(state: CharacterState, elapsedMs: number): CharacterState {
  const healed = recoveredHpPercent(state.hpPercent, elapsedMs);
  return healed === state.hpPercent ? state : { ...state, hpPercent: healed };
}

/** The caller's cultivator, settled, healed and saved. */
export function loadOwnHealed(c: HandlerContext): LoadedCharacter {
  const loaded = loadOwn(c);
  const state = applyHpRecovery(loaded.state, loaded.result.elapsedSec * 1000);
  if (state !== loaded.state) c.ctx.characters.save(state);
  return { state, result: loaded.result };
}

/** Any cultivator by id, settled, healed and saved. Used for PvP targets. */
export function loadOtherHealed(
  ctx: AppContext,
  characterId: string,
  world: WorldSettings,
  now: number,
): CharacterState | null {
  const raw = ctx.characters.byId(characterId);
  if (!raw) return null;
  const loaded = settleAndSave(ctx, raw, world, now);
  // A bot's `hpPercent` is its raid 血池, not a duelling wound: it refills at
  // `raidRecoverMinutes` under the bot tick, or all at once when its shield
  // lapses — never at the player rate.
  if (loaded.state.isBot) return loaded.state;

  const state = applyHpRecovery(loaded.state, loaded.result.elapsedSec * 1000);
  if (state !== loaded.state) ctx.characters.save(state);
  return state;
}

/**
 * A bot's raid 血池 right now.
 *
 * The bot tick heals a raided bot back over `raidRecoverMinutes`; a bot that was
 * brought down is instead parked behind `protectedUntil` and comes back whole
 * the moment that window closes, which is what the raid endpoints read here so
 * the answer does not depend on a tick having run.
 */
export function botRaidHpPercent(state: CharacterState, now: number): number {
  if (state.protectedUntil > 0 && now >= state.protectedUntil) return 1;
  return Math.min(1, Math.max(0, state.hpPercent));
}
