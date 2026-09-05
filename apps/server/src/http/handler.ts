import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { CharacterState, Endpoint, WorldSettings } from '@xianxia/shared';
import type { AppContext } from '../context.js';
import type { UserRow } from '../db/repo/users.js';

/** The authenticated caller, present on every `auth: 'user'` endpoint. */
export interface UserIdentity {
  user: UserRow;
  token: string;
}

/** The authenticated operator, present on every `auth: 'admin'` endpoint. */
export interface AdminIdentity {
  username: string;
  token: string;
}

/** What a handler is handed. */
export interface HandlerContext<Req = unknown> {
  ctx: AppContext;
  /** Validated request payload: body for writes, query for reads. */
  input: Req;
  /** Path parameters — endpoints declare these in `path`, not in `request`. */
  params: Record<string, string>;
  req: FastifyRequest;
  reply: FastifyReply;
  /** Non-null on `auth: 'user'` routes. */
  identity: UserIdentity | null;
  /** Non-null on `auth: 'admin'` routes. */
  admin: AdminIdentity | null;
  /** Epoch ms sampled once for the whole request. */
  now: number;
  /** Live world settings. */
  world: WorldSettings;
}

/**
 * A handler returns the *unwrapped* success payload; the route wrapper puts it
 * in `ok()`. Failures are thrown as `ApiError`.
 */
export type ApiHandler = (c: HandlerContext<never>) => unknown | Promise<unknown>;

/** `group.name` -> handler, e.g. `character.breakthrough`. */
export type HandlerRegistry = Record<string, ApiHandler>;

/** Builds a typed handler for one endpoint, inferring its request payload. */
export function handler<E extends Endpoint>(
  _endpoint: E,
  fn: (c: HandlerContext<z.infer<E['request']>>) => unknown | Promise<unknown>,
): ApiHandler {
  return fn as ApiHandler;
}

/** Convenience for handlers that need the caller's cultivator. */
export interface WithCharacter {
  state: CharacterState;
}
