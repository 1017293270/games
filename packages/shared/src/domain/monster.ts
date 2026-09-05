import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { StatsSchema } from './stats.js';

const ArtIdSchema = z.enum(ART_IDS);

/** A drop table row: `itemId` at `chance`, quantity uniform in [min, max]. */
export const LootEntrySchema = z.object({
  itemId: z.string().min(1),
  chance: z.number().min(0).max(1),
  min: z.number().int().min(1),
  max: z.number().int().min(1),
});
export type LootEntry = z.infer<typeof LootEntrySchema>;

export const MonsterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  art: ArtIdSchema,
  /** Reference stage used to scale the monster's stats. */
  stageIndex: z.number().int().min(0).max(35),
  stats: StatsSchema,
  skills: z.array(z.string().min(1)).max(4),
  /** Cultivation points awarded on victory. */
  expReward: z.number().int().min(0),
  /** 灵石 awarded on victory. */
  stoneReward: z.number().int().min(0),
  loot: z.array(LootEntrySchema),
  /** True for the four 秘境 bosses. */
  isBoss: z.boolean(),
});
export type Monster = z.infer<typeof MonsterSchema>;
