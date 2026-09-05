/**
 * Turning a server payload into the cast a `BattleReplay` needs.
 *
 * `BattleResult` identifies combatants by id only — no names, art or max 气血 —
 * so every screen that plays one has to rebuild the roster from what it already
 * knows: its own `CharacterView`, a `PublicProfile`, or the shared 秘境 content.
 * Doing it once here keeps 秘境 / 论道 / 围攻 telling the same story.
 */

import {
  computeStats,
  isArtId,
  MONSTER_BY_ID,
  type ArtId,
  type BattleResult,
  type CharacterView,
  type Dungeon,
  type PartyMember,
  type PublicProfile,
} from '@xianxia/shared';
import type { ReplayFighter } from './BattleReplay';

const ORDINALS = ['', '二', '三', '四', '五', '六'];

/**
 * Highest 气血 the log ever showed for `id`, floored at an estimate. A replay
 * bar needs a maximum and the contract carries none, so the observed peak is
 * the closest honest answer.
 */
export function observedMaxHp(battles: readonly BattleResult[], id: string, floor: number): number {
  let best = floor;
  for (const battle of battles) {
    for (const event of battle.log) {
      if ((event.type === 'damage' || event.type === 'heal') && event.targetId === id) {
        best = Math.max(best, event.targetHp);
      }
    }
    const final = battle.finalHp[id];
    if (final !== undefined) best = Math.max(best, final);
  }
  return Math.max(1, best);
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
 * A party mate. `PartyMember` carries no stats, so their bar is scaled from a
 * bare-stage estimate lifted to whatever the log actually showed.
 */
export function memberFighter(
  member: PartyMember,
  battles: readonly BattleResult[],
): ReplayFighter {
  const estimate = computeStats({ stageIndex: member.stageIndex }).hp;
  return {
    id: member.characterId,
    name: member.name,
    art: isArtId(member.avatarArt) ? member.avatarArt : null,
    motif: 'portrait',
    maxHp: observedMaxHp(battles, member.characterId, estimate),
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
 * Team B for every wave of a 秘境 run.
 *
 * The server may suffix a duplicated 妖兽 id to keep the two apart in
 * `finalHp` (the mock uses `#slot`), so the id is resolved by lookup, then by
 * the part before the suffix, then by the wave's position in shared content.
 */
export function dungeonWaveFighters(
  dungeon: Dungeon,
  battles: readonly BattleResult[],
  ourIds: readonly string[],
): ReplayFighter[][] {
  const ours = new Set(ourIds);
  const waves: string[][] = [...dungeon.waves.map((ids) => [...ids]), [dungeon.bossId]];

  return battles.map((battle, waveIndex) => {
    const roster = waves[waveIndex] ?? [];
    const foes = Object.keys(battle.finalHp).filter((id) => !ours.has(id));
    const seen = new Map<string, number>();

    return foes.map((id, slot) => {
      const monster =
        MONSTER_BY_ID.get(id) ??
        MONSTER_BY_ID.get(id.split('#')[0] ?? '') ??
        MONSTER_BY_ID.get(roster[slot] ?? '');
      const count = (seen.get(monster?.id ?? id) ?? 0) + 1;
      seen.set(monster?.id ?? id, count);
      const suffix = count > 1 ? ` · ${ORDINALS[count - 1] ?? count}` : '';
      return {
        id,
        name: `${monster?.name ?? '不知名之物'}${suffix}`,
        art: (monster?.art ?? null) as ArtId | null,
        motif: 'beast' as const,
        maxHp: observedMaxHp(battles, id, monster?.stats.hp ?? 1),
      };
    });
  });
}
