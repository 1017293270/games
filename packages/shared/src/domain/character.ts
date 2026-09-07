import { z } from 'zod';
import { ProgressionStateSchema } from './progression.js';
import { ART_AVATARS, ART_IDS } from '../core/art.js';
import { MAX_STAGE_INDEX } from '../cultivation/realms.js';
import { SpiritRootSchema, StatsSchema } from './stats.js';
import { EquipSlotSchema, InventoryItemSchema, ItemGradeSchema } from './item.js';
import { BotParamsSchema } from './bot.js';
import { QuestProgressSchema } from './quest.js';
import { SKILL_SLOT_COUNT } from './skill.js';

const AvatarArtSchema = z.enum(ART_AVATARS);

export const GENDERS = ['male', 'female'] as const;
export const GenderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof GenderSchema>;

/** A timed cultivation-rate buff granted by a pill. */
export const CultivationBuffSchema = z.object({
  id: z.string().min(1),
  /** Item that granted the buff, for the UI icon. */
  itemId: z.string().min(1),
  /** Additive bonus, e.g. 0.5 = +50% cultivation rate. */
  bonus: z.number().min(0),
  /** Epoch ms at which the buff stops applying. */
  expiresAt: z.number().int(),
});
export type CultivationBuff = z.infer<typeof CultivationBuffSchema>;

/** Per-day action counters, reset when `date` no longer matches today. */
export const DailyCountersSchema = z.object({
  /** UTC `YYYY-MM-DD`. */
  date: z.string().length(10),
  dungeon: z.number().int().min(0).default(0),
  arena: z.number().int().min(0).default(0),
  gatherAt: z.record(z.string(), z.number().int()).default({}),
});
export type DailyCounters = z.infer<typeof DailyCountersSchema>;

export const EquipmentSlotsSchema = z.object({
  treasure: z.string().min(1).nullable().default(null),
  robe: z.string().min(1).nullable().default(null),
  accessory: z.string().min(1).nullable().default(null),
  pet: z.string().min(1).nullable().default(null),
});
/** Equipment slots hold an `InventoryItem.uid`, not an `Item.id`. */
export type EquipmentSlots = z.infer<typeof EquipmentSlotsSchema>;

/**
 * The full server-side character record. Bots use the same shape; only
 * `isBot`, `botArchetypeId` and `botParams` differ.
 */
export const CharacterStateSchema = z.object({
  id: z.string().min(1),
  /** Owning account. Bots carry the synthetic `bot` owner id. */
  userId: z.string().min(1),
  name: z.string().min(1).max(16),
  gender: GenderSchema,
  avatarArt: AvatarArtSchema,

  isBot: z.boolean().default(false),
  botArchetypeId: z.string().min(1).nullable().default(null),
  botParams: BotParamsSchema.nullable().default(null),

  spiritRoot: SpiritRootSchema,
  /** 0-35. */
  stageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX),
  /** Cultivation points accumulated inside the current stage. */
  exp: z.number().min(0),
  spiritStones: z.number().int().min(0).default(0),

  /** Equipped 神通, positional; `null` leaves the slot empty. */
  skillSlots: z.array(z.string().min(1).nullable()).length(SKILL_SLOT_COUNT),
  learnedSkillIds: z.array(z.string().min(1)).default([]),
  techniqueId: z.string().min(1).nullable().default(null),
  learnedTechniqueIds: z.array(z.string().min(1)).default([]),
  equipment: EquipmentSlotsSchema,
  progression: ProgressionStateSchema.optional(),

  buffs: z.array(CultivationBuffSchema).default([]),

  /** Current 气血 as a fraction of max; raids and PvP leave the loser hurt. */
  hpPercent: z.number().min(0).max(1).default(1),
  /** Epoch ms before which the character cannot be raided again. */
  protectedUntil: z.number().int().default(0),

  /** Story progress. */
  chapter: z.number().int().min(1).default(1),
  quests: z.array(QuestProgressSchema).default([]),
  flags: z.record(z.string(), z.boolean()).default({}),

  /** Epoch ms of the last cultivation settle. */
  lastSettledAt: z.number().int(),
  /** Epoch ms of the last authenticated activity. */
  lastSeenAt: z.number().int(),
  createdAt: z.number().int(),

  dailyCounters: DailyCountersSchema,

  /** Arena standing. */
  arenaRating: z.number().int().min(0).default(1000),
  arenaWins: z.number().int().min(0).default(0),
  arenaLosses: z.number().int().min(0).default(0),

  /** 声望, earned by bringing down 围攻 targets. */
  prestige: z.number().int().min(0).default(0),

  /** Cached 战力, recomputed whenever stats change. */
  powerScore: z.number().int().min(0).default(0),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

/** One equipped piece as a stranger sees it, ready to draw as a slot. */
export const ProfileEquipmentSchema = z.object({
  slot: EquipSlotSchema,
  itemId: z.string().min(1),
  name: z.string().min(1),
  grade: ItemGradeSchema,
  art: z.enum(ART_IDS),
});
export type ProfileEquipment = z.infer<typeof ProfileEquipmentSchema>;

/** What any player may see about another cultivator. */
export const PublicProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  gender: GenderSchema,
  avatarArt: AvatarArtSchema,
  isBot: z.boolean(),
  stageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX),
  stageName: z.string().min(1),
  spiritRoot: SpiritRootSchema,
  powerScore: z.number().int().min(0),
  stats: StatsSchema,
  techniqueName: z.string().nullable(),
  skillIds: z.array(z.string()),
  equipmentItemIds: z.array(z.string()),
  /** The same pieces with everything a slot needs to render, in slot order. */
  equipment: z.array(ProfileEquipmentSchema),
  arenaRating: z.number().int().min(0),
  arenaWins: z.number().int().min(0),
  arenaLosses: z.number().int().min(0),
  online: z.boolean(),
  lastSeenAt: z.number().int(),
  /** Epoch ms; while in the future the cultivator cannot be raided. */
  protectedUntil: z.number().int(),
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

/** Everything the owning client needs to render its own character screen. */
export const CharacterViewSchema = z.object({
  character: CharacterStateSchema,
  stats: StatsSchema,
  stageName: z.string(),
  /** Cultivation points needed to fill the current stage. */
  expRequired: z.number(),
  /** Live cultivation points per second, all multipliers applied. */
  ratePerSec: z.number(),
  /** Seconds remaining in the current stage at the current rate. */
  secondsToNextStage: z.number(),
  /** True at 圆满: progress is parked until a breakthrough is attempted. */
  atPerfection: z.boolean(),
  inventory: z.array(InventoryItemSchema),
});
export type CharacterView = z.infer<typeof CharacterViewSchema>;
