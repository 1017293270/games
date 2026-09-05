import type { Rng } from '../core/rng.js';
import {
  ELEMENTS,
  SPIRIT_ROOT_MULTIPLIER,
  SPIRIT_ROOT_QUALITIES,
  SPIRIT_ROOT_WEIGHTS,
  type SpiritRoot,
  type SpiritRootQuality,
} from '../domain/stats.js';

/** Cultivation rate multiplier for a root quality: 凡 1.0 / 异 1.3 / 天 1.8. */
export function spiritRootMultiplier(quality: SpiritRootQuality): number {
  return SPIRIT_ROOT_MULTIPLIER[quality];
}

/** Rolls a spirit root: uniform element, quality weighted 70 / 25 / 5. */
export function rollSpiritRoot(rng: Rng): SpiritRoot {
  const element = rng.pick(ELEMENTS);
  const quality = rng.weighted(
    SPIRIT_ROOT_QUALITIES,
    SPIRIT_ROOT_QUALITIES.map((q) => SPIRIT_ROOT_WEIGHTS[q]),
  );
  return { element, quality };
}

/** Display string, e.g. `天灵根·火`. */
export function spiritRootName(root: SpiritRoot): string {
  const qualityName = { mortal: '凡灵根', rare: '异灵根', heaven: '天灵根' }[root.quality];
  const elementName = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' }[
    root.element
  ];
  return `${qualityName}·${elementName}`;
}
