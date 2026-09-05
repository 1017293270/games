import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

/**
 * 秘境 run history.
 *
 * One row per attempt, solo or party. The participant list is stored as JSON
 * because a run is written once and read back whole — quest progress derives
 * 「通关副本」 from `participantIds` plus `cleared`, which needs no join.
 */

export interface DungeonRunInput {
  dungeonId: string;
  leaderId: string;
  participantIds: readonly string[];
  cleared: boolean;
  foughtAt: number;
}

export interface DungeonRun extends Omit<DungeonRunInput, 'participantIds'> {
  id: string;
  participantIds: string[];
}

interface RawRun {
  id: string;
  dungeon_id: string;
  leader_id: string;
  participant_ids_json: string;
  cleared: number;
  fought_at: number;
}

function toRun(row: RawRun): DungeonRun {
  let participantIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.participant_ids_json);
    if (Array.isArray(parsed)) participantIds = parsed.map((id) => String(id));
  } catch {
    // A malformed blob costs the run its roster, not the whole listing.
  }
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    leaderId: row.leader_id,
    participantIds,
    cleared: row.cleared === 1,
    foughtAt: Number(row.fought_at),
  };
}

const COLUMNS = 'id, dungeon_id, leader_id, participant_ids_json, cleared, fought_at';

export class DungeonRunRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(input: DungeonRunInput): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO dungeon_runs (id, dungeon_id, leader_id, participant_ids_json, cleared,' +
          ' fought_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.dungeonId,
        input.leaderId,
        JSON.stringify([...input.participantIds]),
        input.cleared ? 1 : 0,
        input.foughtAt,
      );
    return id;
  }

  byId(id: string): DungeonRun | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM dungeon_runs WHERE id = ?`).get(id) as
      | RawRun
      | undefined;
    return row ? toRun(row) : null;
  }

  /**
   * Runs a character took part in, newest first.
   *
   * The roster is a JSON array, so membership is matched on the serialised id —
   * `LIKE '%"<id>"%'` — which is exact for uuids and keeps the query indexless
   * but cheap against a table only this feature writes.
   */
  forParticipant(characterId: string, limit = 50): DungeonRun[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM dungeon_runs WHERE participant_ids_json LIKE ?` +
          ' ORDER BY fought_at DESC LIMIT ?',
      )
      .all(`%"${characterId}"%`, limit) as unknown as RawRun[];
    return rows.map(toRun);
  }

  /** Cleared runs of one 秘境 by one character; quest progress counts these. */
  countCleared(characterId: string, dungeonId?: string): number {
    const row = (
      dungeonId === undefined
        ? this.db
            .prepare(
              'SELECT COUNT(*) AS c FROM dungeon_runs WHERE cleared = 1' +
                ' AND participant_ids_json LIKE ?',
            )
            .get(`%"${characterId}"%`)
        : this.db
            .prepare(
              'SELECT COUNT(*) AS c FROM dungeon_runs WHERE cleared = 1 AND dungeon_id = ?' +
                ' AND participant_ids_json LIKE ?',
            )
            .get(dungeonId, `%"${characterId}"%`)
    ) as { c: number };
    return Number(row.c);
  }
}
