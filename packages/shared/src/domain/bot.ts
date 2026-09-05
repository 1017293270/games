import { z } from 'zod';

/**
 * Bot cultivator tuning.
 *
 * Bots share `CharacterState` and every formula with human players; the only
 * difference is `isBot: true` plus this parameter block, which the admin panel
 * can edit per bot or per archetype.
 */
export const BotParamsSchema = z.object({
  /** Multiplies the cultivation rate. 天骄 2.5, 散修 0.8. */
  talent: z.number().min(0.1).max(10),
  /** Fraction of the day actually spent cultivating. 苦修 1.0, 纨绔 0.3. */
  diligence: z.number().min(0).max(1),
  /** Additive bonus to breakthrough success, e.g. 0.15 = +15pp. */
  insight: z.number().min(-0.5).max(0.5),
  /** Probability per tick of picking a PvP action over cultivating. */
  aggression: z.number().min(0).max(1),
  /**
   * UTC `[start, end)` hours the bot is "online". The window may wrap past
   * midnight (`[18, 6]` is 18:00-05:59); `end` may be 24 to mean end-of-day,
   * so `[0, 24]` is always active.
   */
  activeHours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(24)]),
  /** Preferred non-cultivation activity. */
  explorePref: z.enum(['cultivate', 'explore', 'dungeon', 'arena']),
});
export type BotParams = z.infer<typeof BotParamsSchema>;

export const BotArchetypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  params: BotParamsSchema,
  /** Relative frequency when populating the world. */
  weight: z.number().positive(),
  /** Avatar art pool the generator draws from. */
  avatarPool: z.array(z.string().min(1)).min(1),
});
export type BotArchetype = z.infer<typeof BotArchetypeSchema>;

/** Rate multiplier applied while a bot is outside its active hours. */
export const BOT_OFFPEAK_RATE = 0.25;

/** What a bot decided to do on one tick. */
export const BOT_ACTIONS = [
  'cultivate',
  'explore',
  'dungeon',
  'arena',
  'breakthrough',
] as const;
export const BotActionSchema = z.enum(BOT_ACTIONS);
export type BotAction = z.infer<typeof BotActionSchema>;
