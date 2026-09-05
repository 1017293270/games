import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  allEndpoints,
  API_ERROR_STATUS,
  fail,
  ok,
  type AuthLevel,
  type Endpoint,
} from '@xianxia/shared';
import type { AppContext } from '../context.js';
import { ApiError, MESSAGES } from './errors.js';
import { issueDetails, parseWithCoercion } from './validate.js';
import type { AdminIdentity, ApiHandler, HandlerContext, HandlerRegistry, UserIdentity } from './handler.js';

/**
 * Route registration.
 *
 * The server does not hand-write routes: it walks `allEndpoints()` — the same
 * table the client generates its fetch wrapper from — and looks each one up in
 * the handler registry. An endpoint with no handler yet is still registered and
 * answers `NOT_FOUND / 功能尚未开放`, so the surface is complete from day one
 * and a later module only has to add its entry to the registry.
 */

/** `:param` in the shared contract, `:param` in Fastify — same syntax. */
function fastifyPath(path: string): string {
  return path;
}

export interface RegisterResult {
  /** `group.name` of every endpoint that has a handler. */
  implemented: string[];
  /** `group.name` of every endpoint still answering 功能尚未开放. */
  pending: string[];
  total: number;
}

/** Reads the bearer token from `Authorization`, or null. */
function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Authenticates a player session. */
export function authenticateUser(ctx: AppContext, req: FastifyRequest): UserIdentity {
  const token = bearer(req);
  if (!token) throw new ApiError('UNAUTHORIZED', MESSAGES.UNAUTHORIZED);

  const session = ctx.sessions.find(token, ctx.now());
  if (!session) throw new ApiError('UNAUTHORIZED', '登录已过期，请重新登录');

  const user = ctx.users.byId(session.userId);
  if (!user) throw new ApiError('UNAUTHORIZED', MESSAGES.UNAUTHORIZED);
  if (user.banned) {
    throw new ApiError('BANNED', user.banReason ? `账号已被封禁：${user.banReason}` : MESSAGES.BANNED);
  }

  return { user, token };
}

/**
 * Authenticates an operator.
 *
 * Accepts an admin session token in either `x-admin-token` or `Authorization:
 * Bearer`, and also lets a player session belonging to an `is_admin` account
 * through, so the panel works with a single login when the operator has one.
 */
export function authenticateAdmin(ctx: AppContext, req: FastifyRequest): AdminIdentity {
  const headerToken = req.headers['x-admin-token'];
  const token = (typeof headerToken === 'string' ? headerToken : null) ?? bearer(req);
  if (!token) throw new ApiError('ADMIN_UNAUTHORIZED', MESSAGES.ADMIN_UNAUTHORIZED);

  const now = ctx.now();
  const adminSession = ctx.adminSessions.find(token, now);
  if (adminSession) return { username: adminSession.username, token };

  const session = ctx.sessions.find(token, now);
  if (session) {
    const user = ctx.users.byId(session.userId);
    if (user?.isAdmin && !user.banned) return { username: user.username, token };
  }

  throw new ApiError('ADMIN_UNAUTHORIZED', MESSAGES.ADMIN_UNAUTHORIZED);
}

function requestPayload(endpoint: Endpoint, req: FastifyRequest): unknown {
  if (endpoint.method === 'GET') {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const params = (req.params ?? {}) as Record<string, unknown>;
    return { ...params, ...query };
  }
  const body = req.body;
  // A body-less POST (`logout`, `settle`) still has to satisfy its schema,
  // which for those endpoints is the empty object.
  return body === undefined || body === null ? {} : body;
}

function sendFailure(reply: FastifyReply, error: ApiError): void {
  void reply.code(error.status).send(error.toEnvelope());
}

/** Registers every endpoint in the shared table against `handlers`. */
export function registerRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  handlers: HandlerRegistry,
): RegisterResult {
  const implemented: string[] = [];
  const pending: string[] = [];
  const endpoints = allEndpoints();

  for (const { group, name, endpoint } of endpoints) {
    const key = `${group}.${name}`;
    const impl: ApiHandler | undefined = handlers[key];
    if (impl) implemented.push(key);
    else pending.push(key);

    app.route({
      method: endpoint.method,
      url: fastifyPath(endpoint.path),
      handler: async (req, reply) => {
        try {
          const identity = resolveIdentity(ctx, req, endpoint.auth);

          if (!impl) {
            throw new ApiError('NOT_FOUND', MESSAGES.NOT_IMPLEMENTED, { endpoint: key });
          }

          const parsed = parseWithCoercion(endpoint.request, requestPayload(endpoint, req));
          if (!parsed.success) {
            throw new ApiError('VALIDATION_ERROR', MESSAGES.VALIDATION, issueDetails(parsed.error));
          }

          const handlerCtx: HandlerContext = {
            ctx,
            input: parsed.data,
            params: (req.params ?? {}) as Record<string, string>,
            req,
            reply,
            identity: identity.user,
            admin: identity.admin,
            now: ctx.now(),
            world: ctx.settings.get(),
          };

          const data = await impl(handlerCtx as HandlerContext<never>);
          if (reply.sent) return;
          return await reply.code(200).send(ok(data ?? {}));
        } catch (error) {
          if (error instanceof ApiError) {
            sendFailure(reply, error);
            return;
          }
          req.log.error({ err: error, endpoint: key }, 'handler threw');
          void reply
            .code(API_ERROR_STATUS.INTERNAL_ERROR)
            .send(fail('INTERNAL_ERROR', MESSAGES.INTERNAL));
          return;
        }
      },
    });
  }

  return { implemented, pending, total: endpoints.length };
}

function resolveIdentity(
  ctx: AppContext,
  req: FastifyRequest,
  auth: AuthLevel,
): { user: UserIdentity | null; admin: AdminIdentity | null } {
  if (auth === 'user') return { user: authenticateUser(ctx, req), admin: null };
  if (auth === 'admin') return { user: null, admin: authenticateAdmin(ctx, req) };
  return { user: null, admin: null };
}
