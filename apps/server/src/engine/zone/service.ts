import {
  canEnterZone,
  ROOMS,
  setOnline,
  setRules,
  stageName,
  zoneBotCount,
  zoneBotLimit,
  zoneMap,
  ZONES,
  ZONE_BOT_CAPACITY_MARGIN,
  ZONE_BY_ID,
  type CharacterState,
  type WorldSettings,
  type ZoneEntity,
  type ZoneLoot,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ZoneMemberRepo } from '../../db/repo/zoneMembers.js';
import { resolveEquipment, statsOf } from '../../game/character.js';
import { loadOtherHealed } from '../../game/hp.js';
import type { ZoneEnterResult, ZoneService, ZoneStats } from './api.js';
import { flushZone } from './flush.js';
import { fullZoneFrame, zoneRulesOf, ZoneWorld } from './world.js';

/**
 * The 战斗大地图 loop.
 *
 * Four fields, one `ZoneWorld` each, driven by two timers: one advances every
 * simulation at `zoneTickMs`, the other pushes a delta frame to each zone room
 * at `zoneSnapshotHz`. Banking spoils rides along with the step timer every
 * `ZONE_FLUSH_MS`, which is also when presence and the offline cap are
 * reconciled.
 *
 * Both timers are `unref`'d self-rescheduling `setTimeout` chains, exactly like
 * the bot tick: a pending zone frame must never be the reason a process refuses
 * to exit, and a settings change re-times the chain rather than waiting out the
 * old interval.
 *
 * Every entry point takes `now`. The timers pass `ctx.now()`; a test passes
 * whatever its hand-cranked clock says, which is what lets a whole afternoon on
 * a field be simulated in a millisecond.
 */

/** How often accrued spoils are written back to the character rows. */
export const ZONE_FLUSH_MS = 5_000;

/** Floor on either timer's period, so a bad setting cannot spin the loop. */
const MIN_TIMER_MS = 50;

export class ZoneServiceImpl implements ZoneService {
  /** One live field per `Zone`, built at construction so tests need no `start`. */
  readonly worlds = new Map<string, ZoneWorld>();

  private readonly members: ZoneMemberRepo;
  /** `characterId` -> `zoneId`, the in-memory mirror of 图籍 plus the bots. */
  private readonly where = new Map<string, string>();

  private running = false;
  private stepTimer: NodeJS.Timeout | null = null;
  private frameTimer: NodeJS.Timeout | null = null;
  private stopSettingsWatch: (() => void) | null = null;
  private nextFlushAt = 0;

  constructor(private readonly ctx: AppContext) {
    this.members = new ZoneMemberRepo(ctx.db);
    const rules = zoneRulesOf(ctx.settings.get());
    const now = ctx.now();
    for (const zone of ZONES) {
      this.worlds.set(zone.id, new ZoneWorld(ctx, zone, rules, now));
    }
    // Subscribed here rather than in `start`, because the fields exist from
    // construction: a 妖兽 density or PvP change has to reach the simulations
    // whether or not the timers are the thing driving them.
    this.stopSettingsWatch = this.ctx.settings.onChange((next) => this.onSettings(next));
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.ctx.now();
    const settings = this.ctx.settings.get();
    for (const world of this.worlds.values()) setRules(world.sim, zoneRulesOf(settings));
    this.restoreMembers(now);
    this.stopSettingsWatch ??= this.ctx.settings.onChange((next) => this.onSettings(next));
    this.nextFlushAt = now + ZONE_FLUSH_MS;
    this.scheduleStep();
    this.scheduleFrame();
  }

  /** Stops both timers and banks everything still owed. */
  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.stepTimer = null;
    this.frameTimer = null;
    this.stopSettingsWatch?.();
    this.stopSettingsWatch = null;
    if (!wasRunning) return;
    try {
      this.flush(this.ctx.now());
    } catch (error) {
      console.error('[zone] final flush failed:', error);
    }
  }

  /**
   * Puts every 图籍 back on its field.
   *
   * Positions are not stored, so everyone reappears at the entrance, logged
   * out, with the protection window a new arrival gets. A row whose character
   * is gone — or whose field no longer exists in the content tables — is
   * dropped rather than carried forward.
   */
  private restoreMembers(now: number): void {
    for (const row of this.members.all()) {
      const world = this.worlds.get(row.zoneId);
      if (!world) {
        this.members.remove(row.characterId);
        continue;
      }
      const state = this.ctx.characters.byId(row.characterId);
      if (!state || state.isBot) {
        this.members.remove(row.characterId);
        continue;
      }
      // A capacity that shrank under a stored population leaves the row alone:
      // the 图籍 is the player's claim on the field, and the next boot may fit.
      // Its 战果 stays in the column too, and `enter` reads it from there.
      if (world.cultivators >= world.zone.capacity) continue;
      this.place(world, state, false, now);
      world.enteredAt.set(state.id, row.enteredAt);
      // Whatever last night's flushes owed this player comes back with it, so
      // the next offline window merges onto the tally instead of replacing it.
      if (row.loot) world.pendingLoot.set(row.characterId, row.loot);
    }
  }

  private onSettings(next: WorldSettings): void {
    const rules = zoneRulesOf(next);
    for (const world of this.worlds.values()) setRules(world.sim, rules);
    if (!this.running) return;
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.stepTimer = null;
    this.frameTimer = null;
    this.scheduleStep();
    this.scheduleFrame();
  }

  private scheduleStep(): void {
    if (!this.running) return;
    const period = Math.max(MIN_TIMER_MS, this.ctx.settings.get().zoneTickMs);
    this.stepTimer = setTimeout(() => {
      this.stepTimer = null;
      const now = this.ctx.now();
      try {
        this.step(now);
        if (now >= this.nextFlushAt) {
          this.nextFlushAt = now + ZONE_FLUSH_MS;
          this.flush(now);
        }
      } catch (error) {
        console.error('[zone] step failed:', error);
      }
      this.scheduleStep();
    }, period);
    this.stepTimer.unref?.();
  }

  private scheduleFrame(): void {
    if (!this.running) return;
    const hz = Math.max(1, this.ctx.settings.get().zoneSnapshotHz);
    const period = Math.max(MIN_TIMER_MS, Math.round(1000 / hz));
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      try {
        const now = this.ctx.now();
        for (const world of this.worlds.values()) world.broadcast(now);
      } catch (error) {
        console.error('[zone] frame failed:', error);
      }
      this.scheduleFrame();
    }, period);
    this.frameTimer.unref?.();
  }

  // ------------------------------------------------------------------ the loop

  step(now: number): void {
    const settings = this.ctx.settings.get();
    for (const world of this.worlds.values()) world.step(now, settings);
  }

  flush(now: number): void {
    const settings = this.ctx.settings.get();
    for (const world of this.worlds.values()) {
      flushZone(this.ctx, world, settings, now);
      this.reconcile(world, settings, now);
    }
  }

  /**
   * Re-syncs the field with who is actually connected, and sweeps out anyone
   * whose 挂机 has outlived `offlineCapHours`.
   *
   * The cap is the same one that forfeits offline 修为: a cultivator who cannot
   * bank what the field earns has no business occupying a slot on it. It is
   * measured from `lastSeenAt`, which the socket layer stamps on connect,
   * on `presence:ping` and on disconnect.
   */
  private reconcile(world: ZoneWorld, settings: WorldSettings, now: number): void {
    const capMs = settings.offlineCapHours * 3_600_000;
    for (const [id, slot] of [...world.slots]) {
      const entity = world.sim.entities[slot];
      if (!entity) {
        world.drop(id);
        this.where.delete(id);
        continue;
      }
      if (entity.kind !== 'player') continue;

      const online = this.ctx.presence.isOnline(id);
      setOnline(world.sim, slot, online);
      if (online) continue;

      const lastSeen = this.ctx.characters.headerById(id)?.lastSeenAt ?? 0;
      if (now - lastSeen <= capMs) continue;
      this.evict(world, id, 'offline_cap');
    }
  }

  /** Takes a player off the field and tells whatever sockets it has left. */
  private evict(world: ZoneWorld, characterId: string, reason: 'offline_cap' | 'removed'): void {
    world.drop(characterId);
    this.where.delete(characterId);
    this.members.remove(characterId);
    this.ctx.realtime.toCharacter(characterId, 'zone:left', { reason });
    this.leaveRoom(characterId, world.id);
  }

  /** Unsubscribes every socket the character holds from the zone's room. */
  private leaveRoom(characterId: string, zoneId: string): void {
    this.ctx.realtime.server?.in(ROOMS.character(characterId)).socketsLeave(ROOMS.zone(zoneId));
  }

  // ------------------------------------------------------------------ membership

  zoneOf(characterId: string): string | null {
    return this.where.get(characterId) ?? null;
  }

  enter(characterId: string, zoneId: string, now: number): ZoneEnterResult {
    const zone = ZONE_BY_ID.get(zoneId);
    const world = this.worlds.get(zoneId);
    if (!zone || !world) {
      return { ok: false, code: 'NOT_FOUND', message: '没有这张战斗大地图' };
    }

    // Already standing here: hand back the current picture and change nothing.
    // The client calls this on every reconnect, so it has to be free.
    const standing = this.where.get(characterId) === zoneId ? world.entityOf(characterId) : null;
    if (standing) {
      const online = this.ctx.presence.isOnline(characterId);
      setOnline(world.sim, standing.i, online);
      this.ctx.characters.touchSeen(characterId, now);
      return {
        ok: true,
        zoneId,
        self: standing.i,
        enteredAt: world.enteredAt.get(characterId) ?? now,
        frame: fullZoneFrame(world.sim),
        pendingLoot: this.claimLoot(world, characterId, online),
      };
    }

    const settings = this.ctx.settings.get();
    const state = loadOtherHealed(this.ctx, characterId, settings, now);
    if (!state || state.isBot) {
      return { ok: false, code: 'NOT_FOUND', message: '没有这名修士' };
    }
    if (!canEnterZone(zoneId, state.stageIndex)) {
      const map = zoneMap(zoneId);
      const need = map ? stageName(map.unlockStage) : '更高境界';
      return { ok: false, code: 'MAP_LOCKED', message: `境界不足，${map?.name ?? '此地'}需${need}` };
    }
    if (world.cultivators >= zone.capacity) {
      return { ok: false, code: 'ZONE_FULL', message: '此地修士已满，换一处再来' };
    }

    // Moving fields banks whatever the old one owed first, so nothing is lost
    // between the two — and the stale membership is gone before the new one is
    // written, which keeps `zone_members` a single row per cultivator.
    const previous = this.where.get(characterId);
    if (previous !== undefined) this.detach(previous, characterId, now);

    const entity = this.place(world, state, false, now);
    this.members.put(characterId, zoneId, now);
    this.ctx.characters.touchSeen(characterId, now);
    return {
      ok: true,
      zoneId,
      self: entity.i,
      enteredAt: now,
      frame: fullZoneFrame(world.sim),
      // A tally can outlive the field it was earned on: a boot that found the
      // map full left the player's 图籍 alone, and a walk to another map drops
      // the old world's copy. Either way `claimLoot` finds it in the row.
      pendingLoot: this.claimLoot(world, characterId, this.ctx.presence.isOnline(characterId)),
    };
  }

  resume(characterId: string, now: number): ZoneEnterResult | null {
    const zoneId = this.where.get(characterId) ?? this.members.get(characterId)?.zoneId ?? null;
    if (zoneId === null) return null;
    return this.enter(characterId, zoneId, now);
  }

  retreat(characterId: string, now: number): boolean {
    const zoneId = this.where.get(characterId) ?? this.members.get(characterId)?.zoneId ?? null;
    if (zoneId === null) return false;
    this.detach(zoneId, characterId, now);
    this.members.remove(characterId);
    this.leaveRoom(characterId, zoneId);
    return true;
  }

  enterBot(state: CharacterState, zoneId: string, now: number): boolean {
    const zone = ZONE_BY_ID.get(zoneId);
    const world = this.worlds.get(zoneId);
    if (!zone || !world || !state.isBot) return false;
    if (this.where.get(state.id) === zoneId) return true;
    if (!canEnterZone(zoneId, state.stageIndex)) return false;
    // Bots stop short of the cap, so the field filling up is never the reason a
    // player is turned away from it.
    if (world.cultivators >= Math.max(0, zone.capacity - ZONE_BOT_CAPACITY_MARGIN)) return false;
    // And they stop far short of it in their own right: the 妖兽 a spawn table
    // hands out per second is the scarce resource, and forty bots ate it before
    // a new player could reach anything. One turned away here simply cultivates
    // at home this tick and tries again on the next.
    if (zoneBotCount(world.sim) >= zoneBotLimit(zone)) return false;

    const previous = this.where.get(state.id);
    if (previous !== undefined) this.detach(previous, state.id, now);
    this.place(world, state, true, now);
    return true;
  }

  retreatBot(characterId: string, now: number): boolean {
    const zoneId = this.where.get(characterId);
    if (zoneId === undefined) return false;
    this.detach(zoneId, characterId, now);
    return true;
  }

  stats(): ZoneStats[] {
    const live = this.running || [...this.worlds.values()].some((w) => w.stepped);
    if (!live) return [];
    return [...this.worlds.values()].map((world) => world.stats());
  }

  // ------------------------------------------------------------------ internals

  /**
   * The 战果 a returning cultivator is owed for the time it was logged out.
   *
   * Looked up on the field first and in the 图籍 row second, because the row is
   * the durable copy: a restart, or a 进图 onto a different map, leaves the
   * tally only there. Handing it over clears both.
   *
   * With nobody connected there is nothing to hand it to, so the tally is
   * instead re-seated on the field the player now stands on — a `zone:enter`
   * that arrives before the socket is registered as present must not silently
   * throw a night's spoils away, and the next offline flush merges onto it.
   */
  private claimLoot(world: ZoneWorld, characterId: string, online: boolean): ZoneLoot | undefined {
    const held = world.pendingLoot.get(characterId) ?? this.members.get(characterId)?.loot ?? null;
    if (!held) return undefined;
    if (!online) {
      world.pendingLoot.set(characterId, held);
      return undefined;
    }
    world.pendingLoot.delete(characterId);
    this.members.setLoot(characterId, null);
    return held;
  }

  /** Banks what a field owes one cultivator, then takes it off that field. */
  private detach(zoneId: string, characterId: string, now: number): void {
    const world = this.worlds.get(zoneId);
    if (world) {
      flushZone(this.ctx, world, this.ctx.settings.get(), now, [characterId]);
      world.drop(characterId);
    }
    this.where.delete(characterId);
  }

  /** Projects a character onto a field: attributes, 神通, 气血 share, presence. */
  private place(
    world: ZoneWorld,
    state: CharacterState,
    isBot: boolean,
    now: number,
  ): ZoneEntity {
    const stats = statsOf(state, resolveEquipment(state, this.ctx.inventory));
    const entity = world.add(
      {
        id: state.id,
        kind: isBot ? 'bot' : 'player',
        name: state.name,
        art: state.avatarArt,
        stageIndex: state.stageIndex,
        stats,
        skills: state.skillSlots,
        // 气血 carried in from 论道 wounds; a bot fights whole every time.
        hpShare: isBot ? 1 : state.hpPercent,
        online: isBot ? true : this.ctx.presence.isOnline(state.id),
        aggression: isBot ? (state.botParams?.aggression ?? 0) : 0,
      },
      now,
    );
    this.where.set(state.id, world.id);
    return entity;
  }
}
