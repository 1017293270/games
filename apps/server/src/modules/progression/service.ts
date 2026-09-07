import { randomBytes } from 'node:crypto';
import {
  claimProgression,
  drawProgression,
  equipProgression,
  getProgression,
  ProgressionError,
  upgradeProgression,
  type CharacterState,
  type ProgressionResponse,
  type ProgressionState,
} from '@xianxia/shared';
import { transact } from '../../db/index.js';
import { loadOwn } from '../../game/access.js';
import { buildView, resolveEquipment, withFreshPower } from '../../game/character.js';
import { ApiError } from '../../http/errors.js';
import type { HandlerContext } from '../../http/handler.js';
import { GachaRepo } from './repo.js';

function response(c: HandlerContext, state: CharacterState): ProgressionResponse {
  return {
    view: buildView(state, c.world, c.now, c.ctx.inventory),
    progression: getProgression(state.progression, c.now),
  };
}

/** All mutations, currency and receipts commit together; no awaited work or pushes inside. */
function mutate(
  c: HandlerContext,
  change: (
    state: ProgressionState,
    characterId: string,
  ) => {
    progression: ProgressionState;
    results?: ProgressionResponse['results'];
  },
): ProgressionResponse {
  let saved: CharacterState;
  let results: ProgressionResponse['results'];
  try {
    saved = transact(c.ctx.db, () => {
      const state = loadOwn(c).state;
      const outcome = change(getProgression(state.progression, c.now), state.id);
      results = outcome.results;
      const next = withFreshPower(
        { ...state, progression: outcome.progression },
        resolveEquipment(state, c.ctx.inventory),
      );
      c.ctx.characters.save(next);
      return next;
    });
  } catch (error) {
    if (error instanceof ProgressionError) throw new ApiError(error.code, error.message);
    throw error;
  }
  c.ctx.realtime.characterUpdate(saved);
  return { ...response(c, saved), ...(results ? { results } : {}) };
}

export function get(c: HandlerContext): ProgressionResponse {
  return response(c, loadOwn(c).state);
}
export function history(c: HandlerContext) {
  return { items: new GachaRepo(c.ctx.db).history(loadOwn(c).state.id) };
}
export function draw(
  c: HandlerContext<Parameters<typeof drawProgression>[1]>,
): ProgressionResponse {
  return mutate(c, (state, characterId) => {
    const repo = new GachaRepo(c.ctx.db);
    const prior = repo.request(characterId, c.input.requestId);
    if (prior) return { progression: state, results: prior.results };
    const outcome = drawProgression(state, c.input, randomBytes(4).readUInt32LE(), c.now);
    repo.insert(characterId, c.input.requestId, outcome.results, c.now);
    return outcome;
  });
}
export function equip(
  c: HandlerContext<Parameters<typeof equipProgression>[1]>,
): ProgressionResponse {
  return mutate(c, (state) => ({ progression: equipProgression(state, c.input) }));
}
export function upgrade(
  c: HandlerContext<Parameters<typeof upgradeProgression>[1]>,
): ProgressionResponse {
  return mutate(c, (state) => ({ progression: upgradeProgression(state, c.input) }));
}
export function claim(
  c: HandlerContext<Parameters<typeof claimProgression>[1]>,
): ProgressionResponse {
  return mutate(c, (state) => ({ progression: claimProgression(state, c.input, c.now) }));
}
