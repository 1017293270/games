import { z } from 'zod';
import { ART_AVATARS } from '../core/art.js';
import {
  CharacterViewSchema,
  CharacterStateSchema,
  GenderSchema,
  PublicProfileSchema,
} from '../domain/character.js';
import { StatsSchema } from '../domain/stats.js';
import { SKILL_SLOT_COUNT } from '../domain/skill.js';
import { MAX_BREAKTHROUGH_PILLS } from '../cultivation/breakthrough.js';
import { BattleResultSchema } from '../combat/types.js';
import { API_PREFIX, endpoint, EmptySchema, paginated, PaginationQuerySchema } from './common.js';

export const CreateCharacterRequestSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[\p{Script=Han}A-Za-z0-9_]+$/u, '道号只能包含汉字、字母、数字和下划线'),
  avatarArt: z.enum(ART_AVATARS),
  gender: GenderSchema,
});
export type CreateCharacterRequest = z.infer<typeof CreateCharacterRequestSchema>;

export const SettleResponseSchema = z.object({
  view: CharacterViewSchema,
  gainedExp: z.number(),
  elapsedSec: z.number(),
  creditedSec: z.number(),
  forfeitedSec: z.number(),
  stageUps: z.number().int().min(0),
  /** Stage names crossed during the window, for the "闭关归来" summary. */
  stagesPassed: z.array(z.string()),
});
export type SettleResponse = z.infer<typeof SettleResponseSchema>;

export const BreakthroughRequestSchema = z.object({
  /** 破境丹 to consume, 0-4. */
  pills: z.number().int().min(0).max(MAX_BREAKTHROUGH_PILLS).default(0),
});
export type BreakthroughRequest = z.infer<typeof BreakthroughRequestSchema>;

export const BreakthroughResponseSchema = z.object({
  success: z.boolean(),
  chance: z.number(),
  pillsUsed: z.number().int().min(0),
  fromStageIndex: z.number().int(),
  toStageIndex: z.number().int(),
  fromStageName: z.string(),
  toStageName: z.string(),
  expLost: z.number(),
  /** Present only for the 大乘·圆满 -> 渡劫 tribulation. */
  tribulation: BattleResultSchema.nullable(),
  view: CharacterViewSchema,
});
export type BreakthroughResponse = z.infer<typeof BreakthroughResponseSchema>;

export const EquipSkillsRequestSchema = z.object({
  /** Positional; `null` clears the slot. Must be exactly 4 entries. */
  slots: z.array(z.string().min(1).nullable()).length(SKILL_SLOT_COUNT),
});
export type EquipSkillsRequest = z.infer<typeof EquipSkillsRequestSchema>;

export const LearnSkillRequestSchema = z.object({ skillId: z.string().min(1) });
export const SetTechniqueRequestSchema = z.object({ techniqueId: z.string().min(1) });
export const LearnTechniqueRequestSchema = z.object({ techniqueId: z.string().min(1) });

export const CultivatorQuerySchema = PaginationQuerySchema.extend({
  /** Filter by name fragment. */
  q: z.string().max(20).optional(),
  onlyOnline: z.boolean().optional(),
});

export const RANKING_BOARDS = ['realm', 'power', 'arena'] as const;
export const RankingBoardSchema = z.enum(RANKING_BOARDS);
export type RankingBoard = z.infer<typeof RankingBoardSchema>;

export const RankingEntrySchema = z.object({
  rank: z.number().int().min(1),
  characterId: z.string(),
  name: z.string(),
  avatarArt: z.enum(ART_AVATARS),
  isBot: z.boolean(),
  stageIndex: z.number().int(),
  stageName: z.string(),
  powerScore: z.number().int(),
  arenaRating: z.number().int(),
  online: z.boolean(),
});
export type RankingEntry = z.infer<typeof RankingEntrySchema>;

export const RankingQuerySchema = PaginationQuerySchema.extend({
  board: RankingBoardSchema,
});

export const characterEndpoints = {
  create: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/character`,
    auth: 'user',
    request: CreateCharacterRequestSchema,
    response: CharacterViewSchema,
    errors: ['CHARACTER_EXISTS', 'NAME_TAKEN', 'INVALID_NAME'],
    summary: '创建角色（灵根由服务端按 70/25/5 权重随机）',
  }),
  get: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/character`,
    auth: 'user',
    request: EmptySchema,
    response: CharacterViewSchema,
    errors: ['CHARACTER_NOT_FOUND'],
    summary: '取自己的角色（服务端会先做一次懒结算）',
  }),
  settle: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/character/settle`,
    auth: 'user',
    request: EmptySchema,
    response: SettleResponseSchema,
    errors: ['CHARACTER_NOT_FOUND'],
    summary: '结算离线修为，返回本次收益明细',
  }),
  breakthrough: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/character/breakthrough`,
    auth: 'user',
    request: BreakthroughRequestSchema,
    response: BreakthroughResponseSchema,
    errors: [
      'NOT_AT_PERFECTION',
      'EXP_NOT_FULL',
      'MAX_STAGE',
      'TRIBULATION_REQUIRED',
      'INSUFFICIENT_ITEMS',
    ],
    summary: '突破大境界。大乘·圆满会先自动打一场天劫战斗',
  }),
  equipSkills: endpoint({
    method: 'PUT',
    path: `${API_PREFIX}/character/skills`,
    auth: 'user',
    request: EquipSkillsRequestSchema,
    response: CharacterViewSchema,
    errors: ['SKILL_NOT_LEARNED'],
    summary: '设置四个神通槽（按序循环释放）',
  }),
  learnSkill: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/character/skills/learn`,
    auth: 'user',
    request: LearnSkillRequestSchema,
    response: CharacterViewSchema,
    errors: ['NOT_FOUND', 'STAGE_TOO_LOW', 'INSUFFICIENT_STONES'],
    summary: '学习神通',
  }),
  setTechnique: endpoint({
    method: 'PUT',
    path: `${API_PREFIX}/character/technique`,
    auth: 'user',
    request: SetTechniqueRequestSchema,
    response: CharacterViewSchema,
    errors: ['TECHNIQUE_NOT_LEARNED'],
    summary: '切换正在修行的功法',
  }),
  learnTechnique: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/character/technique/learn`,
    auth: 'user',
    request: LearnTechniqueRequestSchema,
    response: CharacterViewSchema,
    errors: ['NOT_FOUND', 'STAGE_TOO_LOW', 'INSUFFICIENT_STONES'],
    summary: '习得功法',
  }),
  publicProfile: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/cultivators/:id`,
    auth: 'user',
    request: EmptySchema,
    response: PublicProfileSchema,
    errors: ['CHARACTER_NOT_FOUND'],
    summary: '查看任意修士（含机器人）的公开档案',
  }),
  cultivators: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/cultivators`,
    auth: 'user',
    request: CultivatorQuerySchema,
    response: paginated(PublicProfileSchema),
    errors: [],
    summary: '修士名录，支持搜索与在线筛选',
  }),
  rankings: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/rankings`,
    auth: 'user',
    request: RankingQuerySchema,
    response: paginated(RankingEntrySchema).extend({ board: RankingBoardSchema }),
    errors: [],
    summary: '排行榜：境界 / 战力 / 论道',
  }),
} as const;

export { CharacterStateSchema, CharacterViewSchema, PublicProfileSchema, StatsSchema };
