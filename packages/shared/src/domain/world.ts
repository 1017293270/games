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
