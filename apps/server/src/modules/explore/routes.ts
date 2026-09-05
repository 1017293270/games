import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwn } from '../../game/access.js';
import { chooseEncounter, explore, gather, listMaps } from './service.js';

/** `explore.*` handlers. 秘境副本 arrives with the dungeon module. */
export const exploreHandlers: HandlerRegistry = {
  'explore.maps': handler(API.explore.maps, (c) => listMaps(loadOwn(c).state, c.now)),

  'explore.battle': handler(API.explore.battle, (c) => {
    const input: { mapId: string; monsterId?: string } = { mapId: c.input.mapId };
    if (c.input.monsterId !== undefined) input.monsterId = c.input.monsterId;
    return explore(c.ctx, loadOwn(c).state, input, c.world, c.now);
  }),

  'explore.gather': handler(API.explore.gather, (c) =>
    gather(c.ctx, loadOwn(c).state, c.input.mapId, c.world, c.now),
  ),

  'explore.chooseEvent': handler(API.explore.chooseEvent, (c) =>
    chooseEncounter(c.ctx, loadOwn(c).state, c.input, c.world, c.now),
  ),
};
