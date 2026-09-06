/**
 * 纹理与配色。
 *
 * 大地图上同时有一两百个实体，所以能共享的图案一律只画一次：圆盘、境界环、辉光、
 * 妖兽占位的首字，都是离屏 canvas 画成的白色图案，用 `tint` 染色后当普通 Sprite
 * 批量提交——避免每个实体各带一个 Graphics 或一个遮罩，那是这个场景里唯一会真正
 * 拖垮帧率的东西。头像同理：圆形裁切在 canvas 里做完再上传，省掉每人一个 stencil
 * 遮罩。
 *
 * 本文件不静态 import pixi，只接收 `ZoneCanvas` 动态加载进来的命名空间，pixi 才
 * 能留在自己的 chunk 里。
 */

import type * as PixiNamespace from 'pixi.js';
import type { Texture } from 'pixi.js';

/** `await import('pixi.js')` 的返回值。 */
export type PixiApi = typeof PixiNamespace;

/**
 * 九大境界各一色，练气到渡劫由灰到白，中途借用 tokens.css 的青黛/金/朱砂。
 * 底图是深色的，所以取的都是在暗底上还认得出的明度。
 */
export const REALM_COLORS: readonly number[] = [
  0x8a9ba0, // 练气 灰青
  0x3b5f6b, // 筑基 青黛 --indigo
  0x4e8c6a, // 金丹 松绿
  0xc9a063, // 元婴 金 --gold
  0xc97b3a, // 化神 赭
  0xb23a2e, // 炼虚 朱砂 --cinnabar
  0x8e4a7a, // 合体 绛紫
  0x6a4fa3, // 大乘 青莲
  0xe8dcc0, // 渡劫 月华
];

/** 大境界 = stageIndex / 4，越界一律钳回表内。 */
export function realmColorOf(stageIndex: number): number {
  const realm = Math.floor(stageIndex / 4);
  const clamped = Math.min(REALM_COLORS.length - 1, Math.max(0, realm));
  return REALM_COLORS[clamped] as number;
}

/** 底图缺席时的自绘配色，以及各种恒定色。 */
export const ZONE_PALETTE = {
  /** 没有底图时的地面。 */
  floor: 0x0e1116,
  /** 淡金网格。 */
  grid: 0xd9b15f,
  gridAlpha: 0.08,
  /** 出生点/入口标记。 */
  entrance: 0xc9a063,
  hpBack: 0x14100e,
  hpAlly: 0x5e9c76,
  hpFoe: 0xb23a2e,
  hpBoss: 0xc9a063,
  self: 0xb23a2e,
  boss: 0xc9a063,
  damage: 0xf3ebdc,
  crit: 0xc9a063,
  dodge: 0x9a938a,
  name: 0xf3ebdc,
  ink: 0x1e1b18,
} as const;

/** 与 tokens.css 的 --font-body 一致，CJK 名字才不会掉进衬线兜底。 */
export const ZONE_FONT_FAMILY = [
  'PingFang SC',
  'Noto Sans CJK SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'sans-serif',
];

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * 共享纹理池，随场景一起生死。
 *
 * 白色图案 + tint 的做法意味着同一张纹理能给所有实体用，Pixi 就能把它们合进一次
 * 批次；每人各画一个 Graphics 圆则做不到。
 */
export class ZoneTextures {
  private readonly pixi: PixiApi;
  private readonly shapes = new Map<string, Texture>();
  private readonly chars = new Map<string, Texture>();
  private readonly loads = new Map<string, Promise<Texture | null>>();
  private disposed = false;

  constructor(pixi: PixiApi) {
    this.pixi = pixi;
  }

  /** 1x1 白点，缩放成血条。 */
  get white(): Texture {
    return this.pixi.Texture.WHITE;
  }

  /** 实心白圆：妖兽占位、命中闪白、自身底盘。 */
  disc(): Texture {
    return this.shape('disc', (ctx, size) => {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    });
  }

  /** 白色圆环：境界色环、自身朱砂圈、BOSS 金环。 */
  ring(): Texture {
    return this.shape('ring', (ctx, size) => {
      const width = size * 0.09;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - width, 0, Math.PI * 2);
      ctx.lineWidth = width;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    });
  }

  /** 径向渐变辉光：施法与 BOSS 的存在感，也是没有 ink-splash 时的死亡替身。 */
  glow(): Texture {
    return this.shape('glow', (ctx, size) => {
      const half = size / 2;
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.28)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    });
  }

  /**
   * 一个汉字的白色贴图，用来给没有立绘的妖兽当首字占位。
   * 同一张图上同种妖兽共用一张纹理，几十只狼只占一张。
   */
  char(text: string): Texture {
    const key = text || '?';
    const cached = this.chars.get(key);
    if (cached) return cached;
    const size = 64;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(size * 0.62)}px ${ZONE_FONT_FAMILY.join(',')}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, size / 2, size / 2 + 2);
    }
    const texture = this.pixi.Texture.from(canvas);
    this.chars.set(key, texture);
    return texture;
  }

  /** 位图素材（底图、妖兽立绘）。素材还没出图时返回 null，调用方负责占位。 */
  bitmap(url: string): Promise<Texture | null> {
    const cached = this.loads.get(url);
    if (cached) return cached;
    const task = this.pixi.Assets.load<Texture>(url).catch(() => null);
    this.loads.set(url, task);
    return task;
  }

  /**
   * 圆形裁切好的头像。
   *
   * 在 canvas 里裁而不是给每个修士挂一个 Graphics 遮罩：遮罩会打断批次，一百多个
   * 修士就是一百多次额外绘制；这里同一个头像 URL 只裁一次，之后就是普通 Sprite。
   */
  portrait(url: string): Promise<Texture | null> {
    const key = `round:${url}`;
    const cached = this.loads.get(key);
    if (cached) return cached;
    const task = loadImage(url)
      .then((image) => {
        if (this.disposed || !image) return null;
        const size = 96;
        const canvas = makeCanvas(size);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        // cover：短边铺满，长边居中裁掉，人脸通常在上半张，纵向取偏上的一段。
        const scale = Math.max(size / image.width, size / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        ctx.drawImage(image, (size - w) / 2, (size - h) * 0.35, w, h);
        return this.pixi.Texture.from(canvas);
      })
      .catch(() => null);
    this.loads.set(key, task);
    return task;
  }

  private shape(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
    const cached = this.shapes.get(key);
    if (cached) return cached;
    const size = 64;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    if (ctx) draw(ctx, size);
    const texture = this.pixi.Texture.from(canvas);
    this.shapes.set(key, texture);
    return texture;
  }

  destroy(): void {
    this.disposed = true;
    for (const texture of this.shapes.values()) texture.destroy(true);
    for (const texture of this.chars.values()) texture.destroy(true);
    this.shapes.clear();
    this.chars.clear();
    // `Assets` 拿到的纹理归它自己的缓存管，重进同一张图还要用，不在这里销毁。
    this.loads.clear();
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
