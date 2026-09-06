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
/** How far a cultivator looks for something to fight, in cells. */
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
      // 山道两侧的狼群，新来的弟子一进门就撞得上。
      {
        monsterId: 'monster-qingyun-wolf',
        count: 8,
        respawnSec: 20,
        area: { x: 6, y: 60, w: 20, h: 16 },
      },
      {
        monsterId: 'monster-qingyun-wolf',
        count: 8,
        respawnSec: 20,
        area: { x: 34, y: 58, w: 20, h: 16 },
      },
      // 半山腰的灵猿，硬一档。
      {
        monsterId: 'monster-spirit-ape',
        count: 9,
        respawnSec: 35,
        area: { x: 12, y: 34, w: 36, h: 16 },
      },
      {
        monsterId: 'monster-spirit-ape',
        count: 6,
        respawnSec: 40,
        area: { x: 20, y: 20, w: 22, h: 12 },
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
        count: 9,
        respawnSec: 22,
        area: { x: 8, y: 62, w: 18, h: 16 },
      },
      {
        monsterId: 'monster-river-bandit',
        count: 9,
        respawnSec: 22,
        area: { x: 34, y: 60, w: 18, h: 16 },
      },
      {
        monsterId: 'monster-luoshui-flood-dragon',
        count: 9,
        respawnSec: 38,
        area: { x: 10, y: 32, w: 40, h: 18 },
      },
      {
        monsterId: 'monster-luoshui-flood-dragon',
        count: 5,
        respawnSec: 45,
        area: { x: 22, y: 18, w: 18, h: 10 },
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
        count: 10,
        respawnSec: 25,
        area: { x: 6, y: 58, w: 22, h: 18 },
      },
      {
        monsterId: 'monster-ghost-lantern',
        count: 8,
        respawnSec: 25,
        area: { x: 32, y: 62, w: 22, h: 14 },
      },
      {
        monsterId: 'monster-bone-general',
        count: 10,
        respawnSec: 40,
        area: { x: 12, y: 30, w: 36, h: 18 },
      },
      {
        monsterId: 'monster-bone-general',
        count: 5,
        respawnSec: 45,
        area: { x: 20, y: 18, w: 20, h: 10 },
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
        count: 9,
        respawnSec: 28,
        area: { x: 8, y: 60, w: 20, h: 16 },
      },
      {
        monsterId: 'monster-ice-qilin',
        count: 9,
        respawnSec: 28,
        area: { x: 33, y: 60, w: 20, h: 16 },
      },
      {
        monsterId: 'monster-golden-crow',
        count: 11,
        respawnSec: 42,
        area: { x: 10, y: 30, w: 40, h: 18 },
      },
      {
        monsterId: 'monster-golden-crow',
        count: 7,
        respawnSec: 45,
        area: { x: 18, y: 16, w: 24, h: 10 },
      },
    ],
    boss: { monsterId: 'boss-kunlun-heaven-beast', area: { x: 20, y: 4, w: 20, h: 10 } },
    capacity: 120,
  },
];

export const ZONES: readonly Zone[] = ZONE_SPECS.map((z) => ZoneSchema.parse(z));
export const ZONE_BY_ID: ReadonlyMap<string, Zone> = indexById(ZONES);
export const ZONE_IDS: readonly string[] = ZONES.map((z) => z.id);

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
