import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiResult } from '@xianxia/shared';
import { buildApp, handlers as defaultHandlers, type BuiltApp } from '../src/app.js';
import type { HandlerRegistry } from '../src/http/handler.js';
import type { ServerConfig } from '../src/config.js';

/**
 * Test harness.
 *
 * Every file gets its own temp `DATA_DIR`, so nothing shares a SQLite file, and
 * a hand-cranked clock, so offline settlement can be exercised without waiting.
 */

export interface TestClock {
  now: () => number;
  set: (ms: number) => void;
  advance: (ms: number) => void;
}

export function makeClock(start = Date.UTC(2026, 0, 1, 12, 0, 0)): TestClock {
  let current = start;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

export interface Harness extends BuiltApp {
  clock: TestClock;
  dataDir: string;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  clock?: TestClock;
  inviteCode?: string;
  adminPassword?: string;
  startBots?: boolean;
  /** Defaults off: a test that wants the field drives `ctx.zones` by hand. */
  startZones?: boolean;
  config?: Partial<ServerConfig>;
  /** Extra handlers merged over the default registry, for modules not yet wired into app.ts. */
  handlers?: HandlerRegistry;
  /** Replaces the whole registry, for tests that need some endpoints to stay unimplemented. */
  registry?: HandlerRegistry;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const clock = options.clock ?? makeClock();
  const dataDir = mkdtempSync(join(tmpdir(), 'xianxia-server-'));

  const config: ServerConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: join(dataDir, 'game.db'),
    adminUsername: 'admin',
    adminPassword: options.adminPassword ?? 'test-admin-pass',
    inviteCode: options.inviteCode ?? 'friends',
    sessionTtlDays: 30,
    clientDist: null,
    logLevel: 'silent',
    ...options.config,
  };

  const built = buildApp({
    config,
    now: clock.now,
    startBots: options.startBots ?? false,
    startZones: options.startZones ?? false,
    handlers:
      options.registry ??
      (options.handlers ? { ...defaultHandlers, ...options.handlers } : undefined),
  });

  return {
    ...built,
    clock,
    dataDir,
    close: async () => {
      await built.app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Unwraps the shared envelope, failing loudly on an unexpected error. */
export function expectOk<T>(payload: unknown): T {
  const result = payload as ApiResult<T>;
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}

/** Asserts the call failed and returns the error for further checks. */
export function expectFail(payload: unknown): { code: string; message: string } {
  const result = payload as ApiResult<unknown>;
  if (result.ok) throw new Error(`expected failure, got ${JSON.stringify(result.data)}`);
  return result.error;
}

export interface Player {
  token: string;
  userId: string;
  characterId: string;
  name: string;
}

/** Registers an account, creates a cultivator and returns its credentials. */
export async function makePlayer(
  h: Harness,
  options: { username?: string; name?: string; inviteCode?: string } = {},
): Promise<Player> {
  const username = options.username ?? `tester${Math.floor(Math.random() * 1e9)}`;
  const name = options.name ?? `道友${Math.floor(Math.random() * 1e6)}`;

  const registered = expectOk<{ token: string; user: { id: string } }>(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username, password: 'passw0rd', inviteCode: options.inviteCode ?? 'friends' },
      })
    ).json(),
  );

  const view = expectOk<{ character: { id: string } }>(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/character',
        headers: { authorization: `Bearer ${registered.token}` },
        payload: { name, avatarArt: 'avatar/m01', gender: 'male' },
      })
    ).json(),
  );

  return {
    token: registered.token,
    userId: registered.user.id,
    characterId: view.character.id,
    name,
  };
}

/** Signs into the admin panel and returns its token. */
export async function adminToken(h: Harness, password = 'test-admin-pass'): Promise<string> {
  const session = expectOk<{ token: string }>(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: 'admin', password },
      })
    ).json(),
  );
  return session.token;
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function adminAuth(token: string): Record<string, string> {
  return { 'x-admin-token': token };
}
