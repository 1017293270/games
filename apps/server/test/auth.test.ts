import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth, createHarness, expectFail, expectOk, type Harness } from './helpers.js';

describe('auth', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness({ inviteCode: 'friends' });
  });
  afterEach(async () => {
    await h.close();
  });

  const register = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/auth/register', payload });

  it('registers with the bootstrap invite code', async () => {
    const response = await register({
      username: 'liqing',
      password: 'passw0rd',
      inviteCode: 'friends',
    });
    expect(response.statusCode).toBe(200);
    const session = expectOk<{ token: string; user: { username: string; characterId: null } }>(
      response.json(),
    );
    expect(session.token).toHaveLength(64);
    expect(session.user.username).toBe('liqing');
    expect(session.user.characterId).toBeNull();
  });

  it('rejects a wrong invite code with INVITE_INVALID', async () => {
    const response = await register({
      username: 'liqing',
      password: 'passw0rd',
      inviteCode: 'nope',
    });
    expect(response.statusCode).toBe(403);
    expect(expectFail(response.json()).code).toBe('INVITE_INVALID');
  });

  it('rejects a missing invite code with INVITE_REQUIRED', async () => {
    const response = await register({ username: 'liqing', password: 'passw0rd' });
    expect(expectFail(response.json()).code).toBe('INVITE_REQUIRED');
  });

  it('skips the invite check when world.inviteRequired is off', async () => {
    h.ctx.settings.patch({ inviteRequired: false });
    const response = await register({ username: 'liqing', password: 'passw0rd' });
    expect(response.statusCode).toBe(200);
  });

  it('honours registrationOpen', async () => {
    h.ctx.settings.patch({ registrationOpen: false });
    const response = await register({
      username: 'liqing',
      password: 'passw0rd',
      inviteCode: 'friends',
    });
    expect(expectFail(response.json()).code).toBe('REGISTRATION_CLOSED');
  });

  it('rejects a duplicate username', async () => {
    await register({ username: 'liqing', password: 'passw0rd', inviteCode: 'friends' });
    const response = await register({
      username: 'LIQING',
      password: 'passw0rd',
      inviteCode: 'friends',
    });
    expect(expectFail(response.json()).code).toBe('USERNAME_TAKEN');
  });

  it('logs in and rejects a wrong password', async () => {
    await register({ username: 'liqing', password: 'passw0rd', inviteCode: 'friends' });

    const good = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'liqing', password: 'passw0rd' },
    });
    expect(good.statusCode).toBe(200);

    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'liqing', password: 'wrongpass' },
    });
    expect(bad.statusCode).toBe(401);
    expect(expectFail(bad.json()).code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the account and the server clock from /auth/me', async () => {
    const session = expectOk<{ token: string }>(
      (
        await register({ username: 'liqing', password: 'passw0rd', inviteCode: 'friends' })
      ).json(),
    );
    const me = expectOk<{ user: { username: string }; serverTime: number }>(
      (
        await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session.token) })
      ).json(),
    );
    expect(me.user.username).toBe('liqing');
    expect(me.serverTime).toBe(h.clock.now());
  });

  it('invalidates the token on logout', async () => {
    const session = expectOk<{ token: string }>(
      (
        await register({ username: 'liqing', password: 'passw0rd', inviteCode: 'friends' })
      ).json(),
    );
    await h.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: auth(session.token),
      payload: {},
    });
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: auth(session.token),
    });
    expect(after.statusCode).toBe(401);
  });

  it('blocks a banned account at login and on every request', async () => {
    const session = expectOk<{ token: string; user: { id: string } }>(
      (
        await register({ username: 'liqing', password: 'passw0rd', inviteCode: 'friends' })
      ).json(),
    );
    h.ctx.users.setBanned(session.user.id, true, '扰乱世界秩序');

    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: auth(session.token),
    });
    expect(me.statusCode).toBe(403);
    expect(expectFail(me.json()).code).toBe('BANNED');

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'liqing', password: 'passw0rd' },
    });
    expect(expectFail(login.json()).code).toBe('BANNED');
  });

  it('rejects a malformed payload with VALIDATION_ERROR', async () => {
    const response = await register({ username: 'a', password: '123' });
    expect(response.statusCode).toBe(400);
    expect(expectFail(response.json()).code).toBe('VALIDATION_ERROR');
  });
});
