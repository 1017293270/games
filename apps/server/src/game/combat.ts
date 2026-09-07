import { mainTreasureOf } from './character.js';
import {
  combineSeeds,
  MONSTER_BY_ID,
  simulateBattle,
  type BattleResult,
  type CharacterState,
  type Combatant,
  type Monster,
  type Stats,
  type WorldSettings,
} from '@xianxia/shared';

/**
 * Battles run only here.
 *
 * The client replays a `BattleResult`; it never simulates one. Seeds are always
 * derived from stable server-side inputs through `combineSeeds`, so a stored
 * result can be re-derived byte for byte from its own `seed`.
 */

/** Turns a character into a combatant using its already-computed attributes. */
export function characterCombatant(
  state: CharacterState,
  stats: Stats,
  options: { hpPercent?: number } = {},
): Combatant {
  const mainTreasure = mainTreasureOf(state);
  const combatant: Combatant = {
    id: state.id,
    name: state.name,
    art: state.avatarArt,
    stats,
    ...(mainTreasure ? { mainTreasure } : {}),
    skills: state.skillSlots.filter((s): s is string => s !== null),
  };
  const share = options.hpPercent;
  if (share !== undefined && share < 1) {
    return { ...combatant, hp: Math.max(1, Math.round(stats.hp * share)) };
  }
  return combatant;
}

/** Turns a 妖兽 into a combatant. `suffix` keeps ids unique inside one fight. */
export function monsterCombatant(monster: Monster, suffix = ''): Combatant {
  return {
    id: `${monster.id}${suffix}`,
    name: monster.name,
    art: monster.art,
    stats: monster.stats,
    skills: [...monster.skills],
  };
}

/** Resolves a list of monster ids into combatants, numbering duplicates. */
export function monsterTeam(ids: readonly string[]): Combatant[] {
  const out: Combatant[] = [];
  const seen = new Map<string, number>();
  for (const id of ids) {
    const monster = MONSTER_BY_ID.get(id);
    if (!monster) continue;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    out.push(monsterCombatant(monster, n === 0 ? '' : `#${n + 1}`));
  }
  return out;
}

/** Runs a fight with the world's round cap applied. */
export function runBattle(
  teamA: readonly Combatant[],
  teamB: readonly Combatant[],
  seed: number,
  world: Pick<WorldSettings, 'maxBattleRounds'>,
): BattleResult {
  return simulateBattle({
    seed,
    teamA: [...teamA],
    teamB: [...teamB],
    maxRounds: world.maxBattleRounds,
  });
}

/** A stable battle seed. `parts` should include ids and a timestamp. */
export function battleSeed(...parts: (string | number)[]): number {
  return combineSeeds(...parts);
}

/** Remaining 气血 share of a combatant after a fight, 0-1. */
export function hpShareAfter(result: BattleResult, combatantId: string, maxHp: number): number {
  const remaining = result.finalHp[combatantId];
  if (remaining === undefined || maxHp <= 0) return 0;
  return Math.max(0, Math.min(1, remaining / maxHp));
}
