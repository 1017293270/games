import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { CharacterStateSchema, type CharacterState } from '@xianxia/shared';

/**
 * Cultivator storage.
 *
 * `state_json` is the record of truth — it round-trips through
 * `CharacterStateSchema`, so a new field added to the shared schema needs no
 * migration here. The columns beside it are denormalised copies kept in sync on
 * every write purely so rankings, admin lists and the bot tick can sort and
 * filter without deserialising hundreds of blobs.
 */

/** The denormalised columns, enough to render a ranking row. */
export interface CharacterHeader {
  id: string;
  userId: string;
  name: string;
  isBot: boolean;
  archetypeId: string | null;
  gender: string;
  avatarArt: string;
  stageIndex: number;
  exp: number;
  power: number;
  arenaScore: number;
  spiritStones: number;
  raidHp: number;
  protectedUntil: number;
  lastSettledAt: number;
  lastSeenAt: number;
  createdAt: number;
}

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

const HEADER_COLUMNS =
  'id, user_id, name, is_bot, archetype_id, gender, avatar_art, stage_index, exp, power,' +
  ' arena_score, spirit_stones, raid_hp, protected_until, last_settled_at, last_seen_at, created_at';

/** Sort orders `rankings` and the admin bot list expose. */
export type CharacterSort = 'realm' | 'power' | 'arena' | 'name' | 'created';

const ORDER_BY: Record<CharacterSort, string> = {
  realm: 'stage_index DESC, exp DESC, created_at ASC',
  power: 'power DESC, stage_index DESC, created_at ASC',
  arena: 'arena_score DESC, power DESC, created_at ASC',
  name: 'name ASC',
  created: 'created_at DESC',
};

export class CharacterRepo {
  /** Prepared once: the bot tick writes a few hundred rows through these. */
  private readonly insertStmt: StatementSync;
  private readonly updateStmt: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    this.insertStmt = db.prepare(
      'INSERT INTO characters (id, user_id, name, is_bot, archetype_id, bot_params_json, gender,' +
        ' avatar_art, stage_index, exp, power, arena_score, spirit_stones, prestige, raid_hp,' +
        ' protected_until, last_settled_at, last_seen_at, created_at, state_json)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.updateStmt = db.prepare(
      'UPDATE characters SET name = ?, archetype_id = ?, bot_params_json = ?, gender = ?,' +
        ' avatar_art = ?, stage_index = ?, exp = ?, power = ?, arena_score = ?, spirit_stones = ?,' +
        ' prestige = ?, raid_hp = ?, protected_until = ?, last_settled_at = ?, last_seen_at = ?,' +
        ' state_json = ? WHERE id = ?',
    );
  }

  insert(state: CharacterState): void {
    this.insertStmt.run(
      state.id,
      state.userId,
      state.name,
      state.isBot ? 1 : 0,
      state.botArchetypeId,
      state.botParams === null ? null : JSON.stringify(state.botParams),
      state.gender,
      state.avatarArt,
      state.stageIndex,
      state.exp,
      state.powerScore,
      state.arenaRating,
      state.spiritStones,
      state.prestige,
      state.hpPercent,
      state.protectedUntil,
      state.lastSettledAt,
      state.lastSeenAt,
      state.createdAt,
      JSON.stringify(state),
    );
  }

  /** Writes the full record and refreshes every denormalised column. */
  save(state: CharacterState): void {
    this.updateStmt.run(
      state.name,
      state.botArchetypeId,
      state.botParams === null ? null : JSON.stringify(state.botParams),
      state.gender,
      state.avatarArt,
      state.stageIndex,
      state.exp,
      state.powerScore,
      state.arenaRating,
      state.spiritStones,
      state.prestige,
      state.hpPercent,
      state.protectedUntil,
      state.lastSettledAt,
      state.lastSeenAt,
      JSON.stringify(state),
      state.id,
    );
  }

  saveMany(states: readonly CharacterState[]): void {
    for (const state of states) this.save(state);
  }

  byId(id: string): CharacterState | null {
    const row = this.db.prepare('SELECT state_json FROM characters WHERE id = ?').get(id) as
      | { state_json: string }
      | undefined;
    return row ? parseState(row.state_json) : null;
  }

  byUserId(userId: string): CharacterState | null {
    const row = this.db
      .prepare('SELECT state_json FROM characters WHERE user_id = ? AND is_bot = 0')
      .get(userId) as { state_json: string } | undefined;
    return row ? parseState(row.state_json) : null;
  }

  byIds(ids: readonly string[]): CharacterState[] {
    if (ids.length === 0) return [];
    const holes = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT state_json FROM characters WHERE id IN (${holes})`)
      .all(...ids) as { state_json: string }[];
    return rows.map((r) => parseState(r.state_json));
  }

  /** Case-insensitive 道号 collision check. */
  nameTaken(name: string): boolean {
    return (
      this.db.prepare('SELECT 1 AS hit FROM characters WHERE name = ? COLLATE NOCASE').get(name) !==
      undefined
    );
  }

  headerById(id: string): CharacterHeader | null {
    const row = this.db
      .prepare(`SELECT ${HEADER_COLUMNS} FROM characters WHERE id = ?`)
      .get(id) as RawHeader | undefined;
    return row ? toHeader(row) : null;
  }

  /** All bots, fully deserialised. The bot tick's read side. */
  allBots(): CharacterState[] {
    const rows = this.db
      .prepare('SELECT state_json FROM characters WHERE is_bot = 1 ORDER BY created_at')
      .all() as { state_json: string }[];
    return rows.map((r) => parseState(r.state_json));
  }

  countBots(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM characters WHERE is_bot = 1').get() as {
      c: number;
    };
    return Number(row.c);
  }

  countPlayers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM characters WHERE is_bot = 0').get() as {
      c: number;
    };
    return Number(row.c);
  }

  /** Bot population per archetype id. */
  botsByArchetype(): Record<string, number> {
    const rows = this.db
      .prepare(
        'SELECT COALESCE(archetype_id, \'\') AS a, COUNT(*) AS c FROM characters' +
          ' WHERE is_bot = 1 GROUP BY a',
      )
      .all() as { a: string; c: number }[];
    const out: Record<string, number> = {};
    for (const row of rows) out[row.a] = Number(row.c);
    return out;
  }

  /** Bot population per major realm, index 0-8. */
  botsByRealm(): number[] {
    const out = new Array<number>(9).fill(0);
    const rows = this.db
      .prepare(
        'SELECT stage_index / 4 AS realm, COUNT(*) AS c FROM characters WHERE is_bot = 1' +
          ' GROUP BY realm',
      )
      .all() as { realm: number; c: number }[];
    for (const row of rows) {
      const realm = Number(row.realm);
      if (realm >= 0 && realm < out.length) out[realm] = Number(row.c);
    }
    return out;
  }

  /**
   * Paged listing over the denormalised columns.
   * `onlyIds` narrows to a set (used for the online-only filter).
   */
  page(options: {
    sort: CharacterSort;
    order?: 'asc' | 'desc';
    limit: number;
    offset: number;
    isBot?: boolean;
    archetypeId?: string;
    nameLike?: string;
    onlyIds?: readonly string[];
  }): { rows: CharacterHeader[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];

    if (options.isBot !== undefined) {
      where.push('is_bot = ?');
      args.push(options.isBot ? 1 : 0);
    }
    if (options.archetypeId) {
      where.push('archetype_id = ?');
      args.push(options.archetypeId);
    }
    if (options.nameLike) {
      where.push('name LIKE ?');
      args.push(`%${options.nameLike}%`);
    }
    if (options.onlyIds) {
      if (options.onlyIds.length === 0) return { rows: [], total: 0 };
      where.push(`id IN (${options.onlyIds.map(() => '?').join(',')})`);
      args.push(...options.onlyIds);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS c FROM characters ${clause}`).get(...args) as {
          c: number;
        }
      ).c,
    );

    let orderBy = ORDER_BY[options.sort];
    if (options.order === 'asc') orderBy = orderBy.replaceAll('DESC', 'ASC');

    const rows = this.db
      .prepare(`SELECT ${HEADER_COLUMNS} FROM characters ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...args, options.limit, options.offset) as unknown as RawHeader[];

    return { rows: rows.map(toHeader), total };
  }

  /** Full records for a page, in the page's order. */
  pageStates(options: Parameters<CharacterRepo['page']>[0]): {
    states: CharacterState[];
    total: number;
  } {
    const { rows, total } = this.page(options);
    const byId = new Map(this.byIds(rows.map((r) => r.id)).map((s) => [s.id, s]));
    const states: CharacterState[] = [];
    for (const row of rows) {
      const state = byId.get(row.id);
      if (state) states.push(state);
    }
    return { states, total };
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  touchSeen(id: string, now: number): void {
    this.db.prepare('UPDATE characters SET last_seen_at = ? WHERE id = ?').run(now, id);
  }
}

function parseState(json: string): CharacterState {
  return CharacterStateSchema.parse(JSON.parse(json));
}
