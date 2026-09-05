import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_SETTINGS } from '@xianxia/shared';
import type { AdminStats, BotArchetype, BotSummary, WorldSettings } from '@xianxia/shared';
import {
  adminAuth,
  adminToken,
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
} from './helpers.js';

describe('admin', () => {
  let h: Harness;
  let token: string;

  beforeEach(async () => {
    h = createHarness();
    token = await adminToken(h);
  });
  afterEach(async () => {
    await h.close();
  });

  it('signs in with the ADMIN_PASSWORD credentials and rejects a wrong one', async () => {
    expect(token).toHaveLength(64);

    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'admin', password: 'nope' },
    });
    expect(bad.statusCode).toBe(401);
    expect(expectFail(bad.json()).code).toBe('INVALID_CREDENTIALS');
  });

  it('guards every admin route', async () => {
    const anonymous = await h.app.inject({ method: 'GET', url: '/api/admin/settings' });
    expect(anonymous.statusCode).toBe(401);
    expect(expectFail(anonymous.json()).code).toBe('ADMIN_UNAUTHORIZED');

    const player = await makePlayer(h);
    const asPlayer = await h.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: auth(player.token),
    });
    expect(expectFail(asPlayer.json()).code).toBe('ADMIN_UNAUTHORIZED');
  });

  it('accepts the admin token in either x-admin-token or Authorization', async () => {
    const viaHeader = await h.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: adminAuth(token),
    });
    expect(viaHeader.statusCode).toBe(200);

    const viaBearer = await h.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: auth(token),
    });
    expect(viaBearer.statusCode).toBe(200);
  });

  it('reads the world settings and applies a true partial update', async () => {
    const before = expectOk<WorldSettings>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/admin/settings',
          headers: adminAuth(token),
        })
      ).json(),
    );
    expect(before).toEqual(DEFAULT_WORLD_SETTINGS);

    const after = expectOk<WorldSettings>(
      (
        await h.app.inject({
          method: 'PUT',
          url: '/api/admin/settings',
          headers: adminAuth(token),
          payload: { cultivationMultiplier: 100 },
        })
      ).json(),
    );
    expect(after.cultivationMultiplier).toBe(100);
    // Everything unmentioned survives the patch.
    expect(after.botCount).toBe(DEFAULT_WORLD_SETTINGS.botCount);
    expect(after.announcement).toBe(DEFAULT_WORLD_SETTINGS.announcement);
    expect(h.ctx.settings.get().cultivationMultiplier).toBe(100);
  });

  it('survives a restart with the stored settings intact', async () => {
    await h.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: adminAuth(token),
      payload: { botTickSeconds: 5, announcement: '今日开服' },
    });
    expect(h.ctx.settings.reload().botTickSeconds).toBe(5);
    expect(h.ctx.settings.get().announcement).toBe('今日开服');
  });

  it('rejects an out-of-range setting', async () => {
    const response = await h.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: adminAuth(token),
      payload: { cultivationMultiplier: 9999 },
    });
    expect(response.statusCode).toBe(400);
    expect(expectFail(response.json()).code).toBe('VALIDATION_ERROR');
  });

  it('lists the six seeded archetypes and retunes one', async () => {
    const listed = expectOk<{ archetypes: BotArchetype[] }>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/admin/bot-archetypes',
          headers: adminAuth(token),
        })
      ).json(),
    );
    expect(listed.archetypes).toHaveLength(6);
    expect(listed.archetypes.map((a) => a.id)).toContain('bot-tianjiao');

    const updated = expectOk<{ archetypes: BotArchetype[] }>(
      (
        await h.app.inject({
          method: 'PUT',
          url: '/api/admin/bot-archetypes',
          headers: adminAuth(token),
          payload: { id: 'bot-tianjiao', params: { talent: 5 }, weight: 3 },
        })
      ).json(),
    );
    const tianjiao = updated.archetypes.find((a) => a.id === 'bot-tianjiao')!;
    expect(tianjiao.params.talent).toBe(5);
    expect(tianjiao.params.diligence).toBe(0.9);
    expect(tianjiao.weight).toBe(3);

    const missing = await h.app.inject({
      method: 'PUT',
      url: '/api/admin/bot-archetypes',
      headers: adminAuth(token),
      payload: { id: 'bot-nope', weight: 1 },
    });
    expect(expectFail(missing.json()).code).toBe('NOT_FOUND');
  });

  it('generates, lists, retunes and deletes bots', async () => {
    const generated = expectOk<{ created: number; bots: BotSummary[] }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/bots/generate',
          headers: adminAuth(token),
          payload: { count: 12, minStageIndex: 0, maxStageIndex: 7, seed: 1234 },
        })
      ).json(),
    );
    expect(generated.created).toBe(12);
    expect(new Set(generated.bots.map((b) => b.name)).size).toBe(12);
    for (const bot of generated.bots) {
      expect(bot.stageIndex).toBeGreaterThanOrEqual(0);
      expect(bot.stageIndex).toBeLessThanOrEqual(7);
      expect(bot.powerScore).toBeGreaterThan(0);
      expect(bot.archetypeName).not.toBeNull();
    }

    const page = expectOk<{ items: BotSummary[]; total: number; hasMore: boolean }>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/admin/bots?page=1&pageSize=5&sort=stage&order=desc',
          headers: adminAuth(token),
        })
      ).json(),
    );
    expect(page.total).toBe(12);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]!.stageIndex).toBeGreaterThanOrEqual(page.items[4]!.stageIndex);

    const target = generated.bots[0]!;
    const retuned = expectOk<BotSummary>(
      (
        await h.app.inject({
          method: 'PUT',
          url: '/api/admin/bots',
          headers: adminAuth(token),
          payload: {
            characterId: target.characterId,
            params: { talent: 9, aggression: 1 },
            stageIndex: 10,
          },
        })
      ).json(),
    );
    expect(retuned.params.talent).toBe(9);
    expect(retuned.params.aggression).toBe(1);
    expect(retuned.stageIndex).toBe(10);
    expect(retuned.powerScore).toBeGreaterThan(target.powerScore);

    const deleted = await h.app.inject({
      method: 'DELETE',
      url: '/api/admin/bots',
      headers: adminAuth(token),
      payload: { characterId: target.characterId },
    });
    expect(deleted.statusCode).toBe(200);
    expect(h.ctx.characters.countBots()).toBe(11);

    const gone = await h.app.inject({
      method: 'DELETE',
      url: '/api/admin/bots',
      headers: adminAuth(token),
      payload: { characterId: target.characterId },
    });
    expect(expectFail(gone.json()).code).toBe('BOT_NOT_FOUND');
  });

  it('generates a reproducible cohort from a fixed seed', async () => {
    const first = expectOk<{ bots: BotSummary[] }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/bots/generate',
          headers: adminAuth(token),
          payload: { count: 5, minStageIndex: 2, maxStageIndex: 2, seed: 42 },
        })
      ).json(),
    );

    const other = createHarness();
    const otherToken = await adminToken(other);
    const second = expectOk<{ bots: BotSummary[] }>(
      (
        await other.app.inject({
          method: 'POST',
          url: '/api/admin/bots/generate',
          headers: adminAuth(otherToken),
          payload: { count: 5, minStageIndex: 2, maxStageIndex: 2, seed: 42 },
        })
      ).json(),
    );

    expect(second.bots.map((b) => b.name)).toEqual(first.bots.map((b) => b.name));
    expect(second.bots.map((b) => b.spiritRoot)).toEqual(first.bots.map((b) => b.spiritRoot));
    await other.close();
  });

  it('refuses to generate for an unknown archetype', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/admin/bots/generate',
      headers: adminAuth(token),
      payload: { count: 1, archetypeId: 'bot-nope', minStageIndex: 0, maxStageIndex: 3 },
    });
    expect(expectFail(response.json()).code).toBe('BOT_NOT_FOUND');
  });

  it('reports the dashboard totals', async () => {
    await makePlayer(h);
    await h.app.inject({
      method: 'POST',
      url: '/api/admin/bots/generate',
      headers: adminAuth(token),
      payload: { count: 8, minStageIndex: 0, maxStageIndex: 11 },
    });

    const stats = expectOk<AdminStats>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/admin/stats',
          headers: adminAuth(token),
        })
      ).json(),
    );
    expect(stats.players.total).toBe(1);
    expect(stats.players.newToday).toBe(1);
    expect(stats.players.online).toBe(0);
    expect(stats.bots.total).toBe(8);
    expect(stats.bots.byRealm).toHaveLength(9);
    expect(stats.bots.byRealm.reduce((a, b) => a + b, 0)).toBe(8);
    expect(Object.values(stats.bots.byArchetype).reduce((a, b) => a + b, 0)).toBe(8);
    expect(stats.server.serverTime).toBe(h.clock.now());
    expect(stats.server.lastBotTickAt).toBeNull();
    expect(stats.server.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
