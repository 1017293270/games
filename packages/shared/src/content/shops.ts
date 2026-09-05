/**
 * 商店. Three shops in 青云镇. Buy prices are set per shop entry; sell prices
 * come from the item multiplied by the shop's `buybackRate`, so the merchant
 * always haggles and the alchemist pays a fair price for herbs.
 */

import { indexById } from '../core/util.js';
import type { ItemKind } from '../domain/item.js';
import { ShopSchema, type Shop } from '../domain/shop.js';
import { ITEM_BY_ID } from './items.js';

const SPECS: Shop[] = [
  {
    id: 'shop-yaowang',
    name: '百草堂',
    npcId: 'npc-yaowang',
    description: '药香扑鼻的小铺，架上摆满瓷瓶。丹药一应俱全，价钱公道。',
    buybackRate: 0.6,
    entries: [
      { itemId: 'pill-qi', price: 60, dailyStock: null, conditions: [] },
      { itemId: 'pill-heal', price: 100, dailyStock: null, conditions: [] },
      {
        itemId: 'pill-foundation',
        price: 450,
        dailyStock: 10,
        conditions: [{ type: 'stage_at_least', stageIndex: 3 }],
      },
      {
        itemId: 'pill-spirit',
        price: 300,
        dailyStock: 5,
        conditions: [{ type: 'stage_at_least', stageIndex: 4 }],
      },
      {
        itemId: 'pill-breakthrough',
        price: 1500,
        dailyStock: 3,
        conditions: [{ type: 'stage_at_least', stageIndex: 3 }],
      },
      {
        itemId: 'pill-power',
        price: 800,
        dailyStock: 5,
        conditions: [{ type: 'stage_at_least', stageIndex: 8 }],
      },
      {
        itemId: 'pill-golden-core',
        price: 3500,
        dailyStock: 2,
        conditions: [{ type: 'stage_at_least', stageIndex: 11 }],
      },
      {
        itemId: 'pill-enlightenment',
        price: 7000,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 16 }],
      },
      // 药材: the alchemist marks herbs up over 万宝阁, but never runs out —
      // 采药之约 stays completable on a bad gathering day.
      { itemId: 'mat-spirit-herb', price: 30, dailyStock: null, conditions: [] },
      { itemId: 'mat-beast-core', price: 200, dailyStock: null, conditions: [] },
      {
        itemId: 'mat-soul-crystal',
        price: 900,
        dailyStock: 5,
        conditions: [{ type: 'stage_at_least', stageIndex: 9 }],
      },
    ],
  },
  {
    id: 'shop-tiejiang',
    name: '铁玄铺',
    npcId: 'npc-tiejiang',
    description: '炉火终年不熄。墙上挂着的兵器都是铁玄亲手打的，一件不重样。',
    buybackRate: 0.5,
    entries: [
      { itemId: 'treasure-sword', price: 150, dailyStock: null, conditions: [] },
      { itemId: 'robe-linen', price: 80, dailyStock: null, conditions: [] },
      {
        itemId: 'treasure-bell',
        price: 1100,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 6 }],
      },
      {
        itemId: 'robe-daoist',
        price: 900,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 6 }],
      },
      {
        itemId: 'treasure-fan',
        price: 4800,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 14 }],
      },
      {
        itemId: 'robe-cloud',
        price: 4200,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 14 }],
      },
      {
        itemId: 'treasure-seal',
        price: 16000,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 22 }],
      },
      {
        itemId: 'robe-golden',
        price: 14000,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 22 }],
      },
      // 铸造材料: cheaper here than at 万宝阁 — the smith buys by the crate.
      { itemId: 'mat-iron-essence', price: 110, dailyStock: null, conditions: [] },
      {
        itemId: 'mat-jade',
        price: 380,
        dailyStock: 5,
        conditions: [{ type: 'stage_at_least', stageIndex: 9 }],
      },
    ],
  },
  {
    id: 'shop-shangren',
    name: '万宝阁',
    npcId: 'npc-shangren',
    description: '什么都卖，什么都收。钱多多说这叫「与人方便」。',
    buybackRate: 0.4,
    entries: [
      { itemId: 'mat-spirit-herb', price: 20, dailyStock: null, conditions: [] },
      { itemId: 'mat-iron-essence', price: 120, dailyStock: null, conditions: [] },
      { itemId: 'mat-beast-core', price: 160, dailyStock: null, conditions: [] },
      { itemId: 'acc-jade-pendant', price: 120, dailyStock: null, conditions: [] },
      {
        itemId: 'pet-crane',
        price: 850,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 4 }],
      },
      {
        itemId: 'acc-prayer-beads',
        price: 1000,
        dailyStock: 2,
        conditions: [{ type: 'stage_at_least', stageIndex: 8 }],
      },
      {
        itemId: 'mat-cloud-silk',
        price: 600,
        dailyStock: 10,
        conditions: [{ type: 'stage_at_least', stageIndex: 5 }],
      },
      {
        itemId: 'mat-jade',
        price: 400,
        dailyStock: 10,
        conditions: [{ type: 'stage_at_least', stageIndex: 9 }],
      },
      {
        itemId: 'pet-fox',
        price: 4000,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 12 }],
      },
      {
        itemId: 'mat-soul-crystal',
        price: 700,
        dailyStock: 10,
        conditions: [{ type: 'stage_at_least', stageIndex: 9 }],
      },
      {
        itemId: 'acc-talisman',
        price: 5000,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 16 }],
      },
      {
        itemId: 'pet-turtle',
        price: 13500,
        dailyStock: 1,
        conditions: [{ type: 'stage_at_least', stageIndex: 20 }],
      },
      {
        itemId: 'mat-thunder-wood',
        price: 2200,
        dailyStock: 5,
        conditions: [{ type: 'stage_at_least', stageIndex: 13 }],
      },
    ],
  },
];

export const SHOPS: readonly Shop[] = SPECS.map((s) => ShopSchema.parse(s));
export const SHOP_BY_ID: ReadonlyMap<string, Shop> = indexById(SHOPS);
export const SHOP_IDS: readonly string[] = SHOPS.map((s) => s.id);

/**
 * What each shop will take off your hands.
 *
 * The alchemist has no use for a sword and the smith none for a pill, so the
 * 回收 list is narrower than the 货架 for two of the three; 钱多多 takes
 * everything, which is the whole point of 万宝阁.
 */
export const SHOP_BUYBACK_KINDS: Readonly<Record<string, readonly ItemKind[]>> = {
  'shop-yaowang': ['pill', 'material'],
  'shop-tiejiang': ['equipment', 'material'],
  'shop-shangren': ['pill', 'material', 'equipment'],
};

/** 灵石 (currency) is never a tradeable row; everything else follows the kind list. */
export function shopAcceptsItem(shopId: string, itemId: string): boolean {
  const item = ITEM_BY_ID.get(itemId);
  if (!item || item.id === 'mat-spirit-stone') return false;
  return (SHOP_BUYBACK_KINDS[shopId] ?? []).includes(item.kind);
}

/** 灵石 a shop pays for one unit of an item. 0 when it will not buy. */
export function sellPriceAt(shopId: string, itemId: string): number {
  const shop = SHOP_BY_ID.get(shopId);
  const item = ITEM_BY_ID.get(itemId);
  if (!shop || !item) return 0;
  return Math.floor(item.sellPrice * shop.buybackRate);
}

/** 灵石 a shop charges for one unit. `null` when it does not stock the item. */
export function buyPriceAt(shopId: string, itemId: string): number | null {
  const shop = SHOP_BY_ID.get(shopId);
  const entry = shop?.entries.find((e) => e.itemId === itemId);
  return entry ? entry.price : null;
}
