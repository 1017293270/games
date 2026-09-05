import {
  buildPath,
  type ApiErrorCode,
  type ApiResult,
  type Endpoint,
  type RequestOf,
  type ResponseOf,
} from '@xianxia/shared';

/**
 * One generic fetch wrapper over the shared endpoint registry.
 *
 * `API.<group>.<name>` carries the method, the path (with `:param`
 * placeholders), and the request/response schemas, so a renamed route or a
 * changed payload is a compile error here rather than a runtime 404.
 */

/** Set to `1` to run the whole client against `src/api/mock` with no server. */
export const USE_MOCK = import.meta.env.VITE_MOCK === '1';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, details?: unknown, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type TokenSource = () => string | null;

let readToken: TokenSource = () => null;

/** The session store installs itself here so `call` can attach the bearer. */
export function setTokenSource(source: TokenSource): void {
  readToken = source;
}

export function currentToken(): string | null {
  return readToken();
}

/** Set by `src/api/mock` when `VITE_MOCK=1`; bypasses the network entirely. */
export type MockTransport = (
  endpoint: Endpoint,
  input: unknown,
  params: Record<string, string | number>,
  token: string | null,
) => Promise<ApiResult<unknown>>;

let mockTransport: MockTransport | null = null;

export function setMockTransport(transport: MockTransport | null): void {
  mockTransport = transport;
}

function queryString(input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Validates a payload against the endpoint's declared response schema.
 *
 * A mismatch is a contract bug, so it is reported in full to the console and,
 * during development, thrown. In production the raw payload is handed back
 * rather than blanking the screen over a cosmetic drift.
 */
function parseResponse<E extends Endpoint>(endpoint: E, data: unknown): ResponseOf<E> {
  const result = endpoint.response.safeParse(data);
  if (result.success) return result.data as ResponseOf<E>;

  console.error(
    `[api] ${endpoint.method} ${endpoint.path} 的响应不符合契约 schema`,
    { issues: result.error.issues, received: data },
  );
  if (import.meta.env.DEV) {
    throw new ApiError('VALIDATION_ERROR', '服务端响应与契约不符，详见控制台', result.error.issues);
  }
  return data as ResponseOf<E>;
}

/**
 * Calls one endpoint.
 *
 * `input` is the endpoint's `request` payload — the query string for `GET`,
 * the JSON body otherwise. `params` fills `:id`-style path placeholders.
 */
export async function call<E extends Endpoint>(
  endpoint: E,
  input?: RequestOf<E>,
  params: Record<string, string | number> = {},
): Promise<ResponseOf<E>> {
  const token = readToken();

  let envelope: ApiResult<unknown>;

  if (mockTransport) {
    envelope = await mockTransport(endpoint, input, params, token);
  } else {
    const isRead = endpoint.method === 'GET';
    const path = buildPath(endpoint.path, params) + (isRead ? queryString(input) : '');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
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
    envelope = json as ApiResult<unknown>;

    if (!envelope || typeof envelope !== 'object' || !('ok' in envelope)) {
      throw new ApiError('INTERNAL_ERROR', '服务器响应缺少统一信封', json, response.status);
    }
  }

  if (!envelope.ok) {
    throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.details);
  }
  return parseResponse(endpoint, envelope.data);
}

/** Human-readable text for anything thrown out of `call`. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '出了点岔子，请再试一次';
}
