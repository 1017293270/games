/**
 * Deterministic turn-based battle engine.
 *
 * The same `BattleInput` always produces a byte-identical `BattleResult`, on
 * any engine. The server simulates a fight once, stores the result, and the
 * client replays `log` frame by frame; nothing is re-rolled client-side.
 *
 * Turn structure
 * --------------
 *   round_start (actors sorted by effective 速度, desc)
 *     for each living actor, in that order:
 *       +15 灵力 (capped at 100)
 *       scan the 4-slot rotation for the first 神通 that is off cooldown and
 *       affordable; cast it and advance the pointer, otherwise basic attack
 *       and leave the pointer where it is
 *     tick every active modifier down by one round
 *
 * A hit lands with `clamp(命中 - 闪避, 0.35, 0.99)` and crits with
 * `clamp(暴击 - 抗暴, 0, 0.95)`. Damage is
 * `atk^2 / (atk + def) x power x crit x variance`, floored at 1.
 */

import { createRng, type Rng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import type { Skill } from '../domain/skill.js';
import type { Stats } from '../domain/stats.js';
import { SKILL_BY_ID } from '../content/skills.js';
import {
  BASIC_ATTACK_POWER,
  COMBAT_MANA_MAX,
  COMBAT_MANA_REGEN,
  CRIT_MULTIPLIER,
  DAMAGE_VARIANCE,
  DEFAULT_MAX_ROUNDS,
  MAX_HIT_CHANCE,
  MIN_HIT_CHANCE,
  type BattleEndReason,
  type BattleEvent,
  type BattleInput,
  type BattleResult,
  type BattleWinner,
  type Combatant,
  type CombatantRuntime,
  type TeamSide,
} from './types.js';

/** Stats stored as fractions; a modifier on these is an absolute delta. */
const RATE_STATS = new Set<keyof Stats>(['crit', 'critResist', 'acc', 'eva']);

export interface SimulateBattleOptions {
  /**
   * Skill lookup. Defaults to the shared content registry; tests and the admin
   * sandbox can inject their own table.
   */
  skills?: ReadonlyMap<string, Skill>;
}

function toRuntime(c: Combatant, side: TeamSide, index: number): CombatantRuntime {
  const maxHp = Math.max(1, Math.round(c.hp !== undefined ? Math.max(c.hp, c.stats.hp) : c.stats.hp));
  const hp = Math.max(1, Math.round(c.hp ?? c.stats.hp));
  return {
    id: c.id,
    name: c.name,
    side,
    index,
    base: c.stats,
    skills: c.skills.slice(0, 4),
    hp: Math.min(hp, maxHp),
    maxHp,
    mana: COMBAT_MANA_MAX,
    rotation: 0,
    cooldowns: new Array(Math.min(c.skills.length, 4)).fill(0),
    modifiers: [],
    alive: true,
  };
}

/** Base stat with every active modifier folded in. */
function effective(unit: CombatantRuntime, stat: keyof Stats): number {
  const base = unit.base[stat];
  if (RATE_STATS.has(stat)) {
    let value = base;
    for (const m of unit.modifiers) if (m.stat === stat) value += m.amount;
    return clamp(value, 0, stat === 'acc' ? 2 : 1);
  }
  let pct = 0;
  for (const m of unit.modifiers) if (m.stat === stat) pct += m.amount;
  return Math.max(stat === 'spd' ? 0.1 : 0, base * (1 + pct));
}

/** Sorted acting order: 速度 desc, then team A first, then team position. */
function turnOrder(units: readonly CombatantRuntime[]): CombatantRuntime[] {
  return units
    .filter((u) => u.alive)
    .slice()
    .sort((a, b) => {
      const d = effective(b, 'spd') - effective(a, 'spd');
      if (Math.abs(d) > 1e-9) return d;
      if (a.side !== b.side) return a.side === 'A' ? -1 : 1;
      return a.index - b.index;
    });
}

/** Focus fire: the living enemy with the least 气血, ties by team position. */
function pickEnemy(
  units: readonly CombatantRuntime[],
  actor: CombatantRuntime,
): CombatantRuntime | null {
  let best: CombatantRuntime | null = null;
  for (const u of units) {
    if (!u.alive || u.side === actor.side) continue;
    if (best === null || u.hp < best.hp || (u.hp === best.hp && u.index < best.index)) best = u;
  }
  return best;
}

/** The most wounded living ally, including the actor itself. */
function pickAlly(
  units: readonly CombatantRuntime[],
  actor: CombatantRuntime,
): CombatantRuntime | null {
  let best: CombatantRuntime | null = null;
  let bestRatio = Number.POSITIVE_INFINITY;
  for (const u of units) {
    if (!u.alive || u.side !== actor.side) continue;
    const ratio = u.hp / u.maxHp;
    if (ratio < bestRatio || (ratio === bestRatio && best !== null && u.index < best.index)) {
      best = u;
      bestRatio = ratio;
    }
  }
  return best;
}

function livingEnemies(
  units: readonly CombatantRuntime[],
  actor: CombatantRuntime,
): CombatantRuntime[] {
  return units.filter((u) => u.alive && u.side !== actor.side);
}

interface DamageOutcome {
  amount: number;
  crit: boolean;
  dodged: boolean;
}

function rollDamage(
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  power: number,
  rng: Rng,
): DamageOutcome {
  const hitChance = clamp(
    effective(attacker, 'acc') - effective(defender, 'eva'),
    MIN_HIT_CHANCE,
    MAX_HIT_CHANCE,
  );
  if (!rng.chance(hitChance)) return { amount: 0, crit: false, dodged: true };

  const critChance = clamp(effective(attacker, 'crit') - effective(defender, 'critResist'), 0, 0.95);
  const crit = rng.chance(critChance);

  const atk = effective(attacker, 'atk');
  const def = effective(defender, 'def');
  const core = (atk * atk) / Math.max(1, atk + def);
  const variance = 1 + rng.range(-DAMAGE_VARIANCE, DAMAGE_VARIANCE);
  const raw = core * power * (crit ? CRIT_MULTIPLIER : 1) * variance;

  return { amount: Math.max(1, Math.round(raw)), crit, dodged: false };
}

/**
 * Runs a battle to completion.
 *
 * @throws if any combatant id is duplicated across the two teams.
 */
export function simulateBattle(input: BattleInput, options: SimulateBattleOptions = {}): BattleResult {
  const skillTable = options.skills ?? SKILL_BY_ID;
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const rng = createRng(input.seed);

  const units: CombatantRuntime[] = [
    ...input.teamA.map((c, i) => toRuntime(c, 'A', i)),
    ...input.teamB.map((c, i) => toRuntime(c, 'B', i)),
  ];

  const seenIds = new Set<string>();
  for (const u of units) {
    if (seenIds.has(u.id)) throw new Error(`simulateBattle: duplicate combatant id "${u.id}"`);
    seenIds.add(u.id);
  }

  const log: BattleEvent[] = [];
  const damageDealt: Record<string, number> = {};
  for (const u of units) damageDealt[u.id] = 0;

  const sideAlive = (side: TeamSide): boolean => units.some((u) => u.side === side && u.alive);

  let round = 0;
  let winner: BattleWinner = 'draw';
  let reason: BattleEndReason = 'max_rounds';
  let finished = false;

  const applyDamage = (
    actor: CombatantRuntime,
    target: CombatantRuntime,
    skillId: string | null,
    power: number,
  ): void => {
    const outcome = rollDamage(actor, target, power, rng);
    if (!outcome.dodged) {
      target.hp = Math.max(0, target.hp - outcome.amount);
      damageDealt[actor.id] = (damageDealt[actor.id] ?? 0) + outcome.amount;
    }
    log.push({
      type: 'damage',
      round,
      actorId: actor.id,
      targetId: target.id,
      skillId,
      amount: outcome.amount,
      crit: outcome.crit,
      dodged: outcome.dodged,
      targetHp: target.hp,
    });
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      log.push({ type: 'death', round, targetId: target.id, killerId: actor.id });
    }
  };

  const applyModifier = (
    actor: CombatantRuntime,
    target: CombatantRuntime,
    skill: Skill,
    positive: boolean,
  ): void => {
    const modifier = skill.modifier;
    if (!modifier) return;
    for (const [stat, amount] of Object.entries(modifier.stats)) {
      if (typeof amount !== 'number' || amount === 0) continue;
      target.modifiers.push({
        stat: stat as keyof Stats,
        amount,
        rounds: modifier.durationRounds,
      });
      log.push({
        type: positive ? 'buff' : 'debuff',
        round,
        actorId: actor.id,
        targetId: target.id,
        skillId: skill.id,
        stat,
        amount,
        durationRounds: modifier.durationRounds,
      });
    }
  };

  while (round < maxRounds && !finished) {
    round += 1;
    const order = turnOrder(units);
    if (order.length === 0) break;
    log.push({ type: 'round_start', round, order: order.map((u) => u.id) });

    for (const actor of order) {
      if (!actor.alive || finished) continue;

      actor.mana = Math.min(COMBAT_MANA_MAX, actor.mana + COMBAT_MANA_REGEN);

      // Find the first castable 神通 starting at the rotation pointer.
      let chosen: Skill | null = null;
      let chosenSlot = -1;
      const slotCount = actor.skills.length;
      for (let step = 0; step < slotCount; step += 1) {
        const slot = (actor.rotation + step) % slotCount;
        const skillId = actor.skills[slot];
        if (skillId === undefined) continue;
        const skill = skillTable.get(skillId);
        if (!skill) continue;
        if ((actor.cooldowns[slot] ?? 0) > 0) continue;
        if (skill.manaCost > actor.mana) continue;
        chosen = skill;
        chosenSlot = slot;
        break;
      }

      if (chosen && chosenSlot >= 0) {
        actor.mana -= chosen.manaCost;
        actor.cooldowns[chosenSlot] = chosen.cooldown;
        actor.rotation = (chosenSlot + 1) % slotCount;

        let targets: CombatantRuntime[] = [];
        switch (chosen.target) {
          case 'enemy': {
            const t = pickEnemy(units, actor);
            targets = t ? [t] : [];
            break;
          }
          case 'all_enemies':
            targets = livingEnemies(units, actor);
            break;
          case 'self':
            targets = [actor];
            break;
          case 'ally': {
            const t = pickAlly(units, actor);
            targets = t ? [t] : [actor];
            break;
          }
        }

        log.push({
          type: 'skill_cast',
          round,
          actorId: actor.id,
          skillId: chosen.id,
          skillName: chosen.name,
          manaSpent: chosen.manaCost,
          targetIds: targets.map((t) => t.id),
        });

        for (const target of targets) {
          switch (chosen.type) {
            case 'damage':
              applyDamage(actor, target, chosen.id, chosen.power);
              break;
            case 'heal': {
              const amount = Math.max(
                1,
                Math.round(
                  Math.min(effective(actor, 'atk') * chosen.power, target.maxHp - target.hp),
                ),
              );
              const healed = target.hp >= target.maxHp ? 0 : amount;
              target.hp = Math.min(target.maxHp, target.hp + healed);
              log.push({
                type: 'heal',
                round,
                actorId: actor.id,
                targetId: target.id,
                skillId: chosen.id,
                amount: healed,
                targetHp: target.hp,
              });
              break;
            }
            case 'buff':
              applyModifier(actor, target, chosen, true);
              break;
            case 'debuff':
              if (chosen.power > 0) applyDamage(actor, target, chosen.id, chosen.power);
              applyModifier(actor, target, chosen, false);
              break;
          }
        }
      } else {
        const target = pickEnemy(units, actor);
        log.push({
          type: 'skill_cast',
          round,
          actorId: actor.id,
          skillId: null,
          skillName: '普攻',
          manaSpent: 0,
          targetIds: target ? [target.id] : [],
        });
        if (target) applyDamage(actor, target, null, BASIC_ATTACK_POWER);
      }

      if (!sideAlive('A') || !sideAlive('B')) {
        finished = true;
        reason = 'team_wiped';
        winner = sideAlive('A') ? 'A' : sideAlive('B') ? 'B' : 'draw';
      }
    }

    // End-of-round upkeep: cooldowns and modifier durations tick down together.
    for (const u of units) {
      for (let i = 0; i < u.cooldowns.length; i += 1) {
        u.cooldowns[i] = Math.max(0, (u.cooldowns[i] ?? 0) - 1);
      }
      u.modifiers = u.modifiers
        .map((m) => ({ ...m, rounds: m.rounds - 1 }))
        .filter((m) => m.rounds > 0);
    }
  }

  if (!finished) {
    // Round cap reached: the side holding the larger share of its own 气血 wins.
    reason = 'max_rounds';
    const share = (side: TeamSide): number => {
      let cur = 0;
      let max = 0;
      for (const u of units) {
        if (u.side !== side) continue;
        cur += u.hp;
        max += u.maxHp;
      }
      return max > 0 ? cur / max : 0;
    };
    const a = share('A');
    const b = share('B');
    winner = Math.abs(a - b) < 1e-9 ? 'draw' : a > b ? 'A' : 'B';
  }

  log.push({ type: 'battle_end', round: Math.max(1, round), winner, reason });

  const finalHp: Record<string, number> = {};
  for (const u of units) finalHp[u.id] = u.hp;

  return { winner, rounds: round, log, finalHp, damageDealt, seed: input.seed, reason };
}
