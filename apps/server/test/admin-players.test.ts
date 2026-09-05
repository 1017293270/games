import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BREAKTHROUGH_PILL_ID, getStage, stageName } from '@xianxia/shared';
import type { CharacterState, Invite, InventoryItem, PlayerSummary } from '@xianxia/shared';
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
import { settle } from '../src/game/character.js';

/** Player management and invite codes — the W4 half of the admin surface. */

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

describe('admin / players', () => {
  let h: Harness;
  let token: string;

  beforeEach(async () => {
    h = createHarness();
    token = await adminToken(h);
  });
  afterEach(async () => {
    await h.close();
  });

  async function players(query = ''): Promise<Page<PlayerSummary>> {
    return expectOk<Page<PlayerSummary>>(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/admin/players${query}`,
          headers: adminAuth(token),
        })
      ).json(),
    );
  }

  it('lists accounts newest first, with their cultivator folded in', async () => {
    const first = await makePlayer(h, { username: 'alpha', name: '甲道友' });
    h.clock.advance(1000);
    await makePlayer(h, { username: 'beta', name: '乙道友' });

    const page = await players('?page=1&pageSize=20');
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((p) => p.username)).toEqual(['beta', 'alpha']);

    const alpha = page.items.find((p) => p.username === 'alpha')!;
    expect(alpha.userId).toBe(first.userId);
    expect(alpha.characterId).toBe(first.characterId);
    expect(alpha.characterName).toBe('甲道友');
    expect(alpha.stageIndex).toBe(0);
    expect(alpha.stageName).toBe(stageName(0));
    expect(alpha.powerScore).toBeGreaterThan(0);
    expect(alpha.spiritStones).toBeGreaterThanOrEqual(0);
    expect(alpha.banned).toBe(false);
    expect(alpha.isAdmin).toBe(false);
    expect(alpha.online).toBe(false);
    expect(alpha.lastSeenAt).not.toBeNull();
  });

  it('reports an account that has not created a cultivator yet', async () => {
    expectOk(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: { username: 'blank', password: 'passw0rd', inviteCode: 'friends' },
        })
      ).json(),
    );

    const page = await players();
    const blank = page.items.find((p) => p.username === 'blank')!;
    expect(blank.characterId).toBeNull();
    expect(blank.characterName).toBeNull();
    expect(blank.stageIndex).toBeNull();
    expect(blank.stageName).toBeNull();
    expect(blank.powerScore).toBeNull();
    expect(blank.spiritStones).toBeNull();
    expect(blank.lastSeenAt).toBeNull();
    expect(blank.online).toBe(false);
  });

  it('pages, searches by username and filters to the banned', async () => {
    for (let i = 0; i < 5; i += 1) {
      await makePlayer(h, { username: `sect${i}`, name: `弟子${i}` });
      h.clock.advance(1000);
    }
    const outsider = await makePlayer(h, { username: 'wanderer', name: '散人' });

    const firstPage = await players('?page=1&pageSize=2');
    expect(firstPage.total).toBe(6);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);

    const lastPage = await players('?page=3&pageSize=2');
    expect(lastPage.hasMore).toBe(false);

    const searched = await players('?q=sect');
    expect(searched.total).toBe(5);
    expect(searched.items.every((p) => p.username.startsWith('sect'))).toBe(true);

    await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/ban',
      headers: adminAuth(token),
      payload: { userId: outsider.userId, banned: true, reason: '外挂' },
    });

    const banned = await players('?onlyBanned=true');
    expect(banned.total).toBe(1);
    expect(banned.items[0]!.username).toBe('wanderer');
    expect(banned.items[0]!.banned).toBe(true);
  });

  it('grants 修为, 灵石 and items, and pushes the new numbers to the owner', async () => {
    const player = await makePlayer(h);
    const before = h.ctx.characters.byId(player.characterId)!;
    const pillsBefore = h.ctx.inventory.quantityOf(player.characterId, BREAKTHROUGH_PILL_ID);

    const granted = expectOk<CharacterState>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/grant',
          headers: adminAuth(token),
          payload: {
            characterId: player.characterId,
            exp: 100,
            spiritStones: 1200,
            items: [{ itemId: BREAKTHROUGH_PILL_ID, qty: 3 }],
          },
        })
      ).json(),
    );

    expect(granted.exp).toBe(before.exp + 100);
    expect(granted.spiritStones).toBe(before.spiritStones + 1200);
    expect(h.ctx.inventory.quantityOf(player.characterId, BREAKTHROUGH_PILL_ID)).toBe(
      pillsBefore + 3,
    );

    const bag = expectOk<{ items: InventoryItem[] }>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/inventory',
          headers: auth(player.token),
        })
      ).json(),
    );
    const pill = bag.items.find((i) => i.itemId === BREAKTHROUGH_PILL_ID)!;
    expect(pill.qty).toBe(pillsBefore + 3);
  });

  it('settles the pending 修为 before applying a grant', async () => {
    const player = await makePlayer(h);
    // The row on disk stops at the moment the cultivator was made; nothing
    // reads it again, so 两个时辰 of cultivation is still unbanked.
    const stored = h.ctx.characters.byId(player.characterId)!;
    h.clock.advance(2 * 60 * 60 * 1000);

    // What a plain read would have credited, computed off the same stored row.
    const owed = settle(stored, h.ctx.settings.get(), h.clock.now());
    expect(owed.gainedExp).toBeGreaterThan(0);

    const granted = expectOk<CharacterState>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/grant',
          headers: adminAuth(token),
          payload: {
            characterId: player.characterId,
            items: [{ itemId: BREAKTHROUGH_PILL_ID, qty: 3 }],
          },
        })
      ).json(),
    );

    // An item-only grant must not cost the player the offline window: the
    // 修为 lands exactly where a read would have put it, not back at the
    // stored value that `lastSettledAt: now` would otherwise have frozen.
    expect(granted.stageIndex).toBe(owed.character.stageIndex);
    expect(granted.exp).toBeCloseTo(owed.character.exp, 6);
    expect(granted.exp).not.toBe(stored.exp);
    expect(granted.lastSettledAt).toBe(h.clock.now());

    const saved = h.ctx.characters.byId(player.characterId)!;
    expect(saved.exp).toBeCloseTo(owed.character.exp, 6);
    expect(saved.lastSettledAt).toBe(h.clock.now());
  });

  it('rolls 修为 up through 小境界 and parks at 圆满', async () => {
    const player = await makePlayer(h);

    // Four stages' worth of 修为 lands the cultivator on 练气圆满, full, waiting
    // for an explicit breakthrough rather than sliding into 筑基.
    const huge = getStage(0).expRequired + getStage(1).expRequired + getStage(2).expRequired +
      getStage(3).expRequired * 4;
    const granted = expectOk<CharacterState>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/grant',
          headers: adminAuth(token),
          payload: { characterId: player.characterId, exp: huge },
        })
      ).json(),
    );

    expect(granted.stageIndex).toBe(3);
    expect(granted.exp).toBe(getStage(3).expRequired);
  });

  it('sets 境界 outright, clamping 修为 into the target stage', async () => {
    const player = await makePlayer(h);
    const granted = expectOk<CharacterState>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/grant',
          headers: adminAuth(token),
          payload: { characterId: player.characterId, stageIndex: 12, exp: 100 },
        })
      ).json(),
    );
    expect(granted.stageIndex).toBe(12);
    expect(granted.exp).toBe(100);
    expect(granted.powerScore).toBeGreaterThan(0);

    // A 灵石 grant may take stones away but never past zero.
    const drained = expectOk<CharacterState>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/grant',
          headers: adminAuth(token),
          payload: { characterId: player.characterId, spiritStones: -999_999 },
        })
      ).json(),
    );
    expect(drained.spiritStones).toBe(0);
  });

  it('refuses an unknown character or item, changing nothing', async () => {
    const player = await makePlayer(h);

    const noPlayer = await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/grant',
      headers: adminAuth(token),
      payload: { characterId: 'nope', spiritStones: 10 },
    });
    expect(noPlayer.statusCode).toBe(404);
    expect(expectFail(noPlayer.json()).code).toBe('PLAYER_NOT_FOUND');

    const before = h.ctx.characters.byId(player.characterId)!;
    const noItem = await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/grant',
      headers: adminAuth(token),
      payload: {
        characterId: player.characterId,
        spiritStones: 5000,
        items: [{ itemId: 'item-nope', qty: 1 }],
      },
    });
    expect(expectFail(noItem.json()).code).toBe('ITEM_NOT_FOUND');
    expect(h.ctx.characters.byId(player.characterId)!.spiritStones).toBe(before.spiritStones);
  });

  it('resets a password and invalidates the sessions it had', async () => {
    const player = await makePlayer(h, { username: 'forgetful' });

    const reset = await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/reset-password',
      headers: adminAuth(token),
      payload: { userId: player.userId, newPassword: 'newpassw0rd' },
    });
    expect(reset.statusCode).toBe(200);

    const stale = await h.app.inject({
      method: 'GET',
      url: '/api/character',
      headers: auth(player.token),
    });
    expect(expectFail(stale.json()).code).toBe('UNAUTHORIZED');

    const oldPassword = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'forgetful', password: 'passw0rd' },
    });
    expect(expectFail(oldPassword.json()).code).toBe('INVALID_CREDENTIALS');

    const fresh = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'forgetful', password: 'newpassw0rd' },
    });
    expect(fresh.statusCode).toBe(200);

    const missing = await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/reset-password',
      headers: adminAuth(token),
      payload: { userId: 'nobody', newPassword: 'newpassw0rd' },
    });
    expect(expectFail(missing.json()).code).toBe('PLAYER_NOT_FOUND');
  });

  it('bans an account offline immediately and lets it back in on unban', async () => {
    const player = await makePlayer(h, { username: 'cheater' });

    const banned = expectOk<PlayerSummary>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/ban',
          headers: adminAuth(token),
          payload: { userId: player.userId, banned: true, reason: '恶意刷分' },
        })
      ).json(),
    );
    expect(banned.banned).toBe(true);
    expect(banned.username).toBe('cheater');
    expect(banned.characterId).toBe(player.characterId);

    // The live session is gone, so the held token no longer resolves at all.
    const withToken = await h.app.inject({
      method: 'GET',
      url: '/api/character',
      headers: auth(player.token),
    });
    expect(expectFail(withToken.json()).code).toBe('UNAUTHORIZED');

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cheater', password: 'passw0rd' },
    });
    expect(login.statusCode).toBe(403);
    const failure = expectFail(login.json());
    expect(failure.code).toBe('BANNED');
    expect(failure.message).toContain('恶意刷分');

    const lifted = expectOk<PlayerSummary>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/players/ban',
          headers: adminAuth(token),
          payload: { userId: player.userId, banned: false },
        })
      ).json(),
    );
    expect(lifted.banned).toBe(false);
    expect(h.ctx.users.byId(player.userId)!.banReason).toBe('');

    const backIn = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'cheater', password: 'passw0rd' },
    });
    expect(backIn.statusCode).toBe(200);

    const missing = await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/ban',
      headers: adminAuth(token),
      payload: { userId: 'nobody', banned: true },
    });
    expect(expectFail(missing.json()).code).toBe('PLAYER_NOT_FOUND');
  });
});

describe('admin / invites', () => {
  let h: Harness;
  let token: string;

  beforeEach(async () => {
    h = createHarness({ inviteCode: 'friends' });
    token = await adminToken(h);
  });
  afterEach(async () => {
    await h.close();
  });

  async function list(): Promise<Invite[]> {
    return expectOk<{ invites: Invite[] }>(
      (
        await h.app.inject({
          method: 'GET',
          url: '/api/admin/invites',
          headers: adminAuth(token),
        })
      ).json(),
    ).invites;
  }

  it('lists the bootstrap code from INVITE_CODE', async () => {
    const invites = await list();
    expect(invites).toHaveLength(1);
    expect(invites[0]!.code).toBe('friends');
    expect(invites[0]!.createdBy).toBe('env:INVITE_CODE');
    expect(invites[0]!.usedAt).toBeNull();
    // `maxUses`/`uses` are storage-only; the wire shape stops at `Invite`.
    expect(invites[0]).not.toHaveProperty('maxUses');
  });

  it('mints codes stamped with the operator and registers one', async () => {
    const created = expectOk<{ invites: Invite[] }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/invites',
          headers: adminAuth(token),
          payload: { count: 3, note: '首测名额', expiresAt: null },
        })
      ).json(),
    ).invites;

    expect(created).toHaveLength(4);
    const minted = created.filter((i) => i.createdBy === 'admin');
    expect(minted).toHaveLength(3);
    expect(new Set(minted.map((i) => i.code)).size).toBe(3);
    for (const invite of minted) {
      expect(invite.code).toMatch(/^[23456789BCDFGHJKLMNPQRSTVWXYZ]{6}$/);
      expect(invite.note).toBe('首测名额');
      expect(invite.expiresAt).toBeNull();
    }

    const code = minted[0]!.code;
    const registered = await h.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'invited', password: 'passw0rd', inviteCode: code },
    });
    expect(registered.statusCode).toBe(200);

    const after = (await list()).find((i) => i.code === code)!;
    expect(after.usedAt).toBe(h.clock.now());
    expect(after.usedBy).not.toBeNull();

    // Single use: the second registration is turned away.
    const reused = await h.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'gatecrasher', password: 'passw0rd', inviteCode: code },
    });
    expect(expectFail(reused.json()).code).toBe('INVITE_INVALID');
  });

  it('honours an expiry stamp', async () => {
    const created = expectOk<{ invites: Invite[] }>(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/admin/invites',
          headers: adminAuth(token),
          payload: { count: 1, note: '限时', expiresAt: h.clock.now() + 60_000 },
        })
      ).json(),
    ).invites;
    const code = created.find((i) => i.note === '限时')!.code;

    h.clock.advance(120_000);
    const late = await h.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'latecomer', password: 'passw0rd', inviteCode: code },
    });
    expect(expectFail(late.json()).code).toBe('INVITE_INVALID');
  });

  it('retires a code and answers NOT_FOUND for one that is already gone', async () => {
    const remaining = expectOk<{ invites: Invite[] }>(
      (
        await h.app.inject({
          method: 'DELETE',
          url: '/api/admin/invites',
          headers: adminAuth(token),
          payload: { code: 'friends' },
        })
      ).json(),
    ).invites;
    expect(remaining).toHaveLength(0);

    const gone = await h.app.inject({
      method: 'DELETE',
      url: '/api/admin/invites',
      headers: adminAuth(token),
      payload: { code: 'friends' },
    });
    expect(gone.statusCode).toBe(404);
    expect(expectFail(gone.json()).code).toBe('NOT_FOUND');

    // A retired code no longer opens the gate.
    const refused = await h.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'stale', password: 'passw0rd', inviteCode: 'friends' },
    });
    expect(expectFail(refused.json()).code).toBe('INVITE_INVALID');
  });
});

describe('admin / auth failures', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('rejects a missing, malformed or expired admin token on every new route', async () => {
    h = createHarness();
    const token = await adminToken(h);

    const routes: { method: 'GET' | 'POST' | 'DELETE'; url: string }[] = [
      { method: 'GET', url: '/api/admin/players' },
      { method: 'POST', url: '/api/admin/players/grant' },
      { method: 'POST', url: '/api/admin/players/reset-password' },
      { method: 'POST', url: '/api/admin/players/ban' },
      { method: 'GET', url: '/api/admin/invites' },
      { method: 'POST', url: '/api/admin/invites' },
      { method: 'DELETE', url: '/api/admin/invites' },
    ];

    for (const route of routes) {
      const anonymous = await h.app.inject({ method: route.method, url: route.url, payload: {} });
      expect(anonymous.statusCode, route.url).toBe(401);
      expect(expectFail(anonymous.json()).code, route.url).toBe('ADMIN_UNAUTHORIZED');

      const garbage = await h.app.inject({
        method: route.method,
        url: route.url,
        headers: adminAuth('deadbeef'),
        payload: {},
      });
      expect(expectFail(garbage.json()).code, route.url).toBe('ADMIN_UNAUTHORIZED');
    }

    // A live token works; the same token past its TTL does not.
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/admin/invites', headers: adminAuth(token) }))
        .statusCode,
    ).toBe(200);

    h.clock.advance(31 * 86_400_000);
    const expired = await h.app.inject({
      method: 'GET',
      url: '/api/admin/invites',
      headers: adminAuth(token),
    });
    expect(expired.statusCode).toBe(401);
    expect(expectFail(expired.json()).code).toBe('ADMIN_UNAUTHORIZED');
  });

  it('turns a validation failure into VALIDATION_ERROR, not a 500', async () => {
    h = createHarness();
    const token = await adminToken(h);

    const shortPassword = await h.app.inject({
      method: 'POST',
      url: '/api/admin/players/reset-password',
      headers: adminAuth(token),
      payload: { userId: 'someone', newPassword: '123' },
    });
    expect(shortPassword.statusCode).toBe(400);
    expect(expectFail(shortPassword.json()).code).toBe('VALIDATION_ERROR');

    const tooMany = await h.app.inject({
      method: 'POST',
      url: '/api/admin/invites',
      headers: adminAuth(token),
      payload: { count: 500 },
    });
    expect(expectFail(tooMany.json()).code).toBe('VALIDATION_ERROR');
  });
});
