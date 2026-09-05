import type { CharacterState, SettleResult, WorldSettings } from '@xianxia/shared';
import type { AppContext } from '../context.js';
import { ApiError, MESSAGES } from '../http/errors.js';
import type { HandlerContext } from '../http/handler.js';
import { resolveEquipment, settle, withFreshPower } from './character.js';
import { rollDailyCounters } from './rewards.js';

/**
 * Loading a character always settles it first (ARCHITECTURE §8): 修为 is a pure
 * function of the wall clock, so a read is what advances it. Every handler that
 * touches a cultivator goes through here, which is why nothing in this server
 * runs a cultivation timer.
 */

export interface LoadedCharacter {
  state: CharacterState;
  result: SettleResult;
}

/**
 * Settles `state` to `now`, refreshes the daily quotas and the cached 战力, and
 * writes it back. `extraMultiplier` scales the world cultivation rate for this
 * one character — the bot tick passes its schedule multiplier that way.
 */
export function settleAndSave(
  ctx: AppContext,
  state: CharacterState,
  world: WorldSettings,
  now: number,
  extraMultiplier = 1,
): LoadedCharacter {
  const result = settle(state, world, now, extraMultiplier);
  const rolled = rollDailyCounters(result.character, now);
  const fresh = withFreshPower(rolled, resolveEquipment(rolled, ctx.inventory));
  ctx.characters.save(fresh);
  return { state: fresh, result };
}

/** The caller's own cultivator, settled and saved. Throws when unset. */
export function loadOwn(c: HandlerContext): LoadedCharacter {
  if (!c.identity) throw new ApiError('UNAUTHORIZED', MESSAGES.UNAUTHORIZED);
  const state = c.ctx.characters.byUserId(c.identity.user.id);
  if (!state) throw new ApiError('CHARACTER_NOT_FOUND', MESSAGES.CHARACTER_NOT_FOUND);

  const loaded = settleAndSave(c.ctx, { ...state, lastSeenAt: c.now }, c.world, c.now);
  return loaded;
}

/** Persists a mutated character and pushes the delta to its own sockets. */
export function saveAndPush(ctx: AppContext, state: CharacterState): CharacterState {
  const fresh = withFreshPower(state, resolveEquipment(state, ctx.inventory));
  ctx.characters.save(fresh);
  ctx.realtime.characterUpdate(fresh);
  return fresh;
}

/** Any cultivator by id, settled and saved. Used for profiles and PvP targets. */
export function loadOther(
  ctx: AppContext,
  characterId: string,
  world: WorldSettings,
  now: number,
): CharacterState | null {
  const state = ctx.characters.byId(characterId);
  if (!state) return null;
  return settleAndSave(ctx, state, world, now).state;
}
