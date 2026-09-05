import {
  getStage,
  stageName,
  type BotSummary,
  type CharacterState,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import type { CharacterSort } from '../../db/repo/characters.js';

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
