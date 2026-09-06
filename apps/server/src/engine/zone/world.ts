import {
  addCultivator,
  buildFrame,
  combineSeeds,
  createRng,
  createZoneSim,
  pushZoneEvent,
  removeEntity,
  stepZone,
  zoneBotCount,
  zoneCultivatorCount,
  zoneMonsterCount,
  zonePlayerCount,
  type AddCultivatorInput,
  type WorldSettings,
  type Zone,
  type ZoneEntity,
  type ZoneFrame,
  type ZoneRules,
  type ZoneSim,
  type ZoneStepOutput,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { zoneKillRewards } from './rewards.js';

/**
 * One live 战斗大地图.
 *
 * The class owns exactly three things: a `ZoneSim` (pure, deterministic, no
 * I/O), the accrued-but-unbanked spoils of everyone standing on it, and the
 * bookkeeping that maps a `characterId` onto a slot.
 *
 * What it deliberately does **not** own is a `CharacterState`. Three writers
 * touch a character row — every REST request, the bot tick and this loop — and
 * each of them reads the row, changes it and writes it straight back. A cached
 * snapshot here would let a 5-second-old copy of a cultivator overwrite an
 * admin grant or a breakthrough that landed in between. So a kill only ever
 * increments a `ZoneDelta`, and `flush` re-reads the row before adding it on
 * (ARCHITECTURE §8).
 */

/** How often a zone room is sent a `full` frame rather than a delta. */
export const ZONE_FULL_FRAME_MS = 5_000;

/** Spoils one cultivator has earned on this field since the last flush. */
export interface ZoneDelta {
  exp: number;
  stones: number;
  /** `itemId` -> quantity, merged so one flush is one `inventory.add` per item. */
  items: Map<string, number>;
  /** `monsterId` -> kills, replayed into 击杀 quest objectives at flush. */
  monsterKills: Map<string, number>;
  kills: number;
  bossKills: number;
  /** Epoch ms this accumulation window opened. */
  since: number;
}

function emptyDelta(since: number): ZoneDelta {
  return {
    exp: 0,
    stones: 0,
    items: new Map(),
    monsterKills: new Map(),
    kills: 0,
    bossKills: 0,
    since,
  };
}

/** The slice of the world settings the simulation reads, in its own shape. */
export function zoneRulesOf(settings: WorldSettings): ZoneRules {
  return {
    tickMs: settings.zoneTickMs,
    mapPvp: settings.mapPvp,
    mapPvpStoneLoss: settings.mapPvpStoneLoss,
    mapDeathRespawnSec: settings.mapDeathRespawnSec,
    monsterDensity: settings.monsterDensity,
    respawnMultiplier: settings.respawnMultiplier,
    bossIntervalMinutes: settings.bossIntervalMinutes,
  };
}

/**
 * A `full` frame that does not consume the broadcast state.
 *
 * `buildFrame(sim, true)` is destructive by contract: it drains the roster
 * queues, clears every pulse bit and settles the dirty flags. That is right for
 * the one frame a zone room is sent per period, and wrong for a frame built for
 * a single arriving client — the watchers already in the room would lose the
 * 命中 sparks and roster rows that frame swallowed. The queues are swapped for
 * empty ones and put back afterwards, so the arrival gets a complete picture and
 * everyone else's next delta is untouched.
 *
 * `seq` is deliberately left advanced: every frame this zone ever emits carries
 * its own number, which is what lets a client detect a gap.
 */
export function fullZoneFrame(sim: ZoneSim): ZoneFrame {
  const adds = sim.pendingAdds;
  const removes = sim.pendingRemoves;
  const events = sim.pendingEvents;
  const marks = sim.entities.map((e) =>
    e === null ? null : { dirty: e.dirty, flags: e.flags, skillSlot: e.skillSlot },
  );

  sim.pendingAdds = [];
  sim.pendingRemoves = [];
  sim.pendingEvents = [];
  const frame = buildFrame(sim, true);

  sim.pendingAdds = adds;
  sim.pendingRemoves = removes;
  sim.pendingEvents = events;
  for (const [i, mark] of marks.entries()) {
    const e = sim.entities[i];
    if (!e || !mark) continue;
    e.dirty = mark.dirty;
    e.flags = mark.flags;
    e.skillSlot = mark.skillSlot;
  }
  return frame;
}

export class ZoneWorld {
  readonly sim: ZoneSim;
  /** `characterId` -> slot, for every cultivator this world put on the field. */
  readonly slots = new Map<string, number>();
  /** Unbanked spoils, keyed by `characterId`. */
  readonly deltas = new Map<string, ZoneDelta>();
  /** When each cultivator walked on, epoch ms. */
  readonly enteredAt = new Map<string, number>();

  /**
   * Milliseconds the last `step` cost, for the admin panel. Measured with
   * `performance.now`, because a healthy field steps in a fraction of a
   * millisecond and `Date.now` would report every one of them as 0.
   */
  lastStepMs = 0;
  /** True once the loop has advanced this field at least one tick. */
  stepped = false;

  /** Epoch ms of the last `full` frame sent to the room. */
  private lastFullAt = 0;
  /**
   * Set whenever a period was skipped for want of watchers. The dirty bits kept
   * piling up while nobody was listening, so the first frame after that must
   * restate the field rather than describe a window the client never saw.
   */
  private needsFull = true;

  constructor(
    private readonly ctx: AppContext,
    readonly zone: Zone,
    rules: ZoneRules,
    now: number,
  ) {
    this.sim = createZoneSim(zone, rules, combineSeeds('zone', zone.id), now);
  }

  get id(): string {
    return this.zone.id;
  }

  get cultivators(): number {
    return zoneCultivatorCount(this.sim);
  }

  entityOf(characterId: string): ZoneEntity | null {
    const slot = this.slots.get(characterId);
    if (slot === undefined) return null;
    return this.sim.entities[slot] ?? null;
  }

  /** The delta for `characterId`, opening a fresh window if there is none. */
  delta(characterId: string, now: number): ZoneDelta {
    let delta = this.deltas.get(characterId);
    if (!delta) {
      delta = emptyDelta(now);
      this.deltas.set(characterId, delta);
    }
    return delta;
  }

  /** Puts a cultivator on the field and opens its accrual window. */
  add(input: AddCultivatorInput, now: number): ZoneEntity {
    const entity = addCultivator(this.sim, input);
    this.slots.set(input.id, entity.i);
    this.enteredAt.set(input.id, now);
    this.delta(input.id, now);
    return entity;
  }

  /**
   * Takes a cultivator off the field, dropping whatever it had not banked.
   * Callers flush first; this is the bookkeeping half only.
   */
  drop(characterId: string): boolean {
    const slot = this.slots.get(characterId);
    if (slot === undefined) return false;
    removeEntity(this.sim, slot);
    this.slots.delete(characterId);
    this.enteredAt.delete(characterId);
    this.deltas.delete(characterId);
    return true;
  }

  /**
   * Advances the field and banks whatever the tick earned anyone.
   *
   * `stepZone` catches up in whole ticks on its own, so a late timer changes
   * how much time this call covers, never the outcome of a fight.
   */
  step(now: number, settings: WorldSettings): void {
    const started = performance.now();
    const out = stepZone(this.sim, now);
    this.stepped = true;
    this.lastStepMs = performance.now() - started;
    if (out.kills.length === 0 && out.deaths.length === 0 && out.pvpKills.length === 0) return;
    this.settleOutcome(out, settings, now);
  }

  /**
   * Builds and pushes one frame, or skips the period when nobody is watching.
   *
   * A field with no viewers still fights — the whole 挂机 promise rests on that
   * — but building a frame for an empty room would throw away the pulses and
   * roster rows that the *next* viewer needs. So the frame is simply not built,
   * and the first one after the drought is a `full`.
   */
  broadcast(now: number): boolean {
    if (this.ctx.realtime.zoneWatchers(this.id) === 0) {
      this.needsFull = true;
      return false;
    }
    const full = this.needsFull || now - this.lastFullAt >= ZONE_FULL_FRAME_MS;
    const frame = buildFrame(this.sim, full);
    if (full) {
      this.lastFullAt = now;
      this.needsFull = false;
    }
    this.ctx.realtime.toZone(this.id, 'zone:frame', frame, { volatile: !full });
    return true;
  }

  stats(): {
    zoneId: string;
    players: number;
    bots: number;
    monsters: number;
    bossAlive: boolean;
    lastStepMs: number;
    watchers: number;
  } {
    return {
      zoneId: this.id,
      players: zonePlayerCount(this.sim),
      bots: zoneBotCount(this.sim),
      monsters: zoneMonsterCount(this.sim),
      bossAlive: this.sim.bossI !== null,
      lastStepMs: this.lastStepMs,
      watchers: this.ctx.realtime.zoneWatchers(this.id),
    };
  }

  // ------------------------------------------------------------- one tick's aftermath

  private settleOutcome(out: ZoneStepOutput, settings: WorldSettings, now: number): void {
    // 1. PvP purses first, so the death notice below can quote what was lost.
    //    This is the one thing a zone tick writes immediately: the loser's 灵石
    //    must leave its row at the moment of the kill, or an admin grant or a
    //    shop purchase in the next five seconds would be taxed on the way past.
    const stolen = new Map<number, number>();
    for (const pvp of out.pvpKills) {
      const victim = this.sim.entities[pvp.victimI];
      const killer = this.sim.entities[pvp.killerI];
      if (!victim || !killer) continue;
      const lost = this.takeStones(victim.id, settings.mapPvpStoneLoss);
      stolen.set(pvp.victimI, lost);
      if (lost > 0) this.delta(killer.id, now).stones += lost;
      pushZoneEvent(this.sim, {
        t: 'pvp_kill',
        killer: pvp.killerI,
        victim: pvp.victimI,
        stones: lost,
      });
    }

    // 2. 妖兽 spoils, banked into the deltas.
    for (const kill of out.kills) {
      const rng = createRng(
        combineSeeds('zone-kill', this.id, this.sim.tick, kill.victimI, kill.killerI),
      );
      const shares = zoneKillRewards(kill, settings, rng, (i) => {
        const e = this.sim.entities[i];
        if (!e || e.kind === 'monster' || e.kind === 'boss') return null;
        // A 机器人修士 is never "offline": it farms at full rate around the clock.
        return e.kind === 'bot' ? true : e.online;
      });
      for (const share of shares) {
        const e = this.sim.entities[share.i];
        if (!e) continue;
        const delta = this.delta(e.id, now);
        delta.exp += share.exp;
        delta.stones += share.stones;
        delta.kills += share.kills;
        delta.bossKills += share.bossKills;
        for (const item of share.items) {
          delta.items.set(item.itemId, (delta.items.get(item.itemId) ?? 0) + item.qty);
        }
        if (share.questMonsterId !== null) {
          const id = share.questMonsterId;
          delta.monsterKills.set(id, (delta.monsterKills.get(id) ?? 0) + 1);
        }
      }
    }

    // 3. One notice per fallen player, whatever felled it. A PvP death carries
    //    the purse from step 1; a 妖兽 costs nothing but the respawn wait.
    for (const death of out.deaths) {
      const victim = this.sim.entities[death.victimI];
      if (!victim || victim.kind !== 'player') continue;
      if (!this.ctx.presence.isOnline(victim.id)) continue;
      const killer = death.killerI >= 0 ? this.sim.entities[death.killerI] : null;
      this.ctx.realtime.toCharacter(victim.id, 'zone:death', {
        killerName: killer?.name ?? '未知',
        stonesLost: stolen.get(death.victimI) ?? 0,
        respawnAt: death.respawnAt,
      });
    }
  }

  /** Takes `rate` of a cultivator's 灵石 out of its row now. Returns the amount. */
  private takeStones(characterId: string, rate: number): number {
    if (rate <= 0) return 0;
    const fresh = this.ctx.characters.byId(characterId);
    if (!fresh) return 0;
    const lost = Math.min(fresh.spiritStones, Math.floor(fresh.spiritStones * rate));
    if (lost <= 0) return 0;
    const next = { ...fresh, spiritStones: fresh.spiritStones - lost };
    this.ctx.characters.save(next);
    if (!next.isBot && this.ctx.presence.isOnline(next.id)) {
      this.ctx.realtime.characterUpdate(next);
    }
    return lost;
  }
}
