import { useState } from 'react';
import { ArtImage } from '../../art/ArtImage';
import { Button, ChevronRight, Overlay } from '../../design';
import { useArenaStore } from '../../store/arena';
import { useCharacterStore } from '../../store/character';
import { useUiStore } from '../../store/ui';
import { BattleReplay } from '../combat/BattleReplay';
import { maxHpOf, selfFighter } from '../combat/rosters';
import './arena.css';

/**
 * 「有人向你论道」.
 *
 * A PvP defence resolves server-side while the defender is away, so this is a
 * report and never a question — it rides in on a bar across the top of the leaf
 * instead of a scrim, leaving the page beneath it live. Mounted in `AppShell`,
 * so a challenge lands wherever the player happens to be. While anything else
 * is open (a 秘境 replay, a sheet, a toast) the bar waits its turn, and reports
 * that arrive meanwhile pile into one line with a count.
 */
export function ArenaChallengedNotice() {
  const challenges = useArenaStore((state) => state.challenges);
  const dismiss = useArenaStore((state) => state.dismissChallenges);
  const view = useCharacterStore((state) => state.view);
  const openProfile = useUiStore((state) => state.openProfile);
  const overlayDepth = useUiStore((state) => state.overlayDepth);
  const [watching, setWatching] = useState(false);

  const latest = challenges[0];
  if (!latest) return null;

  const me = view ? selfFighter(view) : null;

  if (watching && me && view) {
    // The event's log was written with the challenger on side A.
    const attacker = {
      id: latest.attackerId,
      name: latest.attackerName,
      art: latest.attackerAvatarArt,
      motif: 'portrait' as const,
      maxHp: maxHpOf([latest.battle], latest.attackerId, view.stats.hp),
    };
    return (
      <BattleReplay
        battle={latest.battle}
        title={`论道 · ${latest.attackerName} 来访`}
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

  // Something is already covering the page; the report keeps until it closes.
  if (overlayDepth > 0) return null;

  const lost = latest.defenderLost;
  const others = challenges.length - 1;

  return (
    <Overlay blocking={false}>
      <aside className="hail" role="status" aria-live="polite">
        <div className="hail__head">
          <button
            type="button"
            className="hail__art"
            aria-label={`查看 ${latest.attackerName}`}
            onClick={() => openProfile(latest.attackerId)}
          >
            <ArtImage id={latest.attackerAvatarArt} label="" motif="portrait" small />
          </button>
          <span className={`hail__mark hail__mark--${lost ? 'lose' : 'win'}`} aria-hidden="true">
            {lost ? '负' : '胜'}
          </span>
          <p className="hail__line">
            <button
              type="button"
              className="msg__who"
              onClick={() => openProfile(latest.attackerId)}
            >
              {latest.attackerName}
            </button>
            （{latest.attackerStageName}）登门论道，
            {lost ? '你未能守住' : '被你挡了回去'}。
            <span className="hail__meta numeral">
              天梯 {latest.ratingDelta >= 0 ? '+' : ''}
              {latest.ratingDelta}
              {others > 0 && ` · 另有 ${others} 场`}
            </span>
          </p>
        </div>

        <div className="hail__acts">
          <Button variant="quiet" size="sm" onClick={dismiss}>
            知道了
          </Button>
          {me && (
            <Button variant="primary" size="sm" onClick={() => setWatching(true)}>
              看回放
              <ChevronRight />
            </Button>
          )}
        </div>
      </aside>
    </Overlay>
  );
}
