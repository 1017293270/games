/**
 * Deterministic pseudo-random number generation.
 *
 * Every system that must replay identically on server and client (combat,
 * loot rolls, bot name generation, encounter selection) draws from here.
 * The algorithm is mulberry32: 32-bit state, one multiply-xor-shift round,
 * uniform enough for gameplay and byte-for-byte reproducible across engines.
 */

/** A seeded random source. `next()` returns a float in [0, 1). */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p` (clamped to [0, 1]). */
  chance(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Element chosen by weight; weights must be non-negative and sum > 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Current internal state, so a battle can be resumed or forked. */
  state(): number;
}

/** Mixes an arbitrary 32-bit integer so that nearby seeds diverge quickly. */
function mixSeed(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Creates a deterministic RNG. Identical `seed` values always produce the
 * identical stream of numbers, on any JavaScript engine.
 */
export function createRng(seed: number): Rng {
  let state = mixSeed(Math.trunc(seed));

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi <= lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted(items, weights) {
      if (items.length === 0) throw new Error('rng.weighted: empty array');
      if (items.length !== weights.length) {
        throw new Error('rng.weighted: items and weights length mismatch');
      }
      let total = 0;
      for (const w of weights) {
        if (w < 0) throw new Error('rng.weighted: negative weight');
        total += w;
      }
      if (total <= 0) throw new Error('rng.weighted: weights sum to zero');
      let roll = next() * total;
      for (let i = 0; i < items.length; i += 1) {
        roll -= weights[i] as number;
        if (roll < 0) return items[i] as (typeof items)[number];
      }
      return items[items.length - 1] as (typeof items)[number];
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    state() {
      return state;
    },
  };

  return rng;
}

/**
 * Turns a string into a 32-bit seed (FNV-1a). Useful for deriving a stable
 * seed from a character id, a date bucket, or a battle id.
 */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combines several seed components into one deterministic 32-bit seed. */
export function combineSeeds(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === 'number' ? part.toString(36) : part;
    h ^= hashSeed(s);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
