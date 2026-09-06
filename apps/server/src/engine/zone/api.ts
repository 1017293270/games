/**
 * The 战斗大地图 service seam.
 *
 * `AppContext` depends on this interface, never on the implementation, so the
 * REST and socket layers can be wired up — and tested — before the zone loop
 * exists, and so a test that does not care about the field can run against
 * `NoopZoneService` with no timers running at all.
 *
 * Everything takes `now` rather than reading the clock: the whole server runs
 * on an injectable clock so tests can advance time by hand.
 */

import type { CharacterState, ZoneErrorCode, ZoneFrame } from '@xianxia/shared';

export type ZoneEnterResult =
  | { ok: true; zoneId: string; self: number; enteredAt: number; frame: ZoneFrame }
  | { ok: false; code: ZoneErrorCode; message: string };

/** One row of `AdminStats.zones`. */
export interface ZoneStats {
  zoneId: string;
  players: number;
  bots: number;
  monsters: number;
  bossAlive: boolean;
  /** Milliseconds the last simulation step cost. */
  lastStepMs: number;
  /** Sockets currently subscribed to the zone room. */
  watchers: number;
}

export interface ZoneService {
  /**
   * Puts a character on a field.
   *
   * Idempotent: already on this map returns the current frame and nothing else
   * changes; on a different map the character is moved, banking whatever the
   * old one owed it first.
   */
  enter(characterId: string, zoneId: string, now: number): ZoneEnterResult;

  /** Reconnect path. Returns null when the character is on no field at all. */
  resume(characterId: string, now: number): ZoneEnterResult | null;

  /** Takes a player off the field for good and clears its 图籍. False if it was not on one. */
  retreat(characterId: string, now: number): boolean;

  /**
   * Sends a bot to a field. Bots stop at `capacity - ZONE_BOT_CAPACITY_MARGIN`,
   * so a player is never turned away because the world filled itself up.
   */
  enterBot(state: CharacterState, zoneId: string, now: number): boolean;
  retreatBot(characterId: string, now: number): boolean;

  /** Which field a character stands on, or null. */
  zoneOf(characterId: string): string | null;

  /** Advances every field. Production drives this from a timer; tests call it. */
  step(now: number): void;

  /** Writes accumulated rewards back to the character rows. */
  flush(now: number): void;

  start(): void;
  stop(): void;

  stats(): ZoneStats[];
}

/**
 * The zone loop turned off.
 *
 * `AppContext` boots with this so every existing test keeps passing untouched;
 * `createContext` swaps in the real service once the loop is available.
 */
export class NoopZoneService implements ZoneService {
  enter(_characterId: string, _zoneId: string, _now: number): ZoneEnterResult {
    return { ok: false, code: 'NOT_FOUND', message: '战斗大地图尚未开放' };
  }

  resume(_characterId: string, _now: number): ZoneEnterResult | null {
    return null;
  }

  retreat(_characterId: string, _now: number): boolean {
    return false;
  }

  enterBot(_state: CharacterState, _zoneId: string, _now: number): boolean {
    return false;
  }

  retreatBot(_characterId: string, _now: number): boolean {
    return false;
  }

  zoneOf(_characterId: string): string | null {
    return null;
  }

  step(_now: number): void {}

  flush(_now: number): void {}

  start(): void {}

  stop(): void {}

  stats(): ZoneStats[] {
    return [];
  }
}
