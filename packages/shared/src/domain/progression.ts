import { z } from 'zod';
import { ART_IDS, type ArtId } from '../core/art.js';
import type { StatBonus } from './stats.js';

export const ProgressionGradeSchema = z.enum(['mortal', 'spirit', 'immortal', 'saint', 'divine']);
export type ProgressionGrade = z.infer<typeof ProgressionGradeSchema>;
export const TreasureFormSchema = z.enum(['bell', 'tower', 'chain', 'seal', 'banner', 'shield']);
export type TreasureForm = z.infer<typeof TreasureFormSchema>;
export const GachaPoolSchema = z.enum(['treasure', 'relic']);
export type GachaPool = z.infer<typeof GachaPoolSchema>;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ProgressionMaterialsSchema = z.object({
  jade: count,
  stardust: count,
  starStones: count,
  breakthroughWood: count,
});
export type ProgressionMaterials = z.infer<typeof ProgressionMaterialsSchema>;
export const TreasureOwnedSchema = z.object({
  uid: z.string().min(1),
  definitionId: z.string().min(1),
  level: z.number().int().min(1).max(100),
  spiritLevel: z.number().int().min(0).max(10),
  stars: z.number().int().min(0).max(5),
  fragments: count,
  slot: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
});
export type TreasureOwned = z.infer<typeof TreasureOwnedSchema>;
export const RelicOwnedSchema = z.object({
  definitionId: z.string().min(1),
  spiritLevel: z.number().int().min(0).max(10),
  stars: z.number().int().min(0).max(5),
  fragments: count,
});
export type RelicOwned = z.infer<typeof RelicOwnedSchema>;
export const ProgressionDailySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kills: count,
  cultivationSeconds: z.number().nonnegative(),
  dungeon: count,
  arena: count,
  chat: count,
  claimed: z.array(z.string()),
  freePools: z.array(GachaPoolSchema),
});
export type ProgressionDaily = z.infer<typeof ProgressionDailySchema>;
export const ProgressionStateSchema = z.object({
  materials: ProgressionMaterialsSchema,
  treasures: z.array(TreasureOwnedSchema),
  relics: z.array(RelicOwnedSchema),
  gacha: z.object({
    treasure: z.object({ pity: count, total: count }),
    relic: z.object({ pity: count, total: count }),
  }),
  daily: ProgressionDailySchema,
  achievements: z.array(z.string()),
  claimedAchievements: z.array(z.string()),
  starterClaimed: z.boolean(),
});
export type ProgressionState = z.infer<typeof ProgressionStateSchema>;
export interface TreasureDefinition {
  id: string;
  name: string;
  grade: ProgressionGrade;
  form: TreasureForm;
  art: ArtId;
  description: string;
}
export interface RelicDefinition {
  id: string;
  name: string;
  grade: ProgressionGrade;
  art: ArtId;
  setId: string;
  percent: Partial<StatBonus>;
  flat: Partial<StatBonus>;
  cultivationBonus: number;
  description: string;
}
export const MainTreasureCombatSchema = z.object({
  definitionId: z.string(),
  name: z.string(),
  art: z.enum(ART_IDS),
  form: TreasureFormSchema,
  power: z.number().positive(),
  intervalMs: z.number().positive(),
  awakened: z.boolean(),
});
export type MainTreasureCombat = z.infer<typeof MainTreasureCombatSchema>;
export const GachaDrawResultSchema = z.object({
  pool: GachaPoolSchema,
  definitionId: z.string(),
  grade: ProgressionGradeSchema,
  duplicate: z.boolean(),
  fragments: count,
  pity: count,
});
export type GachaDrawResult = z.infer<typeof GachaDrawResultSchema>;
export const GachaHistoryEntrySchema = z.object({
  id: z.string(),
  requestId: z.string(),
  at: z.number().int(),
  results: z.array(GachaDrawResultSchema),
});
export type GachaHistoryEntry = z.infer<typeof GachaHistoryEntrySchema>;
