/**
 * 场景装配：把 store 里的插值缓冲画成一屏会动的大地图。
 *
 * 每帧的活儿是固定的：对一次名册（只在引用变了才做）、按槽位取插值缓冲算位置、
 * 新到的一帧才触发脉冲动效、推一步镜头。名册对齐之外全是定长循环，没有分配，
 * 一百多个实体的每帧开销落在几十微秒量级，真正的成本在 Pixi 的变换与提交上。
 *
 * 场景不认识 React 也不认识 store：`read()` 每帧交给它一份快照，别的一概不管。
 */

import type { Application, Container, Graphics, Sprite } from 'pixi.js';
import type { ArtId, ZoneRosterEntry } from '@xianxia/shared';
import { ZONE_BY_ID, ZONE_FLAGS, ZONE_TILE_PX } from '@xianxia/shared';
import {
  isFollowing,
  stepCamera,
  targetCamera,
  clampCenter,
  followZoom,
  type Camera,
} from './camera';
import { damageBetween, poseAt, renderClock, syncClock, type PoseBuffer } from './interp';
import { ZoneFx } from './fx';
import { ZoneEntityView } from './sprites';
import { ZONE_PALETTE, ZoneTextures, type PixiApi } from './textures';

/** `ZoneCanvas` 每帧从 store 摘出来的东西。 */
export interface ZoneSource {
  frames: ReadonlyMap<number, PoseBuffer>;
  roster: Record<number, ZoneRosterEntry>;
  self: number | null;
  zoneId: string | null;
}

export interface ZoneSceneOptions {
  /** 低端机：降帧、藏掉非己方非 BOSS 的名字。 */
  lowEnd: boolean;
  reducedMotion: boolean;
  resolveArt: (id: ArtId) => string | null;
  read: () => ZoneSource;
}

/** 一帧最多推进多少毫秒：切回标签页时不要把动效一次性播完。 */
const MAX_STEP_MS = 100;
/** 没有 zone 配置时的兜底尺寸，与所有现有图一致。 */
const FALLBACK_CELLS = { w: 60, h: 90 };
/** 名字占位格，世界像素。约等于一个六字名字的外框。 */
const LABEL_CELL_W = 40;
const LABEL_CELL_H = 14;

export class ZoneScene {
  private readonly pixi: PixiApi;
  private readonly app: Application;
  private readonly options: ZoneSceneOptions;
  private readonly textures: ZoneTextures;
  private readonly world: Container;
  private readonly floorLayer: Container;
  private readonly entityLayer: Container;
  private readonly fxLayer: Container;
  private readonly fx: ZoneFx;
  private readonly views = new Map<number, ZoneEntityView>();
  private readonly seenAt = new Map<number, number>();
  private readonly deadSeen = new Set<number>();
  /** 本帧已被名字占掉的屏幕格，见 `claimLabel`。 */
  private readonly labelCells = new Set<number>();

  private floorArt: Sprite | null = null;
  private floorFill: Graphics | null = null;
  private floorGrid: Graphics | null = null;
  private zoneId: string | null = null;
  private worldSize = { w: FALLBACK_CELLS.w * ZONE_TILE_PX, h: FALLBACK_CELLS.h * ZONE_TILE_PX };
  private rosterRef: Record<number, ZoneRosterEntry> | null = null;
  private clockOffset: number | null = null;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private panCenter: { x: number; y: number } | null = null;
  private lastDragAt: number | null = null;
  private lastNow = 0;
  private cameraReady = false;
  private destroyed = false;

  constructor(pixi: PixiApi, app: Application, options: ZoneSceneOptions) {
    this.pixi = pixi;
    this.app = app;
    this.options = options;
    this.textures = new ZoneTextures(pixi);

    this.world = new pixi.Container();
    this.floorLayer = new pixi.Container();
    this.entityLayer = new pixi.Container();
    this.entityLayer.sortableChildren = true;
    this.fxLayer = new pixi.Container();
    this.world.addChild(this.floorLayer, this.entityLayer, this.fxLayer);
    app.stage.addChild(this.world);

    this.fx = new ZoneFx(pixi, this.textures, this.fxLayer, options.reducedMotion);
    const splash = options.resolveArt('ui/ink-splash');
    if (splash) {
      void this.textures.bitmap(splash).then((texture) => {
        if (!this.destroyed) this.fx.setSplashTexture(texture);
      });
    }
  }

  /** 每帧一次，由 Pixi 的 ticker 驱动。`now` 是本地单调时钟。 */
  update(now: number): void {
    if (this.destroyed) return;
    const dt = this.lastNow === 0 ? 16 : Math.min(MAX_STEP_MS, Math.max(0, now - this.lastNow));
    this.lastNow = now;

    const source = this.options.read();
    if (source.zoneId !== this.zoneId) this.setZone(source.zoneId);
    if (source.roster !== this.rosterRef) this.reconcile(source);

    let latestAt = 0;
    for (const buffer of source.frames.values()) {
      if (buffer.next.at > latestAt) latestAt = buffer.next.at;
    }
    if (latestAt > 0) this.clockOffset = syncClock(this.clockOffset, latestAt, now, dt);
    const renderAt = this.clockOffset === null ? 0 : renderClock(this.clockOffset, now);

    let selfAt: { x: number; y: number } | null = null;
    this.labelCells.clear();
    for (const [slot, view] of this.views) {
      const buffer = source.frames.get(slot);
      if (!buffer) {
        view.root.visible = false;
        continue;
      }
      const pose = poseAt(buffer, renderAt);
      const px = pose.x * ZONE_TILE_PX;
      const py = pose.y * ZONE_TILE_PX;
      view.place(px, py);
      view.setHpRatio(pose.hp / view.entry.maxHp);
      view.applyFlags(buffer.next.flags, dt);
      view.tick(dt);
      view.showLabel(this.claimLabel(px, py, slot === source.self));
      if (buffer.next.at !== this.seenAt.get(slot)) {
        this.seenAt.set(slot, buffer.next.at);
        this.firePulses(slot, view, buffer, px, py);
      }
      if (slot === source.self) selfAt = { x: px, y: py };
    }

    this.stepCameraTo(selfAt, now, dt);
    this.fx.update(dt);
  }

  /** manifest 到货或 `?art=off` 切换：底图与所有立绘重新解析一遍。 */
  refreshArt(): void {
    if (this.destroyed) return;
    const splash = this.options.resolveArt('ui/ink-splash');
    if (splash) {
      void this.textures.bitmap(splash).then((texture) => {
        if (!this.destroyed) this.fx.setSplashTexture(texture);
      });
    } else {
      this.fx.setSplashTexture(null);
    }
    // 重画地面、丢掉所有视图让它们带着新素材重建；镜头和图幅不动，换素材不该
    // 把画面拽回原点。
    const zone = this.zoneId ? ZONE_BY_ID.get(this.zoneId) : undefined;
    this.drawFloor(zone?.floorArt ?? null, zone?.entrance ?? null);
    this.clearViews();
    this.rosterRef = null;
  }

  /** 手指/鼠标拖动，参数是画布像素位移。停手 3 s 后 `isFollowing` 会自己收回。 */
  pan(dxScreen: number, dyScreen: number, now: number): void {
    const view = { w: this.app.screen.width, h: this.app.screen.height };
    const zoom = this.camera.zoom || 1;
    const from = this.panCenter ?? { x: this.camera.x, y: this.camera.y };
    this.panCenter = clampCenter(
      { x: from.x - dxScreen / zoom, y: from.y - dyScreen / zoom, zoom },
      view,
      this.worldSize,
      zoom,
    );
    this.lastDragAt = now;
  }

  endPan(now: number): void {
    this.lastDragAt = now;
  }

  destroy(): void {
    this.destroyed = true;
    this.clearViews();
    this.fx.destroy();
    this.floorArt?.destroy();
    this.floorFill?.destroy();
    this.floorGrid?.destroy();
    this.world.destroy({ children: true });
    this.textures.destroy();
  }

  // ------------------------------------------------------------------ 内部

  private stepCameraTo(selfAt: { x: number; y: number } | null, now: number, dt: number): void {
    const view = { w: this.app.screen.width, h: this.app.screen.height };
    if (view.w <= 0 || view.h <= 0) return;
    const following = isFollowing(now, this.lastDragAt);
    if (following) this.panCenter = null;
    const target = following ? selfAt : this.panCenter;
    // 跟随时用固定可视格数；手动拖动时沿用当前缩放，抓着地图不该突然放大。
    const zoom = following ? followZoom(view, this.worldSize, ZONE_TILE_PX) : this.camera.zoom;
    const wanted = targetCamera({
      view,
      world: this.worldSize,
      cellPx: ZONE_TILE_PX,
      target,
      zoom: target ? zoom : undefined,
    });
    // 首帧直接落位，否则镜头会从地图角上飞过来。
    this.camera = this.cameraReady ? stepCamera(this.camera, wanted, dt) : wanted;
    this.cameraReady = true;
    this.world.scale.set(this.camera.zoom);
    this.world.position.set(
      view.w / 2 - this.camera.x * this.camera.zoom,
      view.h / 2 - this.camera.y * this.camera.zoom,
    );
  }

  /**
   * 名字防重叠：把画面切成 `LABEL_CELL_W` x `LABEL_CELL_H` 的格子，一格只让一个
   * 名字露出来。自己永远露。格号打包成整数当键，每帧零分配。
   */
  private claimLabel(px: number, py: number, isSelf: boolean): boolean {
    if (isSelf) return true;
    const key = (Math.round(px / LABEL_CELL_W) << 12) ^ Math.round(py / LABEL_CELL_H);
    if (this.labelCells.has(key)) return false;
    this.labelCells.add(key);
    return true;
  }

  private firePulses(
    slot: number,
    view: ZoneEntityView,
    buffer: PoseBuffer,
    px: number,
    py: number,
  ): void {
    const flags = buffer.next.flags;
    const top = py - view.radius - 8;
    if ((flags & ZONE_FLAGS.HIT) !== 0) {
      view.flash();
      const crit = (flags & ZONE_FLAGS.CRIT) !== 0;
      this.fx.damage(px, top, damageBetween(buffer), crit ? 'crit' : 'hit');
    }
    if ((flags & ZONE_FLAGS.DODGED) !== 0) this.fx.damage(px, top, 0, 'dodge');
    if ((flags & ZONE_FLAGS.CASTING) !== 0) view.cast();
    const dead = (flags & ZONE_FLAGS.DEAD) !== 0;
    if (dead && !this.deadSeen.has(slot)) {
      this.deadSeen.add(slot);
      this.fx.splash(px, py, view.radius);
    } else if (!dead) {
      this.deadSeen.delete(slot);
    }
  }

  /**
   * 名册对齐。槽位复用是硬约定：同一个 `i` 换了 `id` 就是换了人，旧视图必须销毁
   * 重建，不能就地改名。
   */
  private reconcile(source: ZoneSource): void {
    this.rosterRef = source.roster;
    const roster = source.roster;
    for (const [slot, view] of this.views) {
      const entry = roster[slot];
      if (!entry || entry.id !== view.entry.id) {
        view.destroy();
        this.views.delete(slot);
        this.seenAt.delete(slot);
        this.deadSeen.delete(slot);
      }
    }
    for (const key of Object.keys(roster)) {
      const slot = Number(key);
      if (this.views.has(slot)) continue;
      const entry = roster[slot];
      if (!entry) continue;
      const view = new ZoneEntityView(this.pixi, this.textures, entry, {
        showName: !this.options.lowEnd || slot === source.self,
        reducedMotion: this.options.reducedMotion,
        isSelf: slot === source.self,
        resolveArt: this.options.resolveArt,
      });
      this.entityLayer.addChild(view.root);
      this.views.set(slot, view);
    }
  }

  private clearViews(): void {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.seenAt.clear();
    this.deadSeen.clear();
  }

  /** 换图：重画地面，清空所有槽位，镜头复位。 */
  private setZone(zoneId: string | null): void {
    if (zoneId === this.zoneId) return;
    this.zoneId = zoneId;
    const zone = zoneId ? ZONE_BY_ID.get(zoneId) : undefined;
    const cells = zone ? { w: zone.width, h: zone.height } : FALLBACK_CELLS;
    this.worldSize = { w: cells.w * ZONE_TILE_PX, h: cells.h * ZONE_TILE_PX };
    this.clearViews();
    this.rosterRef = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.cameraReady = false;
    this.panCenter = null;
    this.lastDragAt = null;
    this.drawFloor(zone?.floorArt ?? null, zone?.entrance ?? null);
  }

  /**
   * 地面。有底图就铺底图（768x1152 的 2:3 图正好铺满 60x90 格），没有就画一层
   * 深色纸背加淡金网格——素材没到位时也得看得出地形和距离。
   */
  private drawFloor(floorArt: ArtId | null, entrance: { x: number; y: number } | null): void {
    this.floorArt?.destroy();
    this.floorArt = null;
    this.floorFill?.destroy();
    this.floorFill = null;
    this.floorGrid?.destroy();
    this.floorGrid = null;

    const fill = new this.pixi.Graphics();
    fill.rect(0, 0, this.worldSize.w, this.worldSize.h).fill(ZONE_PALETTE.floor);
    this.floorLayer.addChild(fill);
    this.floorFill = fill;

    const grid = new this.pixi.Graphics();
    const step = ZONE_TILE_PX * 6;
    for (let x = step; x < this.worldSize.w; x += step) {
      grid.moveTo(x, 0).lineTo(x, this.worldSize.h);
    }
    for (let y = step; y < this.worldSize.h; y += step) {
      grid.moveTo(0, y).lineTo(this.worldSize.w, y);
    }
    grid.stroke({ width: 1, color: ZONE_PALETTE.grid, alpha: ZONE_PALETTE.gridAlpha });
    grid
      .rect(0, 0, this.worldSize.w, this.worldSize.h)
      .stroke({ width: 2, color: ZONE_PALETTE.grid, alpha: 0.24 });
    if (entrance) {
      grid
        .circle(entrance.x * ZONE_TILE_PX, entrance.y * ZONE_TILE_PX, ZONE_TILE_PX * 1.6)
        .stroke({ width: 1.5, color: ZONE_PALETTE.entrance, alpha: 0.5 });
    }
    this.floorLayer.addChild(grid);
    this.floorGrid = grid;

    const src = floorArt ? this.options.resolveArt(floorArt) : null;
    if (!src) return;
    void this.textures.bitmap(src).then((texture) => {
      if (!texture || this.destroyed || !this.floorGrid) return;
      const sprite = new this.pixi.Sprite(texture);
      sprite.width = this.worldSize.w;
      sprite.height = this.worldSize.h;
      this.floorLayer.addChildAt(sprite, 0);
      this.floorArt = sprite;
      // 底图到位后收掉纯色地面，网格退成一层极淡的刻度。
      if (this.floorFill) this.floorFill.visible = false;
      this.floorGrid.alpha = 0.4;
    });
  }
}

export function createZoneScene(
  pixi: PixiApi,
  app: Application,
  options: ZoneSceneOptions,
): ZoneScene {
  return new ZoneScene(pixi, app, options);
}
