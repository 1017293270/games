import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ITEM_BY_ID, TECHNIQUE_BY_ID, computeStats, type CharacterView, type InventoryItem, type InventoryListResponse, type PublicProfile } from '@xianxia/shared';
import { resolveEquipment, statsOf } from '../src/game/character.js';
import { characterCombatant, runBattle } from '../src/game/combat.js';
import type { ZoneServiceImpl } from '../src/engine/zone/service.js';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

describe('inventory', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness();
    player = await makePlayer(h);
  });
  afterEach(async () => {
    await h.close();
  });

  const list = async (): Promise<InventoryListResponse> =>
    expectOk<InventoryListResponse>(
      (
        await h.app.inject({ method: 'GET', url: '/api/inventory', headers: auth(player.token) })
      ).json(),
    );

  const find = (items: InventoryItem[], itemId: string): InventoryItem => {
    const row = items.find((i) => i.itemId === itemId);
    if (!row) throw new Error(`missing ${itemId}`);
    return row;
  };

  it('lists the starter kit with 灵石, 装备槽 and 战力', async () => {
    const inventory = await list();
    expect(inventory.spiritStones).toBe(500);
    expect(inventory.powerScore).toBeGreaterThan(0);
    expect(Object.keys(inventory.equipment).sort()).toEqual([
      'accessory',
      'pet',
      'robe',
      'treasure',
    ]);
    expect(find(inventory.items, 'pill-qi').qty).toBe(3);
  });

  it('服用聚气丹 grants a timed cultivation buff that lifts the rate', async () => {
    const before = expectOk<CharacterView>(
      (
        await h.app.inject({ method: 'GET', url: '/api/character', headers: auth(player.token) })
      ).json(),
    );

    const pill = find((await list()).items, 'pill-qi');
    const used = expectOk<{ view: CharacterView; message: string }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/inventory/use',
          headers: auth(player.token),
          payload: { uid: pill.uid, qty: 1 },
        })
      ).json(),
    );

    expect(used.message).toContain('聚气丹');
    expect(used.view.character.buffs).toHaveLength(1);
    expect(used.view.ratePerSec).toBeGreaterThan(before.ratePerSec);
    expect(find((await list()).items, 'pill-qi').qty).toBe(2);
  });

  it('stat pills persist their existing bonuses in battle and an occupied zone, then expire', async () => {
    // Official existence: https://xian.leiting.com/news/3.html (2020-12-03). Values/stacking follow GDD 4.3 and ITEMS, not the original game's numbers.
    h.ctx.settings.patch({ cultivationMultiplier: 0 });
    const before = await list();
    h.ctx.zones.enter(player.characterId, 'map-qingyun-mountain', h.clock.now());
    const world = (h.ctx.zones as ZoneServiceImpl).worlds.get('map-qingyun-mountain')!;
    const total: Record<string, number> = {};
    for (const id of ['pill-power', 'pill-spirit']) {
      const item = ITEM_BY_ID.get(id)!;
      if (item.kind !== 'pill' || item.effect.type !== 'stat_buff') throw new Error('stat pill missing');
      h.ctx.inventory.add(player.characterId, id, 2);
      const pill = find((await list()).items, id);
      const response = await h.app.inject({ method: 'POST', url: '/api/inventory/use', headers: auth(player.token), payload: { uid: pill.uid, qty: 2 } });
      const used = expectOk<{ view: CharacterView }>(response.json());
      for (const [stat, amount] of Object.entries(item.effect.stats)) total[stat] = (total[stat] ?? 0) + amount * 2;
      const state = h.ctx.characters.byId(player.characterId)!;
      const expected = computeStats({ stageIndex: state.stageIndex, equipment: resolveEquipment(state, h.ctx.inventory), technique: TECHNIQUE_BY_ID.get(state.techniqueId ?? ''), extraPercent: total });
      expect(used.view.stats).toEqual(expected);
      expect(used.view.ratePerSec).toBe(0);
      expect((await list()).stats).toEqual(expected);
      expect(h.ctx.inventory.byUid(pill.uid)).toBeNull();
      h.ctx.zones.flush(h.clock.now()); // Even a no-kill window must refresh the already occupied field.
      expect(world.entityOf(player.characterId)!.stats).toEqual(expected);
    }
    const state = h.ctx.characters.byId(player.characterId)!;
    const buffed = statsOf(state, resolveEquipment(state, h.ctx.inventory));
    const enemy = { id: 'target', name: 'target', stats: { ...before.stats, hp: 10000 }, skills: [] };
    const withPill = runBattle([characterCombatant(state, buffed)], [enemy], 42, { maxBattleRounds: 1 });
    const without = runBattle([characterCombatant(state, before.stats)], [enemy], 42, { maxBattleRounds: 1 });
    expect(withPill.finalHp.target!).toBeLessThan(without.finalHp.target!);
    h.clock.advance(1800 * 1000);
    h.ctx.zones.flush(h.clock.now()); // Expiry must work without a character REST read or any loot.
    expect(world.entityOf(player.characterId)!.stats).toEqual(before.stats);
    const directory = expectOk<{ items: PublicProfile[] }>((await h.app.inject({ method: 'GET', url: `/api/cultivators?q=${encodeURIComponent(player.name)}`, headers: auth(player.token) })).json());
    expect(directory.items.find(row => row.id === player.characterId)!.stats).toEqual(before.stats);
    expect((await list()).stats).toEqual(before.stats);
    expect(h.ctx.characters.byId(player.characterId)!.buffs).toHaveLength(0);
  });

  it('服用筑基丹 grants 修为 immediately', async () => {
    h.ctx.inventory.add(player.characterId, 'pill-foundation', 1);
    const pill = find((await list()).items, 'pill-foundation');

    const used = expectOk<{ gainedExp: number; view: CharacterView }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/inventory/use',
          headers: auth(player.token),
          payload: { uid: pill.uid, qty: 1 },
        })
      ).json(),
    );
    expect(used.gainedExp).toBe(2400);
  });

  it('refuses to eat 破境丹 or wear a pill', async () => {
    const items = (await list()).items;

    const pill = await h.app.inject({
      method: 'POST',
      url: '/api/inventory/use',
      headers: auth(player.token),
      payload: { uid: find(items, 'pill-breakthrough').uid, qty: 1 },
    });
    expect(expectFail(pill.json()).code).toBe('NOT_CONSUMABLE');

    const wear = await h.app.inject({
      method: 'POST',
      url: '/api/inventory/equip',
      headers: auth(player.token),
      payload: { uid: find(items, 'pill-qi').uid },
    });
    expect(expectFail(wear.json()).code).toBe('NOT_EQUIPPABLE');

    const material = await h.app.inject({
      method: 'POST',
      url: '/api/inventory/use',
      headers: auth(player.token),
      payload: { uid: find(items, 'mat-spirit-herb').uid, qty: 1 },
    });
    expect(expectFail(material.json()).code).toBe('NOT_CONSUMABLE');
  });

  it('equips 青锋剑, raises 战力 and swaps the slot on a second equip', async () => {
    const before = await list();
    const sword = find(before.items, 'treasure-sword');

    const equipped = expectOk<CharacterView>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/inventory/equip',
          headers: auth(player.token),
          payload: { uid: sword.uid },
        })
      ).json(),
    );
    expect(equipped.character.equipment.treasure).toBe(sword.uid);
    expect(equipped.stats.atk).toBeGreaterThan(0);
    expect(equipped.character.powerScore).toBeGreaterThan(before.powerScore);

    const after = await list();
    expect(find(after.items, 'treasure-sword').equipped).toBe(true);

    h.ctx.inventory.add(player.characterId, 'treasure-bell', 1);
    const bell = find((await list()).items, 'treasure-bell');
    const stageGate = await h.app.inject({
      method: 'POST',
      url: '/api/inventory/equip',
      headers: auth(player.token),
      payload: { uid: bell.uid },
    });
    expect(expectFail(stageGate.json()).code).toBe('STAGE_TOO_LOW');
  });

  it('unequips a slot and refuses an empty one', async () => {
    const sword = find((await list()).items, 'treasure-sword');
    await h.app.inject({
      method: 'POST',
      url: '/api/inventory/equip',
      headers: auth(player.token),
      payload: { uid: sword.uid },
    });

    const off = expectOk<CharacterView>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/inventory/unequip',
          headers: auth(player.token),
          payload: { slot: 'treasure' },
        })
      ).json(),
    );
    expect(off.character.equipment.treasure).toBeNull();

    const again = await h.app.inject({
      method: 'POST',
      url: '/api/inventory/unequip',
      headers: auth(player.token),
      payload: { slot: 'treasure' },
    });
    expect(expectFail(again.json()).code).toBe('SLOT_MISMATCH');
  });

  it('rejects an item another cultivator owns', async () => {
    const other = await makePlayer(h);
    const theirs = expectOk<InventoryListResponse>(
      (
        await h.app.inject({ method: 'GET', url: '/api/inventory', headers: auth(other.token) })
      ).json(),
    );
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/inventory/use',
      headers: auth(player.token),
      payload: { uid: find(theirs.items, 'pill-qi').uid, qty: 1 },
    });
    expect(expectFail(response.json()).code).toBe('ITEM_NOT_FOUND');
  });
});
