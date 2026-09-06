import { z } from 'zod';

/**
 * Server-wide knobs, editable from the admin panel at runtime.
 * Every gameplay formula that can be tuned reads from here rather than
 * hard-coding a constant.
 *
 * Fields carry no zod `.default()`: defaults live in `DEFAULT_WORLD_SETTINGS`
 * so that `WorldSettingsPatchSchema` is a *true* patch. A schema whose fields
 * default would silently reset every unmentioned knob on a partial
 * `PUT /api/admin/settings`.
 *
 * Bootstrapping a stored config:
 *   `WorldSettingsSchema.parse({ ...DEFAULT_WORLD_SETTINGS, ...stored })`
 */
export const WorldSettingsSchema = z.object({
  /** Global cultivation rate multiplier. 1 = design baseline. */
  cultivationMultiplier: z.number().min(0).max(100),
  /** Offline seconds beyond this many hours are forfeited on settle. */
  offlineCapHours: z.number().min(0).max(720),
  /** Seconds between bot simulation ticks. */
  botTickSeconds: z.number().int().min(5).max(3600),
  /** Target population of bot cultivators. */
  botCount: z.number().int().min(0).max(5000),
  /** Multiplies every drop chance, capped at 1 per entry. */
  dropRateMultiplier: z.number().min(0).max(10),
  /** 秘境 runs allowed per character per UTC day. */
  dungeonDailyLimit: z.number().int().min(0).max(100),
  /** 论道 (arena) challenges per character per UTC day. */
  arenaDailyLimit: z.number().int().min(0).max(100),
  /** Minutes a raided bot needs before it can be attacked again. */
  raidRecoverMinutes: z.number().int().min(0).max(1440),
  /** When true, registration requires a valid invite code. */
  inviteRequired: z.boolean(),
  /** Multiplies 妖兽/BOSS 修为 rewards. */
  expRewardMultiplier: z.number().min(0).max(100),
  /** Multiplies 灵石 rewards from every source. */
  stoneRewardMultiplier: z.number().min(0).max(100),
  /** Multiplies every breakthrough success chance before the 95% cap. */
  breakthroughChanceMultiplier: z.number().min(0).max(10),
  /** Max characters that may be in one party. */
  maxPartySize: z.number().int().min(1).max(8),
  /** Hard cap on rounds any battle may run. */
  maxBattleRounds: z.number().int().min(5).max(200),
  /** World chat messages retained for the scrollback. */
  chatHistoryLimit: z.number().int().min(0).max(1000),
  /** When false, new registrations are rejected outright. */
  registrationOpen: z.boolean(),
  /** Shown on the login screen. */
  announcement: z.string().max(500),

  // ------------------------------------------------------- 战斗大地图 (zone)
  /** Milliseconds one zone simulation step covers. */
  zoneTickMs: z.number().int().min(100).max(1000),
  /** Delta frames pushed to each zone room per second. */
  zoneSnapshotHz: z.number().int().min(1).max(10),
  /** Multiplies every spawn point's population. */
  monsterDensity: z.number().min(0.2).max(3),
  /** Multiplies every 妖兽 respawn delay. */
  respawnMultiplier: z.number().min(0.2).max(5),
  /** Minutes between BOSS appearances in a zone. */
  bossIntervalMinutes: z.number().int().min(1).max(720),
  /** When true, cultivators may attack each other inside a zone. */
  mapPvp: z.boolean(),
  /** Share of the loser's 灵石 the winner takes on a zone PvP kill. */
  mapPvpStoneLoss: z.number().min(0).max(0.5),
  /** Seconds a fallen cultivator waits before respawning at the entrance. */
  mapDeathRespawnSec: z.number().int().min(1).max(120),
  /** Multiplies 修为/灵石 earned from zone kills, against the 秘境 baseline. */
  zoneRewardScale: z.number().min(0).max(10),
  /** Share of zone rewards an offline cultivator still banks. */
  zoneOfflineYield: z.number().min(0).max(1),
});
export type WorldSettings = z.infer<typeof WorldSettingsSchema>;

/** Baseline settings a fresh server boots with. */
export const DEFAULT_WORLD_SETTINGS: WorldSettings = WorldSettingsSchema.parse({
  cultivationMultiplier: 1,
  offlineCapHours: 12,
  botTickSeconds: 30,
  botCount: 200,
  dropRateMultiplier: 1,
  dungeonDailyLimit: 3,
  arenaDailyLimit: 10,
  raidRecoverMinutes: 30,
  inviteRequired: true,
  expRewardMultiplier: 1,
  stoneRewardMultiplier: 1,
  breakthroughChanceMultiplier: 1,
  maxPartySize: 4,
  maxBattleRounds: 30,
  chatHistoryLimit: 100,
  registrationOpen: true,
  announcement: '',

  zoneTickMs: 250,
  zoneSnapshotHz: 4,
  monsterDensity: 1,
  respawnMultiplier: 1,
  bossIntervalMinutes: 30,
  mapPvp: false,
  mapPvpStoneLoss: 0.05,
  mapDeathRespawnSec: 10,
  zoneRewardScale: 0.3,
  zoneOfflineYield: 0.5,
});

/**
 * Partial update accepted by `PUT /api/admin/settings`.
 * Only the keys actually present are changed.
 */
export const WorldSettingsPatchSchema = WorldSettingsSchema.partial();
export type WorldSettingsPatch = z.infer<typeof WorldSettingsPatchSchema>;

/** Merges a validated patch onto the current settings. */
export function applyWorldSettingsPatch(
  current: WorldSettings,
  patch: WorldSettingsPatch,
): WorldSettings {
  return WorldSettingsSchema.parse({ ...current, ...patch });
}

/** Fills any missing key from the defaults; use when loading stored config. */
export function hydrateWorldSettings(stored: unknown): WorldSettings {
  const partial = WorldSettingsPatchSchema.parse(stored ?? {});
  return WorldSettingsSchema.parse({ ...DEFAULT_WORLD_SETTINGS, ...partial });
}
