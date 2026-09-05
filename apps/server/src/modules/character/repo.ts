import { stageName, type PublicProfile, type RankingEntry } from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import type { CharacterHeader, CharacterSort } from '../../db/repo/characters.js';
import { buildPublicProfile } from '../../game/character.js';

/**
 * The listing queries the 修士名录 and 排行榜 own.
 *
 * Rankings read only the denormalised columns, so a 200-bot board costs one
 * indexed scan and no JSON parsing; the directory needs full profiles and
 * therefore deserialises just the page it returns.
 */

export interface PageRequest {
  page: number;
  pageSize: number;
}

function bounds(request: PageRequest): { limit: number; offset: number } {
  return { limit: request.pageSize, offset: (request.page - 1) * request.pageSize };
}

/** Board -> the column ordering `CharacterRepo.page` understands. */
export const BOARD_SORT: Record<'realm' | 'power' | 'arena', CharacterSort> = {
  realm: 'realm',
  power: 'power',
  arena: 'arena',
};

/** A page of the ranking board, players and bots mixed. */
export function rankingPage(
  ctx: AppContext,
  board: 'realm' | 'power' | 'arena',
  request: PageRequest,
): { items: RankingEntry[]; total: number } {
  const { limit, offset } = bounds(request);
  const { rows, total } = ctx.characters.page({ sort: BOARD_SORT[board], limit, offset });
  return { items: rows.map((row, i) => toRankingEntry(ctx, row, offset + i + 1)), total };
}

function toRankingEntry(ctx: AppContext, row: CharacterHeader, rank: number): RankingEntry {
  return {
    rank,
    characterId: row.id,
    name: row.name,
    avatarArt: row.avatarArt as RankingEntry['avatarArt'],
    isBot: row.isBot,
    stageIndex: row.stageIndex,
    stageName: stageName(row.stageIndex),
    powerScore: row.power,
    arenaRating: row.arenaScore,
    online: ctx.presence.isOnline(row.id),
  };
}

/** A page of the 修士名录. */
export function cultivatorPage(
  ctx: AppContext,
  request: PageRequest & { q?: string; onlyOnline?: boolean },
): { items: PublicProfile[]; total: number } {
  const { limit, offset } = bounds(request);
  const query: Parameters<AppContext['characters']['pageStates']>[0] = {
    sort: 'power',
    limit,
    offset,
  };
  if (request.q) query.nameLike = request.q;
  if (request.onlyOnline) query.onlyIds = ctx.presence.ids();

  const { states, total } = ctx.characters.pageStates(query);
  return {
    items: states.map((state) =>
      buildPublicProfile(state, ctx.presence.isOnline(state.id), ctx.inventory),
    ),
    total,
  };
}
