import { timingSafeEqual } from 'node:crypto';
import {
  BotArchetypeSchema,
  BotParamsSchema,
  dayKey,
  ITEM_BY_ID,
  MAX_STAGE_INDEX,
  ROOMS,
  clamp,
  computeStats,
  powerScore,
  type AdminSession,
  type AdminStats,
  type BotArchetype,
  type BotSummary,
  type CharacterState,
  type Invite,
  type PlayerSummary,
  type WorldSettings,
  type WorldSettingsPatch,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { generateBots } from '../../engine/bots/generate.js';
import { transact } from '../../db/index.js';
import { newInviteCode } from '../../db/repo/invites.js';
import { resolveEquipment, settle, withFreshPower } from '../../game/character.js';
import {
  addExp,
  clampExpToStage,
  playerPage,
  playerSummaryOf,
  toBotSummary,
  toInviteView,
  type PlayerPageQuery,
} from './repo.js';

/** 后台. World tuning, the bot population and the dashboard. */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Signs an operator in.
 *
 * The credentials come from the environment (`ADMIN_USERNAME` /
 * `ADMIN_PASSWORD`) rather than the `users` table, so a fresh server has a
 * reachable panel before anybody has registered.
 */
export function adminLogin(
  ctx: AppContext,
  input: { username: string; password: string },
  now: number,
): AdminSession {
  const okUser = constantTimeEquals(input.username, ctx.config.adminUsername);
  const okPass = constantTimeEquals(input.password, ctx.config.adminPassword);
  if (!okUser || !okPass) {
    throw new ApiError('INVALID_CREDENTIALS', '后台用户名或密码不正确');
  }

  ctx.adminSessions.purgeExpired(now);
  const session = ctx.adminSessions.create(input.username, now, ctx.config.sessionTtlDays);
  return { token: session.token, expiresAt: session.expiresAt, username: input.username };
}

/** Applies a partial world-settings update. Takes effect immediately. */
export function putSettings(
  ctx: AppContext,
  patch: WorldSettingsPatch,
): WorldSettings {
  try {
    return ctx.settings.patch(patch);
  } catch (error) {
    throw new ApiError('INVALID_SETTINGS', `世界设置不合法：${(error as Error).message}`);
  }
}

export function createBots(
  ctx: AppContext,
  input: {
    count: number;
    archetypeId?: string;
    minStageIndex: number;
    maxStageIndex: number;
    seed?: number;
  },
  now: number,
): { created: number; bots: BotSummary[] } {
  if (input.archetypeId && !ctx.archetypes.byId(input.archetypeId)) {
    throw new ApiError('BOT_NOT_FOUND', `没有这个机器人原型：${input.archetypeId}`);
  }

  const options: Parameters<typeof generateBots>[1] = {
    count: input.count,
    minStageIndex: input.minStageIndex,
    maxStageIndex: input.maxStageIndex,
  };
  if (input.archetypeId) options.archetypeId = input.archetypeId;
  if (input.seed !== undefined) options.seed = input.seed;

  const created = transact(ctx.db, () => generateBots(ctx, options, now));
  const names = new Map(ctx.archetypes.all().map((a) => [a.id, a.name]));
  return { created: created.length, bots: created.map((b) => toBotSummary(ctx, b, names)) };
}

/** Retunes one bot: parameters, 境界, 修为, 道号 or archetype. */
export function updateBot(
  ctx: AppContext,
  input: {
    characterId: string;
    params?: Partial<CharacterState['botParams'] & object>;
    stageIndex?: number;
    exp?: number;
    name?: string;
    archetypeId?: string;
  },
  now: number,
): BotSummary {
  const state = ctx.characters.byId(input.characterId);
  if (!state || !state.isBot) throw new ApiError('BOT_NOT_FOUND', '没有这个机器人');

  let next: CharacterState = { ...state };

  if (input.params) {
    const merged = BotParamsSchema.safeParse({ ...state.botParams, ...input.params });
    if (!merged.success) {
      throw new ApiError('INVALID_SETTINGS', '机器人参数不合法', merged.error.issues);
    }
    next = { ...next, botParams: merged.data };
  }

  if (input.archetypeId !== undefined) {
    const archetype = ctx.archetypes.byId(input.archetypeId);
    if (!archetype) throw new ApiError('BOT_NOT_FOUND', '没有这个机器人原型');
    next = { ...next, botArchetypeId: archetype.id };
    // Switching archetype without an explicit params block adopts its template.
    if (!input.params) next = { ...next, botParams: { ...archetype.params } };
  }

  if (input.name !== undefined && input.name !== state.name) {
    if (ctx.characters.nameTaken(input.name)) {
      throw new ApiError('NAME_TAKEN', '这个道号已经有人用了');
    }
    next = { ...next, name: input.name };
  }

  if (input.stageIndex !== undefined) {
    const stageIndex = clamp(Math.round(input.stageIndex), 0, MAX_STAGE_INDEX);
    next = { ...next, stageIndex, exp: clampExpToStage(stageIndex, next.exp) };
  }

  if (input.exp !== undefined) {
    next = { ...next, exp: clampExpToStage(next.stageIndex, input.exp) };
  }

  next = {
    ...next,
    lastSettledAt: now,
    powerScore: powerScore(computeStats({ stageIndex: next.stageIndex, technique: null })),
  };

  ctx.characters.save(next);
  const names = new Map(ctx.archetypes.all().map((a) => [a.id, a.name]));
  return toBotSummary(ctx, next, names);
}

export function deleteBot(ctx: AppContext, characterId: string): void {
  const state = ctx.characters.byId(characterId);
  if (!state || !state.isBot) throw new ApiError('BOT_NOT_FOUND', '没有这个机器人');
  transact(ctx.db, () => {
    ctx.inventory.removeAllFor(characterId);
    ctx.characters.remove(characterId);
  });
}

/** Edits an archetype template; affects generation from the next bot on. */
export function updateArchetype(
  ctx: AppContext,
  input: {
    id: string;
    params?: Partial<BotArchetype['params']>;
    weight?: number;
    name?: string;
    description?: string;
  },
  now: number,
): BotArchetype[] {
  const current = ctx.archetypes.byId(input.id);
  if (!current) throw new ApiError('NOT_FOUND', '没有这个机器人原型');

  const candidate = {
    ...current,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
    params: { ...current.params, ...input.params },
  };

  const parsed = BotArchetypeSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError('INVALID_SETTINGS', '原型参数不合法', parsed.error.issues);
  }

  ctx.archetypes.upsert(parsed.data, now);
  return ctx.archetypes.all();
}

/** The dashboard. */
export function stats(ctx: AppContext, now: number): AdminStats {
  const startOfDay = Date.parse(`${dayKey(now)}T00:00:00.000Z`);

  return {
    players: {
      total: ctx.users.count(),
      online: ctx.presence.count,
      banned: ctx.users.countBanned(),
      newToday: ctx.users.countCreatedSince(startOfDay),
    },
    bots: {
      total: ctx.characters.countBots(),
      byArchetype: ctx.characters.botsByArchetype(),
      byRealm: ctx.characters.botsByRealm(),
    },
    activity: {
      battlesToday: ctx.counters.get('battles', now),
      dungeonRunsToday: ctx.counters.get('dungeons', now),
      arenaMatchesToday: ctx.counters.get('arena', now),
      breakthroughsToday: ctx.counters.get('breakthroughs', now),
      chatMessagesToday: ctx.counters.get('chat', now),
    },
    server: {
      startedAt: ctx.startedAt,
      uptimeSec: Math.max(0, Math.round((now - ctx.startedAt) / 1000)),
      serverTime: now,
      lastBotTickAt: ctx.bots.lastTickAt,
      version: ctx.version,
    },
  };
}

/* ------------------------------------------------------------------- 玩家 */

export function listPlayers(
  ctx: AppContext,
  query: { page: number; pageSize: number; q?: string; onlyBanned?: boolean },
): { items: PlayerSummary[]; page: number; pageSize: number; total: number; hasMore: boolean } {
  const options: PlayerPageQuery = { page: query.page, pageSize: query.pageSize };
  if (query.q !== undefined) options.q = query.q;
  if (query.onlyBanned !== undefined) options.onlyBanned = query.onlyBanned;

  const { items, total } = playerPage(ctx, options);
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    hasMore: query.page * query.pageSize < total,
  };
}

/**
 * Hands a cultivator 修为 / 灵石 / 道具, or moves them to a stage outright.
 *
 * Everything is applied in one transaction and the owner is pushed the new
 * numbers, so a player watching the cultivation screen sees the grant land
 * without a reload. Bots are accepted too — a granted item is inert for them,
 * but 修为 and 境界 are the same fields the bot tick reads.
 */
export function grant(
  ctx: AppContext,
  input: {
    characterId: string;
    exp?: number;
    spiritStones?: number;
    stageIndex?: number;
    items?: { itemId: string; qty: number }[];
  },
  now: number,
): CharacterState {
  const stored = ctx.characters.byId(input.characterId);
  if (!stored) throw new ApiError('PLAYER_NOT_FOUND', '没有这个角色');

  for (const entry of input.items ?? []) {
    if (!ITEM_BY_ID.has(entry.itemId)) {
      throw new ApiError('ITEM_NOT_FOUND', `没有这件物品：${entry.itemId}`);
    }
  }

  // The stored row is only settled up to its own `lastSettledAt`, and the save
  // below stamps `now`. Settling first means an offline cultivator keeps the
  // 修为 earned since their last read instead of having it overwritten by the
  // grant. `settle` is what moves `lastSettledAt` to `now` (ARCHITECTURE §8).
  const state = settle(stored, ctx.settings.get(), now).character;

  let next: CharacterState = { ...state };

  // 境界 is set first so a 修为 grant in the same call fills the *target* stage.
  if (input.stageIndex !== undefined) {
    const stageIndex = clamp(Math.round(input.stageIndex), 0, MAX_STAGE_INDEX);
    next = { ...next, stageIndex, exp: clampExpToStage(stageIndex, next.exp) };
  }

  if (input.exp !== undefined && input.exp > 0) {
    const rolled = addExp(next.stageIndex, next.exp, input.exp);
    next = { ...next, stageIndex: rolled.stageIndex, exp: rolled.exp };
  }

  if (input.spiritStones !== undefined && input.spiritStones !== 0) {
    next = { ...next, spiritStones: Math.max(0, next.spiritStones + input.spiritStones) };
  }

  transact(ctx.db, () => {
    for (const entry of input.items ?? []) {
      ctx.inventory.add(next.id, entry.itemId, entry.qty);
    }
    next = withFreshPower(next, resolveEquipment(next, ctx.inventory));
    ctx.characters.save(next);
  });

  ctx.realtime.characterUpdate(next);
  return next;
}

/**
 * Sets a new password and drops every session the account holds, so a
 * compromised token cannot outlive the reset.
 */
export function resetPassword(
  ctx: AppContext,
  input: { userId: string; newPassword: string },
): void {
  const user = ctx.users.byId(input.userId);
  if (!user) throw new ApiError('PLAYER_NOT_FOUND', '没有这个账号');

  transact(ctx.db, () => {
    ctx.users.setPassword(user.id, input.newPassword);
    ctx.sessions.removeForUser(user.id);
  });
}

/**
 * Bans or unbans an account.
 *
 * A ban is immediate: the sessions are deleted, so the next REST call answers
 * `BANNED`, and any live socket is cut so the player does not keep receiving
 * world events on a token that no longer resolves.
 */
export function setBanned(
  ctx: AppContext,
  input: { userId: string; banned: boolean; reason?: string },
): PlayerSummary {
  const user = ctx.users.byId(input.userId);
  if (!user) throw new ApiError('PLAYER_NOT_FOUND', '没有这个账号');

  const reason = input.banned ? (input.reason ?? '') : '';
  transact(ctx.db, () => {
    ctx.users.setBanned(user.id, input.banned, reason);
    if (input.banned) ctx.sessions.removeForUser(user.id);
  });

  if (input.banned) {
    const character = ctx.characters.byUserId(user.id);
    if (character) {
      ctx.realtime.server?.in(ROOMS.character(character.id)).disconnectSockets(true);
    }
  }

  return playerSummaryOf(ctx, { ...user, banned: input.banned, banReason: reason });
}

/* ----------------------------------------------------------------- 邀请码 */

export function listInvites(ctx: AppContext): Invite[] {
  return ctx.invites.list().map(toInviteView);
}

/** Mints `count` single-use codes, stamped with the operator who asked. */
export function createInvites(
  ctx: AppContext,
  input: { count: number; note: string; expiresAt: number | null },
  createdBy: string,
  now: number,
): Invite[] {
  transact(ctx.db, () => {
    for (let i = 0; i < input.count; i += 1) {
      // A six-character code has 29^6 values; a collision is still cheaper to
      // retry than to explain, so the loop redraws until the code is free.
      let code = newInviteCode();
      for (let attempt = 0; attempt < 8 && ctx.invites.find(code) !== null; attempt += 1) {
        code = newInviteCode();
      }
      ctx.invites.create(code, now, {
        createdBy,
        note: input.note,
        expiresAt: input.expiresAt,
        maxUses: 1,
      });
    }
  });
  return listInvites(ctx);
}

export function deleteInvite(ctx: AppContext, code: string): Invite[] {
  if (!ctx.invites.remove(code)) throw new ApiError('NOT_FOUND', '没有这个邀请码');
  return listInvites(ctx);
}
