import {
  clamp,
  dayKey,
  getStage,
  ITEM_BY_ID,
  QUEST_BY_ID,
  SHOP_BY_ID,
  type CharacterState,
  type Condition,
  type Effect,
  type LootEntry,
  type Reward,
  type RewardBundle,
  type Rng,
  type WorldSettings,
} from '@xianxia/shared';
import type { InventoryRepo } from '../db/repo/inventory.js';

/**
 * Loot rolls, reward application and the shared condition/effect evaluator.
 *
 * Encounters, dialogues and quests all speak the same `Condition`/`Effect`
 * vocabulary, so evaluating it lives here rather than inside any one module.
 */

/** Rolls a drop table. `dropRateMultiplier` scales each chance, capped at 1. */
export function rollLoot(
  loot: readonly LootEntry[],
  rng: Rng,
  world: Pick<WorldSettings, 'dropRateMultiplier'>,
): { itemId: string; qty: number }[] {
  const out: { itemId: string; qty: number }[] = [];
  for (const entry of loot) {
    const chance = clamp(entry.chance * world.dropRateMultiplier, 0, 1);
    if (!rng.chance(chance)) continue;
    const qty = rng.int(entry.min, entry.max);
    if (qty > 0) out.push({ itemId: entry.itemId, qty });
  }
  return out;
}

/** An empty bundle, so callers can build one up field by field. */
export function emptyReward(): RewardBundle {
  return { exp: 0, spiritStones: 0, items: [], itemNames: [] };
}

/** Fills `itemNames` from the content table so the client can toast the drop. */
export function nameReward(reward: Omit<RewardBundle, 'itemNames'>): RewardBundle {
  return {
    ...reward,
    itemNames: reward.items.map((i) => ITEM_BY_ID.get(i.itemId)?.name ?? i.itemId),
  };
}

/**
 * Adds 修为 to a character, rolling 小境界 advances but never crossing a 圆满
 * wall — a breakthrough is always an explicit act.
 */
export function grantExp(state: CharacterState, amount: number): CharacterState {
  if (amount <= 0) return state;
  let stageIndex = state.stageIndex;
  let exp = state.exp + amount;

  for (;;) {
    const stage = getStage(stageIndex);
    if (exp < stage.expRequired) break;
    if (stage.isPerfection) {
      exp = stage.expRequired;
      break;
    }
    exp -= stage.expRequired;
    stageIndex += 1;
  }

  return { ...state, stageIndex, exp };
}

/** Applies a whole reward bundle: 修为, 灵石 and items. */
export function applyReward(
  state: CharacterState,
  reward: Pick<Reward, 'exp' | 'spiritStones' | 'items'>,
  inventory: InventoryRepo,
): CharacterState {
  let next = grantExp(state, reward.exp);
  if (reward.spiritStones !== 0) {
    next = { ...next, spiritStones: Math.max(0, next.spiritStones + reward.spiritStones) };
  }
  for (const item of reward.items) inventory.add(next.id, item.itemId, item.qty);
  return next;
}

/** Scales a raw content reward by the world multipliers. */
export function scaleReward(
  exp: number,
  stones: number,
  world: Pick<WorldSettings, 'expRewardMultiplier' | 'stoneRewardMultiplier'>,
): { exp: number; spiritStones: number } {
  return {
    exp: Math.round(exp * world.expRewardMultiplier),
    spiritStones: Math.round(stones * world.stoneRewardMultiplier),
  };
}

/** Resets the per-day quotas when the stored UTC day is no longer today. */
export function rollDailyCounters(state: CharacterState, nowMs: number): CharacterState {
  const today = dayKey(nowMs);
  if (state.dailyCounters.date === today) return state;
  return {
    ...state,
    dailyCounters: { date: today, dungeon: 0, arena: 0, gatherAt: state.dailyCounters.gatherAt },
  };
}

// --------------------------------------------------------------- conditions

/** Everything a condition may need to look at. */
export interface ScriptContext {
  state: CharacterState;
  inventory: InventoryRepo;
}

/** Evaluates one condition against a character. */
export function checkCondition(condition: Condition, ctx: ScriptContext): boolean {
  const { state } = ctx;
  switch (condition.type) {
    case 'stage_at_least':
      return state.stageIndex >= condition.stageIndex;
    case 'stage_below':
      return state.stageIndex < condition.stageIndex;
    case 'has_item':
      return ctx.inventory.quantityOf(state.id, condition.itemId) >= condition.qty;
    case 'spirit_stones_at_least':
      return state.spiritStones >= condition.amount;
    case 'quest_state': {
      const progress = state.quests.find((q) => q.questId === condition.questId);
      if (!progress) return condition.state === 'locked' || condition.state === 'available';
      return progress.state === condition.state;
    }
    case 'chapter_at_least':
      return state.chapter >= condition.chapter;
    case 'flag':
      return (state.flags[condition.flag] ?? false) === condition.value;
  }
}

/** zh-CN reason a blocked choice shows, or null when the condition passes. */
export function conditionReason(condition: Condition): string {
  switch (condition.type) {
    case 'stage_at_least':
      return `需要境界达到 ${getStage(condition.stageIndex).name}`;
    case 'stage_below':
      return `境界高于 ${getStage(condition.stageIndex).name} 后不可选`;
    case 'has_item':
      return `需要 ${ITEM_BY_ID.get(condition.itemId)?.name ?? condition.itemId} ×${condition.qty}`;
    case 'spirit_stones_at_least':
      return `需要灵石 ${condition.amount}`;
    case 'quest_state':
      return `任务「${QUEST_BY_ID.get(condition.questId)?.name ?? condition.questId}」状态不符`;
    case 'chapter_at_least':
      return `需要推进到第 ${condition.chapter} 章`;
    case 'flag':
      return '尚未满足前置条件';
  }
}

/** All conditions pass. */
export function checkAll(conditions: readonly Condition[], ctx: ScriptContext): boolean {
  return conditions.every((c) => checkCondition(c, ctx));
}

/** The first failing condition's reason, or null when everything passes. */
export function firstBlockReason(
  conditions: readonly Condition[],
  ctx: ScriptContext,
): string | null {
  for (const condition of conditions) {
    if (!checkCondition(condition, ctx)) return conditionReason(condition);
  }
  return null;
}

// ------------------------------------------------------------------ effects

export interface EffectOutcome {
  state: CharacterState;
  /** What the effects handed out, ready to show as a reward toast. */
  reward: RewardBundle;
  /** Shop the script asked to open, if any. */
  openShopId: string | null;
}

/**
 * Applies a list of effects. Item grants and losses hit the database as they
 * are applied; the returned state carries the in-memory changes the caller must
 * persist.
 */
export function applyEffects(
  effects: readonly Effect[],
  ctx: ScriptContext,
  world: Pick<WorldSettings, 'expRewardMultiplier' | 'stoneRewardMultiplier'>,
): EffectOutcome {
  let state = ctx.state;
  const reward = emptyReward();
  let openShopId: string | null = null;

  for (const effect of effects) {
    switch (effect.type) {
      case 'give_item': {
        ctx.inventory.add(state.id, effect.itemId, effect.qty);
        reward.items.push({ itemId: effect.itemId, qty: effect.qty });
        break;
      }
      case 'take_item': {
        ctx.inventory.removeByItemId(state.id, effect.itemId, effect.qty);
        break;
      }
      case 'give_exp': {
        const gained = Math.round(effect.exp * world.expRewardMultiplier);
        state = grantExp(state, gained);
        reward.exp += gained;
        break;
      }
      case 'give_spirit_stones': {
        const gained = Math.round(effect.amount * world.stoneRewardMultiplier);
        state = { ...state, spiritStones: Math.max(0, state.spiritStones + gained) };
        reward.spiritStones += gained;
        break;
      }
      case 'advance_chapter': {
        state = { ...state, chapter: Math.max(state.chapter, effect.chapter) };
        break;
      }
      case 'set_flag': {
        state = { ...state, flags: { ...state.flags, [effect.flag]: effect.value } };
        break;
      }
      case 'open_shop': {
        if (SHOP_BY_ID.has(effect.shopId)) openShopId = effect.shopId;
        break;
      }
      case 'learn_technique': {
        if (!state.learnedTechniqueIds.includes(effect.techniqueId)) {
          state = {
            ...state,
            learnedTechniqueIds: [...state.learnedTechniqueIds, effect.techniqueId],
          };
        }
        break;
      }
      case 'learn_skill': {
        if (!state.learnedSkillIds.includes(effect.skillId)) {
          state = { ...state, learnedSkillIds: [...state.learnedSkillIds, effect.skillId] };
        }
        break;
      }
      case 'heal_full': {
        state = { ...state, hpPercent: 1 };
        break;
      }
      // Quest bookkeeping and scripted battles arrive with the quest module.
      case 'accept_quest':
      case 'complete_quest':
      case 'start_battle':
        break;
    }
  }

  return { state, reward: nameReward(reward), openShopId };
}
