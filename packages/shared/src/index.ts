/**
 * `@xianxia/shared` — the single contract source for the whole game.
 *
 * Both `apps/server` (Node 24) and `apps/client` (Vite/browser) import from
 * here and nothing in this package touches Node built-ins, so the same build
 * runs in both. See `docs/ARCHITECTURE.md` for how each app should wire it up.
 *
 * Modules
 *   core/        seeded RNG, small utilities, the `docs/ASSETS.md` art contract
 *   domain/      zod schemas + inferred types for every persisted entity
 *   cultivation/ realm table, attributes, lazy settle, breakthrough
 *   combat/      the deterministic battle engine
 *   zone/        the 战斗大地图 real-time simulation core (pure functions)
 *   content/     all game data (items, skills, monsters, maps, NPCs, quests, bots)
 *   protocol/    REST endpoint registry and Socket.IO typed event maps
 */

export * from './core/art.js';
export * from './core/rng.js';
export * from './core/util.js';
export * from './domain/index.js';
export * from './cultivation/index.js';
export * from './combat/index.js';
export * from './zone/index.js';
export * from './content/index.js';
export * from './protocol/index.js';
