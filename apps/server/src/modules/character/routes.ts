import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { ApiError, MESSAGES } from '../../http/errors.js';
import { loadOwn, loadOther } from '../../game/access.js';
import { buildPublicProfile, buildView } from '../../game/character.js';
import {
  breakthrough,
  createCharacter,
  equipSkills,
  learnSkill,
  learnTechnique,
  setTechnique,
  settleResponse,
} from './service.js';
import { cultivatorPage, rankingPage } from './repo.js';

/** `character.*` handlers. */
export const characterHandlers: HandlerRegistry = {
  'character.create': handler(API.character.create, (c) => {
    if (!c.identity) throw new ApiError('UNAUTHORIZED', MESSAGES.UNAUTHORIZED);
    return createCharacter(c.ctx, c.identity.user.id, c.input, c.world, c.now);
  }),

  'character.get': handler(API.character.get, (c) => {
    const { state } = loadOwn(c);
    return buildView(state, c.world, c.now, c.ctx.inventory);
  }),

  'character.settle': handler(API.character.settle, (c) => {
    const loaded = loadOwn(c);
    c.ctx.realtime.characterUpdate(loaded.state);
    return settleResponse(c.ctx, loaded, c.world, c.now);
  }),

  'character.breakthrough': handler(API.character.breakthrough, (c) =>
    breakthrough(c.ctx, loadOwn(c), c.input.pills, c.world, c.now),
  ),

  'character.equipSkills': handler(API.character.equipSkills, (c) =>
    equipSkills(c.ctx, loadOwn(c).state, c.input.slots, c.world, c.now),
  ),

  'character.learnSkill': handler(API.character.learnSkill, (c) =>
    learnSkill(c.ctx, loadOwn(c).state, c.input.skillId, c.world, c.now),
  ),

  'character.setTechnique': handler(API.character.setTechnique, (c) =>
    setTechnique(c.ctx, loadOwn(c).state, c.input.techniqueId, c.world, c.now),
  ),

  'character.learnTechnique': handler(API.character.learnTechnique, (c) =>
    learnTechnique(c.ctx, loadOwn(c).state, c.input.techniqueId, c.world, c.now),
  ),

  'character.publicProfile': handler(API.character.publicProfile, (c) => {
    const id = c.params.id ?? '';
    const state = loadOther(c.ctx, id, c.world, c.now);
    if (!state) throw new ApiError('CHARACTER_NOT_FOUND', '查无此人');
    return buildPublicProfile(state, c.ctx.presence.isOnline(state.id), c.ctx.inventory);
  }),

  'character.cultivators': handler(API.character.cultivators, (c) => {
    const query: Parameters<typeof cultivatorPage>[1] = {
      page: c.input.page,
      pageSize: c.input.pageSize,
    };
    if (c.input.q !== undefined) query.q = c.input.q;
    if (c.input.onlyOnline !== undefined) query.onlyOnline = c.input.onlyOnline;

    const { items, total } = cultivatorPage(c.ctx, query);
    return {
      items,
      page: c.input.page,
      pageSize: c.input.pageSize,
      total,
      hasMore: c.input.page * c.input.pageSize < total,
    };
  }),

  'character.rankings': handler(API.character.rankings, (c) => {
    const { items, total } = rankingPage(c.ctx, c.input.board, {
      page: c.input.page,
      pageSize: c.input.pageSize,
    });
    return {
      board: c.input.board,
      items,
      page: c.input.page,
      pageSize: c.input.pageSize,
      total,
      hasMore: c.input.page * c.input.pageSize < total,
    };
  }),
};
