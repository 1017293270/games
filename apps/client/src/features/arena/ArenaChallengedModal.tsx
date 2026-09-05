import { useState } from 'react';
import { Button, Modal } from '../../design';
import { useArenaStore } from '../../store/arena';
import { useCharacterStore } from '../../store/character';
import { useUiStore } from '../../store/ui';
import { BattleReplay } from '../combat/BattleReplay';
import { selfFighter } from '../combat/rosters';
import './arena.css';

/**
 * 「有人向你论道」. A PvP defence is resolved server-side while the defender is
 * away, so the only thing to do here is report it and offer the replay.
 */
export function ArenaChallengedModal() {
  const challenged = useArenaStore((state) => state.challenged);
  const dismiss = useArenaStore((state) => state.dismissChallenge);
  const view = useCharacterStore((state) => state.view);
  const openProfile = useUiStore((state) => state.openProfile);
  const [watching, setWatching] = useState(false);

  if (!challenged || !view) return null;

  const lost = challenged.defenderLost;
  const me = selfFighter(view);
  // The event's log was written with the challenger on side A.
  const attacker = {
    id: challenged.attackerId,
    name: challenged.attackerName,
    art: null,
    motif: 'portrait' as const,
    maxHp: Math.max(1, challenged.battle.finalHp[challenged.attackerId] ?? view.stats.hp),
  };

  if (watching) {
    return (
      <BattleReplay
        battle={challenged.battle}
        title={`论道 · ${challenged.attackerName} 来访`}
        teamA={[attacker]}
        teamB={[me]}
        closeLabel="收功"
        onClose={() => {
          setWatching(false);
          dismiss();
        }}
      />
    );
  }

  return (
    <Modal open title="有人向你论道" onClose={dismiss}>
      <div className="challenged__head">
        <span className="challenged__mark" aria-hidden="true">
          {lost ? '负' : '胜'}
        </span>
        <p className="challenged__line">
          <button
            type="button"
            className="msg__who"
            onClick={() => openProfile(challenged.attackerId)}
          >
            {challenged.attackerName}
          </button>
          （{challenged.attackerStageName}）登门论道，
          {lost ? '你未能守住' : '被你挡了回去'}。
          <br />
          <span className="numeral muted">
            天梯 {challenged.ratingDelta >= 0 ? '+' : ''}
            {challenged.ratingDelta}
          </span>
        </p>
      </div>

      <p className="field__hint">论道不夺修为，输了只落分。回看一遍，看看是哪一手没接住。</p>

      <div className="challenged__acts">
        <Button variant="ghost" onClick={dismiss}>
          知道了
        </Button>
        <Button variant="primary" onClick={() => setWatching(true)}>
          回看
        </Button>
      </div>
    </Modal>
  );
}
