import type { AppContext } from '../../context.js';
import type { CharacterHeader } from '../../db/repo/characters.js';

/**
 * The queries the bot tick issues.
 *
 * The loop reads once per tick and writes once per tick, so everything here is
 * a set-shaped query rather than a per-bot lookup — that is what keeps a
 * 200-bot round inside a few milliseconds.
 */

interface RawHeader {
  id: string;
  user_id: string;
  name: string;
  is_bot: number;
  archetype_id: string | null;
  gender: string;
  avatar_art: string;
  stage_index: number;
  exp: number;
  power: number;
  arena_score: number;
  spirit_stones: number;
  raid_hp: number;
  protected_until: number;
  last_settled_at: number;
  last_seen_at: number;
  created_at: number;
}

const COLUMNS =
  'id, user_id, name, is_bot, archetype_id, gender, avatar_art, stage_index, exp, power,' +
  ' arena_score, spirit_stones, raid_hp, protected_until, last_settled_at, last_seen_at, created_at';

function toHeader(row: RawHeader): CharacterHeader {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isBot: row.is_bot === 1,
    archetypeId: row.archetype_id,
    gender: row.gender,
    avatarArt: row.avatar_art,
    stageIndex: Number(row.stage_index),
    exp: Number(row.exp),
    power: Number(row.power),
    arenaScore: Number(row.arena_score),
    spiritStones: Number(row.spirit_stones),
    raidHp: Number(row.raid_hp),
    protectedUntil: Number(row.protected_until),
    lastSettledAt: Number(row.last_settled_at),
    lastSeenAt: Number(row.last_seen_at),
    createdAt: Number(row.created_at),
  };
}

/** Every cultivator's header in one read; the tick matches opponents in memory. */
export function allHeaders(ctx: AppContext): CharacterHeader[] {
  const rows = ctx.db.prepare(`SELECT ${COLUMNS} FROM characters`).all() as unknown as RawHeader[];
  return rows.map(toHeader);
}

/** 道号 already taken, so the generator can avoid a unique-constraint failure. */
export function takenNames(ctx: AppContext): Set<string> {
  const rows = ctx.db.prepare('SELECT name FROM characters').all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}
