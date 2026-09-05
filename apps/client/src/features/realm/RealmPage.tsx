import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CloudRule } from '../../design';
import { useArenaStore } from '../../store/arena';
import { usePartyStore } from '../../store/party';
import { ArenaChallengedModal } from '../arena/ArenaChallengedModal';
import { ArenaPanel } from '../arena/ArenaPanel';
import { DungeonLobby } from '../dungeon/DungeonLobby';
import { DungeonRunReplay } from '../dungeon/DungeonRunReplay';
import { RaidBoard } from '../raid/RaidBoard';
import '../social/social.css';

type Segment = 'dungeon' | 'arena' | 'raid';

const SEGMENTS: { id: Segment; label: string; note: string }[] = [
  { id: 'dungeon', label: '秘境', note: '洞天福地，结伴则易。' },
  { id: 'arena', label: '论道', note: '同境相邀，只论输赢。' },
  { id: 'raid', label: '围攻', note: '血池共用，赏金分账。' },
];

/**
 * 秘境论道 — the three things cultivators do to each other: run an instance
 * together, spar on the ladder, or gang up on a bot with a shared blood pool.
 */
export function RealmPage() {
  const [segment, setSegment] = useState<Segment>('dungeon');
  const navigate = useNavigate();

  const party = usePartyStore((state) => state.party);
  const loadParty = usePartyStore((state) => state.load);
  const incomingRun = usePartyStore((state) => state.incomingRun);
  const clearIncomingRun = usePartyStore((state) => state.clearIncomingRun);
  const challenged = useArenaStore((state) => state.challenged);

  useEffect(() => {
    void loadParty();
  }, [loadParty]);

  const current = SEGMENTS.find((s) => s.id === segment);

  return (
    <div className="social">
      <header className="page-head">
        <h1 className="page-head__title">秘境论道</h1>
        <p className="page-head__note">{current?.note}</p>
      </header>
      <CloudRule />

      <div className="segments" role="tablist" aria-label="秘境论道分页">
        {SEGMENTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={segment === entry.id}
            className={`segment ${segment === entry.id ? 'segment--on' : ''}`}
            onClick={() => setSegment(entry.id)}
          >
            {entry.label}
            {entry.id === 'dungeon' && party && party.members.length > 1 && (
              <span className="segment__n numeral">{party.members.length}</span>
            )}
            {entry.id === 'arena' && challenged && (
              <span className="segment__dot" aria-label="有人向你论道" />
            )}
          </button>
        ))}
      </div>

      {segment === 'dungeon' && (
        <DungeonLobby onWantParty={() => navigate('/social', { state: { tab: 'party' } })} />
      )}
      {segment === 'arena' && <ArenaPanel />}
      {segment === 'raid' && <RaidBoard />}

      {/* A run someone else in the party started; it waits here until watched. */}
      {incomingRun && (
        <DungeonRunReplay
          dungeonId={incomingRun.dungeonId}
          battles={incomingRun.replay}
          cleared={incomingRun.cleared}
          reward={{
            exp: incomingRun.reward.exp,
            spiritStones: incomingRun.reward.spiritStones,
            itemNames: incomingRun.reward.items.map((item) => item.name),
          }}
          participantIds={incomingRun.participantIds}
          onClose={clearIncomingRun}
        />
      )}

      <ArenaChallengedModal />
    </div>
  );
}
