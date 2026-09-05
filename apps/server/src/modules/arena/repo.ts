import type { ArenaRecord, BattleResult } from '@xianxia/shared';
import { BattleResultSchema } from '@xianxia/shared';
import type { AppContext } from '../../context.js';

/**
 * 论道 history, read out of the shared `battle_records` table.
 *
 * Replays are the expensive part of a record — a full `BattleResult` is a few
 * kilobytes — so only the newest `REPLAY_KEEP` fights per cultivator keep
 * theirs; older rows stay as scoreboard lines with `battle: null`.
 */

/** Fights per cultivator that keep a replayable `battle_json`. */
export const REPLAY_KEEP = 50;

interface RawRecord {
  id: string;
  attacker_id: string;
  attacker_name: string;
  defender_id: string;
  defender_name: string;
  winner_id: string | null;
  rating_delta: number;
  fought_at: number;
  battle_json: string | null;
}

function toRecord(row: RawRecord): ArenaRecord {
  let battle: BattleResult | null = null;
  if (row.battle_json !== null) {
    const parsed = BattleResultSchema.safeParse(JSON.parse(row.battle_json));
    if (parsed.success) battle = parsed.data;
  }
  return {
    id: row.id,
    attackerId: row.attacker_id,
    attackerName: row.attacker_name,
    defenderId: row.defender_id,
    defenderName: row.defender_name,
    winnerId: row.winner_id,
    ratingDelta: Number(row.rating_delta),
    foughtAt: Number(row.fought_at),
    battle,
  };
}

const COLUMNS =
  'id, attacker_id, attacker_name, defender_id, defender_name, winner_id, rating_delta,' +
  ' fought_at, battle_json';

/** A page of 论道 records the character took part in on either side. */
export function arenaRecordPage(
  ctx: AppContext,
  characterId: string,
  page: number,
  pageSize: number,
): { items: ArenaRecord[]; total: number } {
  const where = "kind = 'arena' AND (attacker_id = ? OR defender_id = ?)";
  const total = Number(
    (
      ctx.db.prepare(`SELECT COUNT(*) AS c FROM battle_records WHERE ${where}`).get(
        characterId,
        characterId,
      ) as { c: number }
    ).c,
  );

  const rows = ctx.db
    .prepare(
      `SELECT ${COLUMNS} FROM battle_records WHERE ${where}` +
        ' ORDER BY fought_at DESC, rowid DESC LIMIT ? OFFSET ?',
    )
    .all(characterId, characterId, pageSize, (page - 1) * pageSize) as unknown as RawRecord[];

  return { items: rows.map(toRecord), total };
}

/**
 * Drops the replay from everything past this character's newest `REPLAY_KEEP`
 * fights. The row itself stays, so the scoreboard never loses a result.
 */
export function pruneReplays(ctx: AppContext, characterId: string): number {
  const result = ctx.db
    .prepare(
      'UPDATE battle_records SET battle_json = NULL WHERE id IN (' +
        "  SELECT id FROM battle_records WHERE kind = 'arena' AND battle_json IS NOT NULL" +
        '   AND (attacker_id = ? OR defender_id = ?)' +
        '   ORDER BY fought_at DESC, rowid DESC LIMIT -1 OFFSET ?' +
        ')',
    )
    .run(characterId, characterId, REPLAY_KEEP);
  return Number(result.changes);
}

/** Cultivators within `window` stages of `stageIndex`, closest rating first. */
export function nearbyOpponentIds(
  ctx: AppContext,
  options: { characterId: string; stageIndex: number; arenaRating: number; window: number; limit: number },
): string[] {
  const rows = ctx.db
    .prepare(
      'SELECT id FROM characters WHERE id != ? AND stage_index BETWEEN ? AND ?' +
        ' ORDER BY ABS(arena_score - ?) ASC, power DESC, id ASC LIMIT ?',
    )
    .all(
      options.characterId,
      options.stageIndex - options.window,
      options.stageIndex + options.window,
      options.arenaRating,
      options.limit,
    ) as { id: string }[];
  return rows.map((row) => row.id);
}
