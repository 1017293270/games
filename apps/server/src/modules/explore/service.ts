import { progressEvent } from '../../game/progression.js';
import { randomUUID } from 'node:crypto';
import {
  combineSeeds,
  createRng,
  ENCOUNTER_BY_ID,
  EXPLORE_MAP_BY_ID,
  EXPLORE_MAPS,
  MONSTER_BY_ID,
  stageName,
  type CharacterState,
  type Encounter,
  type EncounterChoiceResponse,
  type ExploreBattleResponse,
  type GatherResponse,
  type MapListResponse,
  type Monster,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildView, resolveEquipment, statsOf, withFreshPower } from '../../game/character.js';
import { characterCombatant, monsterCombatant, runBattle } from '../../game/combat.js';
import {
  applyEffects,
  applyReward,
  checkAll,
  emptyReward,
  firstBlockReason,
  nameReward,
  rollLoot,
  scaleReward,
} from '../../game/rewards.js';
import { recordMonsterKill } from '../quest/service.js';

/** How long an 奇遇 token stays answerable. */
export const ENCOUNTER_TTL_MS = 10 * 60 * 1000;

/** Maps, their unlock state and the 采药 cooldown. */
export function listMaps(state: CharacterState, now: number): MapListResponse {
  return {
    maps: EXPLORE_MAPS.map((map) => {
      const readyAt = state.dailyCounters.gatherAt[map.id] ?? 0;
      return {
        ...map,
        unlocked: state.stageIndex >= map.unlockStage,
        gatherReadyAt: readyAt > now ? readyAt : 0,
        monsters: map.monsterIds
          .map((id) => MONSTER_BY_ID.get(id))
          .filter((m): m is Monster => m !== undefined),
      };
    }),
  };
}

function requireUnlockedMap(state: CharacterState, mapId: string) {
  const map = EXPLORE_MAP_BY_ID.get(mapId);
  if (!map) throw new ApiError('NOT_FOUND', '没有这处地界');
  if (state.stageIndex < map.unlockStage) {
    throw new ApiError('MAP_LOCKED', `${map.name}需 ${stageName(map.unlockStage)} 方可涉足`);
  }
  return map;
}

/**
 * One explore action.
 *
 * Rolls the map's `encounterChance` first: a hit produces an 奇遇 and a token
 * the follow-up choice must echo, a miss produces a fight against one of the
 * map's two 妖兽 (or the requested one).
 */
export function explore(
  ctx: AppContext,
  state: CharacterState,
  input: { mapId: string; monsterId?: string },
  world: WorldSettings,
  now: number,
): ExploreBattleResponse {
  const map = requireUnlockedMap(state, input.mapId);
  const rng = createRng(combineSeeds('explore', state.id, now));

  if (input.monsterId === undefined && rng.chance(map.encounterChance)) {
    const pool = map.encounterIds
      .map((id) => ENCOUNTER_BY_ID.get(id))
      .filter((e): e is Encounter => e !== undefined)
      .filter((e) => checkAll(e.conditions, { state, inventory: ctx.inventory }));

    if (pool.length > 0) {
      const encounter = rng.weighted(
        pool,
        pool.map((e) => e.weight),
      );
      const token = randomUUID();
      ctx.encounters.put(token, {
        characterId: state.id,
        encounter,
        mapId: map.id,
        expiresAt: now + ENCOUNTER_TTL_MS,
      });
      return {
        kind: 'encounter',
        encounter,
        encounterToken: token,
        view: buildView(state, world, now, ctx.inventory),
      };
    }
  }

  const monsterId = input.monsterId ?? rng.pick(map.monsterIds);
  const monster = MONSTER_BY_ID.get(monsterId);
  if (!monster) throw new ApiError('NOT_FOUND', '没有这种妖兽');
  if (input.monsterId !== undefined && !map.monsterIds.includes(monsterId)) {
    throw new ApiError('NOT_FOUND', `${map.name}没有这种妖兽`);
  }

  const stats = statsOf(state, resolveEquipment(state, ctx.inventory));
  const battle = runBattle(
    [characterCombatant(state, stats)],
    [monsterCombatant(monster)],
    combineSeeds('battle', state.id, monster.id, now),
    world,
  );
  const won = battle.winner === 'A';

  let reward = emptyReward();
  let next = state;

  if (won) {
    const scaled = scaleReward(monster.expReward, monster.stoneReward, world);
    const drops = rollLoot(monster.loot, rng, world);
    reward = nameReward({ ...scaled, items: drops });
    next = applyReward(state, reward, ctx.inventory);
    next = recordMonsterKill(next, monster.id);
    next = progressEvent(next, now, 'kills');
  }

  const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);
  ctx.counters.bump('battles', now);

  return {
    kind: 'battle',
    monsterId: monster.id,
    monsterName: monster.name,
    battle,
    won,
    reward,
    view: buildView(saved, world, now, ctx.inventory),
  };
}

/** 采药. One roll per map per `gather.cooldownSec`. */
export function gather(
  ctx: AppContext,
  state: CharacterState,
  mapId: string,
  world: WorldSettings,
  now: number,
): GatherResponse {
  const map = requireUnlockedMap(state, mapId);

  const readyAt = state.dailyCounters.gatherAt[map.id] ?? 0;
  if (readyAt > now) {
    const wait = Math.ceil((readyAt - now) / 1000);
    throw new ApiError('GATHER_COOLDOWN', `此处灵草尚未长成，还需 ${wait} 秒`);
  }

  const rng = createRng(combineSeeds('gather', state.id, map.id, now));
  const scaled = scaleReward(map.gather.expReward, map.gather.stoneReward, world);
  const drops = rollLoot(map.gather.loot, rng, world);
  const reward = nameReward({ ...scaled, items: drops });

  const nextGatherAt = now + map.gather.cooldownSec * 1000;
  let next = applyReward(state, reward, ctx.inventory);
  next = {
    ...next,
    dailyCounters: {
      ...next.dailyCounters,
      gatherAt: { ...next.dailyCounters.gatherAt, [map.id]: nextGatherAt },
    },
  };

  const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);

  return { reward, nextGatherAt, view: buildView(saved, world, now, ctx.inventory) };
}

/** Resolves an 奇遇 choice. */
export function chooseEncounter(
  ctx: AppContext,
  state: CharacterState,
  input: { encounterToken: string; optionId: string },
  world: WorldSettings,
  now: number,
): EncounterChoiceResponse {
  const pending = ctx.encounters.take(input.encounterToken, state.id, now);
  if (!pending) throw new ApiError('ENCOUNTER_NOT_ACTIVE', '这场奇遇已经过去了');

  const option = pending.encounter.options.find((o) => o.id === input.optionId);
  if (!option) throw new ApiError('INVALID_CHOICE', '没有这个选择');

  const blocked = firstBlockReason(option.conditions, { state, inventory: ctx.inventory });
  if (blocked !== null) throw new ApiError('CHOICE_BLOCKED', blocked);

  const outcome = applyEffects(option.effects, { state, inventory: ctx.inventory }, world);
  const saved = withFreshPower(outcome.state, resolveEquipment(outcome.state, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);

  return {
    outcomeText: option.outcomeText,
    reward: outcome.reward,
    view: buildView(saved, world, now, ctx.inventory),
  };
}
