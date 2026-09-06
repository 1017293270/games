/**
 * Turning a server payload into the cast a `BattleReplay` needs.
 *
 * `BattleResult` identifies combatants by id and carries their 气血 ceiling in
 * `maxHp`, but no names or art — so every screen that plays one pairs the
 * result with whatever describes the cast: its own `CharacterView`, a
 * `PublicProfile`, or the 秘境 wave roster the server sent alongside the
 * replay. Doing it once here keeps 秘境 / 论道 / 围攻 telling the same story.
 */

import {
  computeStats,
  type BattleResult,
  type CharacterView,
  type DungeonWave,
  type PartyMember,
  type PublicProfile,
} from '@xianxia/shared';
import type { ReplayFighter } from './BattleReplay';

/**
 * The 气血 ceiling the engine used for `id`, from the first wave that names it.
 * `fallback` covers a fighter who never appears in the replay at all.
 */
export function maxHpOf(battles: readonly BattleResult[], id: string, fallback: number): number {
  for (const battle of battles) {
    const max = battle.maxHp[id];
    if (max !== undefined) return Math.max(1, max);
  }
  return Math.max(1, fallback);
}

/** The player themselves, with the exact 气血 their own view reports. */
export function selfFighter(view: CharacterView): ReplayFighter {
  return {
    id: view.character.id,
    name: view.character.name,
    art: view.character.avatarArt,
    motif: 'portrait',
    maxHp: view.stats.hp,
  };
}

/**
 * A party mate. `PartyMember` carries no stats, so their bar comes off the
 * replay's own ceiling, with a bare-stage estimate for a wave they sat out.
 */
export function memberFighter(
  member: PartyMember,
  battles: readonly BattleResult[],
): ReplayFighter {
  const estimate = computeStats({ stageIndex: member.stageIndex }).hp;
  return {
    id: member.characterId,
    name: member.name,
    art: member.avatarArt,
    motif: 'portrait',
    maxHp: maxHpOf(battles, member.characterId, estimate),
  };
}

/** Any other cultivator, bot or human, from their public dossier. */
export function profileFighter(profile: PublicProfile, maxHp = profile.stats.hp): ReplayFighter {
  return {
    id: profile.id,
    name: profile.name,
    art: profile.avatarArt,
    motif: 'portrait',
    maxHp,
  };
}

/**
 * Team B for every wave of a 秘境 run, straight from the roster the server sent
 * with the replay. Duplicates inside one wave are numbered for the reader; the
 * ids are the server's and match the battle log exactly.
 */
export function dungeonWaveFighters(waves: readonly DungeonWave[]): ReplayFighter[][] {
  const ORDINALS = ['', '二', '三', '四', '五', '六'];
  return waves.map((wave) => {
    const seen = new Map<string, number>();
    return wave.enemies.map((enemy) => {
      const count = (seen.get(enemy.name) ?? 0) + 1;
      seen.set(enemy.name, count);
      const suffix = count > 1 ? ` · ${ORDINALS[count - 1] ?? count}` : '';
      return {
        id: enemy.id,
        name: `${enemy.name}${suffix}`,
        art: enemy.art,
        motif: 'beast' as const,
        maxHp: enemy.maxHp,
      };
    });
  });
}
