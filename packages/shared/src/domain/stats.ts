import { z } from 'zod';

/** 五行. Drives spirit roots, 神通 trees and elemental affinity in combat. */
export const ELEMENTS = ['metal', 'wood', 'water', 'fire', 'earth'] as const;
export const ElementSchema = z.enum(ELEMENTS);
export type Element = z.infer<typeof ElementSchema>;

export const ELEMENT_NAMES: Record<Element, string> = {
  metal: '金',
  wood: '木',
  water: '水',
  fire: '火',
  earth: '土',
};

/** 灵根品质 凡/异/天. */
export const SPIRIT_ROOT_QUALITIES = ['mortal', 'rare', 'heaven'] as const;
export const SpiritRootQualitySchema = z.enum(SPIRIT_ROOT_QUALITIES);
export type SpiritRootQuality = z.infer<typeof SpiritRootQualitySchema>;

export const SPIRIT_ROOT_QUALITY_NAMES: Record<SpiritRootQuality, string> = {
  mortal: '凡灵根',
  rare: '异灵根',
  heaven: '天灵根',
};

/** Cultivation rate multiplier granted by root quality. */
export const SPIRIT_ROOT_MULTIPLIER: Record<SpiritRootQuality, number> = {
  mortal: 1.0,
  rare: 1.3,
  heaven: 1.8,
};

/** Roll weights for a freshly created character: 70 / 25 / 5. */
export const SPIRIT_ROOT_WEIGHTS: Record<SpiritRootQuality, number> = {
  mortal: 70,
  rare: 25,
  heaven: 5,
};

export const SpiritRootSchema = z.object({
  element: ElementSchema,
  quality: SpiritRootQualitySchema,
});
export type SpiritRoot = z.infer<typeof SpiritRootSchema>;

/**
 * The eight combat attributes.
 *
 * `hp`/`atk`/`def`/`spd` are absolute values; `crit`/`critResist`/`acc`/`eva`
 * are rates in [0, 1] compared against the opponent's counterpart.
 */
export const StatsSchema = z.object({
  /** 气血 */
  hp: z.number().min(1),
  /** 攻击 */
  atk: z.number().min(0),
  /** 防御 */
  def: z.number().min(0),
  /** 速度 */
  spd: z.number().min(0),
  /** 暴击 */
  crit: z.number().min(0).max(1),
  /** 抗暴 */
  critResist: z.number().min(0).max(1),
  /** 命中 */
  acc: z.number().min(0).max(2),
  /** 闪避 */
  eva: z.number().min(0).max(1),
});
export type Stats = z.infer<typeof StatsSchema>;

export const STAT_KEYS = ['hp', 'atk', 'def', 'spd', 'crit', 'critResist', 'acc', 'eva'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const STAT_NAMES: Record<StatKey, string> = {
  hp: '气血',
  atk: '攻击',
  def: '防御',
  spd: '速度',
  crit: '暴击',
  critResist: '抗暴',
  acc: '命中',
  eva: '闪避',
};

/** Rate-typed stats are stored as fractions and rendered as percentages. */
export const RATE_STAT_KEYS = ['crit', 'critResist', 'acc', 'eva'] as const satisfies readonly StatKey[];

/** Flat additions to the four absolute stats plus the four rates. */
export const StatBonusSchema = z.object({
  hp: z.number().default(0),
  atk: z.number().default(0),
  def: z.number().default(0),
  spd: z.number().default(0),
  crit: z.number().default(0),
  critResist: z.number().default(0),
  acc: z.number().default(0),
  eva: z.number().default(0),
});
export type StatBonus = z.infer<typeof StatBonusSchema>;

export const ZERO_STAT_BONUS: StatBonus = {
  hp: 0,
  atk: 0,
  def: 0,
  spd: 0,
  crit: 0,
  critResist: 0,
  acc: 0,
  eva: 0,
};
