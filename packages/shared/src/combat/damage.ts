/**
 * The damage formula, shared by both simulations.
 *
 * `combat/engine.ts` (turn-based 秘境/论道 replays) and `zone/sim.ts` (the
 * real-time 战斗大地图) must hit for the same numbers, so the roll lives here
 * instead of inside either loop.
 *
 * The RNG is drawn in a fixed order — `chance(hit)`, then `chance(crit)`, then
 * `range(variance)` — and a miss draws only once. Every stored battle replay in
 * the database depends on that order; it must never change.
 */

import { type Rng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import type { Stats } from '../domain/stats.js';
import { CRIT_MULTIPLIER, DAMAGE_VARIANCE, MAX_HIT_CHANCE, MIN_HIT_CHANCE } from './types.js';

/** Stats stored as fractions; a modifier on these is an absolute delta. */
const RATE_STATS = new Set<keyof Stats>(['crit', 'critResist', 'acc', 'eva']);

/** One active stat modifier. Duration is tracked by the caller, not here. */
export interface StatModifier {
  stat: keyof Stats;
  amount: number;
}

/** Anything that can attack or be attacked: base stats plus active modifiers. */
export interface DamageParty {
  readonly stats: Stats;
  readonly modifiers: readonly StatModifier[];
}

/**
 * A base stat with every active modifier folded in.
 *
 * Rate stats (`crit`/`critResist`/`acc`/`eva`) take absolute deltas and clamp
 * into their legal band; the four absolute stats take percentages that add
 * across sources, with 速度 kept above zero so turn order never divides by it.
 */
export function effectiveStat(
  base: Stats,
  modifiers: readonly StatModifier[],
  stat: keyof Stats,
): number {
  const value = base[stat];
  if (RATE_STATS.has(stat)) {
    let total = value;
    for (const m of modifiers) if (m.stat === stat) total += m.amount;
    return clamp(total, 0, stat === 'acc' ? 2 : 1);
  }
  let pct = 0;
  for (const m of modifiers) if (m.stat === stat) pct += m.amount;
  return Math.max(stat === 'spd' ? 0.1 : 0, value * (1 + pct));
}

export interface DamageRoll {
  /** False means the defender dodged; `damage` is then 0. */
  hit: boolean;
  crit: boolean;
  damage: number;
}

/**
 * Rolls one strike.
 *
 * Hit chance is `clamp(命中 - 闪避, 0.35, 0.99)`, crit chance
 * `clamp(暴击 - 抗暴, 0, 0.95)`, and damage
 * `atk^2 / (atk + def) x power x crit x variance`, floored at 1.
 */
export function rollDamage(
  attacker: DamageParty,
  defender: DamageParty,
  power: number,
  rng: Rng,
): DamageRoll {
  const hitChance = clamp(
    effectiveStat(attacker.stats, attacker.modifiers, 'acc') -
      effectiveStat(defender.stats, defender.modifiers, 'eva'),
    MIN_HIT_CHANCE,
    MAX_HIT_CHANCE,
  );
  if (!rng.chance(hitChance)) return { hit: false, crit: false, damage: 0 };

  const critChance = clamp(
    effectiveStat(attacker.stats, attacker.modifiers, 'crit') -
      effectiveStat(defender.stats, defender.modifiers, 'critResist'),
    0,
    0.95,
  );
  const crit = rng.chance(critChance);

  const atk = effectiveStat(attacker.stats, attacker.modifiers, 'atk');
  const def = effectiveStat(defender.stats, defender.modifiers, 'def');
  const core = (atk * atk) / Math.max(1, atk + def);
  const variance = 1 + rng.range(-DAMAGE_VARIANCE, DAMAGE_VARIANCE);
  const raw = core * power * (crit ? CRIT_MULTIPLIER : 1) * variance;

  return { hit: true, crit, damage: Math.max(1, Math.round(raw)) };
}
