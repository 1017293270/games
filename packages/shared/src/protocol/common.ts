import { z } from 'zod';

/**
 * REST envelope and the endpoint registry primitives.
 *
 * Every `/api` response is wrapped:
 *   success -> `{ ok: true, data }`
 *   failure -> `{ ok: false, error: { code, message, details? } }`
 *
 * Endpoint declarations carry the *unwrapped* data schema; `apiResponse()`
 * builds the envelope so neither side hand-rolls it.
 */

export const API_PREFIX = '/api';

export const API_ERROR_CODES = [
  // ---- generic
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',

  // ---- auth
  'INVALID_CREDENTIALS',
  'USERNAME_TAKEN',
  'INVITE_REQUIRED',
  'INVITE_INVALID',
  'REGISTRATION_CLOSED',
  'BANNED',

  // ---- character
  'CHARACTER_EXISTS',
  'CHARACTER_NOT_FOUND',
  'NAME_TAKEN',
  'INVALID_NAME',
  'NOT_AT_PERFECTION',
  'EXP_NOT_FULL',
  'MAX_STAGE',
  'TRIBULATION_REQUIRED',
  'SKILL_NOT_LEARNED',
  'TECHNIQUE_NOT_LEARNED',
  'STAGE_TOO_LOW',

  // ---- inventory
  'ITEM_NOT_FOUND',
  'INSUFFICIENT_ITEMS',
  'NOT_EQUIPPABLE',
  'NOT_CONSUMABLE',
  'SLOT_MISMATCH',
  'INVENTORY_FULL',

  // ---- explore
  'MAP_LOCKED',
  'GATHER_COOLDOWN',
  'ENCOUNTER_NOT_ACTIVE',
  'INVALID_CHOICE',
  'CHOICE_BLOCKED',

  // ---- party
  'PARTY_FULL',
  'ALREADY_IN_PARTY',
  'NOT_IN_PARTY',
  'NOT_PARTY_LEADER',
  'PARTY_NOT_FOUND',
  'INVALID_PARTY_CODE',

  // ---- dungeon / arena / raid
  'DUNGEON_LOCKED',
  'DAILY_LIMIT_REACHED',
  'PARTY_TOO_SMALL',
  'INVALID_OPPONENT',
  'SELF_CHALLENGE',
  'TARGET_PROTECTED',
  'TARGET_NOT_BOT',

  // ---- social
  'ALREADY_FRIENDS',
  'FRIEND_REQUEST_EXISTS',
  'FRIEND_NOT_FOUND',
  'FRIEND_LIMIT',

  // ---- npc / quest / shop
  'NPC_LOCKED',
  'DIALOGUE_NOT_FOUND',
  'QUEST_NOT_AVAILABLE',
  'QUEST_NOT_ACTIVE',
  'QUEST_NOT_COMPLETE',
  'QUEST_ALREADY_CLAIMED',
  'SHOP_NOT_FOUND',
  'ITEM_NOT_SOLD_HERE',
  'INSUFFICIENT_STONES',
  'OUT_OF_STOCK',
  'CONDITION_UNMET',

  // ---- admin
  'ADMIN_UNAUTHORIZED',
  'BOT_NOT_FOUND',
  'PLAYER_NOT_FOUND',
  'INVALID_SETTINGS',
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** HTTP status each code maps to, so the server never guesses. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,

  INVALID_CREDENTIALS: 401,
  USERNAME_TAKEN: 409,
  INVITE_REQUIRED: 403,
  INVITE_INVALID: 403,
  REGISTRATION_CLOSED: 403,
  BANNED: 403,

  CHARACTER_EXISTS: 409,
  CHARACTER_NOT_FOUND: 404,
  NAME_TAKEN: 409,
  INVALID_NAME: 400,
  NOT_AT_PERFECTION: 409,
  EXP_NOT_FULL: 409,
  MAX_STAGE: 409,
  TRIBULATION_REQUIRED: 409,
  SKILL_NOT_LEARNED: 409,
  TECHNIQUE_NOT_LEARNED: 409,
  STAGE_TOO_LOW: 409,

  ITEM_NOT_FOUND: 404,
  INSUFFICIENT_ITEMS: 409,
  NOT_EQUIPPABLE: 400,
  NOT_CONSUMABLE: 400,
  SLOT_MISMATCH: 400,
  INVENTORY_FULL: 409,

  MAP_LOCKED: 403,
  GATHER_COOLDOWN: 429,
  ENCOUNTER_NOT_ACTIVE: 409,
  INVALID_CHOICE: 400,
  CHOICE_BLOCKED: 403,

  PARTY_FULL: 409,
  ALREADY_IN_PARTY: 409,
  NOT_IN_PARTY: 409,
  NOT_PARTY_LEADER: 403,
  PARTY_NOT_FOUND: 404,
  INVALID_PARTY_CODE: 400,

  DUNGEON_LOCKED: 403,
  DAILY_LIMIT_REACHED: 429,
  PARTY_TOO_SMALL: 409,
  INVALID_OPPONENT: 400,
  SELF_CHALLENGE: 400,
  TARGET_PROTECTED: 409,
  TARGET_NOT_BOT: 400,

  ALREADY_FRIENDS: 409,
  FRIEND_REQUEST_EXISTS: 409,
  FRIEND_NOT_FOUND: 404,
  FRIEND_LIMIT: 409,

  NPC_LOCKED: 403,
  DIALOGUE_NOT_FOUND: 404,
  QUEST_NOT_AVAILABLE: 409,
  QUEST_NOT_ACTIVE: 409,
  QUEST_NOT_COMPLETE: 409,
  QUEST_ALREADY_CLAIMED: 409,
  SHOP_NOT_FOUND: 404,
  ITEM_NOT_SOLD_HERE: 400,
  INSUFFICIENT_STONES: 409,
  OUT_OF_STOCK: 409,
  CONDITION_UNMET: 403,

  ADMIN_UNAUTHORIZED: 401,
  BOT_NOT_FOUND: 404,
  PLAYER_NOT_FOUND: 404,
  INVALID_SETTINGS: 400,
};

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  /** Human-readable, already localised to zh-CN by the server. */
  message: z.string(),
  /** Field-level detail for `VALIDATION_ERROR`. */
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiFailureSchema = z.object({ ok: z.literal(false), error: ApiErrorSchema });
export type ApiFailure = z.infer<typeof ApiFailureSchema>;

/** Wraps a data schema in the success envelope. */
export function apiSuccess<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

/** The full `{ok:true,data} | {ok:false,error}` union for a data schema. */
export function apiResponse<T extends z.ZodType>(data: T) {
  return z.union([apiSuccess(data), ApiFailureSchema]);
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/** Empty success payload for endpoints that only signal completion. */
export const EmptySchema = z.object({});
export type Empty = z.infer<typeof EmptySchema>;

export const PaginationQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Wraps an item schema in a page envelope. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    hasMore: z.boolean(),
  });
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Who may call an endpoint. */
export const AUTH_LEVELS = ['none', 'user', 'admin'] as const;
export type AuthLevel = (typeof AUTH_LEVELS)[number];

/**
 * One REST endpoint. `request` describes the body for POST/PUT/DELETE and the
 * query string (plus path params) for GET; `response` is the *unwrapped*
 * success payload.
 */
export interface Endpoint<
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  readonly method: HttpMethod;
  /** Full path including `/api`, with `:param` placeholders. */
  readonly path: string;
  readonly auth: AuthLevel;
  readonly request: Req;
  readonly response: Res;
  /** Failure codes this endpoint may return, beyond the generic ones. */
  readonly errors: readonly ApiErrorCode[];
  readonly summary: string;
}

/** Identity helper that pins the generic parameters for inference. */
export function endpoint<Req extends z.ZodType, Res extends z.ZodType>(
  def: Endpoint<Req, Res>,
): Endpoint<Req, Res> {
  return def;
}

export type RequestOf<E> = E extends Endpoint<infer Req, z.ZodType> ? z.infer<Req> : never;
export type ResponseOf<E> = E extends Endpoint<z.ZodType, infer Res> ? z.infer<Res> : never;

/** Fills `:param` placeholders in an endpoint path. */
export function buildPath(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`buildPath: missing param "${key}" for ${path}`);
    return encodeURIComponent(String(value));
  });
}

/** Convenience constructors for the envelope, used by the server. */
export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(code: ApiErrorCode, message: string, details?: unknown): ApiFailure {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } };
}
