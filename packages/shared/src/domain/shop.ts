import { z } from 'zod';
import { ConditionSchema } from './script.js';

export const ShopEntrySchema = z.object({
  itemId: z.string().min(1),
  /** Price in 灵石. Overrides the item's own `buyPrice`. */
  price: z.number().int().min(0),
  /** null = unlimited stock; a number is the per-day restock cap. */
  dailyStock: z.number().int().min(1).nullable(),
  conditions: z.array(ConditionSchema).default([]),
});
export type ShopEntry = z.infer<typeof ShopEntrySchema>;

export const ShopSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  npcId: z.string().min(1),
  description: z.string().min(1),
  entries: z.array(ShopEntrySchema).min(1),
  /**
   * Fraction of an item's `sellPrice` this shop actually pays.
   * 1.0 means the listed sell price; 0.6 means the merchant haggles.
   */
  buybackRate: z.number().min(0).max(1),
});
export type Shop = z.infer<typeof ShopSchema>;
