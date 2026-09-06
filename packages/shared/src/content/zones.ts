/**
 * 战斗大地图 layouts, one per `ExploreMap`.
 *
 * Each zone is a 60x90 field read bottom-to-top: cultivators arrive at the
 * entrance on the south edge, the 妖兽 grounds fill the middle, and the 秘境
 * BOSS takes the clearing at the north end every `bossIntervalMinutes`. Walking
 * further from the entrance means meeting stronger company, which is the whole
 * of the map's difficulty curve — there are no invisible walls.
 *
 * Populations are authored at `monsterDensity = 1`; the world settings scale
 * them at runtime, so these numbers are the shape of the map, not its load.
 *
 * The counts are sized off `zoneSpawnThroughput`, not off how the field looks:
 * a cultivator with nothing alive nearby walks to the nearest 妖兽 anywhere on
 * the map, so a field that spawns fewer kills per second than the crowd
 * standing on it consumes degenerates into everyone jogging after everyone
 * else's target. Every low tier therefore respawns in 5–6 秒 and is the
 * densest band on the map, and every zone's throughput sits at roughly three
 * times the `ZONE_KILL_BUDGET_PER_SEC` floor so that most of the population is
 * alive rather than waiting on a timer.
 */

import { indexById } from '../core/util.js';
import type { Rng } from '../core/rng.js';
import type { ArtId } from '../core/art.js';
import { ZoneSchema, type Zone } from '../domain/zone.js';
import type { ExploreMap } from '../domain/map.js';
import { EXPLORE_MAP_BY_ID } from './maps.js';

// ------------------------------------------------------------------ tuning

/** Milliseconds between two actions at 速度 10; 速度 scales it. */
export const ZONE_ACTION_MS = 1200;
/**
 * Reference sight, in cells. It is the hard radius for picking a PvP rival, and
 * the penalty a crowded 妖兽 carries when cultivators pick their next kill —
 * 妖兽 themselves are hunted at any distance, so a thin field means long walks.
 */
export const ZONE_SEEK_RADIUS = 14;
/** Melee reach. */
export const ZONE_ATTACK_RANGE = 1.6;
/** Reach for `caster` 妖兽 and any `all_enemies` 神通. */
export const ZONE_CASTER_RANGE = 4;
/** Walking speed, cells per second. */
export const ZONE_MOVE_UNITS_PER_SEC = 4;
/** How far a 妖兽 chases before it gives up and walks home. */
export const ZONE_LEASH = 10;
/** Splash radius around an `all_enemies` cast's primary target. */
export const ZONE_AOE_RADIUS = 2.5;
/** Targets one `all_enemies` cast may reach, primary included. */
export const ZONE_AOE_MAX = 4;
/** Immunity granted on entering a zone and on respawning, in ms. */
export const ZONE_PVP_PROTECT_MS = 60_000;
/** 境界 gap beyond which one cultivator will not attack another. */
export const ZONE_PVP_STAGE_WINDOW = 4;
/** Damage contributors a BOSS kill pays out to. */
export const ZONE_BOSS_LOOT_SHARE_TOP = 5;
/** A bot sent to a zone stays at least this long, so the field is not churning. */
export const ZONE_BOT_MIN_STAY_MS = 600_000;
/** Slots kept clear of bots, so a player is never turned away by the population. */
export const ZONE_BOT_CAPACITY_MARGIN = 20;
/**
 * Share of a field's `capacity` bots may occupy — 36 of 120.
 *
 * The margin above only stops bots filling the last twenty slots; it did
 * nothing about the ninety-nine before them. Measured on a 200-bot world, 40
 * bots crowded 青云山 and took 妖兽 faster than the spawn points gave them
 * back, which left a new 练气 player walking after kills other people had
 * already made. Bots turned away here simply stay home and cultivate.
 */
export const ZONE_BOT_SHARE = 0.3;

/**
 * Kills per second a field must be able to hand out, per cultivator standing
 * on it, for the 10–15 秒一杀 pace `docs/GDD.md` §8.1 is priced against.
 *
 * `zoneSpawnThroughput` measures a layout against it: every zone below clears
 * `(floor(capacity x ZONE_BOT_SHARE) + 8 players) x ZONE_KILL_BUDGET_PER_SEC`
 * with room to spare, because supply that merely matches demand leaves every
 * 妖兽 dead and waiting.
 */
export const ZONE_KILL_BUDGET_PER_SEC = 1 / 12;

// ------------------------------------------------------------------ sprites

/**
 * Top-down sprite for every 妖兽 and BOSS.
 * The suffix mirrors the monster id with its `monster-`/`boss-` prefix removed.
 */
export const MONSTER_SPRITE: Record<string, ArtId> = {
  'monster-qingyun-wolf': 'sprite/qingyun-wolf',
  'monster-spirit-ape': 'sprite/spirit-ape',
  'monster-luoshui-flood-dragon': 'sprite/luoshui-flood-dragon',
  'monster-river-bandit': 'sprite/river-bandit',
  'monster-ghost-lantern': 'sprite/ghost-lantern',
  'monster-bone-general': 'sprite/bone-general',
  'monster-ice-qilin': 'sprite/ice-qilin',
  'monster-golden-crow': 'sprite/golden-crow',
  'boss-qingyun-tiger-king': 'sprite/qingyun-tiger-king',
  'boss-luoshui-dragon-lord': 'sprite/luoshui-dragon-lord',
  'boss-youming-ghost-emperor': 'sprite/youming-ghost-emperor',
  'boss-kunlun-heaven-beast': 'sprite/kunlun-heaven-beast',
};

/** The top-down sprite for a monster id, or null when it has none. */
export function monsterSprite(monsterId: string): ArtId | null {
  return MONSTER_SPRITE[monsterId] ?? null;
}

// ------------------------------------------------------------------ layouts

const ZONE_SPECS: Zone[] = [
  {
    id: 'map-qingyun-mountain',
    floorArt: 'zone/qingyun-mountain',
    width: 60,
    height: 90,
    entrance: { x: 30, y: 84 },
    spawns: [
      // 入口两侧的狼群贴着山道铺开，新弟子一落地就有得打；五秒一复活，
      // 让四十个机器人抢完之后仍有下一只。
      {
        monsterId: 'monster-qingyun-wolf',
        count: 24,
        respawnSec: 5,
        area: { x: 2, y: 60, w: 26, h: 22 },
      },
      {
        monsterId: 'monster-qingyun-wolf',
        count: 24,
        respawnSec: 5,
        area: { x: 32, y: 60, w: 26, h: 22 },
      },
      // 半山腰的灵猿，硬一档，人少一点。
      {
        monsterId: 'monster-spirit-ape',
        count: 16,
        respawnSec: 10,
        area: { x: 10, y: 32, w: 40, h: 20 },
      },
      // 再往北是灵猿王的地界：数量最少、复活最慢，是练气期不该久留的地方。
      {
        monsterId: 'monster-spirit-ape',
        count: 10,
        respawnSec: 14,
        area: { x: 18, y: 16, w: 24, h: 14 },
      },
    ],
    boss: { monsterId: 'boss-qingyun-tiger-king', area: { x: 22, y: 5, w: 16, h: 10 } },
    capacity: 120,
  },
  {
    id: 'map-luoshui-city',
    floorArt: 'zone/luoshui-city',
    width: 60,
    height: 90,
    entrance: { x: 30, y: 85 },
    spawns: [
      {
        monsterId: 'monster-river-bandit',
        count: 24,
        respawnSec: 5,
        area: { x: 2, y: 62, w: 26, h: 21 },
      },
      {
        monsterId: 'monster-river-bandit',
        count: 24,
        respawnSec: 5,
        area: { x: 32, y: 62, w: 26, h: 21 },
      },
      {
        monsterId: 'monster-luoshui-flood-dragon',
        count: 16,
        respawnSec: 11,
        area: { x: 8, y: 30, w: 44, h: 20 },
      },
      {
        monsterId: 'monster-luoshui-flood-dragon',
        count: 9,
        respawnSec: 15,
        area: { x: 20, y: 16, w: 20, h: 12 },
      },
    ],
    boss: { monsterId: 'boss-luoshui-dragon-lord', area: { x: 21, y: 4, w: 18, h: 10 } },
    capacity: 120,
  },
  {
    id: 'map-youming-valley',
    floorArt: 'zone/youming-valley',
    width: 60,
    height: 90,
    entrance: { x: 30, y: 84 },
    spawns: [
      {
        monsterId: 'monster-ghost-lantern',
        count: 26,
        respawnSec: 5,
        area: { x: 2, y: 58, w: 26, h: 24 },
      },
      {
        monsterId: 'monster-ghost-lantern',
        count: 24,
        respawnSec: 5,
        area: { x: 32, y: 60, w: 26, h: 22 },
      },
      {
        monsterId: 'monster-bone-general',
        count: 16,
        respawnSec: 11,
        area: { x: 10, y: 30, w: 40, h: 20 },
      },
      {
        monsterId: 'monster-bone-general',
        count: 9,
        respawnSec: 15,
        area: { x: 19, y: 16, w: 22, h: 12 },
      },
    ],
    boss: { monsterId: 'boss-youming-ghost-emperor', area: { x: 22, y: 4, w: 16, h: 10 } },
    capacity: 120,
  },
  {
    id: 'map-kunlun-ruins',
    floorArt: 'zone/kunlun-ruins',
    width: 60,
    height: 90,
    entrance: { x: 30, y: 86 },
    spawns: [
      {
        monsterId: 'monster-ice-qilin',
        count: 24,
        respawnSec: 6,
        area: { x: 2, y: 60, w: 26, h: 24 },
      },
      {
        monsterId: 'monster-ice-qilin',
        count: 24,
        respawnSec: 6,
        area: { x: 32, y: 60, w: 26, h: 24 },
      },
      {
        monsterId: 'monster-golden-crow',
        count: 18,
        respawnSec: 12,
        area: { x: 8, y: 30, w: 44, h: 20 },
      },
      {
        monsterId: 'monster-golden-crow',
        count: 10,
        respawnSec: 16,
        area: { x: 17, y: 16, w: 26, h: 10 },
      },
    ],
    boss: { monsterId: 'boss-kunlun-heaven-beast', area: { x: 20, y: 4, w: 20, h: 10 } },
    capacity: 120,
  },
];

export const ZONES: readonly Zone[] = ZONE_SPECS.map((z) => ZoneSchema.parse(z));
export const ZONE_BY_ID: ReadonlyMap<string, Zone> = indexById(ZONES);
export const ZONE_IDS: readonly string[] = ZONES.map((z) => z.id);

/** Bots a field will hold at once, the tighter of the share and the margin. */
export function zoneBotLimit(zone: Zone): number {
  return Math.max(
    0,
    Math.min(zone.capacity - ZONE_BOT_CAPACITY_MARGIN, Math.floor(zone.capacity * ZONE_BOT_SHARE)),
  );
}

/**
 * Kills per second a zone's spawn points can hand out when demand is unlimited,
 * at `monsterDensity`/`respawnMultiplier` 1. Every spawn point is its own queue
 * of `count` slots on a `respawnSec` timer, so the ceiling is just their sum.
 */
export function zoneSpawnThroughput(zone: Zone): number {
  return zone.spawns.reduce((sum, s) => sum + s.count / s.respawnSec, 0);
}

/** Kills per second a full field of bots plus `players` will ask of it. */
export function zoneKillDemand(zone: Zone, players = 8): number {
  return (zoneBotLimit(zone) + players) * ZONE_KILL_BUDGET_PER_SEC;
}

/** The `ExploreMap` a zone borrows its name, description and gating from. */
export function zoneMap(zoneId: string): ExploreMap | undefined {
  return EXPLORE_MAP_BY_ID.get(zoneId);
}

function unlockStageOf(zone: Zone): number {
  return EXPLORE_MAP_BY_ID.get(zone.id)?.unlockStage ?? 0;
}

function recommendedStageOf(zone: Zone): number {
  return EXPLORE_MAP_BY_ID.get(zone.id)?.recommendedStage ?? 0;
}

/**
 * Where a cultivator at `stageIndex` belongs.
 *
 * Without an `rng` this is deterministic: the hardest zone the character is
 * actually tuned for (`recommendedStage <= stageIndex`). With one, a fifth of
 * the population pushes one tier further out when that tier has unlocked, which
 * is what keeps the higher maps from standing empty until everyone out-levels
 * the lower ones.
 */
export function zoneFor(stageIndex: number, rng?: Rng): Zone {
  const first = ZONES[0] as Zone;
  let base = first;
  let baseIndex = 0;
  for (const [i, zone] of ZONES.entries()) {
    if (recommendedStageOf(zone) <= stageIndex && unlockStageOf(zone) <= stageIndex) {
      base = zone;
      baseIndex = i;
    }
  }
  if (!rng) return base;
  const next = ZONES[baseIndex + 1];
  if (next && unlockStageOf(next) <= stageIndex && rng.chance(0.2)) return next;
  return base;
}

/** Every zone a character at `stageIndex` may enter. */
export function zonesAvailableAt(stageIndex: number): readonly Zone[] {
  return ZONES.filter((z) => unlockStageOf(z) <= stageIndex);
}

/** True when `stageIndex` clears the zone's `ExploreMap` gate. */
export function canEnterZone(zoneId: string, stageIndex: number): boolean {
  const map = EXPLORE_MAP_BY_ID.get(zoneId);
  return map !== undefined && map.unlockStage <= stageIndex;
}
