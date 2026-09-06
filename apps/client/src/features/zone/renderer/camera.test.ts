import { describe, expect, it } from 'vitest';
import {
  ZONE_DRAG_RELEASE_MS,
  ZONE_MAX_ZOOM,
  ZONE_VISIBLE_CELLS,
  clampCenter,
  fitZoom,
  followZoom,
  isFollowing,
  screenToWorld,
  stepCamera,
  targetCamera,
  worldToScreen,
  type Camera,
} from './camera';

/** 一张 60x90 格的图，ZONE_TILE_PX = 12。 */
const WORLD = { w: 720, h: 1080 };
const CELL = 12;
/** 手机竖屏画布。 */
const VIEW = { w: 400, h: 700 };

describe('fitZoom', () => {
  it('取两轴较小者，保证整图进得来', () => {
    expect(fitZoom({ w: 360, h: 540 }, WORLD)).toBeCloseTo(0.5, 6);
    expect(fitZoom({ w: 720, h: 540 }, WORLD)).toBeCloseTo(0.5, 6);
  });

  it('画布还没量出来时不炸', () => {
    expect(fitZoom({ w: 0, h: 0 }, WORLD)).toBe(1);
  });
});

describe('followZoom', () => {
  it('横向大约 ZONE_VISIBLE_CELLS 格', () => {
    const zoom = followZoom(VIEW, WORLD, CELL);
    expect(VIEW.w / zoom / CELL).toBeCloseTo(ZONE_VISIBLE_CELLS, 6);
  });

  it('不会比整图铺满还小', () => {
    const tiny = { w: 200, h: 200 };
    expect(followZoom(tiny, WORLD, CELL)).toBeGreaterThanOrEqual(fitZoom(tiny, WORLD));
  });

  it('宽屏也有上限', () => {
    expect(followZoom({ w: 4000, h: 1200 }, WORLD, CELL)).toBe(ZONE_MAX_ZOOM);
  });
});

describe('clampCenter', () => {
  const zoom = 1;

  it('把镜头钳进地图，边上不露白', () => {
    expect(clampCenter({ x: -50, y: -50, zoom }, VIEW, WORLD, zoom)).toEqual({ x: 200, y: 350 });
    expect(clampCenter({ x: 9999, y: 9999, zoom }, VIEW, WORLD, zoom)).toEqual({ x: 520, y: 730 });
  });

  it('地图比视口窄的那一维居中', () => {
    const wide = { w: 1600, h: 400 };
    expect(clampCenter({ x: 10, y: 500, zoom }, wide, WORLD, zoom).x).toBe(WORLD.w / 2);
  });

  it('中间的点原样放行', () => {
    expect(clampCenter({ x: 360, y: 540, zoom }, VIEW, WORLD, zoom)).toEqual({ x: 360, y: 540 });
  });
});

describe('targetCamera', () => {
  it('没有 self 就整图铺满、镜头居中', () => {
    const cam = targetCamera({ view: VIEW, world: WORLD, cellPx: CELL, target: null });
    expect(cam).toEqual({ x: 360, y: 540, zoom: fitZoom(VIEW, WORLD) });
  });

  it('有 self 就跟着走并钳进地图', () => {
    const cam = targetCamera({
      view: VIEW,
      world: WORLD,
      cellPx: CELL,
      target: { x: 360, y: 1008 },
    });
    expect(cam.zoom).toBeCloseTo(followZoom(VIEW, WORLD, CELL), 6);
    expect(cam.x).toBe(360);
    expect(cam.y).toBeLessThan(1008);
  });

  it('拖动时沿用传入的缩放', () => {
    const cam = targetCamera({
      view: VIEW,
      world: WORLD,
      cellPx: CELL,
      target: { x: 300, y: 400 },
      zoom: 2,
    });
    expect(cam.zoom).toBe(2);
  });
});

describe('stepCamera', () => {
  const from: Camera = { x: 0, y: 0, zoom: 1 };
  const to: Camera = { x: 100, y: 200, zoom: 2 };

  it('dt = 0 不动', () => {
    expect(stepCamera(from, to, 0)).toBe(from);
  });

  it('单调逼近，不过冲', () => {
    let cam = from;
    for (let i = 0; i < 10; i += 1) {
      const next = stepCamera(cam, to, 16);
      expect(next.x).toBeGreaterThanOrEqual(cam.x);
      expect(next.x).toBeLessThanOrEqual(to.x);
      cam = next;
    }
  });

  it('与帧率无关：一大步约等于若干小步', () => {
    let small = from;
    for (let i = 0; i < 10; i += 1) small = stepCamera(small, to, 8);
    const big = stepCamera(from, to, 80);
    expect(small.x).toBeCloseTo(big.x, 6);
  });

  it('足够久之后精确落位', () => {
    let cam = from;
    for (let i = 0; i < 200; i += 1) cam = stepCamera(cam, to, 16);
    expect(cam).toEqual(to);
  });
});

describe('worldToScreen / screenToWorld', () => {
  const cam: Camera = { x: 360, y: 540, zoom: 1.5 };

  it('镜头中心画在画布中心', () => {
    expect(worldToScreen(cam, VIEW, 360, 540)).toEqual({ x: 200, y: 350 });
  });

  it('互为逆变换', () => {
    const screen = worldToScreen(cam, VIEW, 123, 456);
    const back = screenToWorld(cam, VIEW, screen.x, screen.y);
    expect(back.x).toBeCloseTo(123, 6);
    expect(back.y).toBeCloseTo(456, 6);
  });
});

describe('isFollowing', () => {
  it('没拖过就一直跟随', () => {
    expect(isFollowing(1_000, null)).toBe(true);
  });

  it('拖动期间不跟随，停手 3 s 后恢复', () => {
    expect(isFollowing(1_000, 1_000)).toBe(false);
    expect(isFollowing(1_000 + ZONE_DRAG_RELEASE_MS - 1, 1_000)).toBe(false);
    expect(isFollowing(1_000 + ZONE_DRAG_RELEASE_MS, 1_000)).toBe(true);
  });
});
