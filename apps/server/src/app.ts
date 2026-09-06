import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, fail } from '@xianxia/shared';
import { openDatabase } from './db/index.js';
import { createContext, type AppContext } from './context.js';
import { loadConfig, PACKAGE_ROOT, type ServerConfig } from './config.js';
import { registerRoutes, type RegisterResult } from './http/routes.js';
import { MESSAGES } from './http/errors.js';
import type { HandlerRegistry } from './http/handler.js';
import { ensureBootstrapInvite } from './modules/auth/repo.js';

// ---- handler registry: one line per module. Later modules add a line here.
import { authHandlers } from './modules/auth/routes.js';
import { characterHandlers } from './modules/character/routes.js';
import { inventoryHandlers } from './modules/inventory/routes.js';
import { exploreHandlers } from './modules/explore/routes.js';
import { socialHandlers } from './modules/social/routes.js';
import { adminHandlers } from './modules/admin/routes.js';
import { partyHandlers } from './modules/party/routes.js';
import { dungeonHandlers } from './modules/dungeon/routes.js';
import { arenaHandlers } from './modules/arena/routes.js';
import { raidHandlers } from './modules/raid/routes.js';
import { friendHandlers } from './modules/friend/routes.js';
import { npcHandlers } from './modules/npc/routes.js';
import { questHandlers } from './modules/quest/routes.js';
import { shopHandlers } from './modules/shop/routes.js';

/** Every implemented endpoint, keyed `group.name`. */
export const handlers: HandlerRegistry = {
  ...authHandlers,
  ...characterHandlers,
  ...inventoryHandlers,
  ...exploreHandlers,
  ...socialHandlers,
  ...adminHandlers,
  ...partyHandlers,
  ...dungeonHandlers,
  ...arenaHandlers,
  ...raidHandlers,
  ...friendHandlers,
  ...npcHandlers,
  ...questHandlers,
  ...shopHandlers,
};

export interface BuildAppOptions {
  config?: ServerConfig;
  /** Injectable clock; tests advance it to exercise offline settlement. */
  now?: () => number;
  /** Skips the bot timer. Tests tick by hand. */
  startBots?: boolean;
  /** Skips the 战斗大地图 timers. Tests call `step` / `flush` by hand. */
  startZones?: boolean;
  /** Replaces the default registry; module tests merge their own handlers over `handlers`. */
  handlers?: HandlerRegistry;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  routes: RegisterResult;
}

function packageVersion(): string {
  try {
    const raw = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8');
    return String((JSON.parse(raw) as { version?: string }).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/**
 * What a request looks like in the log.
 *
 * pino's default `req` serializer reports `req.socket.remoteAddress`, which
 * behind Caddy or a Docker network is the gateway on every line. `trustProxy`
 * below makes `req.ip` the first address in `X-Forwarded-For`, so that is the
 * one logged; without a proxy it is still the peer address.
 */
export function serializeRequest(req: FastifyRequest): {
  method: string;
  url: string;
  ip: string;
} {
  return { method: req.method, url: req.url, ip: req.ip };
}

/** True when the request should never fall through to the SPA shell. */
function isApiPath(url: string): boolean {
  return url.startsWith(API_PREFIX) || url.startsWith('/socket.io');
}

/**
 * Builds the whole server: database, context, routes, static hosting.
 *
 * Socket.IO is *not* attached here — it needs a listening HTTP server, so
 * `startServer` attaches it after `app.ready()`. Under `app.inject()` there is
 * no socket at all and every realtime emit is a no-op, which is what lets the
 * REST tests run without a port.
 */
export function buildApp(options: BuildAppOptions = {}): BuiltApp {
  const config = options.config ?? loadConfig();
  const now = options.now ?? (() => Date.now());

  const db = openDatabase(config.dbFile);
  const ctx = createContext({ config, db, now, version: packageVersion() });

  ctx.archetypes.seedIfEmpty(now());
  ensureBootstrapInvite(ctx, config.inviteCode, now());
  ctx.sessions.purgeExpired(now());

  const app = Fastify({
    logger: { level: config.logLevel, serializers: { req: serializeRequest } },
    // Trusting the proxy keeps client IPs honest behind nginx/Caddy, which is
    // how this is meant to be deployed.
    trustProxy: true,
    bodyLimit: 1024 * 512,
  });

  void app.register(cors, { origin: true, credentials: true });

  // ---- REST: every endpoint in the shared table, implemented or not
  const routes = registerRoutes(app, ctx, options.handlers ?? handlers);

  // ---- static client, when a build is present
  const clientDist = config.clientDist;
  const hasClient = clientDist !== null && existsSync(join(clientDist, 'index.html'));
  if (hasClient && clientDist) {
    void app.register(fastifyStatic, { root: clientDist, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (isApiPath(req.url) || !hasClient || clientDist === null || req.method !== 'GET') {
      void reply.code(404).send(fail('NOT_FOUND', `没有这个接口：${req.method} ${req.url}`));
      return;
    }
    // SPA fallback: any other GET renders the shell and the router takes over.
    void reply.type('text/html').send(readFileSync(join(clientDist, 'index.html')));
  });

  app.addHook('onClose', () => {
    ctx.bots.stop();
    // Stops the timers and banks every unflushed 战斗大地图 reward, so this has
    // to run while the database is still open.
    ctx.zones.stop();
    ctx.realtime.detach();
    db.close();
  });

  if (options.startBots ?? true) ctx.bots.start();
  if (options.startZones ?? true) ctx.zones.start();

  return { app, ctx, routes };
}

/** Log line listing the endpoints that still answer 功能尚未开放. */
export function pendingEndpointsBanner(routes: RegisterResult): string {
  const lines = [
    `已实现端点 ${routes.implemented.length} / ${routes.total}，` +
      `未实现 ${routes.pending.length} 个（调用将返回 NOT_FOUND / ${MESSAGES.NOT_IMPLEMENTED}）：`,
  ];
  for (const key of routes.pending) lines.push(`  · ${key}`);
  return lines.join('\n');
}
