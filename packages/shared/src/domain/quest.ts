import { z } from 'zod';
import { ConditionSchema, RewardSchema } from './script.js';

/** What a quest asks the player to do. */
export const QuestObjectiveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('kill_monster'),
    monsterId: z.string().min(1),
    count: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('collect_item'),
    itemId: z.string().min(1),
    count: z.number().int().min(1),
  }),
  z.object({ type: z.literal('reach_stage'), stageIndex: z.number().int().min(0).max(35) }),
  z.object({
    type: z.literal('defeat_bot'),
    /** null = any bot cultivator. */
    botId: z.string().min(1).nullable(),
    count: z.number().int().min(1),
  }),
  z.object({ type: z.literal('clear_dungeon'), dungeonId: z.string().min(1) }),
  z.object({ type: z.literal('talk_npc'), npcId: z.string().min(1) }),
]);
export type QuestObjective = z.infer<typeof QuestObjectiveSchema>;

export const QUEST_KINDS = ['main', 'side', 'daily'] as const;
export const QuestKindSchema = z.enum(QUEST_KINDS);
export type QuestKind = z.infer<typeof QuestKindSchema>;

export const QuestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: QuestKindSchema,
  /** Story chapter this quest belongs to; side quests use the current one. */
  chapter: z.number().int().min(1),
  /** NPC who hands the quest out. */
  giverNpcId: z.string().min(1),
  /** NPC to report back to; defaults to the giver. */
  turnInNpcId: z.string().min(1),
  /** Must all hold before the quest becomes available. */
  requirements: z.array(ConditionSchema),
  objectives: z.array(QuestObjectiveSchema).min(1),
  reward: RewardSchema,
  /** Quest that must be claimed first, forming the chain. */
  prerequisiteQuestId: z.string().min(1).nullable(),
  /** Advances the story chapter when claimed. */
  advancesChapterTo: z.number().int().min(1).nullable(),
  repeatable: z.boolean(),
});
export type Quest = z.infer<typeof QuestSchema>;

export const QUEST_STATES = ['locked', 'available', 'active', 'completed', 'claimed'] as const;
export const QuestStateSchema = z.enum(QUEST_STATES);
export type QuestState = z.infer<typeof QuestStateSchema>;

/** Per-character progress on one quest. */
export const QuestProgressSchema = z.object({
  questId: z.string().min(1),
  state: QuestStateSchema,
  /** Counter per objective, positionally aligned with `Quest.objectives`. */
  counters: z.array(z.number().int().min(0)),
  acceptedAt: z.number().int().nullable(),
  claimedAt: z.number().int().nullable(),
});
export type QuestProgress = z.infer<typeof QuestProgressSchema>;

export const StoryChapterSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Chapter becomes readable at this stage. */
  unlockStage: z.number().int().min(0).max(35),
  questIds: z.array(z.string().min(1)),
});
export type StoryChapter = z.infer<typeof StoryChapterSchema>;
