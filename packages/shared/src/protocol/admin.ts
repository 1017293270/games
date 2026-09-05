import { z } from 'zod';
import { WorldSettingsPatchSchema, WorldSettingsSchema } from '../domain/world.js';
import { BotArchetypeSchema, BotParamsSchema } from '../domain/bot.js';
import { CharacterStateSchema, GenderSchema } from '../domain/character.js';
import { SpiritRootSchema } from '../domain/stats.js';
import { MAX_STAGE_INDEX } from '../cultivation/realms.js';
import { API_PREFIX, EmptySchema, endpoint, paginated, PaginationQuerySchema } from './common.js';

export const AdminLoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const AdminSessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.number().int(),
  username: z.string(),
});
export type AdminSession = z.infer<typeof AdminSessionSchema>;

// ------------------------------------------------------------------- 机器人

export const BotSummarySchema = z.object({
  characterId: z.string(),
  name: z.string(),
  avatarArt: z.string(),
  gender: GenderSchema,
  archetypeId: z.string().nullable(),
  archetypeName: z.string().nullable(),
  spiritRoot: SpiritRootSchema,
  stageIndex: z.number().int(),
  stageName: z.string(),
  exp: z.number(),
  powerScore: z.number().int(),
  params: BotParamsSchema,
  lastSettledAt: z.number().int(),
  arenaRating: z.number().int(),
  hpPercent: z.number(),
});
export type BotSummary = z.infer<typeof BotSummarySchema>;

export const BotListQuerySchema = PaginationQuerySchema.extend({
  archetypeId: z.string().min(1).optional(),
  q: z.string().max(20).optional(),
  sort: z.enum(['stage', 'power', 'name', 'rating']).default('stage'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const BotGenerateRequestSchema = z.object({
  count: z.number().int().min(1).max(1000),
  /** Omit to draw archetypes by their population weights. */
  archetypeId: z.string().min(1).optional(),
  /** Stage range the generated cohort starts in. */
  minStageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX).default(0),
  maxStageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX).default(11),
  /** Fixes the name/root/avatar rolls so a cohort can be reproduced. */
  seed: z.number().int().optional(),
});
export type BotGenerateRequest = z.infer<typeof BotGenerateRequestSchema>;

export const BotGenerateResponseSchema = z.object({
  created: z.number().int(),
  bots: z.array(BotSummarySchema),
});

export const BotUpdateRequestSchema = z.object({
  characterId: z.string().min(1),
  params: BotParamsSchema.partial().optional(),
  stageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX).optional(),
  exp: z.number().min(0).optional(),
  name: z.string().min(1).max(16).optional(),
  archetypeId: z.string().min(1).optional(),
});
export type BotUpdateRequest = z.infer<typeof BotUpdateRequestSchema>;

export const BotDeleteRequestSchema = z.object({ characterId: z.string().min(1) });

export const BotArchetypeUpdateRequestSchema = z.object({
  id: z.string().min(1),
  params: BotParamsSchema.partial().optional(),
  weight: z.number().positive().optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const BotArchetypeListResponseSchema = z.object({
  archetypes: z.array(BotArchetypeSchema),
});

// --------------------------------------------------------------------- 玩家

export const PlayerSummarySchema = z.object({
  userId: z.string(),
  username: z.string(),
  characterId: z.string().nullable(),
  characterName: z.string().nullable(),
  stageIndex: z.number().int().nullable(),
  stageName: z.string().nullable(),
  powerScore: z.number().int().nullable(),
  spiritStones: z.number().int().nullable(),
  banned: z.boolean(),
  isAdmin: z.boolean(),
  online: z.boolean(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
});
export type PlayerSummary = z.infer<typeof PlayerSummarySchema>;

export const PlayerListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(32).optional(),
  onlyBanned: z.boolean().optional(),
});

export const GrantRequestSchema = z.object({
  characterId: z.string().min(1),
  exp: z.number().min(0).optional(),
  spiritStones: z.number().int().optional(),
  stageIndex: z.number().int().min(0).max(MAX_STAGE_INDEX).optional(),
  items: z
    .array(z.object({ itemId: z.string().min(1), qty: z.number().int().min(1) }))
    .optional(),
});
export type GrantRequest = z.infer<typeof GrantRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(6).max(72),
});

export const BanRequestSchema = z.object({
  userId: z.string().min(1),
  banned: z.boolean(),
  reason: z.string().max(200).optional(),
});

// ------------------------------------------------------------------- 邀请码

export const InviteSchema = z.object({
  code: z.string(),
  createdAt: z.number().int(),
  createdBy: z.string(),
  usedBy: z.string().nullable(),
  usedAt: z.number().int().nullable(),
  /** null = never expires. */
  expiresAt: z.number().int().nullable(),
  note: z.string().max(100),
});
export type Invite = z.infer<typeof InviteSchema>;

export const InviteListResponseSchema = z.object({ invites: z.array(InviteSchema) });

export const InviteCreateRequestSchema = z.object({
  count: z.number().int().min(1).max(100).default(1),
  note: z.string().max(100).default(''),
  expiresAt: z.number().int().nullable().default(null),
});

export const InviteDeleteRequestSchema = z.object({ code: z.string().min(1) });

// --------------------------------------------------------------------- 统计

export const AdminStatsSchema = z.object({
  players: z.object({
    total: z.number().int(),
    online: z.number().int(),
    banned: z.number().int(),
    newToday: z.number().int(),
  }),
  bots: z.object({
    total: z.number().int(),
    byArchetype: z.record(z.string(), z.number().int()),
    /** Population per major realm, index 0-8. */
    byRealm: z.array(z.number().int()),
  }),
  activity: z.object({
    battlesToday: z.number().int(),
    dungeonRunsToday: z.number().int(),
    arenaMatchesToday: z.number().int(),
    breakthroughsToday: z.number().int(),
    chatMessagesToday: z.number().int(),
  }),
  server: z.object({
    startedAt: z.number().int(),
    uptimeSec: z.number().int(),
    serverTime: z.number().int(),
    /** Last bot tick, so the operator can see the loop is alive. */
    lastBotTickAt: z.number().int().nullable(),
    version: z.string(),
  }),
});
export type AdminStats = z.infer<typeof AdminStatsSchema>;

export const adminEndpoints = {
  login: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/login`,
    auth: 'none',
    request: AdminLoginRequestSchema,
    response: AdminSessionSchema,
    errors: ['INVALID_CREDENTIALS', 'ADMIN_UNAUTHORIZED'],
    summary: '后台登录',
  }),
  getSettings: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/settings`,
    auth: 'admin',
    request: EmptySchema,
    response: WorldSettingsSchema,
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '读取世界设置',
  }),
  putSettings: endpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/settings`,
    auth: 'admin',
    request: WorldSettingsPatchSchema,
    response: WorldSettingsSchema,
    errors: ['ADMIN_UNAUTHORIZED', 'INVALID_SETTINGS'],
    summary: '修改世界设置（部分更新，立即生效）',
  }),
  listBots: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/bots`,
    auth: 'admin',
    request: BotListQuerySchema,
    response: paginated(BotSummarySchema),
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '机器人列表',
  }),
  generateBots: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/bots/generate`,
    auth: 'admin',
    request: BotGenerateRequestSchema,
    response: BotGenerateResponseSchema,
    errors: ['ADMIN_UNAUTHORIZED', 'BOT_NOT_FOUND'],
    summary: '批量生成机器人（可指定原型、境界区间与随机种子）',
  }),
  updateBot: endpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/bots`,
    auth: 'admin',
    request: BotUpdateRequestSchema,
    response: BotSummarySchema,
    errors: ['ADMIN_UNAUTHORIZED', 'BOT_NOT_FOUND'],
    summary: '调整单个机器人的参数或境界',
  }),
  deleteBot: endpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/bots`,
    auth: 'admin',
    request: BotDeleteRequestSchema,
    response: EmptySchema,
    errors: ['ADMIN_UNAUTHORIZED', 'BOT_NOT_FOUND'],
    summary: '删除机器人',
  }),
  listBotArchetypes: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/bot-archetypes`,
    auth: 'admin',
    request: EmptySchema,
    response: BotArchetypeListResponseSchema,
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '机器人原型（天骄/苦修/散修/纨绔/魔修/隐士）',
  }),
  updateBotArchetype: endpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/bot-archetypes`,
    auth: 'admin',
    request: BotArchetypeUpdateRequestSchema,
    response: BotArchetypeListResponseSchema,
    errors: ['ADMIN_UNAUTHORIZED', 'NOT_FOUND'],
    summary: '调整原型参数（影响后续生成与全局重算）',
  }),
  listPlayers: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/players`,
    auth: 'admin',
    request: PlayerListQuerySchema,
    response: paginated(PlayerSummarySchema),
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '玩家列表',
  }),
  grant: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/players/grant`,
    auth: 'admin',
    request: GrantRequestSchema,
    response: CharacterStateSchema,
    errors: ['ADMIN_UNAUTHORIZED', 'PLAYER_NOT_FOUND', 'ITEM_NOT_FOUND'],
    summary: '给玩家发放修为 / 灵石 / 道具，或直接设置境界',
  }),
  resetPassword: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/players/reset-password`,
    auth: 'admin',
    request: ResetPasswordRequestSchema,
    response: EmptySchema,
    errors: ['ADMIN_UNAUTHORIZED', 'PLAYER_NOT_FOUND'],
    summary: '重置玩家密码',
  }),
  ban: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/players/ban`,
    auth: 'admin',
    request: BanRequestSchema,
    response: PlayerSummarySchema,
    errors: ['ADMIN_UNAUTHORIZED', 'PLAYER_NOT_FOUND'],
    summary: '封禁 / 解封玩家',
  }),
  listInvites: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    request: EmptySchema,
    response: InviteListResponseSchema,
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '邀请码列表',
  }),
  createInvites: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    request: InviteCreateRequestSchema,
    response: InviteListResponseSchema,
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '生成邀请码',
  }),
  deleteInvite: endpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/invites`,
    auth: 'admin',
    request: InviteDeleteRequestSchema,
    response: InviteListResponseSchema,
    errors: ['ADMIN_UNAUTHORIZED', 'NOT_FOUND'],
    summary: '作废邀请码',
  }),
  stats: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/stats`,
    auth: 'admin',
    request: EmptySchema,
    response: AdminStatsSchema,
    errors: ['ADMIN_UNAUTHORIZED'],
    summary: '后台总览统计',
  }),
} as const;
