/**
 * 战斗大地图 (zone) geometry.
 *
 * A zone is the top-down battlefield of one `ExploreMap`: cultivators and 妖兽
 * stand at real coordinates, walk toward each other and trade blows in real
 * time. The server simulates it (`zone/sim.ts`) and pushes delta frames over
 * Socket.IO; the client only draws what it is told.
 *
 * A zone carries **geometry only**. Its name, description and unlock stage come
 * from the `ExploreMap` with the same `id`, so the two tables can never drift
 * on the parts they share.
 *
 * Units are grid cells, not pixels: `ZONE_TILE_PX` is the renderer's cell size
 * at zoom 1. Coordinates are floats inside `[0, width] x [0, height]`, origin
 * top-left, +y pointing down — the same orientation the floor bitmap is drawn
 * in, so no axis flip is ever needed.
 */

import { z } from 'zod';
import { ART_IDS } from '../core/art.js';

const ArtIdSchema = z.enum(ART_IDS);

/** Pixels one grid cell occupies at zoom 1. Renderer-side convention. */
export const ZONE_TILE_PX = 12;

export const ZonePointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type ZonePoint = z.infer<typeof ZonePointSchema>;

/** An axis-aligned rectangle in zone cells; `x`/`y` is its top-left corner. */
export const ZoneAreaSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type ZoneArea = z.infer<typeof ZoneAreaSchema>;

/** One 妖兽 spawn point: how many stand in `area`, and how fast they come back. */
export const ZoneSpawnSchema = z.object({
  monsterId: z.string().min(1),
  /** Population held by this point, before `WorldSettings.monsterDensity`. */
  count: z.number().int().min(1).max(40),
  /** Seconds a corpse waits, before `WorldSettings.respawnMultiplier`. */
  respawnSec: z.number().int().min(1),
  area: ZoneAreaSchema,
});
export type ZoneSpawn = z.infer<typeof ZoneSpawnSchema>;

export const ZoneSchema = z.object({
  /** Identical to the `ExploreMap.id` this zone belongs to. */
  id: z.string().min(1),
  /** Top-down floor bitmap, a `zone/*` art ID. */
  floorArt: ArtIdSchema,
  width: z.number().int().min(16).max(256),
  height: z.number().int().min(16).max(256),
  /** Where arrivals and respawns appear. */
  entrance: ZonePointSchema,
  spawns: z.array(ZoneSpawnSchema).min(1),
  /** The 秘境 BOSS that periodically takes the field, and where it stands. */
  boss: z.object({
    monsterId: z.string().min(1),
    area: ZoneAreaSchema,
  }),
  /** Hard cap on cultivators (players + bots) present at once. */
  capacity: z.number().int().min(10).max(300),
});
export type Zone = z.infer<typeof ZoneSchema>;

/** True when `point` lies inside `area` (right/bottom edges included). */
export function zoneAreaContains(area: ZoneArea, point: ZonePoint): boolean {
  return (
    point.x >= area.x &&
    point.x <= area.x + area.w &&
    point.y >= area.y &&
    point.y <= area.y + area.h
  );
}

/** True when `area` fits entirely inside a `width` x `height` zone. */
export function zoneAreaInBounds(area: ZoneArea, width: number, height: number): boolean {
  return area.x >= 0 && area.y >= 0 && area.x + area.w <= width && area.y + area.h <= height;
}
