import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwn } from '../../game/access.js';
import { equip, list, unequip, useItem } from './service.js';

/** `inventory.*` handlers. */
export const inventoryHandlers: HandlerRegistry = {
  'inventory.list': handler(API.inventory.list, (c) =>
    list(c.ctx, loadOwn(c).state, c.world, c.now),
  ),

  'inventory.use': handler(API.inventory.use, (c) =>
    useItem(c.ctx, loadOwn(c).state, c.input.uid, c.input.qty, c.world, c.now),
  ),

  'inventory.equip': handler(API.inventory.equip, (c) =>
    equip(c.ctx, loadOwn(c).state, c.input.uid, c.world, c.now),
  ),

  'inventory.unequip': handler(API.inventory.unequip, (c) =>
    unequip(c.ctx, loadOwn(c).state, c.input.slot, c.world, c.now),
  ),
};
