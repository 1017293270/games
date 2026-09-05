import { useEffect, useReducer } from 'react';
import { useCharacterStore } from '../../store/character';

export interface LiveCultivation {
  ready: boolean;
  exp: number;
  expRequired: number;
  /** 0-1, clamped. */
  progress: number;
  ratePerSec: number;
  /** Seconds left in the stage at the current rate; `Infinity` at 圆满. */
  remainingSec: number;
  atPerfection: boolean;
}

/**
 * Interpolates 修为 locally between server settles.
 *
 * The server is authoritative — `character.settle` and the socket's
 * `character:update` both overwrite the base — but a progress bar that only
 * moves every thirty seconds reads as broken, so the gap is filled at the
 * server's own `ratePerSec`.
 */
export function useLiveCultivation(tickMs = 1000): LiveCultivation {
  const view = useCharacterStore((state) => state.view);
  const viewAt = useCharacterStore((state) => state.viewAt);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!view || view.ratePerSec <= 0) return;
    const id = window.setInterval(tick, tickMs);
    return () => window.clearInterval(id);
  }, [view, tickMs]);

  if (!view) {
    return {
      ready: false,
      exp: 0,
      expRequired: 1,
      progress: 0,
      ratePerSec: 0,
      remainingSec: Number.POSITIVE_INFINITY,
      atPerfection: false,
    };
  }

  const elapsedSec = Math.max(0, (Date.now() - viewAt) / 1000);
  const projected = view.character.exp + view.ratePerSec * elapsedSec;
  const exp = Math.min(view.expRequired, projected);
  const progress = view.expRequired > 0 ? exp / view.expRequired : 0;
  const remainingSec =
    view.atPerfection || view.ratePerSec <= 0
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (view.expRequired - exp) / view.ratePerSec);

  return {
    ready: true,
    exp,
    expRequired: view.expRequired,
    progress: Math.max(0, Math.min(1, progress)),
    ratePerSec: view.ratePerSec,
    remainingSec,
    atPerfection: view.atPerfection,
  };
}
