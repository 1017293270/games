import { timingSafeEqual } from 'node:crypto';
import {
  BotArchetypeSchema,
  BotParamsSchema,
  dayKey,
  MAX_STAGE_INDEX,
  clamp,
  computeStats,
  powerScore,
  type AdminSession,
  type AdminStats,
  type BotArchetype,
  type BotSummary,
  type CharacterState,
  type WorldSettings,
  type WorldSettingsPatch,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { generateBots } from '../../engine/bots/generate.js';
import { transact } from '../../db/index.js';
import { clampExpToStage, toBotSummary } from './repo.js';

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
