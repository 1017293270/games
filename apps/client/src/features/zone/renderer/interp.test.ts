import { describe, expect, it } from 'vitest';
import type { ZonePose } from '@xianxia/shared';
import {
  ZONE_INTERP_DELAY_MS,
  clamp01,
  damageBetween,
  deathFade,
  lerp,
  poseAt,
  renderClock,
  syncClock,
  type PoseBuffer,
} from './interp';

function pose(partial: Partial<ZonePose> = {}): ZonePose {
  return { x: 0, y: 0, hp: 100, flags: 0, at: 0, ...partial };
}

function buffer(prev: Partial<ZonePose>, next: Partial<ZonePose>): PoseBuffer {
  return { prev: pose(prev), next: pose(next) };
}

describe('clamp01 / lerp', () => {
  it('钳在 0..1，NaN 当 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('线性插值', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 1)).toBe(20);
  });
});

describe('poseAt', () => {
  const buf = buffer({ x: 10, y: 20, hp: 100, at: 1000 }, { x: 12, y: 24, hp: 60, at: 1250 });

  it('半程取两帧中点，血量一起插值', () => {
    const at = poseAt(buf, 1125);
    expect(at.x).toBeCloseTo(11, 6);
    expect(at.y).toBeCloseTo(22, 6);
    expect(at.hp).toBeCloseTo(80, 6);
    expect(at.t).toBeCloseTo(0.5, 6);
  });

  it('两帧之前钳在 prev', () => {
    expect(poseAt(buf, 0)).toMatchObject({ x: 10, y: 20, t: 0 });
  });

  it('缺帧时钳在 next，不外推', () => {
    const late = poseAt(buf, 9999);
    expect(late).toMatchObject({ x: 12, y: 24, t: 1 });
  });

  it('两帧同刻（刚入图、只收到一帧）直接用 next', () => {
    const single = buffer({ x: 5, y: 5, at: 800 }, { x: 5, y: 5, at: 800 });
    expect(poseAt(single, 800)).toMatchObject({ x: 5, y: 5, t: 1 });
  });

  it('时间倒流（服务端重置）也不会插出负 t', () => {
    const backwards = buffer({ x: 0, y: 0, at: 2000 }, { x: 4, y: 0, at: 1000 });
    expect(poseAt(backwards, 1500)).toMatchObject({ x: 4, t: 1 });
  });

  it('瞬移（复活回入口）不拖着走，直接落地', () => {
    const respawn = buffer({ x: 30, y: 10, at: 1000 }, { x: 30, y: 84, at: 1250 });
    const mid = poseAt(respawn, 1125);
    expect(mid.x).toBe(30);
    expect(mid.y).toBe(84);
    expect(mid.t).toBe(1);
  });
});

describe('syncClock / renderClock', () => {
  it('没有历史值时直接采样', () => {
    expect(syncClock(null, 5_000, 1_200)).toBe(3_800);
    expect(syncClock(Number.NaN, 5_000, 1_200)).toBe(3_800);
  });

  it('向上立刻跟随：新帧一到就吃满', () => {
    expect(syncClock(3_800, 6_000, 1_450)).toBe(4_550);
  });

  it('向下缓慢回收：两帧之间的自然下坠不会把时钟拽走', () => {
    const kept = syncClock(4_000, 4_000, 200, 16);
    // 采样值 3_800，一帧（16 ms）只该挪走千分之几。
    expect(kept).toBeLessThan(4_000);
    expect(kept).toBeGreaterThan(3_998);
  });

  it('真实漂移经过足够多帧后还是会收敛过去', () => {
    let offset = 4_000;
    for (let i = 0; i < 1_000; i += 1) offset = syncClock(offset, 3_000 + i * 16, i * 16, 16);
    expect(offset).toBeCloseTo(3_000, 0);
  });

  it('渲染时刻 = 本地时间 + 偏移 − 滞后', () => {
    expect(renderClock(3_800, 1_200)).toBe(5_000 - ZONE_INTERP_DELAY_MS);
    expect(renderClock(3_800, 1_200, 0)).toBe(5_000);
  });
});

describe('damageBetween / deathFade', () => {
  it('掉血算伤害，回血算 0', () => {
    expect(damageBetween(buffer({ hp: 100 }, { hp: 62 }))).toBe(38);
    expect(damageBetween(buffer({ hp: 40 }, { hp: 90 }))).toBe(0);
  });

  it('600 ms 淡到 0', () => {
    expect(deathFade(0)).toBe(1);
    expect(deathFade(300)).toBeCloseTo(0.5, 6);
    expect(deathFade(600)).toBe(0);
    expect(deathFade(5_000)).toBe(0);
  });
});
