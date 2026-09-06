/**
 * 镜头：世界像素 ↔ 画布像素。
 *
 * 有 self 时跟着自己走，可见宽度固定在 `ZONE_VISIBLE_CELLS` 格左右——手机上一眼
 * 能看清周围谁在打谁，又不至于把整张 60x90 的图缩成蚂蚁。没有 self（旁观、还没
 * 入图）就整图铺满。镜头永远被钳在地图内，边缘不会露出画布底色；地图比视口小
 * 的那一维直接居中。
 *
 * 纯函数，不碰 PixiJS。世界坐标一律是像素（格 x ZONE_TILE_PX），不是格。
 */

export interface Camera {
  /** 镜头中心的世界像素坐标。 */
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 跟随模式下画布横向大约能看到多少格。 */
export const ZONE_VISIBLE_CELLS = 30;

/** 跟随的时间常数：越小越贴身，140 ms 在「跟得住」和「不晕」之间。 */
export const ZONE_CAMERA_TAU_MS = 140;

/** 手动拖动之后停手多久回到跟随。 */
export const ZONE_DRAG_RELEASE_MS = 3000;

/** 放得再大也就这样，免得低分辨率底图糊成一片。 */
export const ZONE_MAX_ZOOM = 2.5;

/** 整图铺满视口所需的缩放（取两轴较小者，保证全图可见）。 */
export function fitZoom(view: Size, world: Size): number {
  if (view.w <= 0 || view.h <= 0 || world.w <= 0 || world.h <= 0) return 1;
  return Math.min(view.w / world.w, view.h / world.h);
}

/** 跟随模式的缩放：横向约 `ZONE_VISIBLE_CELLS` 格，且不会比整图铺满还小。 */
export function followZoom(view: Size, world: Size, cellPx: number): number {
  if (view.w <= 0 || cellPx <= 0) return 1;
  const wanted = view.w / (ZONE_VISIBLE_CELLS * cellPx);
  const floor = fitZoom(view, world);
  return Math.min(ZONE_MAX_ZOOM, Math.max(wanted, floor));
}

/**
 * 把镜头中心钳进地图。
 * 某一维上地图不够视口宽时居中——总比露出画布外的空白强。
 */
export function clampCenter(
  center: Camera,
  view: Size,
  world: Size,
  zoom: number,
): { x: number; y: number } {
  const halfW = view.w / (2 * zoom);
  const halfH = view.h / (2 * zoom);
  const x =
    halfW * 2 >= world.w ? world.w / 2 : Math.min(Math.max(center.x, halfW), world.w - halfW);
  const y =
    halfH * 2 >= world.h ? world.h / 2 : Math.min(Math.max(center.y, halfH), world.h - halfH);
  return { x, y };
}

export interface CameraTargetInput {
  view: Size;
  world: Size;
  cellPx: number;
  /** 想看的世界像素点：自己的位置，或手动拖动后的中心。null = 整图。 */
  target: { x: number; y: number } | null;
  /** 手动拖动时不改变缩放，沿用当前值。 */
  zoom?: number;
}

/** 这一刻镜头「应该」在哪。`stepCamera` 负责慢慢挪过去。 */
export function targetCamera(input: CameraTargetInput): Camera {
  const { view, world, cellPx, target } = input;
  if (!target) {
    const zoom = fitZoom(view, world);
    return { x: world.w / 2, y: world.h / 2, zoom };
  }
  const zoom = input.zoom ?? followZoom(view, world, cellPx);
  const center = clampCenter({ x: target.x, y: target.y, zoom }, view, world, zoom);
  return { x: center.x, y: center.y, zoom };
}

/**
 * 指数逼近，与帧率无关：同样的 `tau` 在 30 fps 和 120 fps 下收敛速度一致。
 * 距离小于半像素就直接落位，免得永远差一点点在那儿抖。
 */
export function stepCamera(
  from: Camera,
  to: Camera,
  dtMs: number,
  tauMs = ZONE_CAMERA_TAU_MS,
): Camera {
  if (!(dtMs > 0)) return from;
  const k = 1 - Math.exp(-dtMs / Math.max(1, tauMs));
  const snap = (a: number, b: number, eps: number) => (Math.abs(b - a) < eps ? b : a + (b - a) * k);
  return {
    x: snap(from.x, to.x, 0.5),
    y: snap(from.y, to.y, 0.5),
    zoom: snap(from.zoom, to.zoom, 0.001),
  };
}

/** 世界像素 → 画布像素。 */
export function worldToScreen(
  camera: Camera,
  view: Size,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.zoom + view.w / 2,
    y: (y - camera.y) * camera.zoom + view.h / 2,
  };
}

/** 画布像素 → 世界像素。拖动时把手指位移换算成镜头位移用。 */
export function screenToWorld(
  camera: Camera,
  view: Size,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - view.w / 2) / camera.zoom + camera.x,
    y: (y - view.h / 2) / camera.zoom + camera.y,
  };
}

/** 停手 `ZONE_DRAG_RELEASE_MS` 之后自动回到跟随；从没拖过就一直跟随。 */
export function isFollowing(now: number, lastDragAt: number | null): boolean {
  if (lastDragAt === null) return true;
  return now - lastDragAt >= ZONE_DRAG_RELEASE_MS;
}
