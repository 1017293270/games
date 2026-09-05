import {
  getStage,
  isPerfection,
  MAX_STAGE_INDEX,
  stageName,
  type BotSummary,
  type CharacterState,
  type Invite,
  type PlayerSummary,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import type { CharacterSort } from '../../db/repo/characters.js';
import type { InviteRow } from '../../db/repo/invites.js';
import type { UserRow } from '../../db/repo/users.js';

/** The admin panel's read side. */

/** `BotListQuery.sort` -> the column ordering the repo understands. */
export const BOT_SORT: Record<'stage' | 'power' | 'name' | 'rating', CharacterSort> = {
  stage: 'realm',
  power: 'power',
  name: 'name',
  rating: 'arena',
};

/** Shapes a bot for the panel, resolving its archetype's display name. */
export function toBotSummary(
  ctx: AppContext,
  state: CharacterState,
  archetypeNames: ReadonlyMap<string, string>,
): BotSummary {
  return {
    characterId: state.id,
    name: state.name,
    avatarArt: state.avatarArt,
    gender: state.gender,
    archetypeId: state.botArchetypeId,
    archetypeName:
      state.botArchetypeId === null ? null : (archetypeNames.get(state.botArchetypeId) ?? null),
    spiritRoot: state.spiritRoot,
    stageIndex: state.stageIndex,
    stageName: stageName(state.stageIndex),
    exp: state.exp,
    powerScore: state.powerScore,
    params: state.botParams ?? {
      talent: 1,
      diligence: 1,
      insight: 0,
      aggression: 0,
      activeHours: [0, 24],
      explorePref: 'cultivate',
    },
    lastSettledAt: state.lastSettledAt,
    arenaRating: state.arenaRating,
    hpPercent: state.hpPercent,
  };
}

export interface BotPageQuery {
  page: number;
  pageSize: number;
  sort: 'stage' | 'power' | 'name' | 'rating';
  order: 'asc' | 'desc';
  archetypeId?: string;
  q?: string;
}

export function botPage(
  ctx: AppContext,
  query: BotPageQuery,
): { items: BotSummary[]; total: number } {
  const names = new Map(ctx.archetypes.all().map((a) => [a.id, a.name]));
  const options: Parameters<AppContext['characters']['pageStates']>[0] = {
    sort: BOT_SORT[query.sort],
    order: query.order,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
    isBot: true,
  };
  if (query.archetypeId) options.archetypeId = query.archetypeId;
  if (query.q) options.nameLike = query.q;

  const { states, total } = ctx.characters.pageStates(options);
  return { items: states.map((s) => toBotSummary(ctx, s, names)), total };
}

/** Clamps 修为 into the target stage so a hand-set value stays coherent. */
export function clampExpToStage(stageIndex: number, exp: number): number {
  return Math.max(0, Math.min(exp, getStage(stageIndex).expRequired));
}

/* ------------------------------------------------------------------- 玩家 */

/** The character columns the player list needs, without the JSON blob. */
interface PlayerCharacterRow {
  id: string;
  user_id: string;
  name: string;
  stage_index: number;
  power: number;
  spirit_stones: number;
  last_seen_at: number;
}

/**
 * Cultivators belonging to a batch of accounts, in one query.
 *
 * The player list renders `pageSize` rows, so this reads the denormalised
 * columns for the whole page rather than deserialising a `state_json` per row.
 */
function playerCharacters(
  ctx: AppContext,
  userIds: readonly string[],
): Map<string, PlayerCharacterRow> {
  if (userIds.length === 0) return new Map();
  const holes = userIds.map(() => '?').join(',');
  const rows = ctx.db
    .prepare(
      'SELECT id, user_id, name, stage_index, power, spirit_stones, last_seen_at' +
        ` FROM characters WHERE is_bot = 0 AND user_id IN (${holes})`,
    )
    .all(...userIds) as unknown as PlayerCharacterRow[];
  return new Map(rows.map((row) => [row.user_id, row]));
}

function toPlayerSummary(
  ctx: AppContext,
  user: UserRow,
  character: PlayerCharacterRow | undefined,
): PlayerSummary {
  return {
    userId: user.id,
    username: user.username,
    characterId: character?.id ?? null,
    characterName: character?.name ?? null,
    stageIndex: character ? Number(character.stage_index) : null,
    stageName: character ? stageName(Number(character.stage_index)) : null,
    powerScore: character ? Number(character.power) : null,
    spiritStones: character ? Number(character.spirit_stones) : null,
    banned: user.banned,
    isAdmin: user.isAdmin,
    online: character ? ctx.presence.isOnline(character.id) : false,
    createdAt: user.createdAt,
    lastSeenAt: character ? Number(character.last_seen_at) : null,
  };
}

/** One account's panel row; used by `ban` to answer with the new state. */
export function playerSummaryOf(ctx: AppContext, user: UserRow): PlayerSummary {
  return toPlayerSummary(ctx, user, playerCharacters(ctx, [user.id]).get(user.id));
}

export interface PlayerPageQuery {
  page: number;
  pageSize: number;
  q?: string;
  onlyBanned?: boolean;
}

export function playerPage(
  ctx: AppContext,
  query: PlayerPageQuery,
): { items: PlayerSummary[]; total: number } {
  const filter: { q?: string; onlyBanned?: boolean } = {};
  if (query.q) filter.q = query.q;
  if (query.onlyBanned) filter.onlyBanned = true;

  const { rows, total } = ctx.users.list(
    query.pageSize,
    (query.page - 1) * query.pageSize,
    filter,
  );
  const characters = playerCharacters(
    ctx,
    rows.map((r) => r.id),
  );
  return { items: rows.map((user) => toPlayerSummary(ctx, user, characters.get(user.id))), total };
}

/**
 * Adds 修为 the way the clock would: 小境界 roll over automatically and 圆满
 * parks, waiting for an explicit breakthrough. Mirrors `settleCultivation`, so
 * a granted point behaves exactly like a cultivated one.
 */
export function addExp(
  stageIndex: number,
  exp: number,
  amount: number,
): { stageIndex: number; exp: number } {
  let stage = stageIndex;
  let current = Math.max(0, exp);
  let left = Math.max(0, amount);

  for (;;) {
    const required = getStage(stage).expRequired;
    const missing = required - current;
    if (left < missing) return { stageIndex: stage, exp: current + left };
    if (isPerfection(stage) || stage >= MAX_STAGE_INDEX) return { stageIndex: stage, exp: required };
    left -= missing;
    stage += 1;
    current = 0;
  }
}

/* ----------------------------------------------------------------- 邀请码 */

/**
 * Trims a stored invite to the wire shape.
 *
 * `InviteSchema` carries no `maxUses`/`uses`, so the panel reads redemption
 * from `usedAt`; the unlimited bootstrap code is recognised by its `createdBy`.
 */
export function toInviteView(row: InviteRow): Invite {
  return {
    code: row.code,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    usedBy: row.usedBy,
    usedAt: row.usedAt,
    expiresAt: row.expiresAt,
    note: row.note,
  };
}
