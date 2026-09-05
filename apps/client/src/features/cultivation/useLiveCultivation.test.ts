import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getStage } from '@xianxia/shared';
import { buildView, getWorld } from '../../api/mock';
import { useCharacterStore } from '../../store/character';
import { useLiveCultivation } from './useLiveCultivation';

function seedView(overrides: { stageIndex?: number; exp?: number } = {}) {
  const world = getWorld();
  const character = world.characters.get('char-demo');
  if (!character) throw new Error('demo character missing');
  const patched = {
    ...character,
    stageIndex: overrides.stageIndex ?? character.stageIndex,
    exp: overrides.exp ?? 0,
    lastSettledAt: Date.now(),
  };
  const view = buildView(world, patched);
  useCharacterStore.getState().setView(view);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  useCharacterStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLiveCultivation', () => {
  it('reports nothing before a character is loaded', () => {
    const { result } = renderHook(() => useLiveCultivation());
    expect(result.current.ready).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it('projects 修为 forward at the rate the server reported', () => {
    const view = seedView({ stageIndex: 8, exp: 0 });
    const { result, rerender } = renderHook(() => useLiveCultivation());
    expect(result.current.exp).toBeCloseTo(0, 0);

    vi.advanceTimersByTime(10_000);
    rerender();

    expect(result.current.exp).toBeCloseTo(view.ratePerSec * 10, 0);
    expect(result.current.progress).toBeGreaterThan(0);
  });

  it('never projects past the stage requirement', () => {
    const stage = getStage(0);
    seedView({ stageIndex: 0, exp: stage.expRequired * 0.99 });
    const { result, rerender } = renderHook(() => useLiveCultivation());

    vi.advanceTimersByTime(600_000);
    rerender();

    expect(result.current.exp).toBeLessThanOrEqual(stage.expRequired);
    expect(result.current.progress).toBeLessThanOrEqual(1);
  });

  it('parks at 圆满 with no countdown', () => {
    const stage = getStage(11);
    seedView({ stageIndex: 11, exp: stage.expRequired });
    const { result } = renderHook(() => useLiveCultivation());

    expect(result.current.atPerfection).toBe(true);
    expect(result.current.progress).toBe(1);
    expect(result.current.remainingSec).toBe(Number.POSITIVE_INFINITY);
  });
});
