/**
 * Mock for the W3 content surface: 青云镇 NPC 对话 / 任务链 / 商店.
 *
 * Registered from `handlers.ts` through `registerContentHandlers`, so that file
 * keeps one table of `on(endpoint, handler)` rows. The quest engine here is a
 * faithful small copy of `apps/server/src/modules/quest/service.ts`: progress is
 * derived on every read — 收集 counts the bag, 境界 reads `stageIndex` — and only
 * 击杀 and 对话 keep a stored tally.
 *
 * Two objective kinds have no source of truth in the mock world: 论道 wins and
 * 秘境 clears are recorded by the multiplayer mock in its own private state, so
 * they read 0 here. Everything the 第一章 chain needs is fully playable.
 */

import {
  API,
  DIALOGUE_BY_ID,
  ITEM_BY_ID,
  MONSTER_BY_ID,
  NPCS,
  NPC_BY_ID,
  QUESTS,
  QUEST_BY_ID,
  SHOP_BY_ID,
  STORY_CHAPTERS,
  buyPriceAt,
  dayKey,
  getStage,
  sellPriceAt,
  shopAcceptsItem,
  stageName,
  type ApiErrorCode,
  type CharacterState,
  type Condition,
  type DialogueNode,
  type Effect,
  type Endpoint,
  type Quest,
  type QuestObjective,
  type QuestProgress,
  type Reward,
  type RewardBundle,
} from '@xianxia/shared';
import {
  addItem,
  buildView,
  countItem,
  grantExp,
  itemNames,
  takeItem,
  type MockUser,
  type MockWorld,
} from './world';

/** Structural copies of `handlers.ts`'s private types, to avoid a cycle. */
interface Ctx {
  w: MockWorld;
  user: MockUser | null;
  char: CharacterState | null;
  now: number;
}

type Handler = (
  ctx: Ctx,
  input: Record<string, unknown>,
  params: Record<string, string | number>,
) => unknown;

/** What `handlers.ts` lends this module. */
export interface ContentKit {
  on: <E extends Endpoint>(endpoint: E, handler: Handler) => void;
  Fail: new (code: ApiErrorCode, message: string) => Error;
  save: (ctx: Ctx, char: CharacterState) => CharacterState;
  /** The 山河图 battle handler, wrapped so a win bumps 击杀 counters. */
  exploreBattle: Handler | undefined;
}

// -------------------------------------------------------------- shop ledger

/** `charId|shopId|itemId|day` -> units bought. Keyed off the world so a reset drops it. */
const PURCHASES = new WeakMap<MockWorld, Map<string, number>>();

function purchases(w: MockWorld): Map<string, number> {
  let map = PURCHASES.get(w);
  if (!map) {
    map = new Map();
    PURCHASES.set(w, map);
  }
  return map;
}

function purchaseKey(charId: string, shopId: string, itemId: string, now: number): string {
  return `${charId}|${shopId}|${itemId}|${dayKey(now)}`;
}

// ---------------------------------------------------------------- 条件求值

function checkCondition(w: MockWorld, char: CharacterState, condition: Condition): boolean {
  switch (condition.type) {
    case 'stage_at_least':
      return char.stageIndex >= condition.stageIndex;
    case 'stage_below':
      return char.stageIndex < condition.stageIndex;
    case 'has_item':
      return countItem(w, char.id, condition.itemId) >= condition.qty;
    case 'spirit_stones_at_least':
      return char.spiritStones >= condition.amount;
    case 'quest_state': {
      const progress = char.quests.find((q) => q.questId === condition.questId);
      if (!progress) return condition.state === 'locked' || condition.state === 'available';
      return progress.state === condition.state;
    }
    case 'chapter_at_least':
      return char.chapter >= condition.chapter;
    case 'flag':
      return (char.flags[condition.flag] ?? false) === condition.value;
  }
}

function conditionReason(condition: Condition): string {
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

function firstBlock(
  w: MockWorld,
  char: CharacterState,
  conditions: readonly Condition[],
): string | null {
  for (const condition of conditions) {
    if (!checkCondition(w, char, condition)) return conditionReason(condition);
  }
  return null;
}

// ------------------------------------------------------------------ 任务引擎

function objectiveTarget(objective: QuestObjective): number {
  switch (objective.type) {
    case 'kill_monster':
    case 'collect_item':
    case 'defeat_bot':
      return objective.count;
    default:
      return 1;
  }
}

function objectiveCount(
  w: MockWorld,
  char: CharacterState,
  objective: QuestObjective,
  stored: number,
): number {
  switch (objective.type) {
    case 'kill_monster':
      return Math.min(stored, objective.count);
    case 'talk_npc':
      return Math.min(stored, 1);
    case 'collect_item':
      return Math.min(countItem(w, char.id, objective.itemId), objective.count);
    case 'reach_stage':
      return char.stageIndex >= objective.stageIndex ? 1 : 0;
    // 论道 / 秘境 records live in the multiplayer mock's own state.
    case 'defeat_bot':
    case 'clear_dungeon':
      return Math.min(stored, objectiveTarget(objective));
  }
}

function objectiveText(objective: QuestObjective, current: number): string {
  switch (objective.type) {
    case 'kill_monster':
      return `讨伐${MONSTER_BY_ID.get(objective.monsterId)?.name ?? objective.monsterId} ${current} / ${objective.count}`;
    case 'collect_item':
      return `收集${ITEM_BY_ID.get(objective.itemId)?.name ?? objective.itemId} ${current} / ${objective.count}`;
    case 'reach_stage':
      return `修至${stageName(objective.stageIndex)}${current >= 1 ? '（已达成）' : '（未达成）'}`;
    case 'defeat_bot':
      return objective.botId === null
        ? `论道台胜 ${current} / ${objective.count} 场`
        : `击败指定对手 ${current} / ${objective.count}`;
    case 'clear_dungeon':
      return current >= 1 ? '通关秘境（已完成）' : '通关秘境（未完成）';
    case 'talk_npc':
      return `与${NPC_BY_ID.get(objective.npcId)?.name ?? objective.npcId}交谈${current >= 1 ? '（已完成）' : '（未完成）'}`;
  }
}

function offerable(w: MockWorld, char: CharacterState, quest: Quest): boolean {
  if (quest.prerequisiteQuestId) {
    const prior = char.quests.find((q) => q.questId === quest.prerequisiteQuestId);
    if (!prior || prior.claimedAt === null) return false;
  }
  return quest.requirements.every((c) => checkCondition(w, char, c));
}

function offerBlock(w: MockWorld, char: CharacterState, quest: Quest): string | null {
  if (quest.prerequisiteQuestId) {
    const prior = char.quests.find((q) => q.questId === quest.prerequisiteQuestId);
    if (!prior || prior.claimedAt === null) {
      return `需先完成「${QUEST_BY_ID.get(quest.prerequisiteQuestId)?.name ?? ''}」`;
    }
  }
  return firstBlock(w, char, quest.requirements);
}

/** Rebuilds every quest row from the world, exactly as the server does. */
function syncQuests(w: MockWorld, char: CharacterState): CharacterState {
  const previous = new Map(char.quests.map((q) => [q.questId, q]));
  const rows: QuestProgress[] = [];
  let cursor: CharacterState = { ...char, quests: rows };

  for (const quest of QUESTS) {
    const prior = previous.get(quest.id);
    const acceptedAt = prior?.acceptedAt ?? null;
    const claimedAt = prior?.claimedAt ?? null;

    if (claimedAt !== null && !quest.repeatable) {
      rows.push({
        questId: quest.id,
        state: 'claimed',
        counters: quest.objectives.map(objectiveTarget),
        acceptedAt,
        claimedAt,
      });
      continue;
    }

    if (acceptedAt !== null && claimedAt === null) {
      const counters = quest.objectives.map((objective, i) =>
        objectiveCount(w, cursor, objective, prior?.counters[i] ?? 0),
      );
      const done = counters.every((c, i) => c >= objectiveTarget(quest.objectives[i]!));
      rows.push({
        questId: quest.id,
        state: done ? 'completed' : 'active',
        counters,
        acceptedAt,
        claimedAt: null,
      });
      continue;
    }

    rows.push({
      questId: quest.id,
      state: offerable(w, cursor, quest) ? 'available' : 'locked',
      counters: quest.objectives.map(() => 0),
      acceptedAt: null,
      claimedAt,
    });
    cursor = { ...cursor, quests: rows };
  }

  return { ...char, quests: rows };
}

/** Adds `by(objective)` to every matching counter of every running quest. */
function bump(
  char: CharacterState,
  by: (objective: QuestObjective) => number,
): CharacterState {
  return {
    ...char,
    quests: char.quests.map((progress) => {
      if (progress.state !== 'active' && progress.state !== 'completed') return progress;
      const quest = QUEST_BY_ID.get(progress.questId);
      if (!quest) return progress;
      return {
        ...progress,
        counters: quest.objectives.map((objective, i) =>
          Math.min((progress.counters[i] ?? 0) + by(objective), objectiveTarget(objective)),
        ),
      };
    }),
  };
}

function emptyBundle(): RewardBundle {
  return { exp: 0, spiritStones: 0, items: [], itemNames: [] };
}

function questReward(w: MockWorld, char: CharacterState, reward: Reward): RewardBundle {
  const exp = Math.round(reward.exp * w.settings.expRewardMultiplier);
  const stones = Math.round(reward.spiritStones * w.settings.stoneRewardMultiplier);
  void char;
  return {
    exp,
    spiritStones: stones,
    items: reward.items.map((i) => ({ ...i })),
    itemNames: itemNames(reward.items),
  };
}

export function registerContentHandlers(kit: ContentKit): void {
  const { on, Fail, save, exploreBattle } = kit;

  /** The caller's cultivator with its quest rows freshened and written back. */
  const load = (ctx: Ctx): CharacterState => {
    if (!ctx.char) throw new Fail('CHARACTER_NOT_FOUND', '尚未创建角色');
    const synced = syncQuests(ctx.w, ctx.char);
    ctx.w.characters.set(synced.id, synced);
    ctx.char = synced;
    return synced;
  };

  const store = (ctx: Ctx, char: CharacterState): CharacterState => {
    const synced = syncQuests(ctx.w, char);
    const saved = save(ctx, synced);
    ctx.char = saved;
    return saved;
  };

  /** Applies a list of effects, quest bookkeeping included. */
  const runEffects = (
    ctx: Ctx,
    start: CharacterState,
    effects: readonly Effect[],
  ): { char: CharacterState; reward: RewardBundle; openShopId: string | null } => {
    let char = start;
    const reward = emptyBundle();
    let openShopId: string | null = null;

    for (const effect of effects) {
      switch (effect.type) {
        case 'give_item':
          addItem(ctx.w, char.id, effect.itemId, effect.qty);
          reward.items.push({ itemId: effect.itemId, qty: effect.qty });
          break;
        case 'take_item':
          takeItem(ctx.w, char.id, effect.itemId, effect.qty);
          break;
        case 'give_exp': {
          const gained = Math.round(effect.exp * ctx.w.settings.expRewardMultiplier);
          char = grantExp(char, gained);
          reward.exp += gained;
          break;
        }
        case 'give_spirit_stones': {
          const gained = Math.round(effect.amount * ctx.w.settings.stoneRewardMultiplier);
          char = { ...char, spiritStones: Math.max(0, char.spiritStones + gained) };
          reward.spiritStones += gained;
          break;
        }
        case 'advance_chapter':
          char = { ...char, chapter: Math.max(char.chapter, effect.chapter) };
          break;
        case 'set_flag':
          char = { ...char, flags: { ...char.flags, [effect.flag]: effect.value } };
          break;
        case 'open_shop':
          if (SHOP_BY_ID.has(effect.shopId)) openShopId = effect.shopId;
          break;
        case 'heal_full':
          char = { ...char, hpPercent: 1 };
          break;
        case 'learn_technique':
          if (!char.learnedTechniqueIds.includes(effect.techniqueId)) {
            char = {
              ...char,
              learnedTechniqueIds: [...char.learnedTechniqueIds, effect.techniqueId],
            };
          }
          break;
        case 'learn_skill':
          if (!char.learnedSkillIds.includes(effect.skillId)) {
            char = { ...char, learnedSkillIds: [...char.learnedSkillIds, effect.skillId] };
          }
          break;
        case 'accept_quest':
          char = acceptQuest(ctx, char, effect.questId, false);
          break;
        case 'complete_quest': {
          const claimed = claim(ctx, char, effect.questId);
          char = claimed.char;
          reward.exp += claimed.reward.exp;
          reward.spiritStones += claimed.reward.spiritStones;
          reward.items.push(...claimed.reward.items);
          break;
        }
        case 'start_battle':
          break;
      }
    }

    reward.itemNames = itemNames(reward.items);
    return { char, reward, openShopId };
  };

  const acceptQuest = (
    ctx: Ctx,
    start: CharacterState,
    questId: string,
    strict: boolean,
  ): CharacterState => {
    const quest = QUEST_BY_ID.get(questId);
    if (!quest) {
      if (strict) throw new Fail('NOT_FOUND', '没有这个任务');
      return start;
    }
    const synced = syncQuests(ctx.w, start);
    const progress = synced.quests.find((q) => q.questId === questId);
    if (progress?.state !== 'available') {
      if (!strict) return synced;
      if (progress?.state === 'active' || progress?.state === 'completed') {
        throw new Fail('QUEST_NOT_AVAILABLE', `「${quest.name}」已经在身，先去做完`);
      }
      if (progress?.state === 'claimed') {
        throw new Fail('QUEST_ALREADY_CLAIMED', `「${quest.name}」已经交付过了`);
      }
      throw new Fail('CONDITION_UNMET', offerBlock(ctx.w, synced, quest) ?? '现在还接不了');
    }
    return syncQuests(ctx.w, {
      ...synced,
      quests: synced.quests.map((q) =>
        q.questId === questId
          ? {
              ...q,
              state: 'active' as const,
              counters: quest.objectives.map(() => 0),
              acceptedAt: ctx.now,
              claimedAt: null,
            }
          : q,
      ),
    });
  };

  const claim = (
    ctx: Ctx,
    start: CharacterState,
    questId: string,
  ): { char: CharacterState; reward: RewardBundle; advancedToChapter: number | null } => {
    const quest = QUEST_BY_ID.get(questId);
    if (!quest) throw new Fail('NOT_FOUND', '没有这个任务');

    const synced = syncQuests(ctx.w, start);
    const progress = synced.quests.find((q) => q.questId === questId);
    if (!progress || progress.state === 'locked' || progress.state === 'available') {
      throw new Fail('QUEST_NOT_ACTIVE', `「${quest.name}」尚未接取`);
    }
    if (progress.state === 'claimed') {
      throw new Fail('QUEST_ALREADY_CLAIMED', `「${quest.name}」已经交付过了`);
    }
    if (progress.state !== 'completed') {
      const left = quest.objectives
        .map((objective, i) => objectiveText(objective, progress.counters[i] ?? 0))
        .join('；');
      throw new Fail('QUEST_NOT_COMPLETE', `「${quest.name}」还没做完：${left}`);
    }

    for (const objective of quest.objectives) {
      if (objective.type !== 'collect_item') continue;
      if (!takeItem(ctx.w, synced.id, objective.itemId, objective.count)) {
        const name = ITEM_BY_ID.get(objective.itemId)?.name ?? objective.itemId;
        throw new Fail('QUEST_NOT_COMPLETE', `${name}不足 ${objective.count} 个`);
      }
    }

    const reward = questReward(ctx.w, synced, quest.reward);
    let char = grantExp(synced, reward.exp);
    char = { ...char, spiritStones: char.spiritStones + reward.spiritStones };
    for (const item of reward.items) addItem(ctx.w, char.id, item.itemId, item.qty);

    const advancedToChapter =
      quest.advancesChapterTo !== null && quest.advancesChapterTo > char.chapter
        ? quest.advancesChapterTo
        : null;
    if (advancedToChapter !== null) char = { ...char, chapter: advancedToChapter };

    char = {
      ...char,
      quests: char.quests.map((q) =>
        q.questId === questId ? { ...q, state: 'claimed' as const, claimedAt: ctx.now } : q,
      ),
    };
    return { char: syncQuests(ctx.w, char), reward, advancedToChapter };
  };

  // ---------------------------------------------------------------- NPC

  const requireNpc = (char: CharacterState, npcId: string) => {
    const npc = NPC_BY_ID.get(npcId);
    if (!npc) throw new Fail('NOT_FOUND', '青云镇没有这个人');
    if (char.stageIndex < npc.unlockStage) {
      throw new Fail('NPC_LOCKED', `${npc.name}此刻不愿见你，需 ${stageName(npc.unlockStage)}`);
    }
    const tree = DIALOGUE_BY_ID.get(npc.dialogueId);
    if (!tree) throw new Fail('DIALOGUE_NOT_FOUND', `${npc.name}此刻无话可说`);
    return { npc, tree };
  };

  const dialogueView = (
    ctx: Ctx,
    char: CharacterState,
    npcId: string,
    treeId: string,
    node: DialogueNode,
    reward: RewardBundle,
    openShopId: string | null,
    /** True when the branch just taken was authored to close the conversation. */
    closed = false,
  ) => {
    const npc = NPC_BY_ID.get(npcId)!;
    const choices = node.choices.flatMap((choice) => {
      const blocked = firstBlock(ctx.w, char, choice.conditions);
      if (blocked !== null && choice.hideWhenBlocked) return [];
      return [{ id: choice.id, text: choice.text, available: blocked === null, blockedReason: blocked }];
    });
    const empty = reward.exp === 0 && reward.spiritStones === 0 && reward.items.length === 0;
    return {
      npcId: npc.id,
      npcName: npc.name,
      npcArt: node.art ?? npc.art,
      dialogueId: treeId,
      node,
      choices,
      openShopId,
      reward: empty ? null : reward,
      // Over either because the player took a branch whose `next` is null, or
      // because nothing on this node is takeable. A closing branch answers with
      // the node it came from, choices intact, so the first cannot be read off
      // `choices`.
      ended: closed || !choices.some((choice) => choice.available),
      view: buildView(ctx.w, char),
    };
  };

  on(API.npc.list, (ctx) => {
    const char = load(ctx);
    return {
      npcs: NPCS.map((npc) => ({
        ...npc,
        unlocked: char.stageIndex >= npc.unlockStage,
        hasQuest:
          char.stageIndex >= npc.unlockStage &&
          char.quests.some((progress) => {
            const quest = QUEST_BY_ID.get(progress.questId);
            if (!quest) return false;
            if (progress.state === 'available') return quest.giverNpcId === npc.id;
            if (progress.state === 'completed') return quest.turnInNpcId === npc.id;
            return false;
          }),
      })),
    };
  });

  on(API.npc.dialogue, (ctx, input) => {
    const npcId = String(input.npcId ?? '');
    const char = load(ctx);
    const { tree } = requireNpc(char, npcId);
    const node = tree.nodes.find((n) => n.id === tree.rootNodeId)!;
    const greeted = bump(char, (o) => (o.type === 'talk_npc' && o.npcId === npcId ? 1 : 0));
    const run = runEffects(ctx, syncQuests(ctx.w, greeted), node.onEnter);
    const saved = store(ctx, run.char);
    return dialogueView(ctx, saved, npcId, tree.id, node, run.reward, run.openShopId);
  });

  on(API.npc.talk, (ctx, input) => {
    const npcId = String(input.npcId ?? '');
    const nodeId = String(input.nodeId ?? '');
    const choiceId = input.choiceId === undefined ? null : String(input.choiceId);

    const char = load(ctx);
    const { tree } = requireNpc(char, npcId);
    const current = tree.nodes.find((n) => n.id === nodeId);
    if (!current) throw new Fail('DIALOGUE_NOT_FOUND', '这段对话没有这一节');

    const greeted = syncQuests(
      ctx.w,
      bump(char, (o) => (o.type === 'talk_npc' && o.npcId === npcId ? 1 : 0)),
    );

    if (choiceId === null) {
      const saved = store(ctx, greeted);
      return dialogueView(ctx, saved, npcId, tree.id, current, emptyBundle(), null);
    }

    const choice = current.choices.find((c) => c.id === choiceId);
    if (!choice) throw new Fail('INVALID_CHOICE', '没有这个选择');
    const blocked = firstBlock(ctx.w, greeted, choice.conditions);
    if (blocked !== null) throw new Fail('CHOICE_BLOCKED', blocked);

    const run = runEffects(ctx, greeted, choice.effects);
    let char2 = syncQuests(ctx.w, run.char);
    let reward = run.reward;
    let openShopId = run.openShopId;
    let node = current;

    if (choice.next !== null) {
      const target = tree.nodes.find((n) => n.id === choice.next);
      if (!target) throw new Fail('DIALOGUE_NOT_FOUND', '这段对话断了');
      const entered = runEffects(ctx, char2, target.onEnter);
      char2 = syncQuests(ctx.w, entered.char);
      reward = {
        exp: reward.exp + entered.reward.exp,
        spiritStones: reward.spiritStones + entered.reward.spiritStones,
        items: [...reward.items, ...entered.reward.items],
        itemNames: itemNames([...reward.items, ...entered.reward.items]),
      };
      openShopId = entered.openShopId ?? openShopId;
      node = target;
    }

    const saved = store(ctx, char2);
    return dialogueView(ctx, saved, npcId, tree.id, node, reward, openShopId, choice.next === null);
  });

  // -------------------------------------------------------------- 任务

  const questList = (w: MockWorld, char: CharacterState) => {
    const toRow = (progress: QuestProgress) => {
      const quest = QUEST_BY_ID.get(progress.questId)!;
      return {
        quest,
        progress,
        objectiveText: quest.objectives.map((objective, i) =>
          objectiveText(objective, progress.counters[i] ?? 0),
        ),
        claimable: progress.state === 'completed',
      };
    };
    void w;
    const rows = char.quests.filter((p) => QUEST_BY_ID.has(p.questId)).map(toRow);
    const rank = (v: ReturnType<typeof toRow>): number =>
      (v.claimable ? 0 : 10) + (v.quest.kind === 'main' ? 0 : v.quest.kind === 'side' ? 1 : 2);
    const pick = (states: readonly string[]) =>
      rows
        .filter((r) => states.includes(r.progress.state))
        .sort((a, b) => rank(a) - rank(b) || a.quest.chapter - b.quest.chapter);

    return {
      active: pick(['active', 'completed']),
      available: pick(['available']),
      claimed: pick(['claimed']),
      chapters: STORY_CHAPTERS.filter(
        (c) => c.unlockStage <= char.stageIndex || c.chapter <= char.chapter,
      ),
      currentChapter: char.chapter,
    };
  };

  on(API.quests.list, (ctx) => questList(ctx.w, load(ctx)));

  on(API.quests.accept, (ctx, input) => {
    const char = load(ctx);
    const saved = store(ctx, acceptQuest(ctx, char, String(input.questId ?? ''), true));
    return questList(ctx.w, saved);
  });

  on(API.quests.complete, (ctx, input) => {
    const questId = String(input.questId ?? '');
    const result = claim(ctx, load(ctx), questId);
    const saved = store(ctx, result.char);
    return {
      questId,
      reward: result.reward,
      advancedToChapter: result.advancedToChapter,
      view: buildView(ctx.w, saved),
    };
  });

  // -------------------------------------------------------------- 商店

  const stockLeft = (
    ctx: Ctx,
    char: CharacterState,
    shopId: string,
    itemId: string,
    dailyStock: number | null,
  ): number | null => {
    if (dailyStock === null) return null;
    const bought = purchases(ctx.w).get(purchaseKey(char.id, shopId, itemId, ctx.now)) ?? 0;
    return Math.max(0, dailyStock - bought);
  };

  const shopView = (ctx: Ctx, char: CharacterState, shopId: string) => {
    const shop = SHOP_BY_ID.get(shopId);
    if (!shop) throw new Fail('SHOP_NOT_FOUND', '这里没有这家铺子');

    const entries = shop.entries.map((entry) => {
      const item = ITEM_BY_ID.get(entry.itemId);
      const blocked = firstBlock(ctx.w, char, entry.conditions);
      const left = stockLeft(ctx, char, shop.id, entry.itemId, entry.dailyStock);
      const soldOut = left !== null && left <= 0;
      return {
        itemId: entry.itemId,
        itemName: item?.name ?? entry.itemId,
        itemArt: item?.art ?? '',
        price: entry.price,
        stockLeft: left,
        available: blocked === null && !soldOut,
        blockedReason: blocked ?? (soldOut ? '今日已售罄，明日再来' : null),
      };
    });

    const sellPrices: Record<string, number> = {};
    for (const row of ctx.w.inventories.get(char.id) ?? []) {
      if (row.equipped || !shopAcceptsItem(shop.id, row.itemId)) continue;
      sellPrices[row.uid] = sellPriceAt(shop.id, row.itemId);
    }

    return { shop, entries, spiritStones: char.spiritStones, sellPrices };
  };

  on(API.shop.list, (ctx, input, params) =>
    shopView(ctx, load(ctx), String(params.shopId ?? input.shopId ?? '')),
  );

  on(API.shop.buy, (ctx, input) => {
    const char = load(ctx);
    const shopId = String(input.shopId ?? '');
    const itemId = String(input.itemId ?? '');
    const shop = SHOP_BY_ID.get(shopId);
    if (!shop) throw new Fail('SHOP_NOT_FOUND', '这里没有这家铺子');

    const entry = shop.entries.find((e) => e.itemId === itemId);
    const unit = buyPriceAt(shopId, itemId);
    if (!entry || unit === null) {
      throw new Fail('ITEM_NOT_SOLD_HERE', `${shop.name}不卖这件东西`);
    }
    const blocked = firstBlock(ctx.w, char, entry.conditions);
    if (blocked !== null) throw new Fail('CONDITION_UNMET', blocked);

    const qty = Math.max(1, Math.floor(Number(input.qty ?? 1)));
    const left = stockLeft(ctx, char, shopId, itemId, entry.dailyStock);
    if (left !== null && left < qty) {
      throw new Fail('OUT_OF_STOCK', left <= 0 ? '今日已售罄，明日再来' : `今日只剩 ${left} 件`);
    }
    const total = unit * qty;
    if (char.spiritStones < total) {
      throw new Fail('INSUFFICIENT_STONES', `灵石不足，需 ${total}，你只有 ${char.spiritStones}`);
    }

    addItem(ctx.w, char.id, itemId, qty);
    const key = purchaseKey(char.id, shopId, itemId, ctx.now);
    purchases(ctx.w).set(key, (purchases(ctx.w).get(key) ?? 0) + qty);

    const saved = store(ctx, { ...char, spiritStones: char.spiritStones - total });
    return {
      shopView: shopView(ctx, saved, shopId),
      spiritStones: saved.spiritStones,
      stonesDelta: -total,
      view: buildView(ctx.w, saved),
    };
  });

  on(API.shop.sell, (ctx, input) => {
    const char = load(ctx);
    const shopId = String(input.shopId ?? '');
    const uid = String(input.uid ?? '');
    const shop = SHOP_BY_ID.get(shopId);
    if (!shop) throw new Fail('SHOP_NOT_FOUND', '这里没有这家铺子');

    const row = (ctx.w.inventories.get(char.id) ?? []).find((r) => r.uid === uid);
    if (!row) throw new Fail('ITEM_NOT_FOUND', '背包里没有这件物品');
    if (row.equipped) throw new Fail('INSUFFICIENT_ITEMS', '正穿在身上，先卸下再卖');
    if (!shopAcceptsItem(shopId, row.itemId)) {
      throw new Fail('ITEM_NOT_SOLD_HERE', `${shop.name}不收这件东西`);
    }

    const qty = Math.max(1, Math.floor(Number(input.qty ?? 1)));
    if (row.qty < qty) throw new Fail('INSUFFICIENT_ITEMS', `数量不足，只剩 ${row.qty} 个`);

    const total = sellPriceAt(shopId, row.itemId) * qty;
    takeItem(ctx.w, char.id, row.itemId, qty);

    const saved = store(ctx, { ...char, spiritStones: char.spiritStones + total });
    return {
      shopView: shopView(ctx, saved, shopId),
      spiritStones: saved.spiritStones,
      stonesDelta: total,
      view: buildView(ctx.w, saved),
    };
  });

  // ------------------------------------------------- 山河图战斗的击杀计数
  //
  // The mock has no server-side hook, so the 山河图 handler is wrapped: a win
  // bumps every matching 击杀 objective, which is what the real server does
  // inside `explore()` via `recordMonsterKill`.
  if (exploreBattle) {
    on(API.explore.battle, (ctx, input, params) => {
      const result = exploreBattle(ctx, input, params) as {
        kind?: string;
        won?: boolean;
        monsterId?: string;
      };
      if (result.kind !== 'battle' || !result.won || !result.monsterId) return result;

      const current = ctx.w.characters.get(ctx.char?.id ?? '');
      if (!current) return result;
      const monsterId = result.monsterId;
      const bumped = syncQuests(
        ctx.w,
        bump(syncQuests(ctx.w, current), (o) =>
          o.type === 'kill_monster' && o.monsterId === monsterId ? 1 : 0,
        ),
      );
      ctx.w.characters.set(bumped.id, bumped);
      return { ...result, view: buildView(ctx.w, bumped) };
    });
  }
}
