import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicProfile, RankingEntry } from '@xianxia/shared';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

describe('rankings and the cultivator directory', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness();
    player = await makePlayer(h, { name: '李清子' });
    h.ctx.settings.patch({ botCount: 40 });
    h.ctx.bots.tick(h.clock.now());
  });
  afterEach(async () => {
    await h.close();
  });

  const board = async (name: string, page = 1, pageSize = 10) =>
    expectOk<Page<RankingEntry> & { board: string }>(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/rankings?board=${name}&page=${page}&pageSize=${pageSize}`,
          headers: auth(player.token),
        })
      ).json(),
    );

  it('ranks 境界 by stage then 修为, mixing bots and players', async () => {
    const result = await board('realm');
    expect(result.board).toBe('realm');
    expect(result.total).toBe(41);
    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.items.some((e) => e.isBot)).toBe(true);

    for (let i = 1; i < result.items.length; i += 1) {
      const previous = result.items[i - 1]!;
      const current = result.items[i]!;
      expect(previous.stageIndex).toBeGreaterThanOrEqual(current.stageIndex);
      if (previous.stageIndex === current.stageIndex) {
        expect(previous.rank).toBeLessThan(current.rank);
      }
    }
    expect(result.items.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.items[0]!.stageName).toContain('·');
  });

  it('ranks 战力 descending', async () => {
    const result = await board('power');
    for (let i = 1; i < result.items.length; i += 1) {
      expect(result.items[i - 1]!.powerScore).toBeGreaterThanOrEqual(result.items[i]!.powerScore);
    }
  });

  it('ranks 论道 by arenaRating descending', async () => {
    const result = await board('arena');
    for (let i = 1; i < result.items.length; i += 1) {
      expect(result.items[i - 1]!.arenaRating).toBeGreaterThanOrEqual(
        result.items[i]!.arenaRating,
      );
    }
  });

  it('pages without repeating or dropping anyone', async () => {
    const first = await board('realm', 1, 20);
    const second = await board('realm', 2, 20);
    const third = await board('realm', 3, 20);

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(20);
    expect(third.items).toHaveLength(1);
    expect(third.hasMore).toBe(false);

    const ids = [...first.items, ...second.items, ...third.items].map((e) => e.characterId);
    expect(new Set(ids).size).toBe(41);
    expect([...first.items, ...second.items, ...third.items].map((e) => e.rank)).toEqual(
      Array.from({ length: 41 }, (_, i) => i + 1),
    );
  });

  it('rejects an unknown board', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/rankings?board=gold&page=1&pageSize=10',
      headers: auth(player.token),
    });
    expect(expectFail(response.json()).code).toBe('VALIDATION_ERROR');
  });

  it('coerces numeric and boolean query strings from the URL', async () => {
    const result = expectOk<Page<PublicProfile>>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/cultivators?page=2&pageSize=5&onlyOnline=false',
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.items).toHaveLength(5);
  });

  it('searches the directory by 道号 and keeps a numeric query a string', async () => {
    const found = expectOk<Page<PublicProfile>>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/cultivators?q=%E6%9D%8E%E6%B8%85%E5%AD%90',
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(found.total).toBe(1);
    expect(found.items[0]!.name).toBe('李清子');
    expect(found.items[0]!.isBot).toBe(false);

    const numeric = expectOk<Page<PublicProfile>>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/cultivators?q=123',
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(numeric.total).toBe(0);
  });

  it('filters the directory to cultivators who are online', async () => {
    const offline = expectOk<Page<PublicProfile>>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/cultivators?onlyOnline=true',
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(offline.total).toBe(0);

    h.ctx.presence.join(player.characterId);
    const online = expectOk<Page<PublicProfile>>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/cultivators?onlyOnline=true',
          headers: auth(player.token),
        })
      ).json(),
    );
    expect(online.total).toBe(1);
    expect(online.items[0]!.online).toBe(true);
  });

  it('shows the ladder moving after bots cultivate', async () => {
    const before = await board('realm', 1, 41);
    const beforeById = new Map(before.items.map((e) => [e.characterId, e]));

    h.clock.advance(6 * 3600_000);
    h.ctx.bots.tick(h.clock.now());

    const after = await board('realm', 1, 41);
    const moved = after.items.filter((entry) => {
      const was = beforeById.get(entry.characterId);
      return was !== undefined && entry.stageIndex > was.stageIndex;
    });
    expect(moved.length).toBeGreaterThan(0);
  });
});
