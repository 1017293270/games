import type { AppContext } from '../../context.js';

/**
 * The queries 围攻 needs that the shared character repo does not expose.
 *
 * Both read or write columns that live outside `state_json`: `prestige` has no
 * field on `CharacterState` at all, and the target list filters on
 * `stage_index` while sorting on `power`, which the generic pager cannot spell.
 */

/** Ids of the strongest raidable bots, 战力 first. */
export function raidTargetIds(ctx: AppContext, minStageIndex: number, limit: number): string[] {
  const rows = ctx.db
    .prepare(
      'SELECT id FROM characters WHERE is_bot = 1 AND stage_index >= ?' +
        ' ORDER BY power DESC, stage_index DESC, id ASC LIMIT ?',
    )
    .all(minStageIndex, limit) as { id: string }[];
  return rows.map((row) => row.id);
}

/**
 * Awards 声望 to everyone who helped bring a target down.
 *
 * `prestige` is a column `001_init.sql` reserved and no shared schema field
 * covers, so it is incremented in place rather than round-tripped through
 * `CharacterState` — a `characters.save()` would not carry it.
 */
export function grantPrestige(ctx: AppContext, characterIds: readonly string[], by = 1): void {
  if (characterIds.length === 0) return;
  const statement = ctx.db.prepare('UPDATE characters SET prestige = prestige + ? WHERE id = ?');
  for (const id of characterIds) statement.run(by, id);
}

/** Current 声望 of one cultivator. */
export function prestigeOf(ctx: AppContext, characterId: string): number {
  const row = ctx.db.prepare('SELECT prestige FROM characters WHERE id = ?').get(characterId) as
    | { prestige: number }
    | undefined;
  return row ? Number(row.prestige) : 0;
}
