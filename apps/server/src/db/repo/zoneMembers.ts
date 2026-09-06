import type { DatabaseSync } from 'node:sqlite';
import { ZoneLootSchema, type ZoneLoot } from '@xianxia/shared';

/**
 * 图籍 storage: the field a player is standing on, across restarts.
 *
 * Deliberately tiny. The zone loop keeps every hot fact — position, 气血,
 * target, accrued spoils — in memory, and writes here only when a player walks
 * onto a map or off it, which is a handful of rows a minute on a busy server.
 * The boot rebuild reads the whole table once.
 *
 * The one exception is `loot`: the receipt for what the field banked while the
 * player was logged out. That has to survive a restart — the whole point is
 * that it is handed over when the player comes back, which may be days and a
 * deploy later — so it is written on every offline flush that earned something
 * and cleared as it is delivered.
 */

export interface ZoneMemberRow {
  characterId: string;
  zoneId: string;
  enteredAt: number;
  /** Offline spoils not yet handed to the player, or null when nothing is owed. */
  loot: ZoneLoot | null;
}

interface RawRow {
  character_id: string;
  zone_id: string;
  entered_at: number;
  loot_json: string | null;
}

const COLUMNS = 'character_id, zone_id, entered_at, loot_json';

/**
 * A stored tally, or null.
 *
 * Parsed through the shared schema rather than trusted: the column outlives
 * deploys, and a tally written by an older shape must be dropped rather than
 * handed to a client that would reject it.
 */
function parseLoot(json: string | null): ZoneLoot | null {
  if (json === null) return null;
  try {
    const parsed = ZoneLootSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toRow(row: RawRow): ZoneMemberRow {
  return {
    characterId: row.character_id,
    zoneId: row.zone_id,
    enteredAt: Number(row.entered_at),
    loot: parseLoot(row.loot_json),
  };
}

export class ZoneMemberRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Every 图籍, oldest arrival first, for the rebuild on boot. */
  all(): ZoneMemberRow[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM zone_members ORDER BY entered_at`)
      .all() as unknown as RawRow[];
    return rows.map(toRow);
  }

  get(characterId: string): ZoneMemberRow | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM zone_members WHERE character_id = ?`)
      .get(characterId) as RawRow | undefined;
    return row ? toRow(row) : null;
  }

  /**
   * Records an arrival, replacing the previous field if there was one.
   *
   * `loot_json` is deliberately absent from both halves: a cultivator that
   * walks from one field to another still has whatever the last one owed it,
   * and a fresh row starts at the column default of NULL.
   */
  put(characterId: string, zoneId: string, enteredAt: number): void {
    this.db
      .prepare(
        'INSERT INTO zone_members (character_id, zone_id, entered_at) VALUES (?, ?, ?)' +
          ' ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id,' +
          ' entered_at = excluded.entered_at',
      )
      .run(characterId, zoneId, enteredAt);
  }

  /** Stores the offline tally, or clears it once it has been delivered. */
  setLoot(characterId: string, loot: ZoneLoot | null): void {
    this.db
      .prepare('UPDATE zone_members SET loot_json = ? WHERE character_id = ?')
      .run(loot === null ? null : JSON.stringify(loot), characterId);
  }

  remove(characterId: string): void {
    this.db.prepare('DELETE FROM zone_members WHERE character_id = ?').run(characterId);
  }

  countByZone(zoneId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM zone_members WHERE zone_id = ?')
      .get(zoneId) as { c: number };
    return Number(row.c);
  }
}
