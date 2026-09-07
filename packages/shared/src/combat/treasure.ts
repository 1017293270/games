import type { MainTreasureCombat } from '../domain/progression.js';
/** Per-combat state. No random draws: adapters use the existing damage roll. */
export interface TreasureRuntime {
  nextAt: number;
  pulseAt: number;
  pulses: number;
  shield: number;
  attackUntil: number;
}
export function createTreasureRuntime(now: number): TreasureRuntime {
  return { nextAt: now, pulseAt: 0, pulses: 0, shield: 0, attackUntil: 0 };
}
export interface TreasureAction {
  power: number;
  targets: number;
  shieldFraction: number;
  attackBonus: number;
  durationMs: number;
}
export function stepTreasure(
  t: MainTreasureCombat,
  r: TreasureRuntime,
  now: number,
): TreasureAction[] {
  const out: TreasureAction[] = [];
  const scale = t.power * (t.awakened ? 1.15 : 1);
  // Four banner pulses are separate damage events, not a single upfront hit.
  while (r.pulses > 0 && now >= r.pulseAt) {
    out.push({ power: 0.14 * scale, targets: 3, shieldFraction: 0, attackBonus: 0, durationMs: 0 });
    r.pulses--;
    r.pulseAt += 1000;
  }
  if (now < r.nextAt) return out;
  // Retain clock phase while fighting; idle time never banks attacks.
  const castAt = r.nextAt < now - 1200 ? now : r.nextAt;
  r.nextAt = castAt + t.intervalMs;
  if (t.form === 'banner') {
    r.pulses = 3;
    r.pulseAt = now + 1000;
    out.push({ power: 0.14 * scale, targets: 3, shieldFraction: 0, attackBonus: 0, durationMs: 0 });
    return out;
  }
  const power = { bell: 0.24, tower: 0.36, chain: 0.56, seal: 0.88, shield: 0 }[t.form] * scale;
  const attackBonus = t.form === 'chain' ? 0.1 : 0;
  if (attackBonus) r.attackUntil = now + 4000;
  out.push({
    power,
    targets: t.form === 'tower' ? 3 : 1,
    shieldFraction: t.form === 'shield' ? 0.1 * scale : 0,
    attackBonus,
    durationMs: attackBonus ? 4000 : 0,
  });
  if (r.nextAt <= now) out.push(...stepTreasure(t, r, now));
  return out;
}
export function absorbTreasureShield(r: TreasureRuntime | undefined, damage: number): number {
  if (!r) return damage;
  const absorbed = Math.min(r.shield, damage);
  r.shield -= absorbed;
  return damage - absorbed;
}

export function treasureAttackBonus(r: TreasureRuntime | undefined, now: number): number {
  return r && now < r.attackUntil ? 0.1 : 0;
}
