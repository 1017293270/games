import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BattleResult } from '@xianxia/shared';
import { Overlay } from '../../design';
import { BattleReplay, type ReplayFighter } from './BattleReplay';
import './combat.css';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八'];

/**
 * 第 N 阵, the last wave named 镇守. `bossName` is for the interstitial, which
 * has room to announce who is waiting; the replay header does not.
 */
export function waveLabel(index: number, total: number, bossName?: string): string {
  if (index === total - 1) return bossName ? `镇守 · ${bossName}` : '镇守';
  return `第 ${NUMERALS[index] ?? index + 1} 阵`;
}

export interface WaveReplayProps {
  /** One `BattleResult` per wave, in order; the boss is last. */
  battles: BattleResult[];
  /** Cultivators going in; their 气血 carries between waves. */
  teamA: ReplayFighter[];
  /** What stands in each wave, positionally aligned with `battles`. */
  waves: ReplayFighter[][];
  /** Short wave names, shown beside the 秘境 name in the header. */
  labels: string[];
  /** Wave names for the interstitial, which can afford the boss's full name. */
  gateLabels?: string[];
  title: string;
  /** Shown on the final wave's verdict card. */
  spoils?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

/**
 * Plays a 秘境 run wave by wave through the one `BattleReplay`. Nothing is
 * re-simulated: the server already sent every wave's `BattleResult`, and the
 * 气血 each fighter opens a wave on is read off the previous wave's `finalHp`.
 */
export function WaveReplay({
  battles,
  teamA,
  waves,
  labels,
  gateLabels = labels,
  title,
  spoils,
  onClose,
  closeLabel = '收功',
}: WaveReplayProps) {
  const [index, setIndex] = useState(0);
  const [pausing, setPausing] = useState(false);

  const battle = battles[index];
  const total = battles.length;
  const last = index >= total - 1;

  /** 气血 carried in from the wave before, for team A only. */
  const startHp = useMemo(() => {
    const previous = battles[index - 1];
    if (!previous) return undefined;
    const map: Record<string, number> = {};
    for (const fighter of teamA) {
      const left = previous.finalHp[fighter.id];
      if (left !== undefined) map[fighter.id] = Math.max(0, left);
    }
    return map;
  }, [battles, index, teamA]);

  const advance = useCallback(() => setPausing(true), []);

  useEffect(() => {
    if (!pausing) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timer = window.setTimeout(
      () => {
        setPausing(false);
        setIndex((n) => n + 1);
      },
      reduced ? 220 : 1_150,
    );
    return () => window.clearTimeout(timer);
  }, [pausing]);

  if (!battle) return null;

  if (pausing) {
    const nextLabel = gateLabels[index + 1] ?? waveLabel(index + 1, total);
    return (
      <Overlay>
        <section className="wave-gate" role="status" aria-live="polite">
          <span className="wave-gate__count numeral">
            {index + 1} / {total}
          </span>
          <h2 className="wave-gate__title">{nextLabel}</h2>
          <span className="wave-gate__rule" aria-hidden="true" />
          <p className="wave-gate__note">整息片刻，气血带入下一阵。</p>
        </section>
      </Overlay>
    );
  }

  return (
    <BattleReplay
      key={index}
      battle={battle}
      teamA={teamA}
      teamB={waves[index] ?? []}
      startHp={startHp}
      title={`${title} · ${labels[index] ?? waveLabel(index, total)}`}
      spoils={last ? spoils : undefined}
      closeLabel={last ? closeLabel : '再进一阵'}
      onClose={last ? onClose : advance}
    />
  );
}
