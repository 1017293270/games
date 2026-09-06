/**
 * 一次性动效：飘字与阵亡的墨点。
 *
 * 全部走对象池——一场混战每秒能出几十个伤害数字，每次 new 一个 Text 意味着每次
 * 都要重新光栅化一张画布，池子里换个字符串则只重画一次纹理。池满就丢掉最老的
 * 那个，宁可少飘一个数字也不让帧率掉下去。
 *
 * `prefers-reduced-motion` 下整层静默：飘字和闪光是这个界面里唯一真正快速运动的
 * 东西。
 */

import type { Container, Sprite, Text, Texture } from 'pixi.js';
import { ZONE_FONT_FAMILY, ZONE_PALETTE, type PixiApi, type ZoneTextures } from './textures';

export type DamageKind = 'hit' | 'crit' | 'dodge';

/** 同时在天上飞的伤害数字上限。 */
const MAX_FLOATERS = 28;
/** 同时展开的墨点上限。 */
const MAX_SPLASHES = 10;
const FLOAT_MS = 720;
const CRIT_MS = 900;
const SPLASH_MS = 600;
/** 飘字总共升起多少世界像素。 */
const FLOAT_RISE = 26;

interface Floater {
  node: Text;
  age: number;
  ttl: number;
  x: number;
  y: number;
  scale: number;
}

interface Splash {
  node: Sprite;
  age: number;
  radius: number;
}

export class ZoneFx {
  private readonly pixi: PixiApi;
  private readonly layer: Container;
  private readonly textures: ZoneTextures;
  private readonly reducedMotion: boolean;
  private readonly free: Text[] = [];
  private readonly live: Floater[] = [];
  private readonly freeSplash: Sprite[] = [];
  private readonly liveSplash: Splash[] = [];
  private splashTexture: Texture | null = null;

  constructor(pixi: PixiApi, textures: ZoneTextures, layer: Container, reducedMotion: boolean) {
    this.pixi = pixi;
    this.textures = textures;
    this.layer = layer;
    this.reducedMotion = reducedMotion;
  }

  /** 有 `ui/ink-splash` 就用它，没有就退回辉光。 */
  setSplashTexture(texture: Texture | null): void {
    this.splashTexture = texture;
  }

  /** 伤害/闪避数字。`amount` 为 0 的普通命中不出字，免得刷屏。 */
  damage(x: number, y: number, amount: number, kind: DamageKind): void {
    if (this.reducedMotion) return;
    if (kind !== 'dodge' && amount <= 0) return;
    const node = this.takeText();
    if (kind === 'dodge') {
      node.text = '闪';
      node.style.fill = ZONE_PALETTE.dodge;
    } else {
      node.text = amount >= 10_000 ? `${Math.round(amount / 1000)}k` : String(Math.round(amount));
      node.style.fill = kind === 'crit' ? ZONE_PALETTE.crit : ZONE_PALETTE.damage;
    }
    const scale = kind === 'crit' ? 0.9 : 0.62;
    node.scale.set(scale);
    node.position.set(x + (Math.random() - 0.5) * 6, y);
    node.alpha = 1;
    node.visible = true;
    this.live.push({
      node,
      age: 0,
      ttl: kind === 'crit' ? CRIT_MS : FLOAT_MS,
      x: node.x,
      y,
      scale,
    });
  }

  /** 阵亡：一团墨在原地化开。 */
  splash(x: number, y: number, radius: number): void {
    if (this.reducedMotion) return;
    const node = this.takeSplash();
    node.texture = this.splashTexture ?? this.textures.glow();
    node.tint = this.splashTexture ? 0xffffff : ZONE_PALETTE.ink;
    node.position.set(x, y);
    node.alpha = 0.85;
    node.visible = true;
    this.liveSplash.push({ node, age: 0, radius });
  }

  update(dtMs: number): void {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const fx = this.live[i] as Floater;
      fx.age += dtMs;
      const t = fx.age / fx.ttl;
      if (t >= 1) {
        this.release(i);
        continue;
      }
      // 先快后慢地升起，尾段才开始褪，读得到数字。
      fx.node.y = fx.y - FLOAT_RISE * (1 - (1 - t) * (1 - t));
      fx.node.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      // 暴击起手放大一下再收回原尺寸。
      fx.node.scale.set(t < 0.18 ? fx.scale * (1 + (0.18 - t) * 1.6) : fx.scale);
    }
    for (let i = this.liveSplash.length - 1; i >= 0; i -= 1) {
      const fx = this.liveSplash[i] as Splash;
      fx.age += dtMs;
      const t = fx.age / SPLASH_MS;
      if (t >= 1) {
        this.releaseSplash(i);
        continue;
      }
      const size = fx.radius * (2.2 + t * 1.6);
      fx.node.width = size;
      fx.node.height = size;
      fx.node.alpha = 0.85 * (1 - t);
    }
  }

  destroy(): void {
    for (const fx of this.live) fx.node.destroy();
    for (const node of this.free) node.destroy();
    for (const fx of this.liveSplash) fx.node.destroy();
    for (const node of this.freeSplash) node.destroy();
    this.live.length = 0;
    this.free.length = 0;
    this.liveSplash.length = 0;
    this.freeSplash.length = 0;
  }

  private takeText(): Text {
    const reused = this.free.pop();
    if (reused) return reused;
    if (this.live.length >= MAX_FLOATERS) {
      const oldest = this.live.shift() as Floater;
      return oldest.node;
    }
    const node = new this.pixi.Text({
      text: '',
      style: {
        fontFamily: ZONE_FONT_FAMILY,
        fontSize: 26,
        fontWeight: '700',
        fill: ZONE_PALETTE.damage,
        stroke: { color: ZONE_PALETTE.ink, width: 4 },
      },
    });
    node.anchor.set(0.5, 1);
    this.layer.addChild(node);
    return node;
  }

  private takeSplash(): Sprite {
    const reused = this.freeSplash.pop();
    if (reused) return reused;
    if (this.liveSplash.length >= MAX_SPLASHES) {
      const oldest = this.liveSplash.shift() as Splash;
      return oldest.node;
    }
    const node = new this.pixi.Sprite(this.textures.glow());
    node.anchor.set(0.5);
    this.layer.addChild(node);
    return node;
  }

  private release(index: number): void {
    const fx = this.live[index] as Floater;
    this.live.splice(index, 1);
    fx.node.visible = false;
    this.free.push(fx.node);
  }

  private releaseSplash(index: number): void {
    const fx = this.liveSplash[index] as Splash;
    this.liveSplash.splice(index, 1);
    fx.node.visible = false;
    this.freeSplash.push(fx.node);
  }
}
