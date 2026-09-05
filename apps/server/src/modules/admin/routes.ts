import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import {
  adminLogin,
  createBots,
  createInvites,
  deleteBot,
  deleteInvite,
  grant,
  listInvites,
  listPlayers,
  putSettings,
  resetPassword,
  setBanned,
  stats,
  updateArchetype,
  updateBot,
} from './service.js';
import { botPage } from './repo.js';

/** `admin.*` handlers: world tuning, bots, players and invites. */
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

  'admin.listPlayers': handler(API.admin.listPlayers, (c) => {
    const query: Parameters<typeof listPlayers>[1] = {
      page: c.input.page,
      pageSize: c.input.pageSize,
    };
    if (c.input.q !== undefined) query.q = c.input.q;
    if (c.input.onlyBanned !== undefined) query.onlyBanned = c.input.onlyBanned;
    return listPlayers(c.ctx, query);
  }),

  'admin.grant': handler(API.admin.grant, (c) => {
    const input: Parameters<typeof grant>[1] = { characterId: c.input.characterId };
    if (c.input.exp !== undefined) input.exp = c.input.exp;
    if (c.input.spiritStones !== undefined) input.spiritStones = c.input.spiritStones;
    if (c.input.stageIndex !== undefined) input.stageIndex = c.input.stageIndex;
    if (c.input.items !== undefined) input.items = c.input.items;
    return grant(c.ctx, input, c.now);
  }),

  'admin.resetPassword': handler(API.admin.resetPassword, (c) => {
    resetPassword(c.ctx, c.input);
    return {};
  }),

  'admin.ban': handler(API.admin.ban, (c) => {
    const input: Parameters<typeof setBanned>[1] = {
      userId: c.input.userId,
      banned: c.input.banned,
    };
    if (c.input.reason !== undefined) input.reason = c.input.reason;
    return setBanned(c.ctx, input);
  }),

  'admin.listInvites': handler(API.admin.listInvites, (c) => ({
    invites: listInvites(c.ctx),
  })),

  'admin.createInvites': handler(API.admin.createInvites, (c) => ({
    invites: createInvites(c.ctx, c.input, c.admin?.username ?? 'admin', c.now),
  })),

  'admin.deleteInvite': handler(API.admin.deleteInvite, (c) => ({
    invites: deleteInvite(c.ctx, c.input.code),
  })),

  'admin.stats': handler(API.admin.stats, (c) => stats(c.ctx, c.now)),
};
