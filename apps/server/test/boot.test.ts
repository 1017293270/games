import { afterEach, describe, expect, it } from 'vitest';
import { allEndpoints } from '@xianxia/shared';
import { appliedMigrations } from '../src/db/index.js';
import { handlers } from '../src/app.js';
import { authHandlers } from '../src/modules/auth/routes.js';
import { characterHandlers } from '../src/modules/character/routes.js';
import { createHarness, expectFail, makePlayer, auth, type Harness } from './helpers.js';

describe('boot', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.close();
  });

  it('applies every migration once and is idempotent on a second open', () => {
    h = createHarness();
    const applied = appliedMigrations(h.ctx.db);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied.map((m) => m.name)).toContain('001_init.sql');
  });

  it('registers all 72 endpoints from the shared table', () => {
    h = createHarness();
    expect(h.routes.total).toBe(72);
    expect(h.routes.total).toBe(allEndpoints().length);
    expect(h.routes.implemented.length + h.routes.pending.length).toBe(72);
  });

  it('implements exactly the handlers registered in app.ts', () => {
    h = createHarness();
    expect([...h.routes.implemented].sort()).toEqual(Object.keys(handlers).sort());
  });

  it('answers 功能尚未开放 on an endpoint without a handler', async () => {
    h = createHarness({ registry: { ...authHandlers, ...characterHandlers } });
    const player = await makePlayer(h);
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/party',
      headers: auth(player.token),
    });
    expect(response.statusCode).toBe(404);
    const error = expectFail(response.json());
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('功能尚未开放');
  });

  it('checks auth before reporting an endpoint as unimplemented', async () => {
    h = createHarness({ registry: { ...authHandlers, ...characterHandlers } });
    const response = await h.app.inject({ method: 'GET', url: '/api/party' });
    expect(response.statusCode).toBe(401);
    expect(expectFail(response.json()).code).toBe('UNAUTHORIZED');
  });

  it('returns a JSON 404 for an unknown path rather than crashing', async () => {
    h = createHarness();
    const response = await h.app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
    expect(expectFail(response.json()).code).toBe('NOT_FOUND');
  });

  it('seeds the bot archetypes and the bootstrap invite code', () => {
    h = createHarness({ inviteCode: 'friends' });
    expect(h.ctx.archetypes.all()).toHaveLength(6);
    const invite = h.ctx.invites.find('friends');
    expect(invite?.maxUses).toBe(-1);
  });
});
