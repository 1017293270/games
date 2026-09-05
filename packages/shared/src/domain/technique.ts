import { z } from 'zod';
import { ElementSchema, StatBonusSchema } from './stats.js';
import { ItemGradeSchema } from './item.js';

/**
 * 功法. A character studies exactly one at a time; it is a purely passive
 * modifier applied on top of the realm baseline.
 */
export const TechniqueSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  grade: ItemGradeSchema,
  /** Techniques favouring one element give bonus damage with that element. */
  element: ElementSchema.nullable(),
  /** Additive cultivation rate bonus, e.g. 0.2 = +20%. */
  cultivationBonus: z.number().min(0),
  /** Percentage stat additions relative to the realm baseline. */
  percent: StatBonusSchema,
  /** Extra damage fraction for skills matching `element`. */
  elementAffinity: z.number().min(0),
  requiredStage: z.number().int().min(0).max(35),
  learnCost: z.number().int().min(0),
});
export type Technique = z.infer<typeof TechniqueSchema>;
