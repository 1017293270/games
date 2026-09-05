import { useEffect, useMemo, useState } from 'react';
import type { ArenaChallengeResponse, ArenaRecord } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import { Button, Panel, ProgressBar } from '../../design';
import { useArenaStore } from '../../store/arena';
import { useCharacterStore } from '../../store/character';
import { useUiStore } from '../../store/ui';
import { BattleReplay } from '../combat/BattleReplay';
import { profileFighter, selfFighter } from '../combat/rosters';
import '../social/social.css';
import './arena.css';

const TENTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 胜算 in 成, the way a fortune is told rather than a percentage. */
function oddsText(chance: number): string {
  if (chance >= 0.9) return '十拿九稳';
  if (chance < 0.1) return '不足一成';
  return `约 ${TENTHS[Math.floor(chance * 10) - 1] ?? '五'} 成`;
}

function clockOf(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ArenaPanel() {
  const view = useCharacterStore((state) => state.view);
  const openProfile = useUiStore((state) => state.openProfile);

  const opponents = useArenaStore((state) => state.opponents);
  const opponentsLoaded = useArenaStore((state) => state.opponentsLoaded);
  const rating = useArenaStore((state) => state.rating);
  const challengesToday = useArenaStore((state) => state.challengesToday);
  const dailyLimit = useArenaStore((state) => state.dailyLimit);
  const busy = useArenaStore((state) => state.busy);
  const loadOpponents = useArenaStore((state) => state.loadOpponents);
  const challenge = useArenaStore((state) => state.challenge);

  const records = useArenaStore((state) => state.records);
  const recordsLoaded = useArenaStore((state) => state.recordsLoaded);
  const recordsHasMore = useArenaStore((state) => state.recordsHasMore);
  const recordsLoading = useArenaStore((state) => state.recordsLoading);
  const recordsPage = useArenaStore((state) => state.recordsPage);
  const loadRecords = useArenaStore((state) => state.loadRecords);

  const [bout, setBout] = useState<ArenaChallengeResponse | null>(null);
  const [replayRecord, setReplayRecord] = useState<ArenaRecord | null>(null);

  useEffect(() => {
    if (!opponentsLoaded) void loadOpponents();
  }, [opponentsLoaded, loadOpponents]);

  useEffect(() => {
    if (!recordsLoaded) void loadRecords(1);
  }, [recordsLoaded, loadRecords]);

  const selfId = view?.character.id ?? '';
  const spent = dailyLimit > 0 && challengesToday >= dailyLimit;

  const me = useMemo(() => (view ? selfFighter(view) : null), [view]);

  return (
    <div className="arena">
      <section className="standing">
        <div className="standing__score">
          <span className="standing__label">天梯</span>
          <span className="standing__value">{rating.toLocaleString('zh-CN')}</span>
        </div>
        <div className="standing__meta">
          <span className="numeral">
            今日论道 {challengesToday}/{dailyLimit || '—'}
          </span>
          <span>胜负计入天梯，败者只失分，不失修为。</span>
          <ProgressBar
            value={dailyLimit ? challengesToday / dailyLimit : 0}
            tone="cinnabar"
            thin
            label="今日论道次数"
          />
        </div>
      </section>

      <Panel title="对手" aside={spent ? '今日已尽' : `${opponents.length} 位`}>
        <div>
          {opponents.map((opponent) => (
            <div className="opponent" key={opponent.id}>
              <button
                type="button"
                className="opponent__art"
                aria-label={`查看 ${opponent.name}`}
                onClick={() => openProfile(opponent.id)}
              >
                <ArtImage id={opponent.avatarArt} label="" motif="portrait" />
              </button>
              <div className="opponent__body">
                <span className="opponent__name">
                  {opponent.online && <span className="online-dot" aria-label="在线" />}
                  {opponent.name}
                  {opponent.isBot && <span className="puppet">傀儡</span>}
                </span>
                <span className="opponent__sub numeral">
                  {opponent.stageName} · 战力 {opponent.powerScore.toLocaleString('zh-CN')} · 天梯{' '}
                  {opponent.arenaRating}
                </span>
                <span className="opponent__odds">
                  <ProgressBar
                    value={opponent.winHint}
                    tone={opponent.winHint >= 0.5 ? 'indigo' : 'ink'}
                    thin
                    label={`对 ${opponent.name} 的胜算`}
                  />
                  胜算{oddsText(opponent.winHint)}
                </span>
              </div>
              <Button
                variant="seal"
                size="sm"
                disabled={busy || spent}
                onClick={() => {
                  void challenge(opponent.id).then((result) => result && setBout(result));
                }}
              >
                论道
              </Button>
            </div>
          ))}
          {opponents.length === 0 && (
            <p className="empty">{opponentsLoaded ? '论道台上暂无对手。' : '正在张榜……'}</p>
          )}
        </div>
      </Panel>

      <Panel title="近日战绩" aside={records.length ? `${records.length} 场` : undefined}>
        <div className="records">
          {records.map((record) => {
            const won = record.winnerId === selfId;
            const foe = record.attackerId === selfId ? record.defenderName : record.attackerName;
            const inbound = record.attackerId !== selfId;
            return (
              <div className="record" key={record.id}>
                <span className={`record__mark record__mark--${won ? 'win' : 'lose'}`}>
                  {won ? '胜' : '负'}
                </span>
                <span className="record__body">
                  <span className="record__line">
                    {inbound ? `${foe} 来访` : `往访 ${foe}`}
                  </span>
                  <span className="record__when numeral">{clockOf(record.foughtAt)}</span>
                </span>
                <span
                  className={`record__delta record__delta--${record.ratingDelta >= 0 ? 'up' : 'down'}`}
                >
                  {record.ratingDelta >= 0 ? '+' : ''}
                  {record.ratingDelta}
                </span>
                {record.battle ? (
                  <Button variant="quiet" size="sm" onClick={() => setReplayRecord(record)}>
                    回看
                  </Button>
                ) : (
                  <span className="record__when">已散</span>
                )}
              </div>
            );
          })}

          {records.length === 0 && (
            <p className="empty">{recordsLoaded ? '尚无战绩。' : '正在翻阅……'}</p>
          )}

          {recordsHasMore && (
            <Button
              variant="quiet"
              block
              disabled={recordsLoading}
              style={{ marginTop: 'var(--sp-2)' }}
              onClick={() => void loadRecords(recordsPage + 1)}
            >
              {recordsLoading ? '翻页中……' : '再看一页'}
            </Button>
          )}
        </div>
      </Panel>

      {bout && me && (
        <BattleReplay
          battle={bout.battle}
          title={`论道 · ${bout.opponent.name}`}
          teamA={[me]}
          teamB={[profileFighter(bout.opponent)]}
          spoils={
            <div className="spoils">
              <span className="spoil">
                天梯 {bout.ratingBefore} → {bout.ratingAfter}
              </span>
              {bout.reward.exp > 0 && (
                <span className="spoil">修为 +{bout.reward.exp.toLocaleString('zh-CN')}</span>
              )}
              <span className="spoil">灵石 +{bout.reward.spiritStones.toLocaleString('zh-CN')}</span>
            </div>
          }
          onClose={() => {
            setBout(null);
            void loadRecords(1);
            void loadOpponents();
          }}
        />
      )}

      {replayRecord?.battle && me && (
        <ArchivedBout record={replayRecord} selfId={selfId} onClose={() => setReplayRecord(null)} />
      )}
    </div>
  );
}

/**
 * A bout replayed out of the record book. The archive keeps the log but not the
 * roster, so both sides are rebuilt from the ids the log carries.
 */
function ArchivedBout({
  record,
  selfId,
  onClose,
}: {
  record: ArenaRecord;
  selfId: string;
  onClose: () => void;
}) {
  const view = useCharacterStore((state) => state.view);
  if (!record.battle || !view) return null;

  const me = selfFighter(view);
  const foeId = record.attackerId === selfId ? record.defenderId : record.attackerId;
  const foeName = record.attackerId === selfId ? record.defenderName : record.attackerName;
  const foeHp = Math.max(1, record.battle.finalHp[foeId] ?? view.stats.hp);

  // The archived log is written from the attacker's point of view, so when the
  // bout came in, this cultivator stood on side B.
  const inbound = record.attackerId !== selfId;
  const foe = {
    id: foeId,
    name: foeName,
    art: null,
    motif: 'portrait' as const,
    maxHp: Math.max(foeHp, view.stats.hp),
  };

  return (
    <BattleReplay
      battle={record.battle}
      title={`旧战 · ${foeName}`}
      teamA={inbound ? [foe] : [me]}
      teamB={inbound ? [me] : [foe]}
      closeLabel="合卷"
      onClose={onClose}
    />
  );
}
