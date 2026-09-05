import { useMemo } from 'react';
import { DUNGEON_BY_ID, MONSTER_BY_ID, type BattleResult } from '@xianxia/shared';
import { useCharacterStore } from '../../store/character';
import { usePartyStore } from '../../store/party';
import { dungeonWaveFighters, memberFighter, selfFighter } from '../combat/rosters';
import { WaveReplay, waveLabel } from '../combat/WaveReplay';

export interface DungeonSpoils {
  exp: number;
  spiritStones: number;
  itemNames: string[];
}

export interface DungeonRunReplayProps {
  dungeonId: string;
  /** One `BattleResult` per wave, boss last. */
  battles: BattleResult[];
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

  const waves = useMemo(
    () => (dungeon ? dungeonWaveFighters(dungeon, battles, teamA.map((f) => f.id)) : []),
    [dungeon, battles, teamA],
  );

  if (!dungeon || !view || battles.length === 0) return null;

  const bossName = MONSTER_BY_ID.get(dungeon.bossId)?.name;

  return (
    <WaveReplay
      battles={battles}
      teamA={teamA}
      waves={waves}
      labels={battles.map((_, i) => waveLabel(i, battles.length))}
      gateLabels={battles.map((_, i) => waveLabel(i, battles.length, bossName))}
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
