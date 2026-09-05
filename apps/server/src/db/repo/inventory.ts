import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ITEM_BY_ID, type InventoryItem } from '@xianxia/shared';

/** One stored stack. `equipped` is derived from the character's equip slots. */
export interface InventoryRow {
  uid: string;
  characterId: string;
  itemId: string;
  qty: number;
}

/** Stackable items get a deterministic uid so a stack is a single upsert. */
export function stackUid(characterId: string, itemId: string): string {
  return `${characterId}:${itemId}`;
}

export class InventoryRepo {
  constructor(private readonly db: DatabaseSync) {}

  list(characterId: string): InventoryRow[] {
    const rows = this.db
      .prepare('SELECT uid, character_id, item_id, qty FROM inventory WHERE character_id = ? ORDER BY rowid')
      .all(characterId) as { uid: string; character_id: string; item_id: string; qty: number }[];
    return rows.map((r) => ({
      uid: r.uid,
      characterId: r.character_id,
      itemId: r.item_id,
      qty: Number(r.qty),
    }));
  }

  byUid(uid: string): InventoryRow | null {
    const row = this.db
      .prepare('SELECT uid, character_id, item_id, qty FROM inventory WHERE uid = ?')
      .get(uid) as { uid: string; character_id: string; item_id: string; qty: number } | undefined;
    return row
      ? { uid: row.uid, characterId: row.character_id, itemId: row.item_id, qty: Number(row.qty) }
      : null;
  }

  /** Total quantity of an item id across all stacks the character holds. */
  quantityOf(characterId: string, itemId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(qty), 0) AS q FROM inventory WHERE character_id = ? AND item_id = ?',
      )
      .get(characterId, itemId) as { q: number };
    return Number(row.q);
  }

  /**
   * Adds `qty` of an item. Stackables merge into one row; equipment creates a
   * fresh row per piece, so two identical swords stay individually equippable.
   * Returns the uids touched or created.
   */
  add(characterId: string, itemId: string, qty: number): string[] {
    const item = ITEM_BY_ID.get(itemId);
    if (!item || qty <= 0) return [];

    if (item.stackable) {
      const uid = stackUid(characterId, itemId);
      this.db
        .prepare(
          'INSERT INTO inventory (uid, character_id, item_id, qty) VALUES (?, ?, ?, ?)' +
            ' ON CONFLICT(uid) DO UPDATE SET qty = qty + excluded.qty',
        )
        .run(uid, characterId, itemId, qty);
      return [uid];
    }

    const uids: string[] = [];
    const insert = this.db.prepare(
      'INSERT INTO inventory (uid, character_id, item_id, qty) VALUES (?, ?, ?, 1)',
    );
    for (let i = 0; i < qty; i += 1) {
      const uid = randomUUID();
      insert.run(uid, characterId, itemId);
      uids.push(uid);
    }
    return uids;
  }

  /** Removes `qty` from one stack, deleting the row when it empties. */
  removeFromStack(uid: string, qty: number): void {
    const row = this.byUid(uid);
    if (!row) return;
    const left = row.qty - qty;
    if (left > 0) {
      this.db.prepare('UPDATE inventory SET qty = ? WHERE uid = ?').run(left, uid);
    } else {
      this.db.prepare('DELETE FROM inventory WHERE uid = ?').run(uid);
    }
  }

  /**
   * Removes `qty` of an item id across stacks, oldest first.
   * Returns false and changes nothing when the character does not hold enough.
   */
  removeByItemId(characterId: string, itemId: string, qty: number): boolean {
    if (this.quantityOf(characterId, itemId) < qty) return false;
    let left = qty;
    const rows = this.db
      .prepare('SELECT uid, qty FROM inventory WHERE character_id = ? AND item_id = ? ORDER BY rowid')
      .all(characterId, itemId) as { uid: string; qty: number }[];
    for (const row of rows) {
      if (left <= 0) break;
      const take = Math.min(left, Number(row.qty));
      this.removeFromStack(row.uid, take);
      left -= take;
    }
    return true;
  }

  removeAllFor(characterId: string): void {
    this.db.prepare('DELETE FROM inventory WHERE character_id = ?').run(characterId);
  }

  /** Inventory rows in the shape the protocol returns, with `equipped` filled. */
  view(characterId: string, equippedUids: readonly (string | null)[]): InventoryItem[] {
    const equipped = new Set(equippedUids.filter((u): u is string => u !== null));
    return this.list(characterId).map((row) => ({
      uid: row.uid,
      itemId: row.itemId,
      qty: row.qty,
      equipped: equipped.has(row.uid),
    }));
  }
}
