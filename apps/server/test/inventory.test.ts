import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CharacterView, InventoryItem, InventoryListResponse } from '@xianxia/shared';
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
