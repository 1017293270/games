import {
  ITEM_BY_ID,
  MONSTER_BY_ID,
  NPC_BY_ID,
  QUESTS,
  QUEST_BY_ID,
  stageName,
  STORY_CHAPTERS,
  type CharacterState,
  type Quest,
  type QuestCompleteResponse,
  type QuestListResponse,
  type QuestObjective,
  type QuestProgress,
  type QuestView,
  type RewardBundle,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildView, resolveEquipment, withFreshPower } from '../../game/character.js';
import { applyReward, checkAll, firstBlockReason, nameReward, scaleReward } from '../../game/rewards.js';

/**
 * 任务.
 *
 * Progress is *derived* wherever it can be: a 收集 objective reads the bag, a
 * 境界 objective reads `stageIndex`, a 副本 objective reads `dungeon_runs` and a
 * 论道 objective reads `battle_records`. Only the two kinds nothing else records
 * — 击杀 and 对话 — keep a stored tally, bumped by `recordMonsterKill` from the
 * explore module and `recordNpcTalk` from the NPC module.
 *
 * That means `syncQuests` can rebuild the whole `CharacterState.quests` array
 * from scratch on every read, so a quest never drifts out of sync with the
 * world, and the shared `quest_state` condition — which dialogue trees lean on
 * heavily — always sees the truth.
 */

/** How many units an objective asks for. Non-counting kinds are 1. */
export function objectiveTarget(objective: QuestObjective): number {
  switch (objective.type) {
    case 'kill_monster':
    case 'collect_item':
    case 'defeat_bot':
      return objective.count;
    case 'reach_stage':
    case 'clear_dungeon':
    case 'talk_npc':
      return 1;
  }
}

/** True once `dungeon_runs` exists; the dungeon module owns that migration. */
function hasTable(ctx: AppContext, table: string): boolean {
  const row = ctx.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

/** 论道台 wins over bots since `since`, optionally against one archetype id. */
function countBotWins(
  ctx: AppContext,
  characterId: string,
  botId: string | null,
  since: number,
): number {
  const opponentClause = botId === null ? '' : ' AND opponent.id = ?';
  const sql =
    'SELECT COUNT(*) AS c FROM battle_records b' +
    ' JOIN characters opponent ON opponent.id =' +
    '   CASE WHEN b.attacker_id = ?1 THEN b.defender_id ELSE b.attacker_id END' +
    " WHERE b.kind = 'arena' AND b.winner_id = ?1 AND b.fought_at >= ?2" +
    ' AND (b.attacker_id = ?1 OR b.defender_id = ?1)' +
    ' AND opponent.is_bot = 1' +
    opponentClause;
  const row = (
    botId === null
      ? ctx.db.prepare(sql).get(characterId, since)
      : ctx.db.prepare(sql).get(characterId, since, botId)
  ) as { c: number };
  return Number(row.c);
}

/** Cleared runs of one 秘境 the character took part in since `since`. */
function countDungeonClears(
  ctx: AppContext,
  characterId: string,
  dungeonId: string,
  since: number,
): number {
  if (!hasTable(ctx, 'dungeon_runs')) return 0;
  const row = ctx.db
    .prepare(
      'SELECT COUNT(*) AS c FROM dungeon_runs' +
        ' WHERE dungeon_id = ? AND cleared = 1 AND fought_at >= ?' +
        " AND (leader_id = ? OR instr(participant_ids_json, '\"' || ? || '\"') > 0)",
    )
    .get(dungeonId, since, characterId, characterId) as { c: number };
  return Number(row.c);
}

/**
 * Current progress on one objective.
 *
 * `stored` is the tally already on the progress row — the only input for the
 * two kinds nothing else in the server writes down.
 */
function objectiveCount(
  ctx: AppContext,
  state: CharacterState,
  objective: QuestObjective,
  stored: number,
  acceptedAt: number,
): number {
  switch (objective.type) {
    case 'kill_monster':
      return Math.min(stored, objective.count);
    case 'talk_npc':
      return Math.min(stored, 1);
    case 'collect_item':
      return Math.min(ctx.inventory.quantityOf(state.id, objective.itemId), objective.count);
    case 'reach_stage':
      return state.stageIndex >= objective.stageIndex ? 1 : 0;
    case 'defeat_bot':
      return Math.min(
        countBotWins(ctx, state.id, objective.botId, acceptedAt),
        objective.count,
      );
    case 'clear_dungeon':
      return Math.min(countDungeonClears(ctx, state.id, objective.dungeonId, acceptedAt), 1);
  }
}

/** Whether the quest may be offered at all: prerequisite claimed, gates passed. */
function isOfferable(ctx: AppContext, state: CharacterState, quest: Quest): boolean {
  if (quest.prerequisiteQuestId) {
    const prior = state.quests.find((q) => q.questId === quest.prerequisiteQuestId);
    if (!prior || prior.claimedAt === null) return false;
  }
  return checkAll(quest.requirements, { state, inventory: ctx.inventory });
}

/** zh-CN reason a quest is not offerable yet, or null when it is. */
function offerBlockReason(ctx: AppContext, state: CharacterState, quest: Quest): string | null {
  if (quest.prerequisiteQuestId) {
    const prior = state.quests.find((q) => q.questId === quest.prerequisiteQuestId);
    if (!prior || prior.claimedAt === null) {
      const name = QUEST_BY_ID.get(quest.prerequisiteQuestId)?.name ?? quest.prerequisiteQuestId;
      return `需先完成「${name}」`;
    }
  }
  return firstBlockReason(quest.requirements, { state, inventory: ctx.inventory });
}

/**
 * Rebuilds `state.quests` so every quest in the content table has a row whose
 * state and counters match the world right now.
 *
 * Materialising the locked/available rows rather than leaving them absent is
 * what lets the shared `quest_state` condition tell "not yet offered" apart
 * from "ready to take", which is the difference between a dialogue branch
 * showing and not showing.
 */
export function syncQuests(ctx: AppContext, state: CharacterState): CharacterState {
  const previous = new Map(state.quests.map((q) => [q.questId, q]));
  const rows: QuestProgress[] = [];

  // Two passes: prerequisites are resolved against the rows built so far, and
  // the content table is authored parent-before-child, so one ordered pass over
  // a growing `state` view is enough.
  let cursor: CharacterState = { ...state, quests: [] };

  for (const quest of QUESTS) {
    const prior = previous.get(quest.id);
    const acceptedAt = prior?.acceptedAt ?? null;
    const claimedAt = prior?.claimedAt ?? null;

    // A claimed, non-repeatable quest is finished for good.
    if (claimedAt !== null && !quest.repeatable) {
      const row: QuestProgress = {
        questId: quest.id,
        state: 'claimed',
        counters: quest.objectives.map((o) => objectiveTarget(o)),
        acceptedAt,
        claimedAt,
      };
      rows.push(row);
      cursor = { ...cursor, quests: rows };
      continue;
    }

    // Accepted and running: recompute every counter.
    if (acceptedAt !== null && claimedAt === null) {
      const counters = quest.objectives.map((objective, i) =>
        objectiveCount(ctx, cursor, objective, prior?.counters[i] ?? 0, acceptedAt),
      );
      const complete = counters.every((c, i) => c >= objectiveTarget(quest.objectives[i]!));
      rows.push({
        questId: quest.id,
        state: complete ? 'completed' : 'active',
        counters,
        acceptedAt,
        claimedAt: null,
      });
      cursor = { ...cursor, quests: rows };
      continue;
    }

    // Never taken, or repeatable and already claimed once: offerable or locked.
    const offerable = isOfferable(ctx, cursor, quest);
    rows.push({
      questId: quest.id,
      state: offerable ? 'available' : 'locked',
      counters: quest.objectives.map(() => 0),
      acceptedAt: null,
      claimedAt,
    });
    cursor = { ...cursor, quests: rows };
  }

  return { ...state, quests: rows };
}

/** Loads the caller's cultivator with its quest rows freshened and persisted. */
export function syncAndSave(ctx: AppContext, state: CharacterState): CharacterState {
  const next = syncQuests(ctx, state);
  ctx.characters.save(next);
  return next;
}

// ------------------------------------------------------------------- hooks

/**
 * 击杀计数. Called from the explore module the moment a fight is won, on the
 * state it is about to save — so the tally lands in the same write as the loot
 * rather than needing a second one.
 */
export function recordMonsterKill(state: CharacterState, monsterId: string): CharacterState {
  return bumpObjectives(state, (objective) =>
    objective.type === 'kill_monster' && objective.monsterId === monsterId ? 1 : 0,
  );
}

/** 对话计数, bumped when the NPC module opens or walks a conversation. */
export function recordNpcTalk(state: CharacterState, npcId: string): CharacterState {
  return bumpObjectives(state, (objective) =>
    objective.type === 'talk_npc' && objective.npcId === npcId ? 1 : 0,
  );
}

/** Adds `by(objective)` to every matching counter of every 进行中 quest. */
function bumpObjectives(
  state: CharacterState,
  by: (objective: QuestObjective) => number,
): CharacterState {
  let touched = false;
  const quests = state.quests.map((progress) => {
    if (progress.state !== 'active' && progress.state !== 'completed') return progress;
    const quest = QUEST_BY_ID.get(progress.questId);
    if (!quest) return progress;

    let changed = false;
    const counters = quest.objectives.map((objective, i) => {
      const current = progress.counters[i] ?? 0;
      const delta = by(objective);
      if (delta === 0) return current;
      const next = Math.min(current + delta, objectiveTarget(objective));
      if (next !== current) changed = true;
      return next;
    });
    if (!changed) return progress;
    touched = true;
    return { ...progress, counters };
  });

  return touched ? { ...state, quests } : state;
}

// -------------------------------------------------------------------- views

/** `3 / 5` style progress text, one line per objective. */
export function objectiveText(objective: QuestObjective, current: number): string {
  switch (objective.type) {
    case 'kill_monster': {
      const name = MONSTER_BY_ID.get(objective.monsterId)?.name ?? objective.monsterId;
      return `讨伐${name} ${current} / ${objective.count}`;
    }
    case 'collect_item': {
      const name = ITEM_BY_ID.get(objective.itemId)?.name ?? objective.itemId;
      return `收集${name} ${current} / ${objective.count}`;
    }
    case 'reach_stage':
      return `修至${stageName(objective.stageIndex)}${current >= 1 ? '（已达成）' : '（未达成）'}`;
    case 'defeat_bot':
      return objective.botId === null
        ? `论道台胜 ${current} / ${objective.count} 场`
        : `击败指定对手 ${current} / ${objective.count}`;
    case 'clear_dungeon':
      return current >= 1 ? '通关秘境（已完成）' : '通关秘境（未完成）';
    case 'talk_npc': {
      const name = NPC_BY_ID.get(objective.npcId)?.name ?? objective.npcId;
      return current >= 1 ? `与${name}交谈（已完成）` : `与${name}交谈（未完成）`;
    }
  }
}

function toView(quest: Quest, progress: QuestProgress): QuestView {
  return {
    quest,
    progress,
    objectiveText: quest.objectives.map((objective, i) =>
      objectiveText(objective, progress.counters[i] ?? 0),
    ),
    claimable: progress.state === 'completed',
  };
}

/** 任务列表, grouped the way the client's three tabs read it. */
export function listQuests(state: CharacterState): QuestListResponse {
  const active: QuestView[] = [];
  const available: QuestView[] = [];
  const claimed: QuestView[] = [];

  for (const progress of state.quests) {
    const quest = QUEST_BY_ID.get(progress.questId);
    if (!quest) continue;
    const view = toView(quest, progress);
    if (progress.state === 'active' || progress.state === 'completed') active.push(view);
    else if (progress.state === 'available') available.push(view);
    else if (progress.state === 'claimed') claimed.push(view);
  }

  // 可领奖的排在最前，主线优先于支线与日常。
  const rank = (v: QuestView): number =>
    (v.claimable ? 0 : 10) + (v.quest.kind === 'main' ? 0 : v.quest.kind === 'side' ? 1 : 2);
  active.sort((a, b) => rank(a) - rank(b) || a.quest.chapter - b.quest.chapter);
  available.sort((a, b) => rank(a) - rank(b) || a.quest.chapter - b.quest.chapter);

  return {
    active,
    available,
    claimed,
    chapters: STORY_CHAPTERS.filter((c) => c.unlockStage <= state.stageIndex || c.chapter <= state.chapter),
    currentChapter: state.chapter,
  };
}

// ------------------------------------------------------------------ actions

/** Accepts a quest, after re-checking every gate server-side. */
export function acceptQuest(
  ctx: AppContext,
  state: CharacterState,
  questId: string,
  now: number,
): { state: CharacterState; list: QuestListResponse } {
  const quest = QUEST_BY_ID.get(questId);
  if (!quest) throw new ApiError('NOT_FOUND', '没有这个任务');

  const synced = syncQuests(ctx, state);
  const progress = synced.quests.find((q) => q.questId === questId);

  if (progress?.state === 'active' || progress?.state === 'completed') {
    throw new ApiError('QUEST_NOT_AVAILABLE', `「${quest.name}」已经在身，先去做完`);
  }
  if (progress?.state === 'claimed') {
    throw new ApiError('QUEST_ALREADY_CLAIMED', `「${quest.name}」已经交付过了`);
  }
  if (progress?.state !== 'available') {
    const reason = offerBlockReason(ctx, synced, quest);
    throw new ApiError('CONDITION_UNMET', reason ?? `现在还接不了「${quest.name}」`);
  }

  const accepted: CharacterState = {
    ...synced,
    quests: synced.quests.map((q) =>
      q.questId === questId
        ? { ...q, state: 'active' as const, counters: quest.objectives.map(() => 0), acceptedAt: now, claimedAt: null }
        : q,
    ),
  };

  // Re-sync: a 收集 quest whose items are already in the bag is complete the
  // instant it is taken, and the player should see that rather than a 0/10.
  const next = syncQuests(ctx, accepted);
  ctx.characters.save(next);
  ctx.realtime.characterUpdate(next);
  return { state: next, list: listQuests(next) };
}

/** What claiming a quest hands over, before the world multipliers. */
function questReward(quest: Quest, world: WorldSettings): RewardBundle {
  const scaled = scaleReward(quest.reward.exp, quest.reward.spiritStones, world);
  return nameReward({ ...scaled, items: quest.reward.items.map((i) => ({ ...i })) });
}

/**
 * Claims a finished quest: consumes the 收集 items, pays out, and advances the
 * chapter when the quest is the one that closes it.
 *
 * Returns the reward so the dialogue path can fold it into its own bundle.
 */
export function claimQuest(
  ctx: AppContext,
  state: CharacterState,
  questId: string,
  world: WorldSettings,
  now: number,
): { state: CharacterState; reward: RewardBundle; advancedToChapter: number | null } {
  const quest = QUEST_BY_ID.get(questId);
  if (!quest) throw new ApiError('NOT_FOUND', '没有这个任务');

  const synced = syncQuests(ctx, state);
  const progress = synced.quests.find((q) => q.questId === questId);

  if (!progress || progress.state === 'locked' || progress.state === 'available') {
    throw new ApiError('QUEST_NOT_ACTIVE', `「${quest.name}」尚未接取`);
  }
  if (progress.state === 'claimed') {
    throw new ApiError('QUEST_ALREADY_CLAIMED', `「${quest.name}」已经交付过了`);
  }
  if (progress.state !== 'completed') {
    const unfinished = quest.objectives
      .map((objective, i) => ({ objective, current: progress.counters[i] ?? 0 }))
      .filter(({ objective, current }) => current < objectiveTarget(objective))
      .map(({ objective, current }) => objectiveText(objective, current));
    throw new ApiError('QUEST_NOT_COMPLETE', `「${quest.name}」还没做完：${unfinished.join('；')}`);
  }

  // 收集类目标交差时扣除材料。
  for (const objective of quest.objectives) {
    if (objective.type !== 'collect_item') continue;
    if (!ctx.inventory.removeByItemId(synced.id, objective.itemId, objective.count)) {
      const name = ITEM_BY_ID.get(objective.itemId)?.name ?? objective.itemId;
      throw new ApiError('QUEST_NOT_COMPLETE', `${name}不足 ${objective.count} 个`);
    }
  }

  const reward = questReward(quest, world);
  let next = applyReward(synced, reward, ctx.inventory);

  const advancedToChapter =
    quest.advancesChapterTo !== null && quest.advancesChapterTo > next.chapter
      ? quest.advancesChapterTo
      : null;
  if (advancedToChapter !== null) next = { ...next, chapter: advancedToChapter };

  next = {
    ...next,
    quests: next.quests.map((q) =>
      q.questId === questId
        ? { ...q, state: 'claimed' as const, claimedAt: now, acceptedAt: q.acceptedAt }
        : q,
    ),
  };

  // A repeatable quest drops straight back to available (or locked) here.
  next = syncQuests(ctx, next);
  const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);

  return { state: saved, reward, advancedToChapter };
}

/** The `quests.complete` endpoint payload. */
export function completeQuest(
  ctx: AppContext,
  state: CharacterState,
  questId: string,
  world: WorldSettings,
  now: number,
): QuestCompleteResponse {
  const result = claimQuest(ctx, state, questId, world, now);
  return {
    questId,
    reward: result.reward,
    advancedToChapter: result.advancedToChapter,
    view: buildView(result.state, world, now, ctx.inventory),
  };
}
