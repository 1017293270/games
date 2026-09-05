import {
  buyPriceAt,
  dayKey,
  ITEM_BY_ID,
  sellPriceAt,
  SHOP_BY_ID,
  shopAcceptsItem,
  type CharacterState,
  type ShopEntry,
  type ShopTradeResponse,
  type ShopView,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildView, resolveEquipment, withFreshPower } from '../../game/character.js';
import { firstBlockReason } from '../../game/rewards.js';

/**
 * 商店.
 *
 * Prices come from the content table (`buyPriceAt` / `sellPriceAt`), never from
 * the request. Limited shelves are rationed per UTC day through the
 * `shop_purchases` ledger, which needs no sweeper: yesterday's rows simply stop
 * matching today's `day` key.
 */

/** How much of one shelf the character has already bought today. */
function boughtToday(ctx: AppContext, characterId: string, shopId: string, itemId: string, now: number): number {
  const row = ctx.db
    .prepare(
      'SELECT qty FROM shop_purchases WHERE character_id = ? AND shop_id = ? AND item_id = ? AND day = ?',
    )
    .get(characterId, shopId, itemId, dayKey(now)) as { qty: number } | undefined;
  return row ? Number(row.qty) : 0;
}

function recordPurchase(
  ctx: AppContext,
  characterId: string,
  shopId: string,
  itemId: string,
  qty: number,
  now: number,
): void {
  ctx.db
    .prepare(
      'INSERT INTO shop_purchases (character_id, shop_id, item_id, day, qty) VALUES (?, ?, ?, ?, ?)' +
        ' ON CONFLICT(character_id, shop_id, item_id, day) DO UPDATE SET qty = qty + excluded.qty',
    )
    .run(characterId, shopId, itemId, dayKey(now), qty);
}

function requireShop(shopId: string) {
  const shop = SHOP_BY_ID.get(shopId);
  if (!shop) throw new ApiError('SHOP_NOT_FOUND', '这里没有这家铺子');
  return shop;
}

/** Units left on a limited shelf today; null when the shelf is unlimited. */
function stockLeft(
  ctx: AppContext,
  state: CharacterState,
  shopId: string,
  entry: ShopEntry,
  now: number,
): number | null {
  if (entry.dailyStock === null) return null;
  return Math.max(0, entry.dailyStock - boughtToday(ctx, state.id, shopId, entry.itemId, now));
}

/** 货架 + 回收价. */
export function shopView(
  ctx: AppContext,
  state: CharacterState,
  shopId: string,
  now: number,
): ShopView {
  const shop = requireShop(shopId);

  const entries = shop.entries.map((entry) => {
    const item = ITEM_BY_ID.get(entry.itemId);
    const blocked = firstBlockReason(entry.conditions, { state, inventory: ctx.inventory });
    const left = stockLeft(ctx, state, shop.id, entry, now);
    const soldOut = left !== null && left <= 0;
    return {
      itemId: entry.itemId,
      itemName: item?.name ?? entry.itemId,
      itemArt: item?.art ?? '',
      price: entry.price,
      stockLeft: left,
      available: blocked === null && !soldOut,
      blockedReason: blocked ?? (soldOut ? '今日已售罄，明日再来' : null),
    };
  });

  // One price per inventory row the shop will take, keyed by uid so the client
  // can label the 卖出 column without a second lookup.
  const equipped = new Set(Object.values(state.equipment).filter((u): u is string => u !== null));
  const sellPrices: Record<string, number> = {};
  for (const row of ctx.inventory.list(state.id)) {
    if (equipped.has(row.uid)) continue;
    if (!shopAcceptsItem(shop.id, row.itemId)) continue;
    sellPrices[row.uid] = sellPriceAt(shop.id, row.itemId);
  }

  return { shop, entries, spiritStones: state.spiritStones, sellPrices };
}

/** Persists a trade and pushes the new 灵石 balance. */
function settleTrade(
  ctx: AppContext,
  state: CharacterState,
  shopId: string,
  stonesDelta: number,
  world: WorldSettings,
  now: number,
): ShopTradeResponse {
  const saved = withFreshPower(state, resolveEquipment(state, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);
  return {
    shopView: shopView(ctx, saved, shopId, now),
    spiritStones: saved.spiritStones,
    stonesDelta,
    view: buildView(saved, world, now, ctx.inventory),
  };
}

/** 购买. */
export function buy(
  ctx: AppContext,
  state: CharacterState,
  input: { shopId: string; itemId: string; qty: number },
  world: WorldSettings,
  now: number,
): ShopTradeResponse {
  const shop = requireShop(input.shopId);
  const entry = shop.entries.find((e) => e.itemId === input.itemId);
  const unitPrice = buyPriceAt(shop.id, input.itemId);
  if (!entry || unitPrice === null) {
    const name = ITEM_BY_ID.get(input.itemId)?.name ?? input.itemId;
    throw new ApiError('ITEM_NOT_SOLD_HERE', `${shop.name}不卖${name}`);
  }

  const blocked = firstBlockReason(entry.conditions, { state, inventory: ctx.inventory });
  if (blocked !== null) throw new ApiError('CONDITION_UNMET', blocked);

  const qty = Math.max(1, Math.floor(input.qty));
  const left = stockLeft(ctx, state, shop.id, entry, now);
  if (left !== null && left < qty) {
    throw new ApiError(
      'OUT_OF_STOCK',
      left <= 0 ? '今日已售罄，明日再来' : `今日只剩 ${left} 件`,
    );
  }

  const total = unitPrice * qty;
  if (state.spiritStones < total) {
    throw new ApiError('INSUFFICIENT_STONES', `灵石不足，需 ${total}，你只有 ${state.spiritStones}`);
  }

  ctx.inventory.add(state.id, input.itemId, qty);
  recordPurchase(ctx, state.id, shop.id, input.itemId, qty, now);

  const next: CharacterState = { ...state, spiritStones: state.spiritStones - total };
  return settleTrade(ctx, next, shop.id, -total, world, now);
}

/** 出售, at the shop's own `buybackRate`. */
export function sell(
  ctx: AppContext,
  state: CharacterState,
  input: { shopId: string; uid: string; qty: number },
  world: WorldSettings,
  now: number,
): ShopTradeResponse {
  const shop = requireShop(input.shopId);

  const row = ctx.inventory.byUid(input.uid);
  if (!row || row.characterId !== state.id) {
    throw new ApiError('ITEM_NOT_FOUND', '背包里没有这件物品');
  }

  const equipped = Object.values(state.equipment).includes(row.uid);
  if (equipped) {
    const name = ITEM_BY_ID.get(row.itemId)?.name ?? row.itemId;
    throw new ApiError('INSUFFICIENT_ITEMS', `${name}正穿在身上，先卸下再卖`);
  }

  if (!shopAcceptsItem(shop.id, row.itemId)) {
    const name = ITEM_BY_ID.get(row.itemId)?.name ?? row.itemId;
    throw new ApiError('ITEM_NOT_SOLD_HERE', `${shop.name}不收${name}`);
  }

  const qty = Math.max(1, Math.floor(input.qty));
  if (row.qty < qty) {
    throw new ApiError('INSUFFICIENT_ITEMS', `数量不足，只剩 ${row.qty} 个`);
  }

  const total = sellPriceAt(shop.id, row.itemId) * qty;
  ctx.inventory.removeFromStack(row.uid, qty);

  const next: CharacterState = { ...state, spiritStones: state.spiritStones + total };
  return settleTrade(ctx, next, shop.id, total, world, now);
}
