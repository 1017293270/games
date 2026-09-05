import { resolve } from 'node:path';

/** Everything the process reads from the environment, resolved once at boot. */
export interface ServerConfig {
  port: number;
  host: string;
  /** Absolute path of the directory holding `game.db`. */
  dataDir: string;
  /** Absolute path of the SQLite file. */
  dbFile: string;
  adminUsername: string;
  adminPassword: string;
  /** Bootstrap invite code written to `invites` on first boot; '' disables it. */
  inviteCode: string;
  sessionTtlDays: number;
  /** Absolute path of the client build to serve, or null when not configured. */
  clientDist: string | null;
  logLevel: string;
}

/** Thrown for a missing or malformed environment variable. */
export class ConfigError extends Error {}

function num(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ConfigError(`环境变量 ${name} 不是数字：${raw}`);
  return value;
}

/** The package root, i.e. `apps/server`. `CLIENT_DIST` resolves against it. */
export const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

/**
 * Reads the environment into a `ServerConfig`.
 *
 * `ADMIN_PASSWORD` is the only required variable: without it the admin panel
 * would be unreachable, and a server nobody can tune is not worth booting.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const adminPassword = env.ADMIN_PASSWORD ?? '';
  if (adminPassword.length === 0) {
    throw new ConfigError(
      '缺少环境变量 ADMIN_PASSWORD。请在 apps/server/.env 中设置后台密码后重启' +
        '（可参考 apps/server/.env.example）。',
    );
  }

  const dataDir = resolve(PACKAGE_ROOT, env.DATA_DIR ?? './data');
  const clientDistRaw = env.CLIENT_DIST ?? '../client/dist';

  return {
    port: num(env.PORT, 3000, 'PORT'),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbFile: resolve(dataDir, 'game.db'),
    adminUsername: env.ADMIN_USERNAME ?? 'admin',
    adminPassword,
    inviteCode: env.INVITE_CODE ?? '',
    sessionTtlDays: num(env.SESSION_TTL_DAYS, 30, 'SESSION_TTL_DAYS'),
    clientDist: clientDistRaw === '' ? null : resolve(PACKAGE_ROOT, clientDistRaw),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
