import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwnHealed } from '../../game/hp.js';
import { listDungeons, startDungeon } from './service.js';

/**
 * `explore.dungeons` / `explore.startDungeon`.
 *
 * These live beside 组队 rather than in the explore module because a run is a
 * party activity: the roster, the shared 血池 and the party broadcasts are all
 * multiplayer concerns.
 */
export const dungeonHandlers: HandlerRegistry = {
  'explore.dungeons': handler(API.explore.dungeons, (c) =>
    listDungeons(loadOwnHealed(c).state, c.world),
  ),

  'explore.startDungeon': handler(API.explore.startDungeon, (c) =>
    startDungeon(
      c.ctx,
      loadOwnHealed(c).state,
      { dungeonId: c.input.dungeonId, withParty: c.input.withParty },
      c.world,
      c.now,
    ),
  ),
};
