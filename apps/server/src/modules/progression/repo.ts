import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  GachaDrawResultSchema,
  type GachaDrawResult,
  type GachaHistoryEntry,
} from '@xianxia/shared';

interface Row {
  id: string;
  request_id: string;
  at: number;
  pool: string;
  item_id: string;
  rarity: string;
  duplicate: number;
  fragments: number;
  pity: number;
}

/** Durable receipts double as history and idempotency records. Never prune them. */
export class GachaRepo {
  constructor(private readonly db: DatabaseSync) {}

  request(characterId: string, requestId: string): GachaHistoryEntry | null {
    const rows = this.db
      .prepare(
        'SELECT * FROM gacha_log WHERE character_id = ? AND request_id = ? ORDER BY draw_index',
      )
      .all(characterId, requestId) as unknown as Row[];
    const first = rows[0];
    if (!first) return null;
    return {
      id: first.id,
      requestId,
      at: Number(first.at),
      results: rows.map((row) =>
        GachaDrawResultSchema.parse({
          pool: row.pool,
          definitionId: row.item_id,
          grade: row.rarity,
          duplicate: Boolean(row.duplicate),
          fragments: Number(row.fragments),
          pity: Number(row.pity),
        }),
      ),
    };
  }

  insert(
    characterId: string,
    requestId: string,
    results: readonly GachaDrawResult[],
    at: number,
  ): void {
    const insert = this.db.prepare(`INSERT INTO gacha_log
      (id, character_id, pool, item_id, rarity, duplicate, fragments, pity, at, request_id, draw_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    results.forEach((result, index) =>
      insert.run(
        randomUUID(),
        characterId,
        result.pool,
        result.definitionId,
        result.grade,
        Number(result.duplicate),
        result.fragments,
        result.pity,
        at,
        requestId,
        index,
      ),
    );
  }

  history(characterId: string): GachaHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT request_id FROM gacha_log WHERE character_id = ?
      GROUP BY request_id ORDER BY MAX(at) DESC, MAX(rowid) DESC LIMIT 100`,
      )
      .all(characterId) as { request_id: string }[];
    return rows.map((row) => this.request(characterId, row.request_id)!).filter(Boolean);
  }
}
