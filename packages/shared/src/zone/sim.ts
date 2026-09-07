/**
 * 战斗大地图 simulation core — pure, deterministic, no I/O.
 *
 * One `ZoneSim` is one map: a few hundred cultivators (players and bots alike)
 * and a few dozen 妖兽 standing at real coordinates, walking toward whatever
 * they mean to hit and trading blows in real time. The server owns the loop and
 * pushes delta frames; the client may run the very same code against a mock to
 * develop the renderer offline.
 *
 * Determinism
 * -----------
 * Nothing here reads `Date.now`, `Math.random` or `crypto.randomUUID`. Time
 * arrives as an argument, randomness comes from a seeded `Rng`, and entities are
 * always visited in slot order — so the same seed and the same call sequence
 * reproduce the same trajectory, byte for byte, on any engine.
 *
 * One step, in order
 * ------------------
 *   1. respawns (dead 妖兽 and fallen cultivators) and the BOSS's appearance
 *   2. target selection — recomputed when a target is gone, or every 8 ticks
 *      unless the cultivator is already on a 妖兽 within sight (see
 *      `stickyTarget`)
 *   3. movement, at `ZONE_MOVE_UNITS_PER_SEC`
 *   4. actions — one action is one "round": +15 灵力, the 4-slot rotation,
 *      `rollDamage`, then this actor's own cooldowns and modifiers tick down
 *   5. flag and dirty bookkeeping
 *
 * Rewards are deliberately *not* computed here. A step reports what died and
 * who did the damage; turning that into 修为, 灵石 and drops is the service's
 * job, because only the service can read and write a character row.
 */

import type { MainTreasureCombat } from '../domain/progression.js';
import {
  createTreasureRuntime,
  stepTreasure,
  absorbTreasureShield,
  treasureAttackBonus,
  type TreasureRuntime,
} from '../combat/treasure.js';
import type { Rng } from '../core/rng.js';
import { createRng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import type { ArtId } from '../core/art.js';
import type { Skill } from '../domain/skill.js';
import type { Stats } from '../domain/stats.js';
import type { Zone, ZoneArea, ZonePoint } from '../domain/zone.js';
import { effectiveStat, rollDamage, type StatModifier } from '../combat/damage.js';
import { BASIC_ATTACK_POWER, COMBAT_MANA_MAX, COMBAT_MANA_REGEN } from '../combat/types.js';
import { SKILL_BY_ID } from '../content/skills.js';
import { MONSTER_BY_ID } from '../content/monsters.js';
import {
  MONSTER_SPRITE,
  ZONE_ACTION_MS,
  ZONE_AOE_MAX,
  ZONE_AOE_RADIUS,
  ZONE_ATTACK_RANGE,
  ZONE_BOSS_LOOT_SHARE_TOP,
  ZONE_CASTER_RANGE,
  ZONE_LEASH,
  ZONE_MOVE_UNITS_PER_SEC,
  ZONE_PVP_PROTECT_MS,
  ZONE_PVP_STAGE_WINDOW,
  ZONE_SEEK_RADIUS,
} from '../content/zones.js';
import {
  ZONE_FLAGS,
  ZONE_PULSE_FLAGS,
  type ZoneEntityKind,
  type ZoneEntityTuple,
  type ZoneEvent,
  type ZoneFrame,
  type ZoneRosterEntry,
} from '../protocol/zone.js';

/** Steps a single `stepZone` call will simulate before it gives up catching up. */
export const ZONE_MAX_CATCHUP_STEPS = 8;
/** Ticks between two forced re-evaluations of a still-valid target. */
export const ZONE_RETARGET_TICKS = 8;
/**
 * A 妖兽 locked by this many cultivators is deprioritised, so packs spread out.
 *
 * Two, not three: a cultivator walking toward an untouched 妖兽 has not
 * claimed it yet (see `claimedByOther`), so at three the pair that converged on
 * the same wolf simply raced, and the loser walked on to the next one and lost
 * that race too. Measured on a 36-bot 青云山, dropping it to two took a fresh
 * 练气 player from 2–6 kills a minute to a steady 4–6 and cut its `moving`
 * frames from a third of the round to a quarter.
 */
export const ZONE_CROWD_LOCKS = 2;
/**
 * Distance penalty on a 妖兽 another cultivator has already claimed.
 *
 * Claiming is "locked on and bloodied": that cultivator's `targetI` is this
 * 妖兽 and its `lastHitBy` points back. At twice the sight radius, an unclaimed
 * 妖兽 anywhere in sight beats a claimed one underfoot, and a claimed one is
 * picked only when the field really has nothing else — which is what makes the
 * map read as 各打各的 rather than forty cultivators queuing behind one wolf.
 */
export const ZONE_CLAIMED_PENALTY = ZONE_SEEK_RADIUS * 2;
/**
 * Cells within which a living BOSS outranks every 妖兽 on the field.
 *
 * The BOSS is one 妖兽 among dozens and almost never the nearest, so it simply
 * stood in its clearing: two 150-second observations at `bossIntervalMinutes`
 * 1 saw nobody walk up to 青云虎王 at all. Anyone in the northern half who is
 * up to it (`ZONE_BOSS_CALL_STAGES`) drops what it is doing; further out it is
 * merely attractive, at `ZONE_BOSS_PULL`. The entrance crowd is 70 cells away
 * and carries on farming, which is what keeps the low band from emptying every
 * time a BOSS appears.
 */
export const ZONE_BOSS_CALL = 30;
/** Weight on the distance to a BOSS standing beyond `ZONE_BOSS_CALL`. */
export const ZONE_BOSS_PULL = 0.35;
/**
 * 境界 a cultivator may trail the BOSS by and still hear its call.
 *
 * The call is an invitation to a fight, and a 练气·前期 newcomer has no place
 * in it: 青云虎王 is 筑基·中期 with 1216 气血 and stands seventy cells north of
 * the gate. On a crowded field it would answer anyway — with every wolf at the
 * entrance claimed, `ZONE_CLAIMED_PENALTY` on a wolf underfoot (31) is more
 * than the clearing at `ZONE_BOSS_PULL` (24.5) — and walk half the map to die.
 * Below the threshold the BOSS is not a target at all. Being mauled by one
 * still is.
 */
export const ZONE_BOSS_CALL_STAGES = 2;

export const ZONE_ENTITY_STATES = [
  'idle',
  'seeking',
  'moving',
  'attacking',
  'returning',
  'dead',
] as const;
export type ZoneEntityState = (typeof ZONE_ENTITY_STATES)[number];

/** The slice of `WorldSettings` the simulation actually reads. */
export interface ZoneRules {
  tickMs: number;
  mapPvp: boolean;
  mapPvpStoneLoss: number;
  mapDeathRespawnSec: number;
  monsterDensity: number;
  respawnMultiplier: number;
  bossIntervalMinutes: number;
}

/** One occupant of the field. Slots are recycled, so `i` is not an identity. */
export interface ZoneEntity {
  /** Slot in `ZoneSim.entities`. */
  i: number;
  /** `characterId` for cultivators, `m:<slot>` for 妖兽. */
  id: string;
  kind: ZoneEntityKind;
  name: string;
  art: ArtId | null;
  stageIndex: number;
  stats: Stats;
  /** Up to four 神通 ids, cast in rotation order. */
  skills: string[];
  mainTreasure?: MainTreasureCombat;
  treasureRuntime?: TreasureRuntime;
  /** Content id behind a 妖兽/BOSS; null for cultivators. */
  monsterId: string | null;

  x: number;
  y: number;
  hp: number;
  maxHp: number;

  state: ZoneEntityState;
  /** Slot being fought, or -1. */
  targetI: number;
  /** Spawn anchor: the 妖兽's post, the cultivator's entrance. */
  home: ZonePoint;
  /** Index into `Zone.spawns` for a 妖兽; -1 for cultivators and the BOSS. */
  spawnGroup: number;
  /** Reach, in cells. Melee, or `ZONE_CASTER_RANGE` for an AoE kit. */
  range: number;

  nextActionAt: number;
  mana: number;
  /** Rotation pointer into `skills`. */
  rotation: number;
  /** Remaining cooldown per skill, in *actions*, aligned with `skills`. */
  cooldowns: number[];
  /** Active modifiers, counted down in actions rather than seconds. */
  modifiers: { stat: keyof Stats; amount: number; actions: number; source?: string }[];

  respawnAt: number;
  protectedUntil: number;
  online: boolean;
  /** Odds this cultivator opens a PvP fight on any given re-target. */
  aggression: number;
  lastHitAt: number;
  /** Slot of the last attacker, or -1. Drives retaliation. */
  lastHitBy: number;
  /** Damage suffered per attacker slot, for splitting a BOSS's spoils. */
  damageTaken: Map<number, number>;

  dirty: boolean;
  flags: number;
  /** 神通 slot cast in the current frame window; -1 for 普攻 or no action. */
  skillSlot: number;
}

/** Bookkeeping for one of the zone's spawn points. */
export interface ZoneSpawnState {
  /** Index into `Zone.spawns`. */
  spawn: number;
  /** Slots this point's 妖兽 occupy, in creation order. */
  slots: number[];
  /** Respawn delay in ms, after `respawnMultiplier`. */
  respawnMs: number;
}

export interface ZoneSim {
  zone: Zone;
  rules: ZoneRules;
  /** Simulated clock, epoch ms. Advanced only by `stepZone`. */
  now: number;
  tick: number;
  /** Last frame number emitted by `buildFrame`. */
  seq: number;
  entities: (ZoneEntity | null)[];
  /** Recycled slots, newest first. */
  free: number[];
  bossI: number | null;
  nextBossAt: number;
  rng: Rng;
  pendingAdds: ZoneRosterEntry[];
  pendingRemoves: number[];
  pendingEvents: ZoneEvent[];
  spawnTimers: ZoneSpawnState[];
}

export interface ZoneKill {
  killerI: number;
  victimI: number;
  victimKind: ZoneEntityKind;
  /** Present for 妖兽/BOSS victims. */
  monsterId?: string;
  isBoss: boolean;
  /** `[slot, share]`, share summing to 1, biggest first, top contributors only. */
  damageShares: [number, number][];
}

export interface ZoneDeathRecord {
  victimI: number;
  /** -1 when nothing identifiable landed the blow. */
  killerI: number;
  killerKind: ZoneEntityKind | null;
  respawnAt: number;
}

export interface ZonePvpKill {
  killerI: number;
  victimI: number;
}

export interface ZoneStepOutput {
  kills: ZoneKill[];
  deaths: ZoneDeathRecord[];
  pvpKills: ZonePvpKill[];
  bossSpawned: boolean;
  bossSlain: boolean;
}

export interface AddCultivatorInput {
  id: string;
  kind: 'player' | 'bot';
  name: string;
  art: ArtId | null;
  stageIndex: number;
  stats: Stats;
  skills: readonly (string | null)[];
  mainTreasure?: MainTreasureCombat;
  /** Current 气血 as a fraction of the ceiling, i.e. `CharacterState.hpPercent`. */
  hpShare: number;
  online: boolean;
  /** 0 = only ever fights back; 1 = opens every fight it can. */
  aggression: number;
}

export interface RefreshCultivatorInput {
  stats: Stats;
  skills: readonly (string | null)[];
  mainTreasure?: MainTreasureCombat;
  stageIndex: number;
  maxHp: number;
}

// --------------------------------------------------------------------- helpers

function emptyOutput(): ZoneStepOutput {
  return { kills: [], deaths: [], pvpKills: [], bossSpawned: false, bossSlain: false };
}

function isBeast(kind: ZoneEntityKind): boolean {
  return kind === 'monster' || kind === 'boss';
}

/** Two entities are enemies when exactly one of them is a 妖兽. */
function sameSide(a: ZoneEntity, b: ZoneEntity): boolean {
  return isBeast(a.kind) === isBeast(b.kind);
}

function distance(a: ZoneEntity, b: ZoneEntity): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceTo(e: ZoneEntity, p: ZonePoint): number {
  const dx = e.x - p.x;
  const dy = e.y - p.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointInArea(area: ZoneArea, rng: Rng): ZonePoint {
  return { x: area.x + rng.range(0, area.w), y: area.y + rng.range(0, area.h) };
}

function clampToZone(zone: Zone, p: ZonePoint): ZonePoint {
  return { x: clamp(p.x, 0, zone.width), y: clamp(p.y, 0, zone.height) };
}

/** A cultivator lands near the gate rather than exactly on it, to avoid a pile. */
function entrancePoint(zone: Zone, rng: Rng): ZonePoint {
  return clampToZone(zone, {
    x: zone.entrance.x + rng.range(-3, 3),
    y: zone.entrance.y + rng.range(-2, 2),
  });
}

function skillOf(id: string | undefined): Skill | undefined {
  return id === undefined ? undefined : SKILL_BY_ID.get(id);
}

/**
 * Reach: an AoE kit fights from `ZONE_CASTER_RANGE`, everything else closes to
 * melee. Derived from the skill list rather than the 妖兽's internal profile,
 * which the content tables do not expose.
 */
function reachOf(skills: readonly string[]): number {
  for (const id of skills) {
    if (skillOf(id)?.target === 'all_enemies') return ZONE_CASTER_RANGE;
  }
  return ZONE_ATTACK_RANGE;
}

/** Milliseconds between two actions, faster for higher 速度. */
export function actionIntervalMs(e: ZoneEntity): number {
  const spd = effectiveStat(e.stats, e.modifiers, 'spd');
  return ZONE_ACTION_MS * clamp(1 - (spd - 10) / 200, 0.6, 1.4);
}

function markDirty(e: ZoneEntity): void {
  e.dirty = true;
}

function rosterEntry(e: ZoneEntity): ZoneRosterEntry {
  return {
    i: e.i,
    id: e.id,
    kind: e.kind,
    name: e.name,
    art: e.art,
    stageIndex: e.stageIndex,
    maxHp: e.maxHp,
    ...(e.mainTreasure ? { mainTreasure: e.mainTreasure } : {}),
  };
}

/** Queues a roster row. A repeat for a known slot replaces the client's copy. */
function queueAdd(sim: ZoneSim, e: ZoneEntity): void {
  const at = sim.pendingAdds.findIndex((entry) => entry.i === e.i);
  if (at >= 0) sim.pendingAdds[at] = rosterEntry(e);
  else sim.pendingAdds.push(rosterEntry(e));
}

function queueRemove(sim: ZoneSim, i: number): void {
  const added = sim.pendingAdds.findIndex((entry) => entry.i === i);
  // Arrived and left inside one frame window: the client never knew about it.
  if (added >= 0) {
    sim.pendingAdds.splice(added, 1);
    return;
  }
  if (!sim.pendingRemoves.includes(i)) sim.pendingRemoves.push(i);
}

function entityAt(sim: ZoneSim, i: number): ZoneEntity | null {
  if (i < 0 || i >= sim.entities.length) return null;
  return sim.entities[i] ?? null;
}

function livingAt(sim: ZoneSim, i: number): ZoneEntity | null {
  const e = entityAt(sim, i);
  return e && e.state !== 'dead' ? e : null;
}

function takeSlot(sim: ZoneSim): number {
  const reused = sim.free.pop();
  if (reused !== undefined) return reused;
  sim.entities.push(null);
  return sim.entities.length - 1;
}

/** Drops every reference to a slot, so a recycled index is never mistaken. */
function forgetSlot(sim: ZoneSim, i: number): void {
  for (const other of sim.entities) {
    if (!other) continue;
    if (other.targetI === i) {
      other.targetI = -1;
      markDirty(other);
    }
    if (other.lastHitBy === i) other.lastHitBy = -1;
    other.damageTaken.delete(i);
  }
}

function spawnDelayMs(sim: ZoneSim, group: number): number {
  const timer = sim.spawnTimers[group];
  if (timer) return timer.respawnMs;
  const spawn = sim.zone.spawns[group];
  return Math.max(1000, Math.round((spawn?.respawnSec ?? 30) * 1000 * sim.rules.respawnMultiplier));
}

function bossIntervalMs(rules: ZoneRules): number {
  return Math.max(60_000, Math.round(rules.bossIntervalMinutes * 60_000));
}

/** Cultivators a zone currently holds, alive or waiting to respawn. */
export function zoneCultivatorCount(sim: ZoneSim): number {
  let n = 0;
  for (const e of sim.entities) if (e && !isBeast(e.kind)) n += 1;
  return n;
}

export function zonePlayerCount(sim: ZoneSim): number {
  let n = 0;
  for (const e of sim.entities) if (e && e.kind === 'player') n += 1;
  return n;
}

export function zoneBotCount(sim: ZoneSim): number {
  let n = 0;
  for (const e of sim.entities) if (e && e.kind === 'bot') n += 1;
  return n;
}

export function zoneMonsterCount(sim: ZoneSim): number {
  let n = 0;
  for (const e of sim.entities) if (e && isBeast(e.kind) && e.state !== 'dead') n += 1;
  return n;
}

export function findEntityById(sim: ZoneSim, id: string): ZoneEntity | null {
  for (const e of sim.entities) if (e && e.id === id) return e;
  return null;
}

/** Queues a client-facing event the simulation cannot derive on its own. */
export function pushZoneEvent(sim: ZoneSim, event: ZoneEvent): void {
  sim.pendingEvents.push(event);
}

// ------------------------------------------------------------------- creation

function makeMonster(
  sim: ZoneSim,
  slot: number,
  monsterId: string,
  kind: 'monster' | 'boss',
  spawnGroup: number,
  at: ZonePoint,
): ZoneEntity {
  const monster = MONSTER_BY_ID.get(monsterId);
  if (!monster) throw new Error(`createZoneSim: unknown monster "${monsterId}"`);
  const skills = monster.skills.slice(0, 4);
  const maxHp = Math.max(1, Math.round(monster.stats.hp));
  return {
    i: slot,
    id: `m:${slot}`,
    kind,
    name: monster.name,
    art: MONSTER_SPRITE[monsterId] ?? monster.art,
    stageIndex: monster.stageIndex,
    stats: monster.stats,
    skills,
    monsterId,
    x: at.x,
    y: at.y,
    hp: maxHp,
    maxHp,
    state: 'idle',
    targetI: -1,
    home: { x: at.x, y: at.y },
    spawnGroup,
    range: reachOf(skills),
    nextActionAt: sim.now,
    mana: COMBAT_MANA_MAX,
    rotation: 0,
    cooldowns: new Array<number>(skills.length).fill(0),
    modifiers: [],
    respawnAt: 0,
    protectedUntil: 0,
    online: true,
    aggression: 0,
    lastHitAt: 0,
    lastHitBy: -1,
    damageTaken: new Map<number, number>(),
    dirty: true,
    flags: 0,
    skillSlot: -1,
  };
}

/**
 * Builds a zone, fills every spawn point and schedules the first BOSS.
 *
 * Populations are `count x monsterDensity`, rounded and never below one, so
 * turning the density down thins a map without ever emptying it.
 */
export function createZoneSim(zone: Zone, rules: ZoneRules, seed: number, now: number): ZoneSim {
  const sim: ZoneSim = {
    zone,
    rules,
    now,
    tick: 0,
    seq: 0,
    entities: [],
    free: [],
    bossI: null,
    nextBossAt: now + bossIntervalMs(rules),
    rng: createRng(seed),
    pendingAdds: [],
    pendingRemoves: [],
    pendingEvents: [],
    spawnTimers: [],
  };

  for (const [group, spawn] of zone.spawns.entries()) {
    const target = Math.max(1, Math.round(spawn.count * rules.monsterDensity));
    const state: ZoneSpawnState = {
      spawn: group,
      slots: [],
      respawnMs: Math.max(1000, Math.round(spawn.respawnSec * 1000 * rules.respawnMultiplier)),
    };
    sim.spawnTimers.push(state);
    for (let n = 0; n < target; n += 1) {
      const slot = takeSlot(sim);
      const at = pointInArea(spawn.area, sim.rng);
      const monster = makeMonster(sim, slot, spawn.monsterId, 'monster', group, at);
      sim.entities[slot] = monster;
      state.slots.push(slot);
      queueAdd(sim, monster);
    }
  }

  return sim;
}

/** Puts a cultivator on the field at the entrance and returns its entity. */
export function addCultivator(sim: ZoneSim, input: AddCultivatorInput): ZoneEntity {
  const slot = takeSlot(sim);
  const at = entrancePoint(sim.zone, sim.rng);
  const skills = input.skills
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, 4);
  const maxHp = Math.max(1, Math.round(input.stats.hp));
  const entity: ZoneEntity = {
    i: slot,
    id: input.id,
    kind: input.kind,
    name: input.name,
    art: input.art,
    stageIndex: input.stageIndex,
    stats: input.stats,
    skills,
    monsterId: null,
    x: at.x,
    y: at.y,
    hp: clamp(Math.round(maxHp * input.hpShare), 1, maxHp),
    maxHp,
    state: 'idle',
    targetI: -1,
    home: { x: sim.zone.entrance.x, y: sim.zone.entrance.y },
    spawnGroup: -1,
    range: reachOf(skills),
    nextActionAt: sim.now,
    ...(input.mainTreasure
      ? { mainTreasure: input.mainTreasure, treasureRuntime: createTreasureRuntime(sim.now) }
      : {}),
    mana: COMBAT_MANA_MAX,
    rotation: 0,
    cooldowns: new Array<number>(skills.length).fill(0),
    modifiers: [],
    respawnAt: 0,
    // Arriving grants the same grace a respawn does, so nobody is farmed at the gate.
    protectedUntil: sim.now + ZONE_PVP_PROTECT_MS,
    online: input.online,
    aggression: clamp(input.aggression, 0, 1),
    lastHitAt: 0,
    lastHitBy: -1,
    damageTaken: new Map<number, number>(),
    dirty: true,
    flags: 0,
    skillSlot: -1,
  };
  sim.entities[slot] = entity;
  queueAdd(sim, entity);
  return entity;
}

export function removeEntity(sim: ZoneSim, i: number): void {
  const e = entityAt(sim, i);
  if (!e) return;
  sim.entities[i] = null;
  sim.free.push(i);
  if (sim.bossI === i) sim.bossI = null;
  const timer = e.spawnGroup >= 0 ? sim.spawnTimers[e.spawnGroup] : undefined;
  if (timer) {
    const at = timer.slots.indexOf(i);
    if (at >= 0) timer.slots.splice(at, 1);
  }
  forgetSlot(sim, i);
  queueRemove(sim, i);
}

/** Flips a player's presence. Offline cultivators keep fighting 妖兽 but cannot be attacked. */
export function setOnline(sim: ZoneSim, i: number, online: boolean): void {
  const e = entityAt(sim, i);
  if (!e || e.online === online) return;
  e.online = online;
  markDirty(e);
  if (online) return;
  // An offline player stops being a legal PvP target immediately.
  for (const other of sim.entities) {
    if (!other || isBeast(other.kind)) continue;
    if (other.targetI === i) {
      other.targetI = -1;
      markDirty(other);
    }
  }
}

/** Swaps in fresh world settings, reconciling anything already on the field. */
export function setRules(sim: ZoneSim, rules: ZoneRules): void {
  const previous = sim.rules;
  sim.rules = rules;

  if (previous.mapPvp && !rules.mapPvp) {
    for (const e of sim.entities) {
      if (!e || isBeast(e.kind)) continue;
      const target = entityAt(sim, e.targetI);
      if (target && !isBeast(target.kind)) {
        e.targetI = -1;
        e.lastHitBy = -1;
        markDirty(e);
      }
    }
  }

  if (previous.bossIntervalMinutes !== rules.bossIntervalMinutes && sim.bossI === null) {
    sim.nextBossAt = sim.now + bossIntervalMs(rules);
  }

  for (const [group, spawn] of sim.zone.spawns.entries()) {
    const timer = sim.spawnTimers[group];
    if (!timer) continue;
    timer.respawnMs = Math.max(1000, Math.round(spawn.respawnSec * 1000 * rules.respawnMultiplier));
    const target = Math.max(1, Math.round(spawn.count * rules.monsterDensity));
    while (timer.slots.length > target) {
      const slot = timer.slots[timer.slots.length - 1];
      if (slot === undefined) break;
      removeEntity(sim, slot);
    }
    while (timer.slots.length < target) {
      const slot = takeSlot(sim);
      const monster = makeMonster(
        sim,
        slot,
        spawn.monsterId,
        'monster',
        group,
        pointInArea(spawn.area, sim.rng),
      );
      sim.entities[slot] = monster;
      timer.slots.push(slot);
      queueAdd(sim, monster);
    }
  }
}

/** Re-reads a cultivator after a settle or a gear change; 气血 scales pro rata. */
export function refreshCultivator(sim: ZoneSim, i: number, input: RefreshCultivatorInput): void {
  const e = entityAt(sim, i);
  if (!e || isBeast(e.kind)) return;
  const share = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  const maxHp = Math.max(1, Math.round(input.maxHp));
  e.stats = input.stats;
  if (input.mainTreasure) {
    if (e.mainTreasure?.definitionId !== input.mainTreasure.definitionId)
      e.treasureRuntime = createTreasureRuntime(sim.now);
    e.mainTreasure = input.mainTreasure;
  } else {
    delete e.mainTreasure;
    delete e.treasureRuntime;
  }
  e.stageIndex = input.stageIndex;
  e.skills = input.skills
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, 4);
  e.range = reachOf(e.skills);
  e.cooldowns = new Array<number>(e.skills.length).fill(0);
  e.rotation = 0;
  e.maxHp = maxHp;
  e.hp = e.state === 'dead' ? 0 : clamp(Math.round(maxHp * share), 1, maxHp);
  markDirty(e);
  // `maxHp` and 境界 live in the roster row, so the client needs a fresh one.
  queueAdd(sim, e);
}

// -------------------------------------------------------------------- stepping

/** True when `victim` may legally be struck by `actor` in a PvP exchange. */
function pvpEligible(sim: ZoneSim, actor: ZoneEntity, victim: ZoneEntity): boolean {
  if (victim.i === actor.i || victim.state === 'dead') return false;
  if (isBeast(victim.kind)) return false;
  // An offline player is scenery: it farms, but nobody may touch it.
  if (!victim.online && victim.kind === 'player') return false;
  if (victim.protectedUntil > sim.now) return false;
  return Math.abs(victim.stageIndex - actor.stageIndex) <= ZONE_PVP_STAGE_WINDOW;
}

function countLocks(sim: ZoneSim): number[] {
  const locks = new Array<number>(sim.entities.length).fill(0);
  for (const e of sim.entities) {
    if (!e || e.state === 'dead' || isBeast(e.kind)) continue;
    if (e.targetI >= 0 && e.targetI < locks.length) {
      locks[e.targetI] = (locks[e.targetI] ?? 0) + 1;
    }
  }
  return locks;
}

/**
 * True when another living cultivator has this 妖兽 to itself.
 *
 * Kills are credited to the last blow, so a 妖兽 someone else has bloodied and
 * is still locked onto is somebody's kill in progress. A BOSS is never claimed:
 * it is meant to be mobbed, and its spoils are split across the top five.
 */
function claimedByOther(sim: ZoneSim, actor: ZoneEntity, beast: ZoneEntity): boolean {
  if (beast.kind === 'boss') return false;
  const owner = beast.lastHitBy;
  if (owner < 0 || owner === actor.i) return false;
  const holder = livingAt(sim, owner);
  return holder !== null && !isBeast(holder.kind) && holder.targetI === beast.i;
}

/**
 * The living BOSS this cultivator answers to, or null.
 *
 * Anyone within `ZONE_BOSS_CALL_STAGES` 阶 of it is invited. Anyone below that
 * only ever fights it once it has drawn blood — the difference between being
 * called and being hunted.
 */
function bossHeardBy(sim: ZoneSim, actor: ZoneEntity): ZoneEntity | null {
  if (sim.bossI === null || isBeast(actor.kind)) return null;
  const boss = livingAt(sim, sim.bossI);
  if (boss === null) return null;
  if (actor.lastHitBy === boss.i) return boss;
  return actor.stageIndex >= boss.stageIndex - ZONE_BOSS_CALL_STAGES ? boss : null;
}

/** How far away the BOSS counts as being, once its call is priced in. */
function bossReach(actor: ZoneEntity, boss: ZoneEntity): number {
  const d = distance(actor, boss);
  return d <= ZONE_BOSS_CALL ? 0 : d * ZONE_BOSS_PULL;
}

/**
 * The 妖兽 to walk to: the best one within sight, the nearest on the map when
 * sight holds nothing living, and the BOSS whenever its call outbids them.
 *
 * The two rings exist because the penalties add up. A claimed wolf one cell
 * away scores 29, so scoring the whole map at once let a free 妖兽 forty cells
 * north — or a BOSS seventy cells north at `ZONE_BOSS_PULL` — win it, and a
 * busy entrance band sent its newcomers hiking instead of fighting. Crowding
 * and claims now only break ties among the 妖兽 already in sight; they can no
 * longer promote one that is out of it.
 */
function pickBeast(sim: ZoneSim, actor: ZoneEntity, locks: number[]): number {
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let far = -1;
  let farDist = Number.POSITIVE_INFINITY;
  for (const other of sim.entities) {
    if (!other || other.state === 'dead' || !isBeast(other.kind)) continue;
    // The BOSS is not part of either ring: it is judged by its own call.
    if (other.i === sim.bossI) continue;
    const d = distance(actor, other);
    if (d > ZONE_SEEK_RADIUS) {
      if (d < farDist) {
        farDist = d;
        far = other.i;
      }
      continue;
    }
    const crowded = (locks[other.i] ?? 0) >= ZONE_CROWD_LOCKS;
    const score =
      d +
      (crowded ? ZONE_SEEK_RADIUS * 0.5 : 0) +
      (claimedByOther(sim, actor, other) ? ZONE_CLAIMED_PENALTY : 0);
    if (score < bestScore) {
      bestScore = score;
      best = other.i;
    }
  }
  if (best < 0) {
    best = far;
    bestScore = farDist;
  }

  const boss = bossHeardBy(sim, actor);
  if (boss !== null) {
    const crowded = (locks[boss.i] ?? 0) >= ZONE_CROWD_LOCKS;
    const score = bossReach(actor, boss) + (crowded ? ZONE_SEEK_RADIUS * 0.5 : 0);
    if (best < 0 || score < bestScore) return boss.i;
  }
  return best;
}

/** Nearest cultivator inside `ZONE_SEEK_RADIUS` this one is allowed to attack. */
function pickRival(sim: ZoneSim, actor: ZoneEntity): number {
  let best = -1;
  let bestDist = ZONE_SEEK_RADIUS;
  for (const other of sim.entities) {
    if (!other || !pvpEligible(sim, actor, other)) continue;
    const d = distance(actor, other);
    if (d < bestDist) {
      bestDist = d;
      best = other.i;
    }
  }
  return best;
}

function chooseTarget(sim: ZoneSim, e: ZoneEntity, locks: number[]): void {
  if (isBeast(e.kind)) {
    // A 妖兽 has no ambitions: it hits back, and only while near its post.
    // One already walking home ignores everything until it gets there.
    const attacker = e.state === 'returning' ? null : livingAt(sim, e.lastHitBy);
    if (attacker && !isBeast(attacker.kind) && distanceTo(e, e.home) <= ZONE_LEASH) {
      e.targetI = attacker.i;
      return;
    }
    e.targetI = -1;
    return;
  }

  // Being hit by another cultivator overrides everything: you fight back.
  const aggressor = livingAt(sim, e.lastHitBy);
  if (aggressor && !isBeast(aggressor.kind) && sim.rules.mapPvp && aggressor.state !== 'dead') {
    e.targetI = aggressor.i;
    return;
  }

  if (sim.rules.mapPvp && sim.rng.chance(e.aggression)) {
    const rival = pickRival(sim, e);
    if (rival >= 0) {
      e.targetI = rival;
      return;
    }
  }

  e.targetI = pickBeast(sim, e, locks);
}

function respawnPhase(sim: ZoneSim, out: ZoneStepOutput): void {
  for (const e of sim.entities) {
    if (!e || e.state !== 'dead' || e.respawnAt > sim.now) continue;
    if (isBeast(e.kind)) {
      const spawn = sim.zone.spawns[e.spawnGroup];
      const at = spawn ? pointInArea(spawn.area, sim.rng) : { x: e.home.x, y: e.home.y };
      e.x = at.x;
      e.y = at.y;
      e.home = { x: at.x, y: at.y };
    } else {
      const at = entrancePoint(sim.zone, sim.rng);
      e.x = at.x;
      e.y = at.y;
      e.protectedUntil = sim.now + ZONE_PVP_PROTECT_MS;
    }
    e.hp = e.maxHp;
    e.state = 'idle';
    e.targetI = -1;
    e.lastHitBy = -1;
    e.mana = COMBAT_MANA_MAX;
    e.rotation = 0;
    e.cooldowns = new Array<number>(e.skills.length).fill(0);
    e.modifiers = [];
    e.damageTaken.clear();
    e.respawnAt = 0;
    e.nextActionAt = sim.now + actionIntervalMs(e);
    if (e.mainTreasure) e.treasureRuntime = createTreasureRuntime(sim.now);
    markDirty(e);
  }

  if (sim.bossI === null && sim.nextBossAt <= sim.now) {
    const slot = takeSlot(sim);
    const at = pointInArea(sim.zone.boss.area, sim.rng);
    const boss = makeMonster(sim, slot, sim.zone.boss.monsterId, 'boss', -1, at);
    sim.entities[slot] = boss;
    sim.bossI = slot;
    queueAdd(sim, boss);
    sim.pendingEvents.push({ t: 'boss_spawn', i: slot });
    out.bossSpawned = true;
  }
}

/**
 * True when a cultivator should keep the 妖兽 it is already fighting through a
 * forced re-target.
 *
 * Without this every cultivator on the field re-picked by distance every two
 * seconds, so a 妖兽 that died — or merely someone else standing a step closer
 * to another one — sent whole packs walking. Measured on a 200-bot world, a
 * fresh 练气 player spent 60–95% of its frames in `moving` and landed three
 * kills a minute, because it kept being pulled off a wolf it had half killed.
 *
 * Two things still break the hold: a rival's blow, which must be answered, and
 * a BOSS this cultivator can hear (`bossHeardBy`) whose weighted distance
 * already beats the current target's — exactly the comparison `pickBeast` is
 * about to make.
 */
function stickyTarget(sim: ZoneSim, e: ZoneEntity, target: ZoneEntity): boolean {
  if (isBeast(e.kind) || !isBeast(target.kind)) return false;
  if (distance(e, target) > ZONE_SEEK_RADIUS) return false;
  if (sim.rules.mapPvp) {
    const aggressor = livingAt(sim, e.lastHitBy);
    if (aggressor && !isBeast(aggressor.kind)) return false;
  }
  if (target.i !== sim.bossI) {
    const boss = bossHeardBy(sim, e);
    if (boss !== null && bossReach(e, boss) < distance(e, target)) return false;
  }
  return true;
}

function targetPhase(sim: ZoneSim): void {
  const forced = sim.tick % ZONE_RETARGET_TICKS === 0;
  let locks: number[] | null = null;
  for (const e of sim.entities) {
    if (!e || e.state === 'dead') continue;
    const target = livingAt(sim, e.targetI);
    const stale =
      target === null ||
      (isBeast(e.kind) && !isBeast(target.kind) && distanceTo(e, e.home) > ZONE_LEASH) ||
      (!isBeast(e.kind) && !isBeast(target.kind) && !sim.rules.mapPvp);
    if (!stale && !forced) continue;
    if (!stale && target !== null && stickyTarget(sim, e, target)) continue;
    locks ??= countLocks(sim);
    const before = e.targetI;
    chooseTarget(sim, e, locks);
    if (e.targetI !== before) {
      // Keep the tally honest as the pass proceeds, so two cultivators choosing
      // in the same phase see each other's pick rather than the same empty map.
      if (before >= 0 && before < locks.length)
        locks[before] = Math.max(0, (locks[before] ?? 0) - 1);
      if (e.targetI >= 0 && e.targetI < locks.length) {
        locks[e.targetI] = (locks[e.targetI] ?? 0) + 1;
      }
      markDirty(e);
    }
  }
}

function movePhase(sim: ZoneSim, dtMs: number): void {
  const step = (ZONE_MOVE_UNITS_PER_SEC * dtMs) / 1000;
  for (const e of sim.entities) {
    if (!e || e.state === 'dead') continue;

    // A 妖兽 dragged off its post walks all the way back — not merely to the
    // edge of its leash — and heals up on arrival. Nothing distracts it on the
    // way, which is what stops a pack being kited across the whole map.
    if (isBeast(e.kind)) {
      if (distanceTo(e, e.home) > ZONE_LEASH) e.state = 'returning';
      if (e.state === 'returning') {
        e.targetI = -1;
        e.lastHitBy = -1;
        moveToward(sim, e, e.home, step);
        if (distanceTo(e, e.home) <= 0.5) {
          e.state = 'idle';
          // A 妖兽 that shook off its pursuers is whole again — but a BOSS
          // keeps its wounds and its damage ledger. It is fought by a thin
          // stream of cultivators walking up from the south, so a full heal on
          // every trip home made it unkillable: one offline run took 430 秒 and
          // three resets. The ledger has to survive too, or the top-5 loot
          // shares are wiped along with the 气血.
          if (e.kind !== 'boss') {
            e.hp = e.maxHp;
            e.damageTaken.clear();
          }
        }
        markDirty(e);
        continue;
      }
    }

    const target = livingAt(sim, e.targetI);
    if (!target) {
      if (e.state !== 'idle' && e.state !== 'seeking') markDirty(e);
      e.state = isBeast(e.kind) ? 'idle' : 'seeking';
      continue;
    }

    const gap = distance(e, target);
    if (gap > e.range) {
      e.state = 'moving';
      moveToward(sim, e, target, step);
      markDirty(e);
    } else if (e.state !== 'attacking') {
      e.state = 'attacking';
      markDirty(e);
    }
  }
}

function moveToward(sim: ZoneSim, e: ZoneEntity, to: ZonePoint, step: number): void {
  const dx = to.x - e.x;
  const dy = to.y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 1e-6) return;
  const travel = Math.min(step, d);
  e.x = clamp(e.x + (dx / d) * travel, 0, sim.zone.width);
  e.y = clamp(e.y + (dy / d) * travel, 0, sim.zone.height);
}

function modifiersOf(e: ZoneEntity, now: number): readonly StatModifier[] {
  return [...e.modifiers, { stat: 'atk', amount: treasureAttackBonus(e.treasureRuntime, now) }];
}

function applyModifiers(actor: ZoneEntity, target: ZoneEntity, skill: Skill): void {
  const modifier = skill.modifier;
  if (!modifier) return;
  for (const [stat, amount] of Object.entries(modifier.stats)) {
    if (typeof amount !== 'number' || amount === 0) continue;
    target.modifiers.push({
      stat: stat as keyof Stats,
      amount,
      actions: modifier.durationRounds,
    });
  }
  markDirty(target);
  markDirty(actor);
}

/** Collects the primary target plus splash, capped at `ZONE_AOE_MAX`. */
function splashTargets(sim: ZoneSim, actor: ZoneEntity, primary: ZoneEntity): ZoneEntity[] {
  const hit: ZoneEntity[] = [primary];
  for (const other of sim.entities) {
    if (!other || other.i === primary.i || other.i === actor.i) continue;
    if (other.state === 'dead' || sameSide(actor, other)) continue;
    if (!isBeast(other.kind) && !pvpEligible(sim, actor, other)) continue;
    if (distance(primary, other) > ZONE_AOE_RADIUS) continue;
    hit.push(other);
    if (hit.length >= ZONE_AOE_MAX) break;
  }
  return hit;
}

/** The most wounded friendly within splash range, the caster included. */
function pickAlly(sim: ZoneSim, actor: ZoneEntity): ZoneEntity {
  let best = actor;
  let bestShare = actor.hp / actor.maxHp;
  for (const other of sim.entities) {
    if (!other || other.i === actor.i || other.state === 'dead') continue;
    if (!sameSide(actor, other)) continue;
    if (distance(actor, other) > ZONE_AOE_RADIUS) continue;
    const share = other.hp / other.maxHp;
    if (share < bestShare) {
      bestShare = share;
      best = other;
    }
  }
  return best;
}

function recordDamage(victim: ZoneEntity, attacker: ZoneEntity, amount: number, now: number): void {
  victim.hp = Math.max(0, victim.hp - amount);
  victim.damageTaken.set(attacker.i, (victim.damageTaken.get(attacker.i) ?? 0) + amount);
  victim.lastHitBy = attacker.i;
  victim.lastHitAt = now;
  markDirty(victim);
}

function damageShares(victim: ZoneEntity): [number, number][] {
  let total = 0;
  for (const amount of victim.damageTaken.values()) total += amount;
  if (total <= 0) return [];
  const rows: [number, number][] = [...victim.damageTaken.entries()].map(([i, amount]) => [
    i,
    amount / total,
  ]);
  rows.sort((a, b) => (b[1] === a[1] ? a[0] - b[0] : b[1] - a[1]));
  return rows.slice(0, ZONE_BOSS_LOOT_SHARE_TOP);
}

function killEntity(
  sim: ZoneSim,
  victim: ZoneEntity,
  killer: ZoneEntity,
  out: ZoneStepOutput,
): void {
  const shares = damageShares(victim);
  victim.state = 'dead';
  victim.hp = 0;
  victim.targetI = -1;
  victim.flags |= ZONE_FLAGS.DEAD;
  markDirty(victim);

  if (isBeast(victim.kind)) {
    out.kills.push({
      killerI: killer.i,
      victimI: victim.i,
      victimKind: victim.kind,
      ...(victim.monsterId === null ? {} : { monsterId: victim.monsterId }),
      isBoss: victim.kind === 'boss',
      damageShares: shares,
    });
    if (victim.kind === 'boss') {
      out.bossSlain = true;
      sim.pendingEvents.push({ t: 'boss_slain', killerName: killer.name });
      sim.nextBossAt = sim.now + bossIntervalMs(sim.rules);
      // The BOSS leaves the field entirely; its slot goes back into the pool.
      removeEntity(sim, victim.i);
    } else {
      victim.respawnAt = sim.now + spawnDelayMs(sim, victim.spawnGroup);
      sim.pendingEvents.push({ t: 'kill', killer: killer.i, victim: victim.i });
    }
    return;
  }

  const respawnAt = sim.now + Math.max(1000, Math.round(sim.rules.mapDeathRespawnSec * 1000));
  victim.respawnAt = respawnAt;
  out.deaths.push({
    victimI: victim.i,
    killerI: killer.i,
    killerKind: killer.kind,
    respawnAt,
  });
  sim.pendingEvents.push({ t: 'death', victim: victim.i, respawnAt });
  if (!isBeast(killer.kind)) out.pvpKills.push({ killerI: killer.i, victimI: victim.i });
}

function strike(
  sim: ZoneSim,
  actor: ZoneEntity,
  target: ZoneEntity,
  power: number,
  out: ZoneStepOutput,
): void {
  const roll = rollDamage(
    { stats: actor.stats, modifiers: modifiersOf(actor, sim.now) },
    { stats: target.stats, modifiers: modifiersOf(target, sim.now) },
    power,
    sim.rng,
  );
  if (!roll.hit) {
    target.flags |= ZONE_FLAGS.DODGED;
    markDirty(target);
    return;
  }
  actor.flags |= roll.crit ? ZONE_FLAGS.HIT | ZONE_FLAGS.CRIT : ZONE_FLAGS.HIT;
  target.flags |= ZONE_FLAGS.HIT;
  markDirty(actor);
  recordDamage(target, actor, absorbTreasureShield(target.treasureRuntime, roll.damage), sim.now);
  if (target.hp <= 0 && target.state !== 'dead') killEntity(sim, target, actor, out);
}

/** One action is one "round": regen, rotation, effect, then a cooldown tick. */
function act(sim: ZoneSim, e: ZoneEntity, target: ZoneEntity, out: ZoneStepOutput): void {
  e.mana = Math.min(COMBAT_MANA_MAX, e.mana + COMBAT_MANA_REGEN);

  let chosen: Skill | null = null;
  let chosenSlot = -1;
  const slotCount = e.skills.length;
  for (let step = 0; step < slotCount; step += 1) {
    const slot = (e.rotation + step) % slotCount;
    const skill = skillOf(e.skills[slot]);
    if (!skill) continue;
    if ((e.cooldowns[slot] ?? 0) > 0) continue;
    if (skill.manaCost > e.mana) continue;
    chosen = skill;
    chosenSlot = slot;
    break;
  }

  if (chosen && chosenSlot >= 0) {
    e.mana -= chosen.manaCost;
    e.cooldowns[chosenSlot] = chosen.cooldown;
    e.rotation = (chosenSlot + 1) % slotCount;
    e.skillSlot = chosenSlot;
    e.flags |= ZONE_FLAGS.CASTING;

    let targets: ZoneEntity[];
    switch (chosen.target) {
      case 'all_enemies':
        targets = splashTargets(sim, e, target);
        break;
      case 'self':
        targets = [e];
        break;
      case 'ally':
        targets = [pickAlly(sim, e)];
        break;
      case 'enemy':
      default:
        targets = [target];
        break;
    }

    for (const hit of targets) {
      switch (chosen.type) {
        case 'damage':
          strike(sim, e, hit, chosen.power, out);
          break;
        case 'heal': {
          const atk = effectiveStat(e.stats, modifiersOf(e, sim.now), 'atk');
          const amount = Math.max(1, Math.round(Math.min(atk * chosen.power, hit.maxHp - hit.hp)));
          if (hit.hp < hit.maxHp) {
            hit.hp = Math.min(hit.maxHp, hit.hp + amount);
            markDirty(hit);
          }
          break;
        }
        case 'buff':
          applyModifiers(e, hit, chosen);
          break;
        case 'debuff':
          if (chosen.power > 0) strike(sim, e, hit, chosen.power, out);
          if (hit.state !== 'dead') applyModifiers(e, hit, chosen);
          break;
      }
    }
  } else {
    e.skillSlot = -1;
    strike(sim, e, target, BASIC_ATTACK_POWER, out);
  }

  // Cooldowns and modifiers are counted in actions, not seconds: a 3-round
  // 神通 is off cooldown after this actor has acted three more times, whatever
  // its 速度. That keeps a zone fight tuned the same way a 秘境 one is.
  for (let s = 0; s < e.cooldowns.length; s += 1) {
    e.cooldowns[s] = Math.max(0, (e.cooldowns[s] ?? 0) - 1);
  }
  if (e.modifiers.length > 0) {
    e.modifiers = e.modifiers
      .map((m) => ({ stat: m.stat, amount: m.amount, actions: m.actions - 1 }))
      .filter((m) => m.actions > 0);
  }

  e.nextActionAt = Math.max(e.nextActionAt, sim.now) + actionIntervalMs(e);
  markDirty(e);
}

function actPhase(sim: ZoneSim, out: ZoneStepOutput): void {
  for (const e of sim.entities) {
    if (!e || e.state === 'dead') continue;
    const target = livingAt(sim, e.targetI);
    if (!target) continue;
    if (distance(e, target) > e.range) continue;
    if (e.mainTreasure && e.treasureRuntime) {
      for (const effect of stepTreasure(e.mainTreasure, e.treasureRuntime, sim.now)) {
        if (effect.shieldFraction) {
          e.treasureRuntime.shield = Math.max(
            e.treasureRuntime.shield,
            Math.round(e.maxHp * effect.shieldFraction),
          );
          markDirty(e);
        }

        if (effect.power)
          for (const t of splashTargets(sim, e, target).slice(0, effect.targets))
            if (t.state !== 'dead') strike(sim, e, t, effect.power, out);
      }
    }
    if (e.nextActionAt > sim.now || target.state === 'dead') continue;
    act(sim, e, target, out);
  }
}

function flagPhase(sim: ZoneSim): void {
  for (const e of sim.entities) {
    if (!e) continue;
    const steady =
      (e.state === 'dead' ? ZONE_FLAGS.DEAD : 0) |
      (e.protectedUntil > sim.now ? ZONE_FLAGS.PROTECTED : 0) |
      (!e.online && e.kind === 'player' ? ZONE_FLAGS.OFFLINE : 0) |
      (e.state === 'moving' || e.state === 'returning' ? ZONE_FLAGS.MOVING : 0);
    const next = (e.flags & ZONE_PULSE_FLAGS) | steady;
    if (next !== e.flags) {
      e.flags = next;
      markDirty(e);
    }
  }
}

/**
 * Advances the zone to `now`.
 *
 * Time moves in whole `tickMs` steps, so a loop that runs late catches up
 * instead of taking a longer stride — the outcome of a fight never depends on
 * how punctual the timer was. A backlog deeper than `ZONE_MAX_CATCHUP_STEPS`
 * is dropped rather than burned through, which is what keeps a stalled process
 * from freezing the whole server when it wakes up.
 */
export function stepZone(sim: ZoneSim, now: number): ZoneStepOutput {
  const out = emptyOutput();
  const tickMs = Math.max(1, Math.round(sim.rules.tickMs));
  if (now <= sim.now) return out;

  let steps = Math.floor((now - sim.now) / tickMs);
  if (steps <= 0) return out;
  if (steps > ZONE_MAX_CATCHUP_STEPS) {
    sim.now = now - ZONE_MAX_CATCHUP_STEPS * tickMs;
    steps = ZONE_MAX_CATCHUP_STEPS;
  }

  for (let s = 0; s < steps; s += 1) {
    sim.now += tickMs;
    sim.tick += 1;
    respawnPhase(sim, out);
    targetPhase(sim);
    movePhase(sim, tickMs);
    actPhase(sim, out);
    flagPhase(sim);
  }
  return out;
}

// ---------------------------------------------------------------------- frames

function tupleOf(e: ZoneEntity): ZoneEntityTuple {
  return [
    e.i,
    Math.round(e.x * 10),
    Math.round(e.y * 10),
    Math.max(0, Math.round(e.hp)),
    e.flags,
    e.targetI,
    e.skillSlot,
  ];
}

/**
 * Drains everything that changed into one frame.
 *
 * A `full` frame restates the zone from scratch — it is what a joining client
 * gets. Otherwise only dirty entities travel, along with the roster rows and
 * removals queued since the last call. Calling this **consumes** that state:
 * two frames built back to back leave the second one empty, which is exactly
 * what a client that already has the first needs.
 */
export function buildFrame(sim: ZoneSim, full: boolean): ZoneFrame {
  sim.seq += 1;
  const add: ZoneRosterEntry[] = [];
  const ents: ZoneEntityTuple[] = [];

  if (full) {
    for (const e of sim.entities) {
      if (!e) continue;
      add.push(rosterEntry(e));
      ents.push(tupleOf(e));
    }
    sim.pendingAdds.length = 0;
    sim.pendingRemoves.length = 0;
  } else {
    add.push(...sim.pendingAdds);
    sim.pendingAdds = [];
    for (const e of sim.entities) {
      if (!e || !e.dirty) continue;
      ents.push(tupleOf(e));
    }
  }

  const treasureStates = sim.entities
    .filter((e): e is ZoneEntity => !!e && !!e.mainTreasure && (full || e.dirty))
    .map((e) => ({ i: e.i, shield: e.treasureRuntime?.shield ?? 0 }));
  const remove = full ? [] : sim.pendingRemoves;
  if (!full) sim.pendingRemoves = [];

  const events = sim.pendingEvents;
  sim.pendingEvents = [];

  // Pulses have now been delivered; clear them and settle the dirty bits.
  for (const e of sim.entities) {
    if (!e) continue;
    if (full || e.dirty) {
      e.flags &= ~ZONE_PULSE_FLAGS;
      e.skillSlot = -1;
      e.dirty = false;
    }
  }

  return {
    zoneId: sim.zone.id,
    seq: sim.seq,
    at: sim.now,
    full,
    add,
    remove,
    ents,
    events,
    ...(treasureStates.length ? { treasureStates } : {}),
    boss: {
      alive: sim.bossI !== null,
      nextAt: sim.bossI === null ? sim.nextBossAt : null,
    },
  };
}
