import { API } from '@xianxia/shared';
import { handler, type HandlerRegistry } from '../../http/handler.js';
import { loadOwn } from '../../game/access.js';
import { buy, sell, shopView } from './service.js';

/** `shop.*` handlers: 货架、买入与卖出. */
export const shopHandlers: HandlerRegistry = {
  // `shopId` rides in the path, so it arrives through `params` rather than the
  // parsed query — the GET request schema exists only to name the field.
  'shop.list': handler(API.shop.list, (c) => {
    const { state } = loadOwn(c);
    return shopView(c.ctx, state, c.params.shopId ?? c.input.shopId, c.now);
  }),

  'shop.buy': handler(API.shop.buy, (c) => {
    const { state } = loadOwn(c);
    return buy(c.ctx, state, c.input, c.world, c.now);
  }),

  'shop.sell': handler(API.shop.sell, (c) => {
    const { state } = loadOwn(c);
    return sell(c.ctx, state, c.input, c.world, c.now);
  }),
};
