/**
 * 一个槽位的显示对象。
 *
 * 每个实体是 5-7 个显示对象：境界环、本体、闪白层、血条两片、名字，BOSS 与自己
 * 各多一个外环。全部是共享纹理的 Sprite，只有名字是 Text——一屏一百多个实体也就
 * 八百来个对象，且绝大多数能进同一批次。
 *
 * 槽位复用是硬约定：`remove` 之后同一个 `i` 会被别人占用，所以视图对象跟着槽位
 * 生灭，不做跨实体复用。
 */

import type { Container, Sprite, Text } from 'pixi.js';
import { progressionArtSource } from '../../progression/art';
import type { ArtId, ZoneRosterEntry } from '@xianxia/shared';
import { ZONE_FLAGS, TREASURE_FORM_NAMES } from '@xianxia/shared';
import {
  ZONE_FONT_FAMILY,
  ZONE_PALETTE,
  realmColorOf,
  type PixiApi,
  type ZoneTextures,
} from './textures';

/** 本体半径，世界像素（1 格 = 12 px）。 */
const RADIUS = { monster: 8.5, cultivator: 10.5 } as const;
/** BOSS 比同类大这么多倍。 */
const BOSS_SCALE = 1.6;
const HP_HEIGHT = 3;
const FLASH_MS = 120;
const CAST_MS = 280;
const DEATH_FADE_MS = 600;

export interface EntityViewOptions {
  /** 低端机：只留自己和 BOSS 的名字。 */
  showName: boolean;
  reducedMotion: boolean;
  isSelf: boolean;
  /** 由 `ZoneCanvas` 注入的 art manifest 查询；缺素材或 `?art=off` 时返回 null。 */
  resolveArt: (id: ArtId) => string | null;
}

export class ZoneEntityView {
  readonly slot: number;
  readonly entry: ZoneRosterEntry;
  readonly root: Container;
  readonly radius: number;
  readonly isBoss: boolean;

  private readonly pixi: PixiApi;
  private readonly textures: ZoneTextures;
  private readonly reducedMotion: boolean;
  private readonly resolveArt: (id: ArtId) => string | null;
  private readonly ring: Sprite;
  private readonly body: Sprite;
  private readonly initial: Sprite | null;
  private readonly flashLayer: Sprite;
  private readonly hpBack: Sprite;
  private readonly hpFill: Sprite;
  private readonly outerRing: Sprite | null;
  private readonly label: Text | null;
  private readonly hpWidth: number;

  private readonly treasure: Sprite | null;
  private readonly shield: Sprite | null;
  private orbit = 0;
  private flashLeft = 0;
  private castLeft = 0;
  private deadFor = -1;
  private pulse = 0;
  private destroyed = false;

  constructor(
    pixi: PixiApi,
    textures: ZoneTextures,
    entry: ZoneRosterEntry,
    options: EntityViewOptions,
  ) {
    this.pixi = pixi;
    this.textures = textures;
    this.entry = entry;
    this.slot = entry.i;
    this.reducedMotion = options.reducedMotion;
    this.resolveArt = options.resolveArt;
    this.isBoss = entry.kind === 'boss';
    const isMonster = entry.kind === 'monster' || entry.kind === 'boss';
    const base = isMonster ? RADIUS.monster : RADIUS.cultivator;
    this.radius = this.isBoss ? base * BOSS_SCALE : base;
    this.hpWidth = this.radius * 2.2;

    this.root = new pixi.Container();
    const realmColor = realmColorOf(entry.stageIndex);

    this.ring = new pixi.Sprite(textures.ring());
    this.ring.anchor.set(0.5);
    this.ring.width = this.radius * 2 + 3;
    this.ring.height = this.radius * 2 + 3;
    this.ring.tint = realmColor;
    this.root.addChild(this.ring);

    this.body = new pixi.Sprite(textures.disc());
    this.body.anchor.set(0.5);
    this.body.width = this.radius * 2;
    this.body.height = this.radius * 2;
    // 还没拿到素材时，本体就是一枚境界色的圆——暗一档，好让色环仍然读得出来。
    this.body.tint = isMonster ? darken(realmColor) : 0x2b2f36;
    this.root.addChild(this.body);

    // 妖兽没有立绘就压一个名字首字上去，认得出是哪一种。
    if (isMonster) {
      const initial = new pixi.Sprite(textures.char(entry.name.slice(0, 1)));
      initial.anchor.set(0.5);
      initial.width = this.radius * 1.5;
      initial.height = this.radius * 1.5;
      initial.tint = 0xf3ebdc;
      initial.alpha = 0.9;
      this.root.addChild(initial);
      this.initial = initial;
    } else {
      this.initial = null;
    }

    this.flashLayer = new pixi.Sprite(textures.disc());
    this.flashLayer.anchor.set(0.5);
    this.flashLayer.width = this.radius * 2.4;
    this.flashLayer.height = this.radius * 2.4;
    this.flashLayer.blendMode = 'add';
    this.flashLayer.visible = false;
    this.root.addChild(this.flashLayer);

    // 自己一圈朱砂，BOSS 一圈金——两者都在色环之外，不抢境界色。
    if (options.isSelf || this.isBoss) {
      const outer = new pixi.Sprite(textures.ring());
      outer.anchor.set(0.5);
      outer.width = this.radius * 2 + 9;
      outer.height = this.radius * 2 + 9;
      outer.tint = options.isSelf ? ZONE_PALETTE.self : ZONE_PALETTE.boss;
      outer.alpha = 0.9;
      this.root.addChild(outer);
      this.outerRing = outer;
    } else {
      this.outerRing = null;
    }

    const barY = -this.radius - 6;
    this.hpBack = new pixi.Sprite(textures.white);
    this.hpBack.anchor.set(0.5, 0.5);
    this.hpBack.width = this.hpWidth + 1;
    this.hpBack.height = HP_HEIGHT + 1;
    this.hpBack.tint = ZONE_PALETTE.hpBack;
    this.hpBack.alpha = 0.75;
    this.hpBack.position.set(0, barY);
    this.root.addChild(this.hpBack);

    this.hpFill = new pixi.Sprite(textures.white);
    this.hpFill.anchor.set(0, 0.5);
    this.hpFill.width = this.hpWidth;
    this.hpFill.height = HP_HEIGHT;
    this.hpFill.tint = this.isBoss
      ? ZONE_PALETTE.hpBoss
      : isMonster
        ? ZONE_PALETTE.hpFoe
        : ZONE_PALETTE.hpAlly;
    this.hpFill.position.set(-this.hpWidth / 2, barY);
    this.root.addChild(this.hpFill);

    const wantsName = (entry.kind !== 'monster' && options.showName) || this.isBoss;
    if (wantsName) {
      const label = new pixi.Text({
        text: entry.name.length > 6 ? `${entry.name.slice(0, 6)}…` : entry.name,
        style: {
          fontFamily: ZONE_FONT_FAMILY,
          fontSize: 18,
          fill: options.isSelf ? ZONE_PALETTE.crit : ZONE_PALETTE.name,
          stroke: { color: ZONE_PALETTE.ink, width: 3 },
        },
      });
      label.anchor.set(0.5, 1);
      // 按 18 px 光栅化再缩到 ~8 px：字号直接给 8 会糊，这样放大也还清楚。
      label.scale.set(0.46);
      // 挨得近的人按槽位分三条高度错开，名字不至于严丝合缝地叠在一起。
      label.position.set(0, barY - 4 - (entry.i % 3) * 6);
      this.root.addChild(label);
      this.label = label;
    } else {
      this.label = null;
    }

    this.treasure = entry.mainTreasure
      ? new pixi.Sprite(textures.char(TREASURE_FORM_NAMES[entry.mainTreasure.form]))
      : null;
    this.shield = entry.mainTreasure ? new pixi.Sprite(textures.ring()) : null;
    if (this.treasure) {
      this.treasure.anchor.set(0.5);
      this.treasure.width = this.treasure.height = 12;
      this.treasure.tint = 0xffd16f;
      this.treasure.position.set(this.radius + 8, 0);
      this.root.addChild(this.treasure);
      const treasureSprite = this.treasure;
      const fallback = this.resolveArt(entry.mainTreasure!.art);
      const source = progressionArtSource({
        id: entry.mainTreasure!.definitionId,
        form: entry.mainTreasure!.form,
      });
      void (async () => {
        const texture =
          (source ? await textures.bitmap(source) : null) ??
          (fallback ? await textures.bitmap(fallback) : null);
        if (texture && !this.destroyed) {
          treasureSprite.texture = texture;
          treasureSprite.tint = 0xffffff;
        }
      })();
    }
    if (this.shield) {
      this.shield.anchor.set(0.5);
      this.shield.width = this.shield.height = this.radius * 3.2;
      this.shield.tint = 0x6ae6df;
      this.shield.visible = false;
      this.root.addChild(this.shield);
    }
    void this.loadArt();
  }

  /** 世界像素定位；`zIndex` 取 y，靠下的压住靠上的，俯视图才有前后。 */
  place(x: number, y: number): void {
    this.root.position.set(x, y);
    this.root.zIndex = y;
  }

  setShield(amount: number): void {
    if (this.shield) this.shield.visible = amount > 0;
  }

  setHpRatio(ratio: number): void {
    const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    this.hpFill.width = this.hpWidth * clamped;
    // 妖兽满血时不占屏，掉过血才亮出来；修士一直显示，那是要盯的信息。
    const hide = this.entry.kind === 'monster' && clamped >= 1;
    this.hpFill.visible = !hide;
    this.hpBack.visible = !hide;
  }

  /**
   * 名字是否露出来。挤在一处时只留一个（`ZoneScene` 按屏幕格占位判定），
   * 否则一堆人踩在同一格上会糊成一块黑斑，谁也认不出。
   */
  showLabel(visible: boolean): void {
    if (this.label) this.label.visible = visible;
  }

  /** 命中闪白。 */
  flash(): void {
    if (this.reducedMotion) return;
    this.flashLeft = FLASH_MS;
    this.flashLayer.texture = this.textures.disc();
    this.flashLayer.width = this.radius * 2.4;
    this.flashLayer.height = this.radius * 2.4;
    this.flashLayer.tint = 0xffffff;
    this.flashLayer.visible = true;
  }

  /** 施法起手的一下辉光：比闪白大一圈，用境界色。 */
  cast(): void {
    if (this.reducedMotion || this.flashLeft > 0) return;
    this.castLeft = CAST_MS;
    this.flashLayer.texture = this.textures.glow();
    this.flashLayer.width = this.radius * 4;
    this.flashLayer.height = this.radius * 4;
    this.flashLayer.tint = realmColorOf(this.entry.stageIndex);
    this.flashLayer.visible = true;
  }

  /** 持续态：阵亡淡出、护体脉动、离线半透。 */
  applyFlags(flags: number, dtMs: number): void {
    const dead = (flags & ZONE_FLAGS.DEAD) !== 0;
    if (dead) {
      this.deadFor = this.deadFor < 0 ? 0 : this.deadFor + dtMs;
    } else if (this.deadFor >= 0) {
      this.deadFor = -1;
      this.root.alpha = 1;
      this.root.visible = true;
    }

    let alpha = 1;
    if (dead) {
      alpha = Math.max(0, 1 - this.deadFor / DEATH_FADE_MS);
    } else if ((flags & ZONE_FLAGS.OFFLINE) !== 0) {
      alpha = 0.42;
    }
    this.root.alpha = alpha;
    this.root.visible = alpha > 0.01;

    const protectedNow = (flags & ZONE_FLAGS.PROTECTED) !== 0 && !dead;
    if (protectedNow) {
      if (this.reducedMotion) {
        this.ring.alpha = 0.55;
      } else {
        this.pulse += dtMs / 900;
        const wave = 0.5 + 0.5 * Math.sin(this.pulse * Math.PI * 2);
        this.ring.alpha = 0.35 + wave * 0.65;
      }
    } else if (this.ring.alpha !== 1) {
      this.ring.alpha = 1;
      this.pulse = 0;
    }
  }

  /** 每帧推进一次性动效。 */
  tick(dtMs: number): void {
    if (this.treasure && !this.reducedMotion) {
      this.orbit += dtMs / 1800;
      this.treasure.position.set(
        Math.cos(this.orbit) * (this.radius + 8),
        Math.sin(this.orbit) * (this.radius + 5),
      );
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dtMs;
      this.flashLayer.alpha = Math.max(0, this.flashLeft / FLASH_MS) * 0.85;
    } else if (this.castLeft > 0) {
      this.castLeft -= dtMs;
      this.flashLayer.alpha = Math.max(0, this.castLeft / CAST_MS) * 0.45;
    } else if (this.flashLayer.visible) {
      this.flashLayer.visible = false;
      this.flashLayer.alpha = 0;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.root.destroy({ children: true });
  }

  /**
   * 素材是异步的，且随时可能缺席（T6 还在出图、或者 `?art=off`）。
   * 拿到之前先用占位，拿到之后原地换纹理；期间槽位被回收就丢弃结果。
   */
  private async loadArt(): Promise<void> {
    const art = this.entry.art;
    if (!art) return;
    const src = this.resolveArt(art);
    if (!src) return;
    const isCultivator = this.entry.kind === 'player' || this.entry.kind === 'bot';
    const texture = isCultivator
      ? await this.textures.portrait(src)
      : await this.textures.bitmap(src);
    if (!texture || this.destroyed) return;
    this.body.texture = texture;
    this.body.tint = 0xffffff;
    if (isCultivator) {
      this.body.width = this.radius * 2;
      this.body.height = this.radius * 2;
    } else {
      // 妖兽立绘是带透明的方图，按长边塞进略大于圆的框里，剪影才不显得缩水。
      const box = this.radius * 2.7;
      const scale = box / Math.max(texture.width, texture.height);
      this.body.width = texture.width * scale;
      this.body.height = texture.height * scale;
      if (this.initial) this.initial.visible = false;
      this.ring.alpha = 0.55;
    }
  }
}

function darken(color: number): number {
  const r = Math.round(((color >> 16) & 0xff) * 0.55);
  const g = Math.round(((color >> 8) & 0xff) * 0.55);
  const b = Math.round((color & 0xff) * 0.55);
  return (r << 16) | (g << 8) | b;
}
