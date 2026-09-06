/**
 * 战斗大地图 wire protocol.
 *
 * A zone room receives a delta frame `WorldSettings.zoneSnapshotHz` times a
 * second, to as many as `Zone.capacity` occupants at once, so the per-entity
 * payload is a **positional tuple** rather than an object: at 4 Hz with 300
 * entities the difference between `[i,x,y,hp,f,t,s]` and a named object is
 * roughly 20 KB/s per viewer.
 *
 * Names, portraits and 境界 are sent once in `add` and cached client-side by
 * slot; the tuples that follow carry only what actually changes.
 *
 * Coordinates travel as tenths of a cell (`Math.round(x * 10)`), which is under
 * a tenth of a pixel at `ZONE_TILE_PX` and keeps every field an integer.
 */

import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { MAX_STAGE_INDEX } from '../cultivation/realms.js';

const ArtIdSchema = z.enum(ART_IDS);

export const ZONE_ENTITY_KINDS = ['player', 'bot', 'monster', 'boss'] as const;
export const ZoneEntityKindSchema = z.enum(ZONE_ENTITY_KINDS);
export type ZoneEntityKind = z.infer<typeof ZoneEntityKindSchema>;

/**
 * One occupant's fixed facts, sent when it enters view.
 *
 * `i` is its slot in the zone's entity array. Slots are recycled after a
 * `remove`, so a client must drop everything it knows about a slot the moment
 * it appears in `ZoneFrame.remove`.
 */
export const ZoneRosterEntrySchema = z.object({
  i: z.number().int().min(0),
  /** `characterId` for cultivators, `m:<slot>` for 妖兽. */
  id: z.string().min(1),
  kind: ZoneEntityKindSchema,
  name: z.string().min(1),
  /** `avatar/*` for cultivators, `sprite/*` for 妖兽; null when unknown. */
  art: ArtIdSchema.nullable(),
  stageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX),
  maxHp: z.number().int().min(1),
});
export type ZoneRosterEntry = z.infer<typeof ZoneRosterEntrySchema>;

/**
 * `[i, x*10, y*10, hp, flags, targetI, skillSlot]`.
 *
 * `targetI` is -1 when the entity has no target; `skillSlot` is -1 when it did
 * not act, or acted with a 普攻, and 0-3 for the 神通 slot it just cast.
 */
export const ZoneEntityTupleSchema = z.tuple([
  z.number().int().min(0),
  z.number().int(),
  z.number().int(),
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int(),
  z.number().int(),
]);
export type ZoneEntityTuple = z.infer<typeof ZoneEntityTupleSchema>;

/**
 * Bit flags in tuple field 4.
 *
 * `HIT`/`CRIT`/`DODGED`/`CASTING` are *pulses*: they report what happened since
 * the previous frame and are cleared once sent, so the client fires a one-shot
 * effect on them. The rest are steady state.
 */
export const ZONE_FLAGS = {
  HIT: 1,
  CRIT: 2,
  DODGED: 4,
  CASTING: 8,
  DEAD: 16,
  PROTECTED: 32,
  OFFLINE: 64,
  MOVING: 128,
} as const;
export type ZoneFlag = (typeof ZONE_FLAGS)[keyof typeof ZONE_FLAGS];

/** Pulse bits, cleared by the sender after every frame. */
export const ZONE_PULSE_FLAGS =
  ZONE_FLAGS.HIT | ZONE_FLAGS.CRIT | ZONE_FLAGS.DODGED | ZONE_FLAGS.CASTING;

/**
 * Notable things that happened in the window a frame covers.
 * Discriminated on `t`, kept short because these ride the same 4 Hz channel.
 */
export const ZoneEventSchema = z.discriminatedUnion('t', [
  /** A cultivator brought down a 妖兽. */
  z.object({ t: z.literal('kill'), killer: z.number().int(), victim: z.number().int() }),
  /** A cultivator fell; `respawnAt` is epoch ms. */
  z.object({
    t: z.literal('death'),
    victim: z.number().int(),
    respawnAt: z.number().int(),
  }),
  z.object({ t: z.literal('boss_spawn'), i: z.number().int().min(0) }),
  z.object({ t: z.literal('boss_slain'), killerName: z.string() }),
  /** A cultivator killed another cultivator and took `stones` 灵石. */
  z.object({
    t: z.literal('pvp_kill'),
    killer: z.number().int(),
    victim: z.number().int(),
    stones: z.number().int().min(0),
  }),
]);
export type ZoneEvent = z.infer<typeof ZoneEventSchema>;

/**
 * One push. `full` frames restate the whole zone (sent on join and after a
 * client falls behind); the rest carry only what changed.
 */
export const ZoneFrameSchema = z.object({
  zoneId: z.string().min(1),
  /** Monotonic per zone. A gap means the client missed a frame. */
  seq: z.number().int().min(0),
  at: z.number().int(),
  full: z.boolean(),
  add: z.array(ZoneRosterEntrySchema),
  remove: z.array(z.number().int().min(0)),
  ents: z.array(ZoneEntityTupleSchema),
  events: z.array(ZoneEventSchema),
  boss: z.object({
    alive: z.boolean(),
    /** Epoch ms of the next appearance; null while one is already on the field. */
    nextAt: z.number().int().nullable(),
  }),
});
export type ZoneFrame = z.infer<typeof ZoneFrameSchema>;

// ------------------------------------------------------------- client -> server

/** `zoneId: null` asks the server to restore whichever zone the character is in. */
export const ZoneEnterSchema = z.object({
  zoneId: z.string().min(1).nullable(),
});
export type ZoneEnter = z.infer<typeof ZoneEnterSchema>;

// ------------------------------------------------------------- server -> client

export const ZoneJoinedSchema = z.object({
  zoneId: z.string().min(1),
  /** The viewer's own slot, so it can centre the camera and colour itself. */
  self: z.number().int().min(0),
  enteredAt: z.number().int(),
  /** Always a `full` frame. */
  frame: ZoneFrameSchema,
});
export type ZoneJoined = z.infer<typeof ZoneJoinedSchema>;

export const ZONE_LEAVE_REASONS = ['retreat', 'offline_cap', 'none', 'removed'] as const;
export const ZoneLeaveReasonSchema = z.enum(ZONE_LEAVE_REASONS);
export type ZoneLeaveReason = z.infer<typeof ZoneLeaveReasonSchema>;

export const ZoneLeftSchema = z.object({
  reason: ZoneLeaveReasonSchema,
});
export type ZoneLeft = z.infer<typeof ZoneLeftSchema>;

/** What a stint in the zone banked, settled when the character leaves or ticks over. */
export const ZoneLootSchema = z.object({
  exp: z.number().int().min(0),
  spiritStones: z.number().int().min(0),
  items: z.array(z.object({ itemId: z.string(), qty: z.number().int(), name: z.string() })),
  kills: z.number().int().min(0),
  bossKills: z.number().int().min(0),
  /** Epoch ms the accumulation window opened. */
  since: z.number().int(),
});
export type ZoneLoot = z.infer<typeof ZoneLootSchema>;

export const ZoneDeathSchema = z.object({
  killerName: z.string(),
  stonesLost: z.number().int().min(0),
  respawnAt: z.number().int(),
});
export type ZoneDeath = z.infer<typeof ZoneDeathSchema>;

export const ZONE_ERROR_CODES = ['MAP_LOCKED', 'NOT_FOUND', 'RATE_LIMITED', 'ZONE_FULL'] as const;
export const ZoneErrorCodeSchema = z.enum(ZONE_ERROR_CODES);
export type ZoneErrorCode = z.infer<typeof ZoneErrorCodeSchema>;

export const ZoneErrorSchema = z.object({
  code: ZoneErrorCodeSchema,
  message: z.string(),
});
export type ZoneError = z.infer<typeof ZoneErrorSchema>;

/**
 * One sampled position, for the client's interpolation buffer.
 *
 * Never serialised on its own — frames arrive at `zoneSnapshotHz` and the
 * renderer runs at 60 fps, so it keeps two poses per slot and eases between
 * them. Deliberately a plain type, not a schema.
 */
export interface ZonePose {
  x: number;
  y: number;
  hp: number;
  flags: number;
  at: number;
}
