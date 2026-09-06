import type { z } from 'zod';
import type { NpcListResponseSchema } from '@xianxia/shared';
import {
  DIALOGUE_BY_ID,
  NPCS,
  NPC_BY_ID,
  QUEST_BY_ID,
  stageName,
  type CharacterState,
  type DialogueNode,
  type DialogueTree,
  type DialogueView,
  type Effect,
  type ResolvedChoice,
  type RewardBundle,
  type WorldSettings,
} from '@xianxia/shared';

import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildView, resolveEquipment, withFreshPower } from '../../game/character.js';
import {
  applyEffects,
  emptyReward,
  firstBlockReason,
  nameReward,
} from '../../game/rewards.js';
import { claimQuest, recordNpcTalk, syncQuests } from '../quest/service.js';

/** `protocol/npc.ts` exports the schema but not the type; infer it here. */
type NpcListResponse = z.infer<typeof NpcListResponseSchema>;

/**
 * 青云镇 NPC 对话.
 *
 * The tree is data (`content/dialogues.ts`); this module walks it. Every
 * condition is evaluated here and every effect applied here, so the client only
 * ever renders `available` / `blockedReason` and can never talk its way into a
 * branch it has not earned.
 *
 * `game/rewards.applyEffects` handles the world-facing effects. The two quest
 * effects it deliberately leaves alone — `accept_quest` and `complete_quest` —
 * are applied afterwards in the order they appear, because quest bookkeeping
 * lives in the quest module and reaches for the database.
 */

/** Merges `b` into `a`, keeping `itemNames` consistent. */
function mergeRewards(a: RewardBundle, b: RewardBundle): RewardBundle {
  return nameReward({
    exp: a.exp + b.exp,
    spiritStones: a.spiritStones + b.spiritStones,
    items: [...a.items, ...b.items],
  });
}

function isEmptyReward(reward: RewardBundle): boolean {
  return reward.exp === 0 && reward.spiritStones === 0 && reward.items.length === 0;
}

/** The NPC and its dialogue tree, or the right failure. */
function requireNpc(state: CharacterState, npcId: string): { npc: (typeof NPCS)[number]; tree: DialogueTree } {
  const npc = NPC_BY_ID.get(npcId);
  if (!npc) throw new ApiError('NOT_FOUND', '青云镇没有这个人');
  if (state.stageIndex < npc.unlockStage) {
    throw new ApiError('NPC_LOCKED', `${npc.name}此刻不愿见你，需 ${stageName(npc.unlockStage)}`);
  }
  const tree = DIALOGUE_BY_ID.get(npc.dialogueId);
  if (!tree) throw new ApiError('DIALOGUE_NOT_FOUND', `${npc.name}此刻无话可说`);
  return { npc, tree };
}

/** True when this NPC has something to hand out or take back right now. */
function hasBusiness(state: CharacterState, npcId: string): boolean {
  return state.quests.some((progress) => {
    const quest = QUEST_BY_ID.get(progress.questId);
    if (!quest) return false;
    if (progress.state === 'available') return quest.giverNpcId === npcId;
    if (progress.state === 'completed') return quest.turnInNpcId === npcId;
    return false;
  });
}

/** 青云镇 roster, with the 任务 marker the client draws on the portrait. */
export function listNpcs(state: CharacterState): NpcListResponse {
  return {
    npcs: NPCS.map((npc) => ({
      ...npc,
      unlocked: state.stageIndex >= npc.unlockStage,
      hasQuest: state.stageIndex >= npc.unlockStage && hasBusiness(state, npc.id),
    })),
  };
}

/** Evaluates one node's choices against the character. */
function resolveChoices(
  ctx: AppContext,
  state: CharacterState,
  node: DialogueNode,
): ResolvedChoice[] {
  const out: ResolvedChoice[] = [];
  for (const choice of node.choices) {
    const blocked = firstBlockReason(choice.conditions, { state, inventory: ctx.inventory });
    // `hideWhenBlocked` is how a root node can hold a dozen quest branches and
    // still show two: the server drops them rather than greying them out.
    if (blocked !== null && choice.hideWhenBlocked) continue;
    out.push({
      id: choice.id,
      text: choice.text,
      available: blocked === null,
      blockedReason: blocked,
    });
  }
  return out;
}

interface EffectRun {
  state: CharacterState;
  reward: RewardBundle;
  openShopId: string | null;
}

/**
 * Applies a list of effects, including the two quest effects the shared
 * evaluator leaves for this module.
 *
 * Quest effects run after the rest of the list rather than interleaved; no
 * authored branch depends on the difference, and keeping them apart means the
 * database work happens once, at a known point.
 */
function runEffects(
  ctx: AppContext,
  state: CharacterState,
  effects: readonly Effect[],
  world: WorldSettings,
  now: number,
): EffectRun {
  const outcome = applyEffects(effects, { state, inventory: ctx.inventory }, world);
  let next = outcome.state;
  let reward = outcome.reward;

  for (const effect of effects) {
    if (effect.type === 'accept_quest') {
      next = acceptFromDialogue(ctx, next, effect.questId, now);
    } else if (effect.type === 'complete_quest') {
      const claimed = claimQuest(ctx, next, effect.questId, world, now);
      next = claimed.state;
      reward = mergeRewards(reward, claimed.reward);
    }
    // `start_battle` is authored nowhere yet; when it is, it belongs in the
    // explore module's combat path rather than inside a dialogue round trip.
  }

  return { state: next, reward, openShopId: outcome.openShopId };
}

/**
 * Takes a quest from inside a conversation.
 *
 * The branch was already gated on `quest_state: available`, so a failure here
 * would mean the tree and the quest table disagree; the quest is skipped rather
 * than breaking the conversation.
 */
function acceptFromDialogue(
  ctx: AppContext,
  state: CharacterState,
  questId: string,
  now: number,
): CharacterState {
  const synced = syncQuests(ctx, state);
  const progress = synced.quests.find((q) => q.questId === questId);
  if (progress?.state !== 'available') return synced;
  const quest = QUEST_BY_ID.get(questId);
  if (!quest) return synced;

  const accepted: CharacterState = {
    ...synced,
    quests: synced.quests.map((q) =>
      q.questId === questId
        ? {
            ...q,
            state: 'active' as const,
            counters: quest.objectives.map(() => 0),
            acceptedAt: now,
            claimedAt: null,
          }
        : q,
    ),
  };
  return syncQuests(ctx, accepted);
}

/** Persists whatever a conversation turn changed and pushes it to the client. */
function persist(ctx: AppContext, state: CharacterState): CharacterState {
  const saved = withFreshPower(state, resolveEquipment(state, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);
  return saved;
}

function toView(
  ctx: AppContext,
  state: CharacterState,
  npcId: string,
  tree: DialogueTree,
  node: DialogueNode,
  reward: RewardBundle,
  openShopId: string | null,
  world: WorldSettings,
  now: number,
  /** True when the branch just taken was authored to close the conversation. */
  closed = false,
): DialogueView {
  const npc = NPC_BY_ID.get(npcId)!;
  const choices = resolveChoices(ctx, state, node);
  return {
    npcId: npc.id,
    npcName: npc.name,
    npcArt: node.art ?? npc.art,
    dialogueId: tree.id,
    node,
    choices,
    openShopId,
    reward: isEmptyReward(reward) ? null : reward,
    // Two ways a conversation is over: the player took a branch whose `next` is
    // null — 弟子告退 and the like — or the node they are on has no takeable
    // branch left. The first is the common one, and it cannot be read off the
    // node alone, because a closing branch answers with the node it was taken
    // from, choices and all.
    ended: closed || !choices.some((choice) => choice.available),
    view: buildView(state, world, now, ctx.inventory),
  };
}

/** Opens a conversation at the tree's root. */
export function startDialogue(
  ctx: AppContext,
  state: CharacterState,
  npcId: string,
  world: WorldSettings,
  now: number,
): DialogueView {
  const { tree } = requireNpc(state, npcId);
  const node = tree.nodes.find((n) => n.id === tree.rootNodeId);
  if (!node) throw new ApiError('DIALOGUE_NOT_FOUND', '这段对话缺了开头');

  // 与 NPC 对话 objectives are satisfied by walking up and saying hello.
  let next = syncQuests(ctx, recordNpcTalk(syncQuests(ctx, state), npcId));
  const run = runEffects(ctx, next, node.onEnter, world, now);
  next = syncQuests(ctx, run.state);

  const saved = persist(ctx, next);
  return toView(ctx, saved, npcId, tree, node, run.reward, run.openShopId, world, now);
}

/** Walks one branch of a conversation. */
export function talk(
  ctx: AppContext,
  state: CharacterState,
  input: { npcId: string; nodeId: string; choiceId?: string },
  world: WorldSettings,
  now: number,
): DialogueView {
  const { tree } = requireNpc(state, input.npcId);
  const current = tree.nodes.find((n) => n.id === input.nodeId);
  if (!current) throw new ApiError('DIALOGUE_NOT_FOUND', '这段对话没有这一节');

  let next = syncQuests(ctx, recordNpcTalk(syncQuests(ctx, state), input.npcId));

  // No choice: re-enter the node to refresh which branches are open, without
  // re-running its `onEnter` effects.
  if (input.choiceId === undefined) {
    const saved = persist(ctx, next);
    return toView(ctx, saved, input.npcId, tree, current, emptyReward(), null, world, now);
  }

  const choice = current.choices.find((c) => c.id === input.choiceId);
  if (!choice) throw new ApiError('INVALID_CHOICE', '没有这个选择');

  const blocked = firstBlockReason(choice.conditions, { state: next, inventory: ctx.inventory });
  if (blocked !== null) throw new ApiError('CHOICE_BLOCKED', blocked);

  const run = runEffects(ctx, next, choice.effects, world, now);
  next = syncQuests(ctx, run.state);

  let reward = run.reward;
  let openShopId = run.openShopId;

  // `next: null` closes the conversation. The node the client is showing
  // carries that, so it knows to close; the server answers with the same node
  // so the payload stays a well-formed `DialogueView`.
  let node = current;
  if (choice.next !== null) {
    const target = tree.nodes.find((n) => n.id === choice.next);
    if (!target) throw new ApiError('DIALOGUE_NOT_FOUND', '这段对话断了');
    const entered = runEffects(ctx, next, target.onEnter, world, now);
    next = syncQuests(ctx, entered.state);
    reward = mergeRewards(reward, entered.reward);
    openShopId = entered.openShopId ?? openShopId;
    node = target;
  }

  const saved = persist(ctx, next);
  return toView(
    ctx,
    saved,
    input.npcId,
    tree,
    node,
    reward,
    openShopId,
    world,
    now,
    choice.next === null,
  );
}
