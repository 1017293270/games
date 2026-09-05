import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { STAT_NAMES, type ArtId, type BattleEvent, type BattleResult } from '@xianxia/shared';
import { ArtImage } from '../../art/ArtImage';
import type { Motif } from '../../art/Placeholder';
import { Button, Overlay, ProgressBar } from '../../design';
import './combat.css';

export interface ReplayFighter {
  id: string;
  name: string;
  art: ArtId | null;
  motif?: Motif;
  maxHp: number;
}

export interface BattleReplayProps {
  battle: BattleResult;
  teamA: ReplayFighter[];
  teamB: ReplayFighter[];
  title?: string;
  /** Rendered under the verdict — drops, rating change, and so on. */
  spoils?: ReactNode;
  /** Verdict wording; defaults to 胜/负 from team A's point of view. */
  onClose: () => void;
  closeLabel?: string;
}

interface FloatMark {
  key: number;
  targetId: string;
  text: string;
  kind: 'hit' | 'crit' | 'miss' | 'heal';
}

interface ModMark {
  key: string;
  targetId: string;
  text: string;
  up: boolean;
  until: number;
}

/** Milliseconds one log entry is held on screen. */
const BEAT: Record<BattleEvent['type'], number> = {
  round_start: 460,
  skill_cast: 380,
  damage: 340,
  heal: 340,
  buff: 260,
  debuff: 260,
  death: 520,
  battle_end: 200,
};

/**
 * Plays a `BattleResult` back frame by frame.
 *
 * Nothing is re-rolled here: the server (or the mock) already ran
 * `simulateBattle`, and this walks its `log` discriminated union. The same
 * component serves explore fights, the 天劫, and — from W3 — dungeons and PvP.
 */
export function BattleReplay({
  battle,
  teamA,
  teamB,
  title = '战',
  spoils,
  onClose,
  closeLabel = '收功',
}: BattleReplayProps) {
  const fighters = useMemo(() => [...teamA, ...teamB], [teamA, teamB]);
  const nameOf = useCallback(
    (id: string) => fighters.find((f) => f.id === id)?.name ?? id,
    [fighters],
  );

  const initialHp = useMemo(() => {
    const map: Record<string, number> = {};
    for (const fighter of fighters) map[fighter.id] = fighter.maxHp;
    return map;
  }, [fighters]);

  const [cursor, setCursor] = useState(0);
  const [hp, setHp] = useState<Record<string, number>>(initialHp);
  const [round, setRound] = useState(1);
  const [acting, setActing] = useState<string | null>(null);
  const [feed, setFeed] = useState<string[]>([]);
  const [floats, setFloats] = useState<FloatMark[]>([]);
  const [mods, setMods] = useState<ModMark[]>([]);
  const [done, setDone] = useState(false);
  const floatKey = useRef(0);

  const describe = useCallback(
    (event: BattleEvent): string | null => {
      switch (event.type) {
        case 'round_start':
          return `— 第 ${event.round} 回合 —`;
        case 'skill_cast':
          return `${nameOf(event.actorId)} ${event.skillId ? '施展' : '出手'}${event.skillName}`;
        case 'damage':
          return event.dodged
            ? `${nameOf(event.targetId)} 身形一侧，避开了`
            : `${nameOf(event.targetId)} 受 ${Math.round(event.amount)} 点伤${event.crit ? '（暴击）' : ''}`;
        case 'heal':
          return `${nameOf(event.targetId)} 气血回复 ${Math.round(event.amount)}`;
        case 'buff':
          return `${nameOf(event.targetId)} ${STAT_NAMES[event.stat as keyof typeof STAT_NAMES] ?? event.stat} 提升`;
        case 'debuff':
          return `${nameOf(event.targetId)} ${STAT_NAMES[event.stat as keyof typeof STAT_NAMES] ?? event.stat} 被压制`;
        case 'death':
          return `${nameOf(event.targetId)} 力竭倒下`;
        case 'battle_end':
          return null;
      }
    },
    [nameOf],
  );

  const apply = useCallback(
    (event: BattleEvent, animate: boolean) => {
      switch (event.type) {
        case 'round_start':
          setRound(event.round);
          setMods((current) => current.filter((m) => m.until > event.round));
          break;
        case 'skill_cast':
          setActing(event.actorId);
          break;
        case 'damage':
          setHp((current) => ({ ...current, [event.targetId]: event.targetHp }));
          if (animate) {
            floatKey.current += 1;
            const mark: FloatMark = {
              key: floatKey.current,
              targetId: event.targetId,
              text: event.dodged ? '闪' : `-${Math.round(event.amount)}`,
              kind: event.dodged ? 'miss' : event.crit ? 'crit' : 'hit',
            };
            setFloats((current) => [...current, mark]);
            window.setTimeout(
              () => setFloats((current) => current.filter((f) => f.key !== mark.key)),
              1000,
            );
          }
          break;
        case 'heal':
          setHp((current) => ({ ...current, [event.targetId]: event.targetHp }));
          if (animate) {
            floatKey.current += 1;
            const mark: FloatMark = {
              key: floatKey.current,
              targetId: event.targetId,
              text: `+${Math.round(event.amount)}`,
              kind: 'heal',
            };
            setFloats((current) => [...current, mark]);
            window.setTimeout(
              () => setFloats((current) => current.filter((f) => f.key !== mark.key)),
              1000,
            );
          }
          break;
        case 'buff':
        case 'debuff': {
          const label = STAT_NAMES[event.stat as keyof typeof STAT_NAMES] ?? event.stat;
          setMods((current) => [
            ...current,
            {
              key: `${event.round}-${event.targetId}-${event.stat}-${current.length}`,
              targetId: event.targetId,
              text: `${label}${event.amount >= 0 ? '↑' : '↓'}`,
              up: event.amount >= 0,
              until: event.round + event.durationRounds,
            },
          ]);
          break;
        }
        case 'death':
          setHp((current) => ({ ...current, [event.targetId]: 0 }));
          break;
        case 'battle_end':
          setDone(true);
          break;
      }
      const line = describe(event);
      if (line) setFeed((current) => [...current, line].slice(-14));
    },
    [describe],
  );

  useEffect(() => {
    if (done || cursor >= battle.log.length) return;
    const event = battle.log[cursor];
    if (!event) return;
    const timer = window.setTimeout(() => {
      apply(event, true);
      setCursor((n) => n + 1);
    }, BEAT[event.type]);
    return () => window.clearTimeout(timer);
  }, [cursor, battle.log, apply, done]);

  useEffect(() => {
    if (!done && cursor >= battle.log.length && battle.log.length > 0) setDone(true);
  }, [cursor, battle.log.length, done]);

  const skip = () => {
    for (let i = cursor; i < battle.log.length; i += 1) {
      const event = battle.log[i];
      if (event) apply(event, false);
    }
    setCursor(battle.log.length);
    setActing(null);
    setDone(true);
  };

  const won = battle.winner === 'A';

  return (
    <Overlay>
      <section className="replay" role="dialog" aria-modal="true" aria-label="战斗回放">
        <header className="replay__head">
          <h2 className="replay__title">{title}</h2>
          <span className="replay__round numeral">第 {round} 回合</span>
          {!done && (
            <Button variant="quiet" size="sm" onClick={skip}>
              跳过
            </Button>
          )}
        </header>

        <div className="replay__field">
          <div className="replay__side">
            {teamA.map((fighter) => (
              <FighterCard
                key={fighter.id}
                fighter={fighter}
                hp={hp[fighter.id] ?? fighter.maxHp}
                acting={acting === fighter.id}
                floats={floats.filter((f) => f.targetId === fighter.id)}
                mods={mods.filter((m) => m.targetId === fighter.id)}
              />
            ))}
          </div>
          <div className="replay__versus" aria-hidden="true">
            对阵
          </div>
          <div className="replay__side">
            {teamB.map((fighter) => (
              <FighterCard
                key={fighter.id}
                fighter={fighter}
                hp={hp[fighter.id] ?? fighter.maxHp}
                acting={acting === fighter.id}
                floats={floats.filter((f) => f.targetId === fighter.id)}
                mods={mods.filter((m) => m.targetId === fighter.id)}
              />
            ))}
          </div>
        </div>

        <div className="replay__feed" aria-live="polite">
          {feed.slice(-4).map((line, index) => (
            <p className="replay__line" key={`${line}-${index}`}>
              {line}
            </p>
          ))}
        </div>

        {done && (
          <footer className="replay__foot">
            <div className="replay__verdict">
              <span
                className={`replay__verdict-mark replay__verdict-mark--${won ? 'win' : 'lose'}`}
              >
                {won ? '胜' : battle.winner === 'draw' ? '和' : '负'}
              </span>
              <span className="muted numeral">
                {battle.rounds} 回合 · {battle.reason === 'max_rounds' ? '力竭而止' : '一方倒下'}
              </span>
            </div>
            {spoils}
            <Button variant="primary" block onClick={onClose}>
              {closeLabel}
            </Button>
          </footer>
        )}
      </section>
    </Overlay>
  );
}

function FighterCard({
  fighter,
  hp,
  acting,
  floats,
  mods,
}: {
  fighter: ReplayFighter;
  hp: number;
  acting: boolean;
  floats: FloatMark[];
  mods: ModMark[];
}) {
  const ratio = fighter.maxHp > 0 ? hp / fighter.maxHp : 0;
  return (
    <article
      className={`fighter ${acting ? 'fighter--acting' : ''} ${hp <= 0 ? 'fighter--down' : ''}`}
    >
      <div className="fighter__art">
        <ArtImage id={fighter.art} label={fighter.name} motif={fighter.motif ?? 'beast'} />
      </div>
      <p className="fighter__name">{fighter.name}</p>
      <div className="fighter__hp">
        <ProgressBar value={ratio} tone={ratio > 0.3 ? 'cinnabar' : 'ink'} thin label="气血" />
        <span className="fighter__hpnum numeral">{Math.max(0, Math.round(hp))}</span>
      </div>
      <div className="fighter__mods">
        {mods.map((mod) => (
          <span key={mod.key} className={`mod-chip ${mod.up ? 'mod-chip--up' : 'mod-chip--down'}`}>
            {mod.text}
          </span>
        ))}
      </div>
      <div className="floats" aria-hidden="true">
        {floats.map((mark) => (
          <span key={mark.key} className={`float float--${mark.kind}`}>
            {mark.text}
          </span>
        ))}
      </div>
    </article>
  );
}
