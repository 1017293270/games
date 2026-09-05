import { randomUUID } from 'node:crypto';
import {
  attemptBreakthrough,
  BREAKTHROUGH_PILL_ID,
  checkBreakthroughReadiness,
  combineSeeds,
  createRng,
  dayKey,
  getStage,
  hashSeed,
  ITEM_BY_ID,
  MAX_BREAKTHROUGH_PILLS,
  MONSTER_BY_ID,
  requiresTribulation,
  rollSpiritRoot,
  SKILL_BY_ID,
  SKILL_SLOT_COUNT,
  stageName,
  STARTER_TECHNIQUE_ID,
  starterSkillIds,
  TECHNIQUE_BY_ID,
  tribulationAvatar,
  type BattleResult,
  type BreakthroughResponse,
  type CharacterState,
  type CharacterView,
  type CreateCharacterRequest,
  type SettleResponse,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import {
  atPerfection,
  buildView,
  resolveEquipment,
  stagesPassed,
  statsOf,
  withFreshPower,
} from '../../game/character.js';
import { settleAndSave, type LoadedCharacter } from '../../game/access.js';
import { characterCombatant, monsterCombatant, runBattle } from '../../game/combat.js';

/** 灵石 a fresh cultivator starts with. */
export const STARTING_SPIRIT_STONES = 500;

/** The 新手道具 bundle handed out on character creation. */
export const STARTER_ITEMS: readonly { itemId: string; qty: number }[] = [
  { itemId: 'pill-qi', qty: 3 },
  { itemId: 'pill-heal', qty: 2 },
  { itemId: 'pill-breakthrough', qty: 1 },
  { itemId: 'mat-spirit-herb', qty: 5 },
  { itemId: 'treasure-sword', qty: 1 },
  { itemId: 'robe-linen', qty: 1 },
];

/**
 * Creates a cultivator for an account.
 *
 * The spirit root is rolled server-side (70/25/5) from a seed derived from the
 * account id and the clock, so it cannot be re-rolled by retrying the call —
 * the second attempt is rejected by `CHARACTER_EXISTS` before any roll happens.
 */
export function createCharacter(
  ctx: AppContext,
  userId: string,
  input: CreateCharacterRequest,
  world: WorldSettings,
  now: number,
): CharacterView {
  if (ctx.characters.byUserId(userId)) {
    throw new ApiError('CHARACTER_EXISTS', '你已经有一位修士了');
  }
  if (ctx.characters.nameTaken(input.name)) {
    throw new ApiError('NAME_TAKEN', '这个道号已经有人用了');
  }

  const rng = createRng(combineSeeds(userId, input.name, now));
  const spiritRoot = rollSpiritRoot(rng);
  const starters = starterSkillIds(spiritRoot.element);
  const slots: (string | null)[] = new Array<string | null>(SKILL_SLOT_COUNT).fill(null);
  for (let i = 0; i < Math.min(SKILL_SLOT_COUNT, starters.length); i += 1) {
    slots[i] = starters[i] ?? null;
  }

  const state: CharacterState = {
    id: randomUUID(),
    userId,
    name: input.name,
    gender: input.gender,
    avatarArt: input.avatarArt,

    isBot: false,
    botArchetypeId: null,
    botParams: null,

    spiritRoot,
    stageIndex: 0,
    exp: 0,
    spiritStones: STARTING_SPIRIT_STONES,

    skillSlots: slots,
    learnedSkillIds: starters,
    techniqueId: STARTER_TECHNIQUE_ID,
    learnedTechniqueIds: [STARTER_TECHNIQUE_ID],
    equipment: { treasure: null, robe: null, accessory: null, pet: null },

    buffs: [],
    hpPercent: 1,
    protectedUntil: 0,

    chapter: 1,
    quests: [],
    flags: {},

    lastSettledAt: now,
    lastSeenAt: now,
    createdAt: now,

    dailyCounters: { date: dayKey(now), dungeon: 0, arena: 0, gatherAt: {} },

    arenaRating: 1000,
    arenaWins: 0,
    arenaLosses: 0,
    powerScore: 0,
  };

  ctx.characters.insert(state);
  for (const item of STARTER_ITEMS) ctx.inventory.add(state.id, item.itemId, item.qty);

  const withPower = withFreshPower(state, resolveEquipment(state, ctx.inventory));
  ctx.characters.save(withPower);

  return buildView(withPower, world, now, ctx.inventory);
}

/** Turns a settle result into the endpoint payload. */
export function settleResponse(
  ctx: AppContext,
  loaded: LoadedCharacter,
  world: WorldSettings,
  now: number,
): SettleResponse {
  const { state, result } = loaded;
  return {
    view: buildView(state, world, now, ctx.inventory),
    gainedExp: result.gainedExp,
    elapsedSec: result.elapsedSec,
    creditedSec: result.creditedSec,
    forfeitedSec: result.forfeitedSec,
    stageUps: result.stageUps,
    stagesPassed: stagesPassed(result.fromStageIndex, result.stageUps),
  };
}

/**
 * Attempts a major breakthrough.
 *
 * 大乘·圆满 first fights a 天劫: losing that fight ends the call with
 * `success: false` and the replay attached, and consumes nothing — the
 * breakthrough was never rolled.
 */
export function breakthrough(
  ctx: AppContext,
  loaded: LoadedCharacter,
  pills: number,
  world: WorldSettings,
  now: number,
): BreakthroughResponse {
  const state = loaded.state;
  const requested = Math.min(Math.max(0, Math.floor(pills)), MAX_BREAKTHROUGH_PILLS);

  if (requested > 0) {
    const held = ctx.inventory.quantityOf(state.id, BREAKTHROUGH_PILL_ID);
    if (held < requested) {
      const name = ITEM_BY_ID.get(BREAKTHROUGH_PILL_ID)?.name ?? BREAKTHROUGH_PILL_ID;
      throw new ApiError('INSUFFICIENT_ITEMS', `${name}不足，需要 ${requested} 颗，你只有 ${held} 颗`);
    }
  }

  const readiness = checkBreakthroughReadiness(state, requested, world, true);
  if (!readiness.ready && readiness.reason !== 'tribulation_required') {
    throw blockedError(readiness.reason, state.stageIndex);
  }

  let tribulation: BattleResult | null = null;
  let tribulationWon = false;

  if (requiresTribulation(state.stageIndex)) {
    const stats = statsOf(state, resolveEquipment(state, ctx.inventory));
    const avatar = tribulationAvatar(state.stageIndex);
    tribulation = runBattle(
      [characterCombatant(state, stats)],
      [monsterCombatant(avatar)],
      combineSeeds('tribulation', state.id, now),
      world,
    );
    tribulationWon = tribulation.winner === 'A';

    ctx.battles.insert({
      kind: 'tribulation',
      attackerId: state.id,
      attackerName: state.name,
      defenderId: avatar.id,
      defenderName: avatar.name,
      winnerId: tribulationWon ? state.id : null,
      ratingDelta: 0,
      foughtAt: now,
      battle: tribulation,
    });

    if (!tribulationWon) {
      return {
        success: false,
        chance: readiness.chance,
        pillsUsed: 0,
        fromStageIndex: state.stageIndex,
        toStageIndex: state.stageIndex,
        fromStageName: stageName(state.stageIndex),
        toStageName: stageName(state.stageIndex),
        expLost: 0,
        tribulation,
        view: buildView(state, world, now, ctx.inventory),
      };
    }
  }

  const rng = createRng(combineSeeds('breakthrough', state.id, now, hashSeed(String(state.exp))));
  const attempt = attemptBreakthrough(state, rng, { pills: requested, world, tribulationWon });

  if (attempt.blocked) throw blockedError(attempt.blocked, state.stageIndex);

  if (attempt.pillsUsed > 0) {
    ctx.inventory.removeByItemId(state.id, BREAKTHROUGH_PILL_ID, attempt.pillsUsed);
  }

  const next = withFreshPower(
    attempt.character,
    resolveEquipment(attempt.character, ctx.inventory),
  );
  ctx.characters.save(next);
  ctx.realtime.characterUpdate(next);
  ctx.counters.bump('breakthroughs', now, attempt.success ? 1 : 0);

  if (attempt.success) {
    ctx.realtime.notice({
      kind: 'breakthrough',
      text: `${next.name} 突破至 ${stageName(attempt.toStageIndex)}`,
      characterId: next.id,
      at: now,
    });
  }

  return {
    success: attempt.success,
    chance: attempt.chance,
    pillsUsed: attempt.pillsUsed,
    fromStageIndex: attempt.fromStageIndex,
    toStageIndex: attempt.toStageIndex,
    fromStageName: stageName(attempt.fromStageIndex),
    toStageName: stageName(attempt.toStageIndex),
    expLost: attempt.expLost,
    tribulation,
    view: buildView(next, world, now, ctx.inventory),
  };
}

function blockedError(reason: string | null, stageIndex: number): ApiError {
  switch (reason) {
    case 'not_at_perfection':
      return new ApiError(
        'NOT_AT_PERFECTION',
        `当前为 ${stageName(stageIndex)}，只有圆满境才能冲击大境界`,
      );
    case 'exp_not_full':
      return new ApiError('EXP_NOT_FULL', '修为尚未圆满，再闭关一阵吧');
    case 'max_stage':
      return new ApiError('MAX_STAGE', '已至此界极限，前路再无可破之境');
    case 'tribulation_required':
      return new ApiError('TRIBULATION_REQUIRED', '需先渡过天劫');
    default:
      return new ApiError('NOT_AT_PERFECTION', '当前无法突破');
  }
}

/** Sets the four 神通 slots. */
export function equipSkills(
  ctx: AppContext,
  state: CharacterState,
  slots: (string | null)[],
  world: WorldSettings,
  now: number,
): CharacterView {
  for (const skillId of slots) {
    if (skillId === null) continue;
    if (!SKILL_BY_ID.has(skillId)) {
      throw new ApiError('SKILL_NOT_LEARNED', `不存在的神通：${skillId}`);
    }
    if (!state.learnedSkillIds.includes(skillId)) {
      const name = SKILL_BY_ID.get(skillId)?.name ?? skillId;
      throw new ApiError('SKILL_NOT_LEARNED', `尚未习得「${name}」`);
    }
  }

  const next = withFreshPower(
    { ...state, skillSlots: [...slots] },
    resolveEquipment(state, ctx.inventory),
  );
  ctx.characters.save(next);
  ctx.realtime.characterUpdate(next, { skillSlots: next.skillSlots });
  return buildView(next, world, now, ctx.inventory);
}

/** Learns a 神通 from the sect, charging 灵石. */
export function learnSkill(
  ctx: AppContext,
  state: CharacterState,
  skillId: string,
  world: WorldSettings,
  now: number,
): CharacterView {
  const skill = SKILL_BY_ID.get(skillId);
  if (!skill) throw new ApiError('NOT_FOUND', '没有这门神通');

  if (state.learnedSkillIds.includes(skillId)) {
    return buildView(state, world, now, ctx.inventory);
  }
  if (state.stageIndex < skill.unlockStage) {
    throw new ApiError('STAGE_TOO_LOW', `境界不足，需 ${stageName(skill.unlockStage)}`);
  }
  if (state.spiritStones < skill.learnCost) {
    throw new ApiError('INSUFFICIENT_STONES', `灵石不足，需 ${skill.learnCost}`);
  }

  const next = withFreshPower(
    {
      ...state,
      spiritStones: state.spiritStones - skill.learnCost,
      learnedSkillIds: [...state.learnedSkillIds, skillId],
    },
    resolveEquipment(state, ctx.inventory),
  );
  ctx.characters.save(next);
  ctx.realtime.characterUpdate(next, { learnedSkillIds: next.learnedSkillIds });
  return buildView(next, world, now, ctx.inventory);
}

/** Switches the 功法 being studied. */
export function setTechnique(
  ctx: AppContext,
  state: CharacterState,
  techniqueId: string,
  world: WorldSettings,
  now: number,
): CharacterView {
  if (!state.learnedTechniqueIds.includes(techniqueId)) {
    const name = TECHNIQUE_BY_ID.get(techniqueId)?.name ?? techniqueId;
    throw new ApiError('TECHNIQUE_NOT_LEARNED', `尚未习得《${name}》`);
  }
  const next = withFreshPower({ ...state, techniqueId }, resolveEquipment(state, ctx.inventory));
  ctx.characters.save(next);
  ctx.realtime.characterUpdate(next, { techniqueId });
  return buildView(next, world, now, ctx.inventory);
}

/** Learns a 功法 from the sect, charging 灵石. */
export function learnTechnique(
  ctx: AppContext,
  state: CharacterState,
  techniqueId: string,
  world: WorldSettings,
  now: number,
): CharacterView {
  const technique = TECHNIQUE_BY_ID.get(techniqueId);
  if (!technique) throw new ApiError('NOT_FOUND', '没有这部功法');

  if (state.learnedTechniqueIds.includes(techniqueId)) {
    return buildView(state, world, now, ctx.inventory);
  }
  if (state.stageIndex < technique.requiredStage) {
    throw new ApiError('STAGE_TOO_LOW', `境界不足，需 ${stageName(technique.requiredStage)}`);
  }
  if (state.spiritStones < technique.learnCost) {
    throw new ApiError('INSUFFICIENT_STONES', `灵石不足，需 ${technique.learnCost}`);
  }

  const next = withFreshPower(
    {
      ...state,
      spiritStones: state.spiritStones - technique.learnCost,
      learnedTechniqueIds: [...state.learnedTechniqueIds, techniqueId],
    },
    resolveEquipment(state, ctx.inventory),
  );
  ctx.characters.save(next);
  ctx.realtime.characterUpdate(next, { learnedTechniqueIds: next.learnedTechniqueIds });
  return buildView(next, world, now, ctx.inventory);
}

/** Re-exported so the routes file does not import from three places. */
export { atPerfection, getStage, MONSTER_BY_ID, settleAndSave };
