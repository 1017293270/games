import { z } from 'zod';

/**
 * Conditions and effects shared by dialogue trees, quests and 奇遇 events.
 * Both are plain data so the server can evaluate them and the client can grey
 * out unavailable choices without duplicating logic.
 */

export const ConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage_at_least'), stageIndex: z.number().int().min(0).max(35) }),
  z.object({ type: z.literal('stage_below'), stageIndex: z.number().int().min(0).max(35) }),
  z.object({
    type: z.literal('has_item'),
    itemId: z.string().min(1),
    qty: z.number().int().min(1).default(1),
  }),
  z.object({ type: z.literal('spirit_stones_at_least'), amount: z.number().int().min(0) }),
  z.object({
    type: z.literal('quest_state'),
    questId: z.string().min(1),
    state: z.enum(['locked', 'available', 'active', 'completed', 'claimed']),
  }),
  z.object({ type: z.literal('chapter_at_least'), chapter: z.number().int().min(1) }),
  z.object({ type: z.literal('flag'), flag: z.string().min(1), value: z.boolean().default(true) }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('give_item'),
    itemId: z.string().min(1),
    qty: z.number().int().min(1).default(1),
  }),
  z.object({
    type: z.literal('take_item'),
    itemId: z.string().min(1),
    qty: z.number().int().min(1).default(1),
  }),
  z.object({ type: z.literal('give_exp'), exp: z.number().int().min(1) }),
  z.object({ type: z.literal('give_spirit_stones'), amount: z.number().int() }),
  z.object({ type: z.literal('accept_quest'), questId: z.string().min(1) }),
  z.object({ type: z.literal('complete_quest'), questId: z.string().min(1) }),
  z.object({ type: z.literal('advance_chapter'), chapter: z.number().int().min(1) }),
  z.object({ type: z.literal('set_flag'), flag: z.string().min(1), value: z.boolean() }),
  z.object({ type: z.literal('open_shop'), shopId: z.string().min(1) }),
  z.object({ type: z.literal('learn_technique'), techniqueId: z.string().min(1) }),
  z.object({ type: z.literal('learn_skill'), skillId: z.string().min(1) }),
  z.object({ type: z.literal('start_battle'), monsterId: z.string().min(1) }),
  z.object({ type: z.literal('heal_full') }),
]);
export type Effect = z.infer<typeof EffectSchema>;

/** A bundle of grants used by quest completion and event outcomes. */
export const RewardSchema = z.object({
  exp: z.number().int().min(0).default(0),
  spiritStones: z.number().int().min(0).default(0),
  items: z
    .array(z.object({ itemId: z.string().min(1), qty: z.number().int().min(1) }))
    .default([]),
});
export type Reward = z.infer<typeof RewardSchema>;
