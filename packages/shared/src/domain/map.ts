import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { ConditionSchema, EffectSchema } from './script.js';
import { LootEntrySchema } from './monster.js';

const ArtIdSchema = z.enum(ART_IDS);

/** One branch of an 奇遇: a player choice and what it yields. */
export const EncounterOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  conditions: z.array(ConditionSchema).default([]),
  /** Outcome prose shown after choosing. */
  outcomeText: z.string().min(1),
  effects: z.array(EffectSchema).default([]),
  /** Relative weight when the server needs to auto-resolve for a bot. */
  botWeight: z.number().min(0).default(1),
});
export type EncounterOption = z.infer<typeof EncounterOptionSchema>;

/** 奇遇 event: prose plus a set of choices. */
export const EncounterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().min(1),
  art: ArtIdSchema.nullable().default(null),
  /** Relative chance of this event firing among the map's events. */
  weight: z.number().positive(),
  /** Gate for the event appearing at all. */
  conditions: z.array(ConditionSchema).default([]),
  options: z.array(EncounterOptionSchema).min(2),
});
export type Encounter = z.infer<typeof EncounterSchema>;

export const ExploreMapSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  art: ArtIdSchema,
  /** Unlocks at this stageIndex. */
  unlockStage: z.number().int().min(0).max(35),
  /** Reference stage the map's content is tuned for. */
  recommendedStage: z.number().int().min(0).max(35),
  /** Exactly two 妖兽 per map. */
  monsterIds: z.array(z.string().min(1)).length(2),
  /** 采药 output table. */
  gather: z.object({
    /** Seconds between gathers. */
    cooldownSec: z.number().int().positive(),
    expReward: z.number().int().min(0),
    stoneReward: z.number().int().min(0),
    loot: z.array(LootEntrySchema).min(1),
  }),
  encounterIds: z.array(z.string().min(1)).min(2),
  /** Chance an explore action rolls an 奇遇 instead of a battle. */
  encounterChance: z.number().min(0).max(1),
});
export type ExploreMap = z.infer<typeof ExploreMapSchema>;

export const DungeonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  art: ArtIdSchema,
  unlockStage: z.number().int().min(0).max(35),
  recommendedStage: z.number().int().min(0).max(35),
  /** Trash waves fought before the boss; each entry is a monster id list. */
  waves: z.array(z.array(z.string().min(1)).min(1)).min(1),
  bossId: z.string().min(1),
  /** Recommended party size; a solo run is allowed but harsher. */
  partySize: z.number().int().min(1).max(4),
  reward: z.object({
    exp: z.number().int().min(0),
    spiritStones: z.number().int().min(0),
    loot: z.array(LootEntrySchema),
  }),
  /** Extra entries beyond `WorldSettings.dungeonDailyLimit`, 0 = none. */
  bonusDailyEntries: z.number().int().min(0).default(0),
});
export type Dungeon = z.infer<typeof DungeonSchema>;
