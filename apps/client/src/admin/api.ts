import {
  API,
  buildPath,
  type ApiResult,
  type Endpoint,
  type RequestOf,
  type ResponseOf,
} from '@xianxia/shared';
import { ApiError } from '../api/http';

/**
 * The console's own transport.
 *
 * Deliberately separate from `src/api/http.ts`: that wrapper attaches the
 * *player* bearer token from the session store, and an operator is not a
 * player — the two credentials must never be able to stand in for one another.
 * Everything else (the shared endpoint table, the envelope, `ApiError`) is
 * reused, so a contract change is still a compile error rather than a 404.
 */

/**
 * `sessionStorage`, not `localStorage`: an admin token that survives closing
 * the tab is a liability on a shared machine.
 */
const TOKEN_KEY = 'xianxia.admin.token';

export function readAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeAdminToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode or a blocked storage partition: the session simply lasts
    // until the next reload.
  }
}

function queryString(input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Same contract check `src/api/http.ts` runs: drift is loud in development. */
function parseResponse<E extends Endpoint>(endpoint: E, data: unknown): ResponseOf<E> {
  const result = endpoint.response.safeParse(data);
  if (result.success) return result.data as ResponseOf<E>;

  console.error(`[admin] ${endpoint.method} ${endpoint.path} 的响应不符合契约 schema`, {
    issues: result.error.issues,
    received: data,
  });
  if (import.meta.env.DEV) {
    throw new ApiError('VALIDATION_ERROR', '服务端响应与契约不符，详见控制台', result.error.issues);
  }
  return data as ResponseOf<E>;
}

/**
 * Calls one `auth: 'admin'` endpoint.
 *
 * An `ADMIN_UNAUTHORIZED` answer clears the stored token on the way out, so an
 * expired session lands the operator back on the sign-in card instead of
 * leaving a dead panel that fails one request at a time.
 */
export async function adminCall<E extends Endpoint>(
  endpoint: E,
  input?: RequestOf<E>,
): Promise<ResponseOf<E>> {
  const token = readAdminToken();
  const isRead = endpoint.method === 'GET';
  const path = buildPath(endpoint.path) + (isRead ? queryString(input) : '');

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['x-admin-token'] = token;
  if (!isRead) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method: endpoint.method,
      headers,
      body: isRead ? undefined : JSON.stringify(input ?? {}),
    });
  } catch (cause) {
    throw new ApiError('INTERNAL_ERROR', '连不上服务器，请稍后再试', cause);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError('INTERNAL_ERROR', '服务器返回了无法解析的内容', null, response.status);
  }

  const envelope = json as ApiResult<unknown>;
  if (!envelope || typeof envelope !== 'object' || !('ok' in envelope)) {
    throw new ApiError('INTERNAL_ERROR', '服务器响应缺少统一信封', json, response.status);
  }

  if (!envelope.ok) {
    if (envelope.error.code === 'ADMIN_UNAUTHORIZED') writeAdminToken(null);
    throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.details);
  }
  return parseResponse(endpoint, envelope.data);
}

/** Named calls, one line each, mirroring `src/api/endpoints.ts`. */
export const adminApi = {
  login: (body: RequestOf<typeof API.admin.login>) => adminCall(API.admin.login, body),

  settings: () => adminCall(API.admin.getSettings, {}),
  saveSettings: (patch: RequestOf<typeof API.admin.putSettings>) =>
    adminCall(API.admin.putSettings, patch),

  stats: () => adminCall(API.admin.stats, {}),

  bots: (query: RequestOf<typeof API.admin.listBots>) => adminCall(API.admin.listBots, query),
  generateBots: (body: RequestOf<typeof API.admin.generateBots>) =>
    adminCall(API.admin.generateBots, body),
  updateBot: (body: RequestOf<typeof API.admin.updateBot>) => adminCall(API.admin.updateBot, body),
  deleteBot: (characterId: string) => adminCall(API.admin.deleteBot, { characterId }),

  archetypes: () => adminCall(API.admin.listBotArchetypes, {}),
  updateArchetype: (body: RequestOf<typeof API.admin.updateBotArchetype>) =>
    adminCall(API.admin.updateBotArchetype, body),

  players: (query: RequestOf<typeof API.admin.listPlayers>) =>
    adminCall(API.admin.listPlayers, query),
  grant: (body: RequestOf<typeof API.admin.grant>) => adminCall(API.admin.grant, body),
  resetPassword: (body: RequestOf<typeof API.admin.resetPassword>) =>
    adminCall(API.admin.resetPassword, body),
  ban: (body: RequestOf<typeof API.admin.ban>) => adminCall(API.admin.ban, body),

  invites: () => adminCall(API.admin.listInvites, {}),
  createInvites: (body: RequestOf<typeof API.admin.createInvites>) =>
    adminCall(API.admin.createInvites, body),
  deleteInvite: (code: string) => adminCall(API.admin.deleteInvite, { code }),
} as const;
