import type { DatabaseSync } from 'node:sqlite';
import type { FriendState } from '@xianxia/shared';

/**
 * 好友 storage.
 *
 * The relationship is stored once per direction — `A -> B 'pending_out'` sits
 * opposite `B -> A 'pending_in'` — so reading one cultivator's list is a single
 * indexed lookup on `character_id` that already carries the right label, with
 * no CASE over who happened to send the request.
 */

export interface FriendEdge {
  characterId: string;
  friendId: string;
  state: FriendState;
  createdAt: number;
}

interface RawEdge {
  character_id: string;
  friend_id: string;
  state: string;
  created_at: number;
}

function toEdge(row: RawEdge): FriendEdge {
  return {
    characterId: row.character_id,
    friendId: row.friend_id,
    state: row.state as FriendState,
    createdAt: Number(row.created_at),
  };
}

export class FriendRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Every edge owned by `characterId`, accepted friends first. */
  list(characterId: string): FriendEdge[] {
    const rows = this.db
      .prepare(
        'SELECT character_id, friend_id, state, created_at FROM friends' +
          ' WHERE character_id = ? ORDER BY created_at DESC',
      )
      .all(characterId) as unknown as RawEdge[];
    return rows.map(toEdge);
  }

  edge(characterId: string, friendId: string): FriendEdge | null {
    const row = this.db
      .prepare(
        'SELECT character_id, friend_id, state, created_at FROM friends' +
          ' WHERE character_id = ? AND friend_id = ?',
      )
      .get(characterId, friendId) as RawEdge | undefined;
    return row ? toEdge(row) : null;
  }

  /** Accepted friends only; the cap counts these. */
  countAccepted(characterId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM friends WHERE character_id = ? AND state = 'accepted'",
      )
      .get(characterId) as { c: number };
    return Number(row.c);
  }

  put(characterId: string, friendId: string, state: FriendState, now: number): void {
    this.db
      .prepare(
        'INSERT INTO friends (character_id, friend_id, state, created_at) VALUES (?, ?, ?, ?)' +
          ' ON CONFLICT(character_id, friend_id) DO UPDATE SET state = excluded.state',
      )
      .run(characterId, friendId, state, now);
  }

  /** Drops both directions at once; a friendship never half-exists. */
  removePair(a: string, b: string): number {
    const result = this.db
      .prepare(
        'DELETE FROM friends WHERE (character_id = ? AND friend_id = ?)' +
          ' OR (character_id = ? AND friend_id = ?)',
      )
      .run(a, b, b, a);
    return Number(result.changes);
  }
}
