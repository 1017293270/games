import { useMemo } from 'react';
import { DUNGEON_BY_ID, type BattleResult, type DungeonWave } from '@xianxia/shared';
import { useCharacterStore } from '../../store/character';
import { usePartyStore } from '../../store/party';
import { dungeonWaveFighters, memberFighter, selfFighter } from '../combat/rosters';
import { WaveReplay } from '../combat/WaveReplay';

export interface DungeonSpoils {
  exp: number;
  spiritStones: number;
  itemNames: string[];
}

export interface DungeonRunReplayProps {
  dungeonId: string;
  /** One `BattleResult` per wave, boss last. */
  battles: BattleResult[];
  /** What stood in each wave, positionally aligned with `battles`. */
  waves: DungeonWave[];
  cleared: boolean;
  reward: DungeonSpoils;
  /** Who went in; anyone here is drawn on the left. */
  participantIds: string[];
  onClose: () => void;
}

/**
 * Plays one 秘境 run. Shared by the party that started it and by any member who
 * only learns about it through `dungeon:result`, so both see the same waves.
 */
export function DungeonRunReplay({
  dungeonId,
  battles,
  waves,
  cleared,
  reward,
  participantIds,
  onClose,
}: DungeonRunReplayProps) {
  const view = useCharacterStore((state) => state.view);
  const party = usePartyStore((state) => state.party);
  const dungeon = DUNGEON_BY_ID.get(dungeonId);

  const teamA = useMemo(() => {
    if (!view) return [];
    const me = selfFighter(view);
    const mates = (party?.members ?? [])
      .filter((m) => m.characterId !== view.character.id)
      .filter((m) => participantIds.length === 0 || participantIds.includes(m.characterId))
      .map((m) => memberFighter(m, battles));
    return [me, ...mates];
  }, [view, party, participantIds, battles]);

  const teamB = useMemo(() => dungeonWaveFighters(waves), [waves]);

  if (!dungeon || !view || battles.length === 0) return null;

  // The last wave's roster names the 妖王, which is what the interstitial has
  // room to announce.
  const bossName = waves.at(-1)?.enemies[0]?.name;

  return (
    <WaveReplay
      battles={battles}
      teamA={teamA}
      waves={teamB}
      labels={waves.map((wave) => wave.name)}
      gateLabels={waves.map((wave, i) =>
        i === waves.length - 1 && bossName ? `${wave.name} · ${bossName}` : wave.name,
      )}
      title={dungeon.name}
      onClose={onClose}
      spoils={
        cleared ? (
          <div className="spoils">
            <span className="spoil">修为 +{reward.exp.toLocaleString('zh-CN')}</span>
            <span className="spoil">灵石 +{reward.spiritStones.toLocaleString('zh-CN')}</span>
            {reward.itemNames.map((name) => (
              <span className="spoil spoil--gold" key={name}>
                {name}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: 'center', fontSize: 'var(--fs-sm)' }}>
            未能走到最后，此行不计入所得。养好气血，或多带一人。
          </p>
        )
      }
    />
  );
}
