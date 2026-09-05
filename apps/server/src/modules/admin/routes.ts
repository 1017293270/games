import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import {
  adminLogin,
  createBots,
  deleteBot,
  putSettings,
  stats,
  updateArchetype,
  updateBot,
} from './service.js';
import { botPage } from './repo.js';

/** `admin.*` handlers. Player management and invites arrive with W4. */
export const adminHandlers: HandlerRegistry = {
  'admin.login': handler(API.admin.login, (c) => adminLogin(c.ctx, c.input, c.now)),

  'admin.getSettings': handler(API.admin.getSettings, (c) => c.ctx.settings.get()),

  'admin.putSettings': handler(API.admin.putSettings, (c) => putSettings(c.ctx, c.input)),

  'admin.listBots': handler(API.admin.listBots, (c) => {
    const query: Parameters<typeof botPage>[1] = {
      page: c.input.page,
      pageSize: c.input.pageSize,
      sort: c.input.sort,
      order: c.input.order,
    };
    if (c.input.archetypeId !== undefined) query.archetypeId = c.input.archetypeId;
    if (c.input.q !== undefined) query.q = c.input.q;

    const { items, total } = botPage(c.ctx, query);
    return {
      items,
      page: c.input.page,
      pageSize: c.input.pageSize,
      total,
      hasMore: c.input.page * c.input.pageSize < total,
    };
  }),

  'admin.generateBots': handler(API.admin.generateBots, (c) => {
    const input: Parameters<typeof createBots>[1] = {
      count: c.input.count,
      minStageIndex: c.input.minStageIndex,
      maxStageIndex: c.input.maxStageIndex,
    };
    if (c.input.archetypeId !== undefined) input.archetypeId = c.input.archetypeId;
    if (c.input.seed !== undefined) input.seed = c.input.seed;
    return createBots(c.ctx, input, c.now);
  }),

  'admin.updateBot': handler(API.admin.updateBot, (c) => updateBot(c.ctx, c.input, c.now)),

  'admin.deleteBot': handler(API.admin.deleteBot, (c) => {
    deleteBot(c.ctx, c.input.characterId);
    return {};
  }),

  'admin.listBotArchetypes': handler(API.admin.listBotArchetypes, (c) => ({
    archetypes: c.ctx.archetypes.all(),
  })),

  'admin.updateBotArchetype': handler(API.admin.updateBotArchetype, (c) => ({
    archetypes: updateArchetype(c.ctx, c.input, c.now),
  })),

  'admin.stats': handler(API.admin.stats, (c) => stats(c.ctx, c.now)),
};
