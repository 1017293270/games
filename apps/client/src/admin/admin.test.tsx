import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { API, DEFAULT_WORLD_SETTINGS, type WorldSettings } from '@xianxia/shared';
import { ApiError } from '../api/http';
import AdminPage from './index';
import { adminCall, readAdminToken, writeAdminToken } from './api';

/**
 * The console talks to the server over its own transport, so these tests stub
 * `fetch` with a miniature admin API rather than the player-side mock world.
 */

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Recorded[] = [];
let world: WorldSettings;
/** Overrides keyed by `METHOD /path`, for the failure paths. */
let responses: Record<string, { status: number; payload: unknown }> = {};

const ok = (data: unknown) => ({ ok: true, data });

function install(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const [path, query = ''] = url.split('?');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      method,
      path: path ?? '',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });

    const override = responses[`${method} ${path}`];
    if (override) {
      return new Response(JSON.stringify(override.payload), { status: override.status });
    }

    let payload: unknown;
    if (path === '/api/admin/login') {
      payload =
        (body as { password?: string })?.password === 'right'
          ? ok({ token: 'tok-123', expiresAt: Date.now() + 1000, username: 'admin' })
          : { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '后台用户名或密码不正确' } };
    } else if (path === '/api/admin/settings' && method === 'GET') {
      payload = ok(world);
    } else if (path === '/api/admin/settings' && method === 'PUT') {
      world = { ...world, ...(body as Partial<WorldSettings>) };
      payload = ok(world);
    } else if (path === '/api/admin/stats') {
      payload = ok({
        players: { total: 1, online: 0, banned: 0, newToday: 1 },
        bots: { total: 3, byArchetype: { 'bot-sanxiu': 3 }, byRealm: [3, 0, 0, 0, 0, 0, 0, 0, 0] },
        activity: {
          battlesToday: 0,
          dungeonRunsToday: 0,
          arenaMatchesToday: 0,
          breakthroughsToday: 0,
          chatMessagesToday: 0,
        },
        server: {
          startedAt: 1,
          uptimeSec: 60,
          serverTime: Date.now(),
          lastBotTickAt: Date.now() - 2000,
          version: '0.1.0',
        },
      });
    } else if (path === '/api/admin/bot-archetypes') {
      payload = ok({
        archetypes: [
          {
            id: 'bot-sanxiu',
            name: '散修',
            description: '无门无派。',
            weight: 34,
            avatarPool: ['avatar/m01'],
            params: {
              talent: 0.8,
              diligence: 0.5,
              insight: 0,
              aggression: 0.2,
              activeHours: [6, 22],
              explorePref: 'explore',
            },
          },
        ],
      });
    } else if (path === '/api/admin/invites' && method === 'GET') {
      payload = ok({ invites: [] });
    } else {
      payload = { ok: false, error: { code: 'NOT_FOUND', message: `未桩：${method} ${path}` } };
    }

    // `query` is captured only so a caller can assert on it via `calls`.
    if (query) calls[calls.length - 1]!.path = `${path}?${query}`;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

describe('admin transport', () => {
  beforeEach(() => {
    calls = [];
    responses = {};
    world = { ...DEFAULT_WORLD_SETTINGS };
    writeAdminToken(null);
    install();
  });
  afterEach(() => {
    writeAdminToken(null);
    vi.restoreAllMocks();
  });

  it('sends the operator token in x-admin-token, never as a player bearer', async () => {
    writeAdminToken('tok-123');
    await adminCall(API.admin.getSettings, {});

    const call = calls.at(-1)!;
    expect(call.headers['x-admin-token']).toBe('tok-123');
    expect(call.headers.Authorization).toBeUndefined();
  });

  it('puts a GET payload in the query string and omits empty values', async () => {
    writeAdminToken('tok-123');
    await adminCall(API.admin.stats, {});
    expect(calls.at(-1)!.path).toBe('/api/admin/stats');
  });

  it('drops the stored token when the server rejects the session', async () => {
    writeAdminToken('stale');
    responses['GET /api/admin/settings'] = {
      status: 401,
      payload: { ok: false, error: { code: 'ADMIN_UNAUTHORIZED', message: '后台身份未通过校验' } },
    };

    await expect(adminCall(API.admin.getSettings, {})).rejects.toBeInstanceOf(ApiError);
    expect(readAdminToken()).toBeNull();
  });

  it('keeps the token for an ordinary failure', async () => {
    writeAdminToken('tok-123');
    responses['GET /api/admin/settings'] = {
      status: 400,
      payload: { ok: false, error: { code: 'INVALID_SETTINGS', message: '不合法' } },
    };

    await expect(adminCall(API.admin.getSettings, {})).rejects.toMatchObject({
      code: 'INVALID_SETTINGS',
    });
    expect(readAdminToken()).toBe('tok-123');
  });
});

describe('admin panel', () => {
  beforeEach(() => {
    calls = [];
    responses = {};
    world = { ...DEFAULT_WORLD_SETTINGS };
    writeAdminToken(null);
    install();
  });
  afterEach(() => {
    writeAdminToken(null);
    vi.restoreAllMocks();
  });

  it('gates on the admin password and reports a wrong one in place', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);

    expect(screen.getByRole('heading', { name: '道录司' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('密码'), 'nope');
    await user.click(screen.getByRole('button', { name: '入内' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('后台用户名或密码不正确');
    expect(readAdminToken()).toBeNull();
  });

  it('stores the token and shows the console once signed in', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);

    await user.type(screen.getByLabelText('密码'), 'right');
    await user.click(screen.getByRole('button', { name: '入内' }));

    expect(await screen.findByRole('navigation', { name: '后台分区' })).toBeInTheDocument();
    expect(readAdminToken()).toBe('tok-123');
  });

  it('sends only the knobs the operator actually changed', async () => {
    const user = userEvent.setup();
    writeAdminToken('tok-123');
    render(<AdminPage />);

    await user.click(await screen.findByRole('button', { name: /世界/ }));
    // The label also names the stepper buttons, so the query is pinned to the input.
    const field = await screen.findByLabelText(/每息秒数/, { selector: 'input' });
    await user.clear(field);
    await user.type(field, '45');

    // 朱批 names the pending change before it is written.
    expect(screen.getByText(/1 项待存档：每息秒数/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '存档' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.path === '/api/admin/settings');
      expect(put).toBeDefined();
      expect(put!.body).toEqual({ botTickSeconds: 45 });
    });
    expect(await screen.findByText('已存档，世界即刻生效。')).toBeInTheDocument();
  });

  it('steps a number within its declared band and stops at the edges', async () => {
    const user = userEvent.setup();
    writeAdminToken('tok-123');
    render(<AdminPage />);

    await user.click(await screen.findByRole('button', { name: /世界/ }));
    const party = await screen.findByLabelText(/队伍上限/, { selector: 'input' });
    expect(party).toHaveValue(DEFAULT_WORLD_SETTINGS.maxPartySize);

    await user.click(screen.getByRole('button', { name: '队伍上限 加 1' }));
    expect(party).toHaveValue(DEFAULT_WORLD_SETTINGS.maxPartySize + 1);

    for (let i = 0; i < 10; i += 1) {
      const plus = screen.getByRole('button', { name: '队伍上限 加 1' });
      if ((plus as HTMLButtonElement).disabled) break;
      await user.click(plus);
    }
    expect(party).toHaveValue(8);
    expect(screen.getByRole('button', { name: '队伍上限 加 1' })).toBeDisabled();
  });

  it('restores the untouched settings when 复原 is pressed', async () => {
    const user = userEvent.setup();
    writeAdminToken('tok-123');
    render(<AdminPage />);

    await user.click(await screen.findByRole('button', { name: /世界/ }));
    const announcement = screen.getByLabelText(/登录页公告/, { selector: 'textarea' });
    await user.type(announcement, '今日开服');
    expect(screen.getByText(/1 项待存档：登录页公告/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '复原' }));
    expect(announcement).toHaveValue('');
    expect(screen.getByText('尚无改动。')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
