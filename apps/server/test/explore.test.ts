import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPLORE_MAP_BY_ID } from '@xianxia/shared';
import type { ExploreBattleResponse, GatherResponse, MapListResponse } from '@xianxia/shared';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

describe('explore', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness();
    player = await makePlayer(h);
  });
  afterEach(async () => {
    await h.close();
  });

  const battle = async (payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/explore/battle',
      headers: auth(player.token),
      payload,
    });

  it('lists the four maps with unlock state and gather cooldown', async () => {
    const maps = expectOk<MapListResponse>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/explore/maps',
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(maps.maps).toHaveLength(4);
    const qingyun = maps.maps.find((m) => m.id === 'map-qingyun-mountain')!;
    expect(qingyun.unlocked).toBe(true);
    expect(qingyun.gatherReadyAt).toBe(0);
    expect(qingyun.monsters).toHaveLength(2);
    expect(maps.maps.find((m) => m.id === 'map-kunlun-ruins')!.unlocked).toBe(false);
  });

  it('locks a map the cultivator has not reached', async () => {
    const response = await battle({ mapId: 'map-kunlun-ruins' });
    expect(response.statusCode).toBe(403);
    expect(expectFail(response.json()).code).toBe('MAP_LOCKED');
  });

  it('fights a named 妖兽 and returns a replayable BattleResult with loot', async () => {
    const result = expectOk<ExploreBattleResponse>(
      (await battle({ mapId: 'map-qingyun-mountain', monsterId: 'monster-qingyun-wolf' })).json(),
    );
    expect(result.kind).toBe('battle');
    if (result.kind !== 'battle') throw new Error('expected a battle');

    expect(result.monsterName).toBe('青云狼');
    expect(result.battle.log.length).toBeGreaterThan(0);
    expect(result.battle.log[0]?.type).toBe('round_start');
    expect(result.battle.log.at(-1)?.type).toBe('battle_end');
    expect(['A', 'B', 'draw']).toContain(result.battle.winner);
    expect(Object.keys(result.battle.finalHp)).toContain(player.characterId);

    if (result.won) {
      expect(result.reward.exp).toBeGreaterThan(0);
      expect(result.reward.itemNames.length).toBe(result.reward.items.length);
      expect(result.view.character.exp).toBeGreaterThan(0);
    }
  });

  it('rejects a 妖兽 that does not live on the map', async () => {
    const response = await battle({
      mapId: 'map-qingyun-mountain',
      monsterId: 'monster-golden-crow',
    });
    expect(expectFail(response.json()).code).toBe('NOT_FOUND');
  });

  it('rolls 奇遇 sometimes, and the token resolves exactly once', async () => {
    let encounter: Extract<ExploreBattleResponse, { kind: 'encounter' }> | null = null;
    for (let i = 0; i < 60 && encounter === null; i += 1) {
      h.clock.advance(1000);
      const result = expectOk<ExploreBattleResponse>(
        (await battle({ mapId: 'map-qingyun-mountain' })).json(),
      );
      if (result.kind === 'encounter') encounter = result;
    }
    expect(encounter).not.toBeNull();
    expect(encounter!.encounter.options.length).toBeGreaterThanOrEqual(2);

    const option = encounter!.encounter.options[0]!;
    const chosen = expectOk<{ outcomeText: string; reward: { itemNames: string[] } }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/explore/event',
          headers: auth(player.token),
          payload: { encounterToken: encounter!.encounterToken, optionId: option.id },
        })
      ).json(),
    );
    expect(chosen.outcomeText).toBe(option.outcomeText);

    const replay = await h.app.inject({
      method: 'POST',
      url: '/api/explore/event',
      headers: auth(player.token),
      payload: { encounterToken: encounter!.encounterToken, optionId: option.id },
    });
    expect(expectFail(replay.json()).code).toBe('ENCOUNTER_NOT_ACTIVE');
  });

  it('rejects an unknown 奇遇 choice', async () => {
    let token: string | null = null;
    for (let i = 0; i < 60 && token === null; i += 1) {
      h.clock.advance(1000);
      const result = expectOk<ExploreBattleResponse>(
        (await battle({ mapId: 'map-qingyun-mountain' })).json(),
      );
      if (result.kind === 'encounter') token = result.encounterToken;
    }
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/explore/event',
      headers: auth(player.token),
      payload: { encounterToken: token!, optionId: 'no-such-option' },
    });
    expect(expectFail(response.json()).code).toBe('INVALID_CHOICE');
  });

  it('采药 pays out and then holds the cooldown', async () => {
    const first = expectOk<GatherResponse>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/explore/gather',
          headers: auth(player.token),
          payload: { mapId: 'map-qingyun-mountain' },
        })
      ).json(),
    );
    expect(first.reward.exp).toBe(120);
    expect(first.nextGatherAt).toBe(h.clock.now() + 300_000);

    const tooSoon = await h.app.inject({
      method: 'POST',
      url: '/api/explore/gather',
      headers: auth(player.token),
      payload: { mapId: 'map-qingyun-mountain' },
    });
    expect(tooSoon.statusCode).toBe(429);
    expect(expectFail(tooSoon.json()).code).toBe('GATHER_COOLDOWN');

    h.clock.advance(EXPLORE_MAP_BY_ID.get('map-qingyun-mountain')!.gather.cooldownSec * 1000);
    const again = await h.app.inject({
      method: 'POST',
      url: '/api/explore/gather',
      headers: auth(player.token),
      payload: { mapId: 'map-qingyun-mountain' },
    });
    expect(again.statusCode).toBe(200);
  });

  it('scales rewards by the world multipliers', async () => {
    h.ctx.settings.patch({ expRewardMultiplier: 10, stoneRewardMultiplier: 4 });
    const result = expectOk<GatherResponse>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/explore/gather',
          headers: auth(player.token),
          payload: { mapId: 'map-qingyun-mountain' },
        })
      ).json(),
    );
    expect(result.reward.exp).toBe(1200);
    expect(result.reward.spiritStones).toBe(120);
  });
});
