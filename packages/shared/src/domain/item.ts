import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { StatBonusSchema } from './stats.js';

const ArtIdSchema = z.enum(ART_IDS);

/** 装备槽位: 法宝 / 法衣 / 饰品 / 灵宠. */
export const EQUIP_SLOTS = ['treasure', 'robe', 'accessory', 'pet'] as const;
export const EquipSlotSchema = z.enum(EQUIP_SLOTS);
export type EquipSlot = z.infer<typeof EquipSlotSchema>;

export const EQUIP_SLOT_NAMES: Record<EquipSlot, string> = {
  treasure: '法宝',
  robe: '法衣',
  accessory: '饰品',
  pet: '灵宠',
};

/** 品阶 凡/灵/仙/圣. */
export const ITEM_GRADES = ['mortal', 'spirit', 'immortal', 'saint'] as const;
export const ItemGradeSchema = z.enum(ITEM_GRADES);
export type ItemGrade = z.infer<typeof ItemGradeSchema>;

export const ITEM_GRADE_NAMES: Record<ItemGrade, string> = {
  mortal: '凡阶',
  spirit: '灵阶',
  immortal: '仙阶',
  saint: '圣阶',
};

/** Multiplier applied to an equipment piece's stat block by its grade. */
export const ITEM_GRADE_MULTIPLIER: Record<ItemGrade, number> = {
  mortal: 1.0,
  spirit: 1.6,
  immortal: 2.6,
  saint: 4.2,
};

export const ITEM_KINDS = ['pill', 'material', 'equipment'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

/** What consuming a pill does. */
export const PillEffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cultivation_buff'),
    /** Additive cultivation bonus, e.g. 0.5 = +50%. */
    bonus: z.number().positive(),
    durationSec: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('instant_exp'),
    /** Cultivation points granted immediately. */
    exp: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('breakthrough_aid'),
    /** Consumed by a breakthrough attempt; +0.15 success each. */
    bonus: z.number().positive(),
  }),
  z.object({
    type: z.literal('heal'),
    /** Fraction of max 气血 restored out of combat. */
    healPercent: z.number().positive().max(1),
  }),
  z.object({
    type: z.literal('stat_buff'),
    stats: StatBonusSchema.partial(),
    durationSec: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('unlock_skill_slot'),
    slot: z.number().int().min(0).max(3),
  }),
]);
export type PillEffect = z.infer<typeof PillEffectSchema>;

const ItemBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  art: ArtIdSchema,
  grade: ItemGradeSchema,
  /** Base merchant sell price in 灵石; 0 means unsellable. */
  sellPrice: z.number().int().min(0),
  /** Base merchant buy price in 灵石; null means not for sale anywhere. */
  buyPrice: z.number().int().min(0).nullable(),
  stackable: z.boolean(),
});

export const PillItemSchema = ItemBaseSchema.extend({
  kind: z.literal('pill'),
  stackable: z.literal(true),
  effect: PillEffectSchema,
});
export type PillItem = z.infer<typeof PillItemSchema>;

export const MaterialItemSchema = ItemBaseSchema.extend({
  kind: z.literal('material'),
  stackable: z.literal(true),
});
export type MaterialItem = z.infer<typeof MaterialItemSchema>;

export const EquipmentItemSchema = ItemBaseSchema.extend({
  kind: z.literal('equipment'),
  stackable: z.literal(false),
  slot: EquipSlotSchema,
  /** Minimum stageIndex required to equip. */
  requiredStage: z.number().int().min(0).max(35),
  /** Flat additions applied after the percentage block. */
  flat: StatBonusSchema,
  /**
   * Percentage additions relative to the realm baseline, e.g. `atk: 0.12`
   * means +12% of base 攻击. Multiplied by `ITEM_GRADE_MULTIPLIER`.
   */
  percent: StatBonusSchema,
});
export type EquipmentItem = z.infer<typeof EquipmentItemSchema>;

export const ItemSchema = z.discriminatedUnion('kind', [
  PillItemSchema,
  MaterialItemSchema,
  EquipmentItemSchema,
]);
export type Item = z.infer<typeof ItemSchema>;

/** One inventory row. Equipment always has `qty` 1 and a unique `uid`. */
export const InventoryItemSchema = z.object({
  /** Row identity; server-generated. */
  uid: z.string().min(1),
  itemId: z.string().min(1),
  qty: z.number().int().min(0),
  /** True when the piece is currently in one of the four equip slots. */
  equipped: z.boolean().default(false),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;
