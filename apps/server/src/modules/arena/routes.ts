import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwnHealed } from '../../game/hp.js';
import { challenge, listOpponents } from './service.js';
import { arenaRecordPage } from './repo.js';

/** `arena.*` handlers. */
export const arenaHandlers: HandlerRegistry = {
  'arena.opponents': handler(API.arena.opponents, (c) =>
    listOpponents(c.ctx, loadOwnHealed(c).state, c.world),
  ),

  'arena.challenge': handler(API.arena.challenge, (c) =>
    challenge(c.ctx, loadOwnHealed(c).state, c.input.targetId, c.world, c.now),
  ),

  'arena.records': handler(API.arena.records, (c) => {
    const { state } = loadOwnHealed(c);
    const { items, total } = arenaRecordPage(c.ctx, state.id, c.input.page, c.input.pageSize);
    return {
      items,
      page: c.input.page,
      pageSize: c.input.pageSize,
      total,
      hasMore: c.input.page * c.input.pageSize < total,
    };
  }),
};
