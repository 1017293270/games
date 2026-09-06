import { z } from 'zod';
import { DialogueNodeSchema, NpcSchema } from '../domain/npc.js';
import { QuestProgressSchema, QuestSchema, StoryChapterSchema } from '../domain/quest.js';
import { ShopSchema } from '../domain/shop.js';
import { CharacterViewSchema } from '../domain/character.js';
import { RewardBundleSchema } from './explore.js';
import { API_PREFIX, EmptySchema, endpoint } from './common.js';

// -------------------------------------------------------------------- NPC

export const NpcListEntrySchema = NpcSchema.extend({
  unlocked: z.boolean(),
  /** True when this NPC has a quest ready to accept or turn in. */
  hasQuest: z.boolean(),
});
export type NpcListEntry = z.infer<typeof NpcListEntrySchema>;

export const NpcListResponseSchema = z.object({ npcs: z.array(NpcListEntrySchema) });
export type NpcListResponse = z.infer<typeof NpcListResponseSchema>;

/** One choice as the player sees it, with conditions already evaluated. */
export const ResolvedChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** False when a condition failed; the client greys it out. */
  available: z.boolean(),
  /** Why it is unavailable, ready to display. */
  blockedReason: z.string().nullable(),
});
export type ResolvedChoice = z.infer<typeof ResolvedChoiceSchema>;

export const DialogueViewSchema = z.object({
  npcId: z.string(),
  npcName: z.string(),
  npcArt: z.string(),
  dialogueId: z.string(),
  node: DialogueNodeSchema,
  choices: z.array(ResolvedChoiceSchema),
  /** Shop to open, when the last choice carried an `open_shop` effect. */
  openShopId: z.string().nullable(),
  /** Anything the node's effects granted. */
  reward: RewardBundleSchema.nullable(),
  /**
   * True when the conversation is over: the branch just taken was authored to
   * close it (`next: null` — 弟子告退 and the like), or the node offers no
   * takeable branch at all. The client shows a 告辞 and drops the choices
   * rather than re-offering branches the player just declined.
   *
   * A closing branch answers with the node it was taken from, choices intact,
   * so this cannot be derived from `choices` on the client.
   */
  ended: z.boolean(),
  view: CharacterViewSchema,
});
export type DialogueView = z.infer<typeof DialogueViewSchema>;

export const NpcDialogueRequestSchema = z.object({ npcId: z.string().min(1) });

export const NpcTalkRequestSchema = z.object({
  npcId: z.string().min(1),
  nodeId: z.string().min(1),
  /** Omit to simply re-enter a node. */
  choiceId: z.string().min(1).optional(),
});
export type NpcTalkRequest = z.infer<typeof NpcTalkRequestSchema>;

// ------------------------------------------------------------------ 任务

export const QuestViewSchema = z.object({
  quest: QuestSchema,
  progress: QuestProgressSchema,
  /** Objective-by-objective `current / required`. */
  objectiveText: z.array(z.string()),
  claimable: z.boolean(),
});
export type QuestView = z.infer<typeof QuestViewSchema>;

export const QuestListResponseSchema = z.object({
  active: z.array(QuestViewSchema),
  available: z.array(QuestViewSchema),
  claimed: z.array(QuestViewSchema),
  chapters: z.array(StoryChapterSchema),
  currentChapter: z.number().int(),
});
export type QuestListResponse = z.infer<typeof QuestListResponseSchema>;

export const QuestIdRequestSchema = z.object({ questId: z.string().min(1) });

export const QuestCompleteResponseSchema = z.object({
  questId: z.string(),
  reward: RewardBundleSchema,
  /** Non-null when claiming the quest advanced the story. */
  advancedToChapter: z.number().int().nullable(),
  view: CharacterViewSchema,
});
export type QuestCompleteResponse = z.infer<typeof QuestCompleteResponseSchema>;

// ------------------------------------------------------------------ 商店

export const ShopEntryViewSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  itemArt: z.string(),
  price: z.number().int(),
  /** null = unlimited. */
  stockLeft: z.number().int().nullable(),
  available: z.boolean(),
  blockedReason: z.string().nullable(),
});
export type ShopEntryView = z.infer<typeof ShopEntryViewSchema>;

export const ShopViewSchema = z.object({
  shop: ShopSchema,
  entries: z.array(ShopEntryViewSchema),
  spiritStones: z.number().int(),
  /** Buyback price per inventory row uid the player could sell here. */
  sellPrices: z.record(z.string(), z.number().int()),
});
export type ShopView = z.infer<typeof ShopViewSchema>;

export const ShopIdRequestSchema = z.object({ shopId: z.string().min(1) });

export const ShopBuyRequestSchema = z.object({
  shopId: z.string().min(1),
  itemId: z.string().min(1),
  qty: z.number().int().min(1).max(99).default(1),
});
export type ShopBuyRequest = z.infer<typeof ShopBuyRequestSchema>;

export const ShopSellRequestSchema = z.object({
  shopId: z.string().min(1),
  uid: z.string().min(1),
  qty: z.number().int().min(1).max(999).default(1),
});
export type ShopSellRequest = z.infer<typeof ShopSellRequestSchema>;

export const ShopTradeResponseSchema = z.object({
  shopView: ShopViewSchema,
  spiritStones: z.number().int(),
  /** Negative when buying, positive when selling. */
  stonesDelta: z.number().int(),
  view: CharacterViewSchema,
});
export type ShopTradeResponse = z.infer<typeof ShopTradeResponseSchema>;

export const npcEndpoints = {
  list: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/npc`,
    auth: 'user',
    request: EmptySchema,
    response: NpcListResponseSchema,
    errors: [],
    summary: '青云镇 NPC 列表',
  }),
  dialogue: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/npc/dialogue`,
    auth: 'user',
    request: NpcDialogueRequestSchema,
    response: DialogueViewSchema,
    errors: ['NOT_FOUND', 'NPC_LOCKED', 'DIALOGUE_NOT_FOUND'],
    summary: '开始对话，返回根节点与可选项',
  }),
  talk: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/npc/talk`,
    auth: 'user',
    request: NpcTalkRequestSchema,
    response: DialogueViewSchema,
    errors: ['DIALOGUE_NOT_FOUND', 'INVALID_CHOICE', 'CHOICE_BLOCKED'],
    summary: '在对话树中选择分支（服务端校验条件并执行效果）',
  }),
} as const;

export const questEndpoints = {
  list: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/quests`,
    auth: 'user',
    request: EmptySchema,
    response: QuestListResponseSchema,
    errors: [],
    summary: '任务列表与章节进度',
  }),
  accept: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/quests/accept`,
    auth: 'user',
    request: QuestIdRequestSchema,
    response: QuestListResponseSchema,
    errors: ['NOT_FOUND', 'QUEST_NOT_AVAILABLE', 'CONDITION_UNMET'],
    summary: '接受任务',
  }),
  complete: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/quests/complete`,
    auth: 'user',
    request: QuestIdRequestSchema,
    response: QuestCompleteResponseSchema,
    errors: ['NOT_FOUND', 'QUEST_NOT_ACTIVE', 'QUEST_NOT_COMPLETE', 'QUEST_ALREADY_CLAIMED'],
    summary: '交付任务并领取奖励',
  }),
} as const;

export const shopEndpoints = {
  list: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/shop/:shopId`,
    auth: 'user',
    request: ShopIdRequestSchema,
    response: ShopViewSchema,
    errors: ['SHOP_NOT_FOUND'],
    summary: '商店货架（含条件判定与回收价）',
  }),
  buy: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/shop/buy`,
    auth: 'user',
    request: ShopBuyRequestSchema,
    response: ShopTradeResponseSchema,
    errors: [
      'SHOP_NOT_FOUND',
      'ITEM_NOT_SOLD_HERE',
      'INSUFFICIENT_STONES',
      'OUT_OF_STOCK',
      'CONDITION_UNMET',
    ],
    summary: '购买道具',
  }),
  sell: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/shop/sell`,
    auth: 'user',
    request: ShopSellRequestSchema,
    response: ShopTradeResponseSchema,
    errors: ['SHOP_NOT_FOUND', 'ITEM_NOT_FOUND', 'INSUFFICIENT_ITEMS'],
    summary: '出售道具（按商店 buybackRate 折价）',
  }),
} as const;
