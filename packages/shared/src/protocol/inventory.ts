import { z } from 'zod';
import { EquipSlotSchema, InventoryItemSchema } from '../domain/item.js';
import { CharacterViewSchema } from '../domain/character.js';
import { StatsSchema } from '../domain/stats.js';
import { API_PREFIX, EmptySchema, endpoint } from './common.js';

export const InventoryListResponseSchema = z.object({
  items: z.array(InventoryItemSchema),
  spiritStones: z.number().int().min(0),
  /** Slot -> `InventoryItem.uid`. */
  equipment: z.record(EquipSlotSchema, z.string().nullable()),
  stats: StatsSchema,
  powerScore: z.number().int(),
});
export type InventoryListResponse = z.infer<typeof InventoryListResponseSchema>;

export const UseItemRequestSchema = z.object({
  uid: z.string().min(1),
  qty: z.number().int().min(1).max(99).default(1),
});
export type UseItemRequest = z.infer<typeof UseItemRequestSchema>;

export const UseItemResponseSchema = z.object({
  view: CharacterViewSchema,
  /** What the pill actually did, ready to display. */
  message: z.string(),
  gainedExp: z.number().min(0).default(0),
});
export type UseItemResponse = z.infer<typeof UseItemResponseSchema>;

export const EquipRequestSchema = z.object({ uid: z.string().min(1) });
export const UnequipRequestSchema = z.object({ slot: EquipSlotSchema });

export const SellItemRequestSchema = z.object({
  uid: z.string().min(1),
  qty: z.number().int().min(1).default(1),
  /** Which merchant is buying; sets the buyback rate. */
  shopId: z.string().min(1),
});

export const inventoryEndpoints = {
  list: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/inventory`,
    auth: 'user',
    request: EmptySchema,
    response: InventoryListResponseSchema,
    errors: ['CHARACTER_NOT_FOUND'],
    summary: '背包与当前装备',
  }),
  use: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/inventory/use`,
    auth: 'user',
    request: UseItemRequestSchema,
    response: UseItemResponseSchema,
    errors: ['ITEM_NOT_FOUND', 'INSUFFICIENT_ITEMS', 'NOT_CONSUMABLE'],
    summary: '服用丹药',
  }),
  equip: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/inventory/equip`,
    auth: 'user',
    request: EquipRequestSchema,
    response: CharacterViewSchema,
    errors: ['ITEM_NOT_FOUND', 'NOT_EQUIPPABLE', 'STAGE_TOO_LOW'],
    summary: '穿戴装备（同槽位旧装备自动卸下）',
  }),
  unequip: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/inventory/unequip`,
    auth: 'user',
    request: UnequipRequestSchema,
    response: CharacterViewSchema,
    errors: ['SLOT_MISMATCH'],
    summary: '卸下某个槽位的装备',
  }),
} as const;
