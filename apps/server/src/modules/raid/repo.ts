import type { AppContext } from '../../context.js';

/**
 * The queries 围攻 needs that the shared character repo does not expose: the
 * target list filters on `stage_index` while sorting on `power`, which the
 * generic pager cannot spell, and 声望 is read straight off its denormalised
 * column rather than through a full `CharacterState`.
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

/** Current 声望 of one cultivator, off the denormalised column. */
export function prestigeOf(ctx: AppContext, characterId: string): number {
  const row = ctx.db.prepare('SELECT prestige FROM characters WHERE id = ?').get(characterId) as
    | { prestige: number }
    | undefined;
  return row ? Number(row.prestige) : 0;
}
