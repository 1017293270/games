import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buyPriceAt, sellPriceAt, type ShopTradeResponse, type ShopView } from '@xianxia/shared';
import { shopHandlers } from '../src/modules/shop/routes.js';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

describe('shop', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness({ handlers: shopHandlers });
    player = await makePlayer(h);
  });
  afterEach(async () => {
    await h.close();
  });

  const view = async (shopId: string) =>
    h.app.inject({ method: 'GET', url: `/api/shop/${shopId}`, headers: auth(player.token) });

  const buy = async (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/shop/buy', headers: auth(player.token), payload });

  const sell = async (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/shop/sell', headers: auth(player.token), payload });

  const stonesOf = (): number => h.ctx.characters.byId(player.characterId)!.spiritStones;

  it('shows the shelf with conditions already judged', async () => {
    const shop = expectOk<ShopView>((await view('shop-yaowang')).json());
    expect(shop.shop.name).toBe('百草堂');
    expect(shop.spiritStones).toBe(500);

    const qi = shop.entries.find((e) => e.itemId === 'pill-qi')!;
    expect(qi.itemName).toBe('聚气丹');
    expect(qi.price).toBe(60);
    expect(qi.stockLeft).toBeNull();
    expect(qi.available).toBe(true);

    // 破境丹 is gated on 练气·圆满 for a fresh cultivator.
    const gated = shop.entries.find((e) => e.itemId === 'pill-breakthrough')!;
    expect(gated.available).toBe(false);
    expect(gated.blockedReason).toContain('境界');
    expect(gated.stockLeft).toBe(3);
  });

  it('404s a shop that does not exist', async () => {
    const response = await view('shop-nowhere');
    expect(response.statusCode).toBe(404);
    expect(expectFail(response.json()).code).toBe('SHOP_NOT_FOUND');
  });

  it('buys at the listed price and debits 灵石', async () => {
    const before = stonesOf();
    const result = expectOk<ShopTradeResponse>(
      (await buy({ shopId: 'shop-yaowang', itemId: 'pill-qi', qty: 3 })).json(),
    );
    expect(result.stonesDelta).toBe(-180);
    expect(result.spiritStones).toBe(before - 180);
    expect(stonesOf()).toBe(before - 180);
    // 新手包 already carries three 聚气丹.
    expect(h.ctx.inventory.quantityOf(player.characterId, 'pill-qi')).toBe(6);
    expect(result.view.character.spiritStones).toBe(before - 180);
  });

  it('refuses a purchase the purse cannot cover', async () => {
    const response = await buy({ shopId: 'shop-yaowang', itemId: 'pill-heal', qty: 99 });
    expect(response.statusCode).toBe(409);
    const error = expectFail(response.json());
    expect(error.code).toBe('INSUFFICIENT_STONES');
    expect(error.message).toContain('9900');
    expect(stonesOf()).toBe(500);
  });

  it('refuses an item the shop does not stock', async () => {
    const response = await buy({ shopId: 'shop-yaowang', itemId: 'treasure-seal', qty: 1 });
    expect(response.statusCode).toBe(400);
    expect(expectFail(response.json()).code).toBe('ITEM_NOT_SOLD_HERE');
  });

  it('refuses a shelf whose condition is unmet', async () => {
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, spiritStones: 99_999, lastSettledAt: h.clock.now() });

    const response = await buy({ shopId: 'shop-yaowang', itemId: 'pill-breakthrough', qty: 1 });
    expect(response.statusCode).toBe(403);
    expect(expectFail(response.json()).code).toBe('CONDITION_UNMET');
  });

  it('rations a limited shelf per UTC day and restocks the next one', async () => {
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...current,
      stageIndex: 4,
      spiritStones: 99_999,
      lastSettledAt: h.clock.now(),
    });

    expectOk((await buy({ shopId: 'shop-yaowang', itemId: 'pill-spirit', qty: 4 })).json());
    const shop = expectOk<ShopView>((await view('shop-yaowang')).json());
    expect(shop.entries.find((e) => e.itemId === 'pill-spirit')!.stockLeft).toBe(1);

    const overshoot = await buy({ shopId: 'shop-yaowang', itemId: 'pill-spirit', qty: 2 });
    expect(overshoot.statusCode).toBe(409);
    expect(expectFail(overshoot.json()).code).toBe('OUT_OF_STOCK');

    expectOk((await buy({ shopId: 'shop-yaowang', itemId: 'pill-spirit', qty: 1 })).json());
    const soldOut = await buy({ shopId: 'shop-yaowang', itemId: 'pill-spirit', qty: 1 });
    expect(expectFail(soldOut.json()).code).toBe('OUT_OF_STOCK');

    h.clock.advance(24 * 3600 * 1000);
    const tomorrow = expectOk<ShopView>((await view('shop-yaowang')).json());
    expect(tomorrow.entries.find((e) => e.itemId === 'pill-spirit')!.stockLeft).toBe(5);
    expectOk((await buy({ shopId: 'shop-yaowang', itemId: 'pill-spirit', qty: 1 })).json());
  });

  it('sells at the shop 回收价 and credits 灵石', async () => {
    const row = h.ctx.inventory.list(player.characterId).find((r) => r.itemId === 'mat-spirit-herb')!;
    const unit = sellPriceAt('shop-shangren', 'mat-spirit-herb');
    expect(unit).toBe(3);

    const before = stonesOf();
    const result = expectOk<ShopTradeResponse>(
      (await sell({ shopId: 'shop-shangren', uid: row.uid, qty: 5 })).json(),
    );
    expect(result.stonesDelta).toBe(unit * 5);
    expect(stonesOf()).toBe(before + unit * 5);
    expect(h.ctx.inventory.quantityOf(player.characterId, 'mat-spirit-herb')).toBe(0);
  });

  it('always pays less than it charges for the same shelf', async () => {
    const shop = expectOk<ShopView>((await view('shop-shangren')).json());
    for (const entry of shop.entries) {
      expect(entry.price).toBeGreaterThan(sellPriceAt(shop.shop.id, entry.itemId));
      expect(entry.price).toBe(buyPriceAt(shop.shop.id, entry.itemId));
    }
  });

  it('quotes a buyback price for every bag row the shop will take', async () => {
    const shop = expectOk<ShopView>((await view('shop-yaowang')).json());
    const rows = h.ctx.inventory.list(player.characterId);
    const herb = rows.find((r) => r.itemId === 'mat-spirit-herb')!;
    const sword = rows.find((r) => r.itemId === 'treasure-sword')!;
    // 百草堂 takes 丹药 and 药材, not 法宝.
    expect(shop.sellPrices[herb.uid]).toBe(sellPriceAt('shop-yaowang', 'mat-spirit-herb'));
    expect(shop.sellPrices[sword.uid]).toBeUndefined();
  });

  it('refuses to buy back what the shop does not deal in', async () => {
    const sword = h.ctx.inventory.list(player.characterId).find((r) => r.itemId === 'treasure-sword')!;
    const response = await sell({ shopId: 'shop-yaowang', uid: sword.uid, qty: 1 });
    expect(response.statusCode).toBe(400);
    expect(expectFail(response.json()).code).toBe('ITEM_NOT_SOLD_HERE');
  });

  it('refuses to sell more than the stack holds, or an unknown row', async () => {
    const row = h.ctx.inventory.list(player.characterId).find((r) => r.itemId === 'mat-spirit-herb')!;
    const tooMany = await sell({ shopId: 'shop-shangren', uid: row.uid, qty: 99 });
    expect(tooMany.statusCode).toBe(409);
    expect(expectFail(tooMany.json()).code).toBe('INSUFFICIENT_ITEMS');

    const missing = await sell({ shopId: 'shop-shangren', uid: 'no-such-uid', qty: 1 });
    expect(missing.statusCode).toBe(404);
    expect(expectFail(missing.json()).code).toBe('ITEM_NOT_FOUND');
  });

  it('refuses to sell something that is worn', async () => {
    const row = h.ctx.inventory.list(player.characterId).find((r) => r.itemId === 'robe-linen')!;
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({
      ...current,
      equipment: { ...current.equipment, robe: row.uid },
      lastSettledAt: h.clock.now(),
    });

    const response = await sell({ shopId: 'shop-tiejiang', uid: row.uid, qty: 1 });
    expect(response.statusCode).toBe(409);
    expect(expectFail(response.json()).message).toContain('卸下');
  });
});
