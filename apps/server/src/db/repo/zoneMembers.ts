import type { DatabaseSync } from 'node:sqlite';

/**
 * 图籍 storage: the field a player is standing on, across restarts.
 *
 * Deliberately tiny. The zone loop keeps every hot fact — position, 气血,
 * target, accrued spoils — in memory, and writes here only when a player walks
 * onto a map or off it, which is a handful of rows a minute on a busy server.
 * The boot rebuild reads the whole table once.
 */

export interface ZoneMemberRow {
  characterId: string;
  zoneId: string;
  enteredAt: number;
}

interface RawRow {
  character_id: string;
  zone_id: string;
  entered_at: number;
}

function toRow(row: RawRow): ZoneMemberRow {
  return {
    characterId: row.character_id,
    zoneId: row.zone_id,
    enteredAt: Number(row.entered_at),
  };
}

export class ZoneMemberRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Every 图籍, oldest arrival first, for the rebuild on boot. */
  all(): ZoneMemberRow[] {
    const rows = this.db
      .prepare('SELECT character_id, zone_id, entered_at FROM zone_members ORDER BY entered_at')
      .all() as unknown as RawRow[];
    return rows.map(toRow);
  }

  get(characterId: string): ZoneMemberRow | null {
    const row = this.db
      .prepare('SELECT character_id, zone_id, entered_at FROM zone_members WHERE character_id = ?')
      .get(characterId) as RawRow | undefined;
    return row ? toRow(row) : null;
  }

  /** Records an arrival, replacing the previous field if there was one. */
  put(characterId: string, zoneId: string, enteredAt: number): void {
    this.db
      .prepare(
        'INSERT INTO zone_members (character_id, zone_id, entered_at) VALUES (?, ?, ?)' +
          ' ON CONFLICT(character_id) DO UPDATE SET zone_id = excluded.zone_id,' +
          ' entered_at = excluded.entered_at',
      )
      .run(characterId, zoneId, enteredAt);
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
