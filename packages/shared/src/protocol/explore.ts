import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { DungeonSchema, EncounterSchema, ExploreMapSchema } from '../domain/map.js';
import { MonsterSchema } from '../domain/monster.js';
import { CharacterViewSchema } from '../domain/character.js';
import { RewardSchema } from '../domain/script.js';
import { BattleResultSchema } from '../combat/types.js';
import { API_PREFIX, EmptySchema, endpoint } from './common.js';

/** What actually came out of an action: 修为, 灵石 and items. */
export const RewardBundleSchema = RewardSchema.extend({
  /** Item names resolved server-side so the client can render a toast. */
  itemNames: z.array(z.string()).default([]),
});
export type RewardBundle = z.infer<typeof RewardBundleSchema>;

export const MapListEntrySchema = ExploreMapSchema.extend({
  unlocked: z.boolean(),
  /** Epoch ms the 采药 cooldown ends; 0 when ready. */
  gatherReadyAt: z.number().int(),
  monsters: z.array(MonsterSchema),
});
export type MapListEntry = z.infer<typeof MapListEntrySchema>;

export const MapListResponseSchema = z.object({ maps: z.array(MapListEntrySchema) });
export type MapListResponse = z.infer<typeof MapListResponseSchema>;

export const ExploreBattleRequestSchema = z.object({
  mapId: z.string().min(1),
  /** Pick a specific 妖兽; omitted means the server rolls one. */
  monsterId: z.string().min(1).optional(),
});
export type ExploreBattleRequest = z.infer<typeof ExploreBattleRequestSchema>;

/**
 * An explore action either resolves into a battle or triggers an 奇遇.
 * `kind` discriminates; the client renders a replay or a dialogue card.
 */
export const ExploreBattleResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('battle'),
    monsterId: z.string(),
    monsterName: z.string(),
    battle: BattleResultSchema,
    won: z.boolean(),
    reward: RewardBundleSchema,
    view: CharacterViewSchema,
  }),
  z.object({
    kind: z.literal('encounter'),
    encounter: EncounterSchema,
    /** Token the follow-up `explore/event` call must echo back. */
    encounterToken: z.string(),
    view: CharacterViewSchema,
  }),
]);
export type ExploreBattleResponse = z.infer<typeof ExploreBattleResponseSchema>;

export const GatherRequestSchema = z.object({ mapId: z.string().min(1) });

export const GatherResponseSchema = z.object({
  reward: RewardBundleSchema,
  /** Epoch ms the next 采药 becomes available. */
  nextGatherAt: z.number().int(),
  view: CharacterViewSchema,
});
export type GatherResponse = z.infer<typeof GatherResponseSchema>;

export const EncounterChoiceRequestSchema = z.object({
  encounterToken: z.string().min(1),
  optionId: z.string().min(1),
});
export type EncounterChoiceRequest = z.infer<typeof EncounterChoiceRequestSchema>;

export const EncounterChoiceResponseSchema = z.object({
  outcomeText: z.string(),
  reward: RewardBundleSchema,
  view: CharacterViewSchema,
});
export type EncounterChoiceResponse = z.infer<typeof EncounterChoiceResponseSchema>;

export const DungeonListEntrySchema = DungeonSchema.extend({
  unlocked: z.boolean(),
  runsToday: z.number().int().min(0),
  dailyLimit: z.number().int().min(0),
  boss: MonsterSchema,
});

export const DungeonListResponseSchema = z.object({ dungeons: z.array(DungeonListEntrySchema) });
export type DungeonListEntry = z.infer<typeof DungeonListEntrySchema>;
export type DungeonListResponse = z.infer<typeof DungeonListResponseSchema>;

export const DungeonStartRequestSchema = z.object({
  dungeonId: z.string().min(1),
  /** Run with the current party instead of solo. */
  withParty: z.boolean().default(false),
});
export type DungeonStartRequest = z.infer<typeof DungeonStartRequestSchema>;

/**
 * One 妖兽 as it stood in a wave.
 *
 * `id` is the combatant id the battle log uses, which for a duplicated 妖兽
 * carries a suffix — so this is the only thing that maps a `finalHp` key back
 * to a name and a portrait.
 */
export const DungeonWaveEnemySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** null when the 妖兽 carries no portrait; the client draws a placeholder. */
  art: z.enum(ART_IDS).nullable(),
  maxHp: z.number().min(1),
});
export type DungeonWaveEnemy = z.infer<typeof DungeonWaveEnemySchema>;

/** One wave of a 秘境 run, positionally aligned with the run's battles. */
export const DungeonWaveSchema = z.object({
  name: z.string(),
  enemies: z.array(DungeonWaveEnemySchema),
});
export type DungeonWave = z.infer<typeof DungeonWaveSchema>;

export const DungeonStartResponseSchema = z.object({
  dungeonId: z.string(),
  cleared: z.boolean(),
  /** One `BattleResult` per wave, boss last. */
  battles: z.array(BattleResultSchema),
  /** What stood in each wave, same length and order as `battles`. */
  waves: z.array(DungeonWaveSchema),
  reward: RewardBundleSchema,
  view: CharacterViewSchema,
  /** Character ids that took part; party runs share the loot. */
  participantIds: z.array(z.string()),
});
export type DungeonStartResponse = z.infer<typeof DungeonStartResponseSchema>;

export const exploreEndpoints = {
  maps: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/explore/maps`,
    auth: 'user',
    request: EmptySchema,
    response: MapListResponseSchema,
    errors: [],
    summary: '地图列表（含解锁状态与采药冷却）',
  }),
  battle: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/explore/battle`,
    auth: 'user',
    request: ExploreBattleRequestSchema,
    response: ExploreBattleResponseSchema,
    errors: ['MAP_LOCKED', 'NOT_FOUND'],
    summary: '探索：按 encounterChance 掷出战斗或奇遇',
  }),
  gather: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/explore/gather`,
    auth: 'user',
    request: GatherRequestSchema,
    response: GatherResponseSchema,
    errors: ['MAP_LOCKED', 'GATHER_COOLDOWN'],
    summary: '采药',
  }),
  chooseEvent: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/explore/event`,
    auth: 'user',
    request: EncounterChoiceRequestSchema,
    response: EncounterChoiceResponseSchema,
    errors: ['ENCOUNTER_NOT_ACTIVE', 'INVALID_CHOICE', 'CHOICE_BLOCKED'],
    summary: '在奇遇中做出选择',
  }),
  dungeons: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/dungeon`,
    auth: 'user',
    request: EmptySchema,
    response: DungeonListResponseSchema,
    errors: [],
    summary: '秘境列表与今日剩余次数',
  }),
  startDungeon: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/dungeon/start`,
    auth: 'user',
    request: DungeonStartRequestSchema,
    response: DungeonStartResponseSchema,
    errors: ['DUNGEON_LOCKED', 'DAILY_LIMIT_REACHED', 'PARTY_TOO_SMALL', 'NOT_IN_PARTY', 'NOT_PARTY_LEADER'],
    summary: '开启秘境副本（可组队）',
  }),
} as const;
