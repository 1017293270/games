import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwnHealed } from '../../game/hp.js';
import { attack, listTargets } from './service.js';

/** `raid.*` handlers. */
export const raidHandlers: HandlerRegistry = {
  'raid.targets': handler(API.raid.targets, (c) => {
    loadOwnHealed(c);
    return listTargets(c.ctx, c.now);
  }),

  'raid.attack': handler(API.raid.attack, (c) =>
    attack(
      c.ctx,
      loadOwnHealed(c).state,
      { botId: c.input.botId, withParty: c.input.withParty },
      c.world,
      c.now,
    ),
  ),
};
