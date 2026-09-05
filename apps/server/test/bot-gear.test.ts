import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  baselinePowerAtStage,
  computeStats,
  EQUIP_SLOTS,
  getStage,
  getTechnique,
  ITEM_BY_ID,
  powerScore,
  STARTER_TECHNIQUE_ID,
  type CharacterState,
  type EquipmentItem,
  type PublicProfile,
} from '@xianxia/shared';
import { arenaHandlers } from '../src/modules/arena/routes.js';
import {
  botEquipment,
  botLoadout,
  botSlotItemId,
  BOT_UID_PREFIX,
} from '../src/engine/bots/gear.js';
import { generateBots } from '../src/engine/bots/generate.js';
import { auth, createHarness, expectOk, makePlayer, type Harness } from './helpers.js';

/**
 * 机器人的装备.
 *
 * The band these tests pin is the point of the feature: two cultivators at the
 * same 境界 must not be the same fighter, and the spread has to stay narrow
 * enough that 论道 matchmaking still means something.
 */

/** Ratio of a bot's 战力 to the gear-less, 功法-less baseline at its stage. */
const ratio = (bot: CharacterState): number =>
  bot.powerScore / baselinePowerAtStage(bot.stageIndex);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

const uids = (bot: CharacterState): string[] =>
  EQUIP_SLOTS.map((slot) => bot.equipment[slot] ?? '-');

describe('bot gear', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness({ handlers: arenaHandlers });
  });
  afterEach(async () => {
    await h.close();
  });

  const cohort = (
    archetypeId: string,
    count: number,
    stageIndex: number,
    seed: number,
  ): CharacterState[] =>
    generateBots(
      h.ctx,
      { count, archetypeId, minStageIndex: stageIndex, maxStageIndex: stageIndex, seed },
      h.clock.now(),
    );

  it('equips every generated bot out of the item table, never above its 境界', () => {
    h.ctx.settings.patch({ botCount: 80 });
    h.ctx.bots.tick(h.clock.now());

    const bots = h.ctx.characters.allBots();
    let armed = 0;
    for (const bot of bots) {
      const pieces: EquipmentItem[] = [];
      for (const slot of EQUIP_SLOTS) {
        const uid = bot.equipment[slot];
        if (uid === null) continue;
        expect(uid.startsWith(BOT_UID_PREFIX)).toBe(true);
        const item = ITEM_BY_ID.get(botSlotItemId(uid) as string);
        expect(item?.kind).toBe('equipment');
        const piece = item as EquipmentItem;
        expect(piece.slot).toBe(slot);
        expect(piece.requiredStage).toBeLessThanOrEqual(bot.stageIndex);
        pieces.push(piece);
      }
      // The slots stored on the row are the pieces every module resolves.
      expect(botEquipment(bot).map((p) => p.id)).toEqual(pieces.map((p) => p.id));
      if (pieces.length > 0) armed += 1;
    }
    // A bare-handed 散修 is allowed; a bare-handed world is not.
    expect(armed / bots.length).toBeGreaterThan(0.6);
  });

  it('counts the gear in the 战力 it stores', () => {
    const bots = cohort('bot-tianjiao', 20, 6, 41);
    const geared = bots.find((b) => botEquipment(b).length > 0);
    expect(geared).toBeDefined();

    const expected = powerScore(
      computeStats({
        stageIndex: geared!.stageIndex,
        equipment: botEquipment(geared!),
        technique: getTechnique(STARTER_TECHNIQUE_ID),
      }),
    );
    expect(geared!.powerScore).toBe(expected);
    expect(geared!.powerScore).toBeGreaterThan(baselinePowerAtStage(geared!.stageIndex));
  });

  it('spreads 战力 across bots of the same 境界 instead of cloning one number', () => {
    h.ctx.settings.patch({ botCount: 0 });
    const bots = [
      ...cohort('bot-tianjiao', 30, 6, 1),
      ...cohort('bot-kuxiu', 30, 6, 2),
      ...cohort('bot-sanxiu', 30, 6, 3),
      ...cohort('bot-wanku', 30, 6, 4),
    ];

    const powers = bots.map((b) => b.powerScore);
    expect(new Set(powers).size).toBeGreaterThan(4);

    const ratios = bots.map(ratio);
    // Gear only ever adds, so 1.0 is the floor; the ceiling is what keeps a
    // 论道 window from containing an unbeatable outlier.
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...ratios)).toBeLessThan(1.5);
    expect(median(ratios)).toBeGreaterThan(1.05);
  });

  it('kits a 天骄 out better than a 散修 of the same 境界', () => {
    // The cohorts are large because the comparison is a median of a discrete
    // distribution: 120 a side keeps the answer from riding on one roll.
    for (const stage of [2, 8, 11]) {
      const tianjiao = cohort('bot-tianjiao', 120, stage, 100 + stage).map(ratio);
      const sanxiu = cohort('bot-sanxiu', 120, stage, 200 + stage).map(ratio);
      expect(median(tianjiao)).toBeGreaterThan(median(sanxiu));
    }
  });

  it('re-equips a bot when it crosses into a new 大境界', () => {
    h.ctx.settings.patch({ botCount: 0 });
    const bots = cohort('bot-kuxiu', 60, 3, 77);
    const before = new Map(bots.map((b) => [b.id, uids(b).join('|')]));

    // 练气·圆满 -> 元婴·前期 is three 大境界 up: the spirit tiers are in reach.
    for (const bot of bots) {
      h.ctx.characters.save({ ...bot, stageIndex: 12, exp: 0, lastSettledAt: h.clock.now() });
    }
    h.clock.advance(60_000);
    h.ctx.bots.tick(h.clock.now());

    let rerolled = 0;
    let upgraded = 0;
    for (const stored of bots) {
      const bot = h.ctx.characters.byId(stored.id) as CharacterState;
      expect(bot.equipment).toEqual(botLoadout(bot.id, 12, bot.botParams));
      if (uids(bot).join('|') !== before.get(bot.id)) rerolled += 1;
      const pieces = botEquipment(bot);
      for (const piece of pieces) expect(piece.requiredStage).toBeLessThanOrEqual(12);
      if (pieces.some((p) => p.requiredStage > 0)) upgraded += 1;
      expect(bot.powerScore).toBeGreaterThanOrEqual(baselinePowerAtStage(12));
    }
    expect(rerolled).toBeGreaterThan(bots.length * 0.6);
    // 练气 had nothing but 凡阶 to offer; 元婴 hands out 灵阶 and 灵宠.
    expect(upgraded).toBeGreaterThan(bots.length / 4);
  });

  it('hands the same uids back on a second engine start', () => {
    h.ctx.settings.patch({ botCount: 40 });
    h.ctx.bots.tick(h.clock.now());
    const first = new Map(h.ctx.characters.allBots().map((b) => [b.id, uids(b).join('|')]));

    h.ctx.bots.start();
    h.ctx.bots.stop();
    h.ctx.bots.start();
    h.ctx.bots.stop();

    for (const bot of h.ctx.characters.allBots()) {
      expect(uids(bot).join('|')).toBe(first.get(bot.id));
    }
    // Nothing left to write: the derivation is the storage.
    expect(h.ctx.bots.ensureGear()).toBe(0);
    expect(h.ctx.bots.ensureGear()).toBe(0);
  });

  it('backfills a world whose bots were seeded before gear existed', () => {
    h.ctx.settings.patch({ botCount: 30 });
    h.ctx.bots.tick(h.clock.now());
    const geared = new Map(h.ctx.characters.allBots().map((b) => [b.id, uids(b).join('|')]));

    // What an upgraded database looks like: slots empty, 战力 gear-less.
    for (const bot of h.ctx.characters.allBots()) {
      h.ctx.characters.save({
        ...bot,
        equipment: { treasure: null, robe: null, accessory: null, pet: null },
        powerScore: baselinePowerAtStage(bot.stageIndex),
      });
    }

    expect(h.ctx.bots.ensureGear()).toBe(30);
    for (const bot of h.ctx.characters.allBots()) {
      expect(uids(bot).join('|')).toBe(geared.get(bot.id));
      expect(bot.powerScore).toBeGreaterThanOrEqual(baselinePowerAtStage(bot.stageIndex));
    }
    // Idempotent: the second pass finds nothing to do.
    expect(h.ctx.bots.ensureGear()).toBe(0);
  });

  it('shows the gear a bot carries on its 公开档案', async () => {
    const player = await makePlayer(h);
    const bot = cohort('bot-tianjiao', 8, 8, 999).find((b) => botEquipment(b).length > 0);
    expect(bot).toBeDefined();

    const profile = expectOk<PublicProfile>(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/cultivators/${bot!.id}`,
          headers: auth(player.token),
        })
      ).json(),
    );

    expect(profile.isBot).toBe(true);
    expect(profile.equipmentItemIds).toEqual(botEquipment(bot!).map((p) => p.id));
    expect(profile.equipmentItemIds.length).toBeGreaterThan(0);
    expect(profile.stats.atk).toBeGreaterThan(
      computeStats({ stageIndex: bot!.stageIndex, technique: null }).atk,
    );
  });

  it('offers 论道 opponents that no longer share one 战力', async () => {
    const player = await makePlayer(h);
    const state = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...state, stageIndex: 6, exp: getStage(6).expRequired * 0.5 });
    h.ctx.settings.patch({ botCount: 0 });
    cohort('bot-moxiu', 40, 6, 55);

    const list = expectOk<{ opponents: (PublicProfile & { winHint: number })[] }>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/arena/opponents',
          headers: auth(player.token),
        })
      ).json(),
    );

    const bots = list.opponents.filter((o) => o.isBot && o.stageIndex === 6);
    expect(bots.length).toBeGreaterThan(3);
    expect(new Set(bots.map((o) => o.powerScore)).size).toBeGreaterThan(1);
    expect(bots.some((o) => o.equipmentItemIds.length > 0)).toBe(true);
  });
});
