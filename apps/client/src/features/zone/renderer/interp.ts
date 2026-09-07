/**
 * 帧插值：把 4 Hz 的服务端快照摊成 60 fps 的画面。
 *
 * 服务端每 250 ms 推一帧（`WorldSettings.zoneSnapshotHz`），渲染器却每帧都要落
 * 笔，所以每个槽位留 `{prev, next}` 两个 `ZonePose`，画面时间取「服务端时间 −
 * ZONE_INTERP_DELAY_MS」，永远落在这两帧之间往回插值。滞后 300 ms 略大于一帧
 * 间隔，掉一帧也还有料可插，代价是所有人都比服务端慢三分之一秒——大地图上没有
 * 需要帧级判定的操作，这笔买卖划算。
 *
 * 本文件是纯函数，不碰 PixiJS，也不碰 store，可以直接单测。
 */

import type { ZonePose } from '@xianxia/shared';

/** 一个槽位的插值缓冲。store 侧原地改写这两个对象，渲染器只读。 */
export interface PoseBuffer {
  shield?: number;
  prev: ZonePose;
  next: ZonePose;
}

/** 画面比服务端慢多少毫秒。必须大于一帧间隔（250 ms），否则会插到没有的未来。 */
export const ZONE_INTERP_DELAY_MS = 300;

/**
 * 两帧间位移超过这么多格就当作瞬移（复活回入口、被拉回刷新点），直接跳过去。
 * 正常行走 4 格/秒，一帧最多 1 格，不会误判。
 */
export const ZONE_TELEPORT_CELLS = 8;

/** 时钟偏移向下收敛的时间常数：抬升立刻生效，回落用 2 s 慢慢磨。 */
const CLOCK_DECAY_TAU_MS = 2000;

export function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export interface InterpResult {
  x: number;
  y: number;
  /** 血量同样插值，血条才不会一跳一跳。 */
  hp: number;
  /** 在 prev→next 之间的位置，0..1。 */
  t: number;
}

/**
 * 槽位在 `renderAt`（服务端时间轴）那一刻的位置。
 *
 * `renderAt` 越过 `next.at` 时钳在 next——宁可停住也不外推，掉帧时静止一下远比
 * 冲出去再被拽回来好看。
 */
export function poseAt(buffer: PoseBuffer, renderAt: number): InterpResult {
  const { prev, next } = buffer;
  const span = next.at - prev.at;
  if (!(span > 0)) {
    return { x: next.x, y: next.y, hp: next.hp, t: 1 };
  }
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  if (dx * dx + dy * dy > ZONE_TELEPORT_CELLS * ZONE_TELEPORT_CELLS) {
    return { x: next.x, y: next.y, hp: next.hp, t: 1 };
  }
  const t = clamp01((renderAt - prev.at) / span);
  return {
    x: lerp(prev.x, next.x, t),
    y: lerp(prev.y, next.y, t),
    hp: lerp(prev.hp, next.hp, t),
    t,
  };
}

/**
 * 本地单调时钟 → 服务端时间的偏移量。
 *
 * `latestAt` 是当前所有槽位里最新的一帧时间戳。刚收到帧的那一瞬 `latestAt -
 * localNow` 最大，也最接近真实偏移；两帧之间它会一路掉到 −250 ms，所以取上包络：
 * 向上立刻跟随，向下按 `CLOCK_DECAY_TAU_MS` 缓慢回收，只用来吸收真正的时钟漂移，
 * 不被抖动带跑。
 */
export function syncClock(
  offset: number | null,
  latestAt: number,
  localNow: number,
  dtMs = 16,
): number {
  const sample = latestAt - localNow;
  if (offset === null || !Number.isFinite(offset)) return sample;
  if (sample > offset) return sample;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / CLOCK_DECAY_TAU_MS);
  return offset + (sample - offset) * k;
}

/** 该画哪一刻：本地时间换算到服务端时间，再往回退一个滞后量。 */
export function renderClock(
  offset: number,
  localNow: number,
  delayMs = ZONE_INTERP_DELAY_MS,
): number {
  return localNow + offset - delayMs;
}

/** 两帧之间掉的血，用来合成伤害数字；治疗与复活回血记 0。 */
export function damageBetween(buffer: PoseBuffer): number {
  return Math.max(0, buffer.prev.hp - buffer.next.hp);
}

/** 阵亡后 `elapsed` 毫秒时的不透明度：600 ms 淡到 0。 */
export function deathFade(elapsedMs: number, durationMs = 600): number {
  return 1 - clamp01(elapsedMs / durationMs);
}
