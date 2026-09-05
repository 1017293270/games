import { z } from 'zod';
import { ElementSchema, StatBonusSchema } from './stats.js';

/** 神通 categories. */
export const SKILL_TYPES = ['damage', 'heal', 'buff', 'debuff'] as const;
export const SkillTypeSchema = z.enum(SKILL_TYPES);
export type SkillType = z.infer<typeof SkillTypeSchema>;

/** How a skill picks its target. */
export const SKILL_TARGETS = ['enemy', 'all_enemies', 'self', 'ally'] as const;
export const SkillTargetSchema = z.enum(SKILL_TARGETS);
export type SkillTarget = z.infer<typeof SkillTargetSchema>;

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  element: ElementSchema,
  /** 1-3; a tree's tiers unlock in order. */
  tier: z.number().int().min(1).max(3),
  type: SkillTypeSchema,
  target: SkillTargetSchema,
  /**
   * Damage/heal coefficient applied to the caster's effective 攻击.
   * Ignored by pure buff/debuff skills.
   */
  power: z.number().min(0),
  /** 灵力 spent per cast. The combat pool is 100 with +15 regen per round. */
  manaCost: z.number().int().min(0),
  /** Rounds before the skill may be cast again. 0 = every rotation step. */
  cooldown: z.number().int().min(0),
  /** Minimum stageIndex at which the skill can be learned. */
  unlockStage: z.number().int().min(0).max(35),
  /** Cost in 灵石 to learn from the sect. */
  learnCost: z.number().int().min(0),
  /** Stat modifier applied by buff/debuff skills, plus its duration. */
  modifier: z
    .object({
      stats: StatBonusSchema.partial(),
      /** Rounds the modifier lasts. */
      durationRounds: z.number().int().min(1),
    })
    .nullable(),
});
export type Skill = z.infer<typeof SkillSchema>;

/** Number of equipped 神通 slots. The rotation cycles through them in order. */
export const SKILL_SLOT_COUNT = 4;
