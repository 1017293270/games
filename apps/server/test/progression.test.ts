import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProgression,
  RELICS,
  TREASURES,
  type CharacterState,
  type ProgressionResponse,
} from '@xianxia/shared';
import { buildPublicProfile, resolveEquipment, statsOf, settle } from '../src/game/character.js';
import { progressEvent } from '../src/game/progression.js';
import { recordMessage } from '../src/modules/social/service.js';
import type { ZoneServiceImpl } from '../src/engine/zone/service.js';
import {
  adminAuth,
  adminToken,
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

describe('progression HTTP and persistence', () => {
  let h: Harness;
  let p: Player;
  beforeEach(async () => {
    h = createHarness();
    p = await makePlayer(h);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await h.close();
  });
  const state = () => h.ctx.characters.byId(p.characterId)!;
  const post = (path: string, payload: Record<string, unknown>, player = p) =>
    h.app.inject({
      method: 'POST',
      url: `/api/progression/${path}`,
      headers: auth(player.token),
      payload,
    });
  const request = (requestId: string, extra = {}) => ({
    pool: 'treasure',
    count: 1,
    requestId,
    ...extra,
  });
  function seed(jade = 10000) {
    const s = state();
    const progression = getProgression(s.progression, h.clock.now());
    progression.materials = { jade, stardust: 10000, starStones: 10000, breakthroughWood: 100 };
    h.ctx.characters.save({ ...s, progression });
    return progression;
  }

  it('reads old JSON and grants the starter once without altering legacy equipment', async () => {
    const old = state();
    delete old.progression;
    h.ctx.characters.save(old);
    const view = expectOk<ProgressionResponse>(
      (await post('claim', { kind: 'starter', id: 'starter' })).json(),
    );
    expect(view.progression.treasures[0]?.slot).toBe(0);
    expect(view.view.character.equipment).toEqual(old.equipment);
    expect(expectFail((await post('claim', { kind: 'starter', id: 'starter' })).json()).code).toBe(
      'QUEST_ALREADY_CLAIMED',
    );
  });
  it('grants one free single per pool/day and makes retries durable', async () => {
    const input = request('free-a', { free: true });
    const first = expectOk<ProgressionResponse>((await post('draw', input)).json());
    const again = expectOk<ProgressionResponse>((await post('draw', input)).json());
    expect(again.results).toEqual(first.results);
    expect(again.progression.gacha.treasure.total).toBe(1);
    expect(again.progression.materials.jade).toBe(0);
    expect(expectFail((await post('draw', request('free-b', { free: true }))).json()).code).toBe(
      'CONDITION_UNMET',
    );
    expectOk((await post('draw', request('free-c', { free: true, pool: 'relic' }))).json());
    h.clock.advance(86400000);
    expectOk((await post('draw', request('free-d', { free: true }))).json());
    expect(state().progression?.gacha.treasure.total).toBe(2);
  });
  it('charges exact single and ten prices, guarantees gold+, and preserves pool pity', async () => {
    seed();
    expectOk((await post('draw', request('single'))).json());
    const result = expectOk<ProgressionResponse>(
      (await post('draw', request('ten', { count: 10 }))).json(),
    );
    expect(result.progression.materials.jade).toBe(8340);
    expect(result.results).toHaveLength(10);
    expect(result.results?.some((v) => v.grade === 'saint' || v.grade === 'divine')).toBe(true);
    expect(result.progression.gacha.relic).toEqual({ pity: 0, total: 0 });
    const again = expectOk<ProgressionResponse>(
      (await post('draw', request('ten', { count: 10 }))).json(),
    );
    expect(again.progression.materials.jade).toBe(8340);
    expect(again.results).toEqual(result.results);
  });
  it('forces red at 70 and converts known duplicates to ten fragments', async () => {
    const progression = seed();
    progression.gacha.treasure.pity = 69;
    progression.treasures = TREASURES.map((def) => ({
      uid: `owned-${def.id}`,
      definitionId: def.id,
      level: 1,
      spiritLevel: 0,
      stars: 0,
      fragments: 0,
      slot: null,
    }));
    h.ctx.characters.save({ ...state(), progression });
    const result = expectOk<ProgressionResponse>((await post('draw', request('seventy'))).json());
    expect(result.results?.[0]).toMatchObject({
      grade: 'divine',
      duplicate: true,
      fragments: 10,
      pity: 0,
    });
    expect(
      result.progression.treasures.find((t) => t.definitionId === result.results?.[0]?.definitionId)
        ?.fragments,
    ).toBe(10);
  });
  it('does not spend, change counters, or write receipts on insufficient funds', async () => {
    const before = state().progression;
    expect(expectFail((await post('draw', request('poor'))).json()).code).toBe(
      'INSUFFICIENT_ITEMS',
    );
    expect(state().progression).toEqual(before);
    expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM gacha_log').get()?.n).toBe(0);
  });
  it('rolls back currency, all ten results, and pushes if writing the receipt fails', async () => {
    seed();
    const before = state();
    const push = vi.spyOn(h.ctx.realtime, 'characterUpdate');
    h.ctx.db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON gacha_log WHEN NEW.draw_index = 5
      BEGIN SELECT RAISE(ABORT, 'receipt failed'); END;`);
    expect(expectFail((await post('draw', request('broken', { count: 10 }))).json()).code).toBe(
      'INTERNAL_ERROR',
    );
    expect(state()).toEqual(before);
    expect(push).not.toHaveBeenCalled();
    expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM gacha_log').get()?.n).toBe(0);
    h.ctx.db.exec('DROP TRIGGER fail_receipt');
    expectOk((await post('draw', request('broken', { count: 10 }))).json());
  });
  it('isolates request ids and history between characters', async () => {
    const other = await makePlayer(h);
    expectOk((await post('draw', request('same', { free: true }))).json());
    expectOk((await post('draw', request('same', { free: true }), other)).json());
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/progression/history',
      headers: auth(p.token),
    });
    const history = expectOk<{ items: { requestId: string }[] }>(response.json());
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.requestId).toBe('same');
    expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM gacha_log').get()?.n).toBe(2);
    expect(expectFail((await post('equip', { uid: 'unknown', slot: 0 }, other)).json()).code).toBe(
      'ITEM_NOT_FOUND',
    );
  });
  it('upgrades cost real materials and every stats consumer sees equipped progression', async () => {
    const starter = expectOk<ProgressionResponse>(
      (await post('claim', { kind: 'starter', id: 'starter' })).json(),
    );
    const uid = starter.progression.treasures[0]!.uid;
    seed();
    const before = state().progression!.materials.starStones;
    const result = expectOk<ProgressionResponse>(
      (await post('upgrade', { kind: 'treasure', id: uid, action: 'level' })).json(),
    );
    expect(result.progression.treasures[0]?.level).toBe(2);
    expect(result.progression.materials.starStones).toBe(before - 7);
    const current = state();
    expect(result.view.stats).toEqual(statsOf(current, resolveEquipment(current, h.ctx.inventory)));
    expect(buildPublicProfile(current, false, h.ctx.inventory).stats).toEqual(result.view.stats);
    h.ctx.zones.enter(current.id, 'map-qingyun-mountain', h.clock.now());
    const world = (h.ctx.zones as ZoneServiceImpl).worlds.get('map-qingyun-mountain')!;
    world.delta(current.id, h.clock.now()).stones = 1;
    await post('upgrade', { kind: 'treasure', id: uid, action: 'infuse' });
    h.ctx.zones.flush(h.clock.now());
    expect(state().progression?.treasures[0]?.spiritLevel).toBe(1);
    expect(world.entityOf(current.id)?.stats).toEqual(
      statsOf(state(), resolveEquipment(state(), h.ctx.inventory)),
    );
  });
  it('daily actions earn claimable rewards once, roll over UTC, and exclude prior-day cultivation', async () => {
    h.clock.set(Date.UTC(2026, 0, 1, 23, 59));
    h.ctx.characters.save({
      ...state(),
      lastSettledAt: h.clock.now(),
      progression: getProgression(undefined, h.clock.now()),
    });
    h.clock.advance(120000);
    let fresh = settle(state(), h.ctx.settings.get(), h.clock.now()).character;
    expect(fresh.progression?.daily.cultivationSeconds).toBe(60);
    fresh = progressEvent(fresh, h.clock.now(), 'kills', 50);
    h.ctx.characters.save(fresh);
    const claimed = expectOk<ProgressionResponse>(
      (await post('claim', { kind: 'daily', id: 'kills' })).json(),
    );
    expect(claimed.progression.materials.jade).toBe(100);
    expect(expectFail((await post('claim', { kind: 'daily', id: 'kills' })).json()).code).toBe(
      'QUEST_ALREADY_CLAIMED',
    );
    h.clock.advance(86400000);
    expect(expectFail((await post('claim', { kind: 'daily', id: 'kills' })).json()).code).toBe(
      'QUEST_NOT_COMPLETE',
    );
  });
  it('records real chat and BOSS events and accepts admin material grants', async () => {
    recordMessage(
      h.ctx,
      {
        channel: 'world',
        senderId: p.characterId,
        senderName: p.name,
        stageIndex: 0,
        text: '道友好',
      },
      h.ctx.settings.get(),
      h.clock.now(),
    );
    expect(state().progression?.daily.chat).toBe(1);
    expectOk((await post('claim', { kind: 'daily', id: 'chat' })).json());
    h.ctx.zones.enter(p.characterId, 'map-qingyun-mountain', h.clock.now());
    const world = (h.ctx.zones as ZoneServiceImpl).worlds.get('map-qingyun-mountain')!;
    world.delta(p.characterId, h.clock.now()).bossKills = 1;
    h.ctx.zones.flush(h.clock.now());
    expect(state().progression?.achievements).toContain('first_boss');
    expectOk((await post('claim', { kind: 'achievement', id: 'first_boss' })).json());
    const token = await adminToken(h);
    const before = state().progression!.materials;
    const granted = expectOk<CharacterState>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/grant',
          headers: adminAuth(token),
          payload: {
            characterId: p.characterId,
            jade: 50,
            stardust: 20,
            starStones: 30,
            breakthroughWood: 2,
          },
        })
      ).json(),
    );
    expect(granted.progression?.materials).toEqual({
      jade: before.jade + 50,
      stardust: before.stardust + 20,
      starStones: before.starStones + 30,
      breakthroughWood: before.breakthroughWood + 2,
    });
  });
  it('collecting relics adds passive stats and cultivation without occupying equipment slots', () => {
    const old = state();
    const progression = getProgression(old.progression, h.clock.now());
    progression.relics = RELICS.slice(0, 6).map((def) => ({
      definitionId: def.id,
      spiritLevel: 0,
      stars: 0,
      fragments: 0,
    }));
    const grown = { ...old, progression };
    expect(statsOf(grown, []).hp).toBeGreaterThan(statsOf(old, []).hp);
    const world = h.ctx.settings.get();
    expect(settle(grown, world, h.clock.now() + 60000).gainedExp).toBeGreaterThan(
      settle(old, world, h.clock.now() + 60000).gainedExp,
    );
  });
  it('requires breakthrough wood at ten, real fragments for stars, and refuses exhausted upgrades', async () => {
    const starter = expectOk<ProgressionResponse>(
      (await post('claim', { kind: 'starter', id: 'starter' })).json(),
    );
    const uid = starter.progression.treasures[0]!.uid;
    const progression = seed();
    progression.treasures[0]!.level = 10;
    progression.materials.breakthroughWood = 0;
    h.ctx.characters.save({ ...state(), progression });
    const before = state();
    expect(
      expectFail((await post('upgrade', { kind: 'treasure', id: uid, action: 'level' })).json())
        .code,
    ).toBe('INSUFFICIENT_ITEMS');
    expect(state()).toEqual(before);
    progression.materials.breakthroughWood = 1;
    progression.treasures[0]!.fragments = 10;
    h.ctx.characters.save({ ...state(), progression });
    const leveled = expectOk<ProgressionResponse>(
      (await post('upgrade', { kind: 'treasure', id: uid, action: 'level' })).json(),
    );
    expect(leveled.progression.treasures[0]?.level).toBe(11);
    expect(leveled.progression.materials.breakthroughWood).toBe(0);
    const starred = expectOk<ProgressionResponse>(
      (await post('upgrade', { kind: 'treasure', id: uid, action: 'star' })).json(),
    );
    expect(starred.progression.treasures[0]).toMatchObject({ stars: 1, fragments: 0 });
    expect(
      expectFail((await post('upgrade', { kind: 'treasure', id: uid, action: 'star' })).json())
        .code,
    ).toBe('INSUFFICIENT_ITEMS');
  });
  it('retains old idempotency receipts beyond the hundred-request history window', async () => {
    seed(20000);
    const first = expectOk<ProgressionResponse>((await post('draw', request('oldest'))).json());
    for (let i = 0; i < 100; i++) {
      h.clock.advance(1);
      expectOk((await post('draw', request(`later-${i}`))).json());
    }
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/progression/history',
      headers: auth(p.token),
    });
    expect(expectOk<{ items: unknown[] }>(response.json()).items).toHaveLength(100);
    const balance = state().progression!.materials.jade;
    const retry = expectOk<ProgressionResponse>((await post('draw', request('oldest'))).json());
    expect(retry.results).toEqual(first.results);
    expect(retry.progression.materials.jade).toBe(balance);
    expect(retry.progression.gacha.treasure.total).toBe(101);
  });
  it('serializes concurrent duplicate HTTP requests into a single charge', async () => {
    seed();
    const results = await Promise.all([
      post('draw', request('concurrent')),
      post('draw', request('concurrent')),
    ]);
    const [one, two] = results.map((r) => expectOk<ProgressionResponse>(r.json()));
    expect(one?.results).toEqual(two?.results);
    expect(state().progression?.materials.jade).toBe(9840);
    expect(state().progression?.gacha.treasure.total).toBe(1);
  });
});
