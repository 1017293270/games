import { z } from 'zod';
import { CharacterViewSchema } from '../domain/character.js';
import {
  GachaPoolSchema,
  ProgressionStateSchema,
  GachaDrawResultSchema,
  GachaHistoryEntrySchema,
} from '../domain/progression.js';
import { API_PREFIX, endpoint, EmptySchema } from './common.js';
export const ProgressionDrawRequestSchema = z
  .object({
    pool: GachaPoolSchema,
    count: z.union([z.literal(1), z.literal(10)]),
    free: z.boolean().optional(),
    requestId: z.string().trim().min(1).max(100),
  })
  .refine((v) => !v.free || v.count === 1, '免费寻宝仅支持单抽');
export type ProgressionDrawRequest = z.infer<typeof ProgressionDrawRequestSchema>;
export const ProgressionEquipRequestSchema = z.object({
  uid: z.string().min(1).max(100),
  slot: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
});
export type ProgressionEquipRequest = z.infer<typeof ProgressionEquipRequestSchema>;
export const ProgressionUpgradeRequestSchema = z.object({
  kind: GachaPoolSchema,
  id: z.string().min(1).max(100),
  action: z.enum(['level', 'infuse', 'star']),
});
export type ProgressionUpgradeRequest = z.infer<typeof ProgressionUpgradeRequestSchema>;
export const ProgressionClaimRequestSchema = z.object({
  kind: z.enum(['daily', 'achievement', 'starter']),
  id: z.string().min(1).max(100),
});
export type ProgressionClaimRequest = z.infer<typeof ProgressionClaimRequestSchema>;
export const ProgressionResponseSchema = z.object({
  view: CharacterViewSchema,
  progression: ProgressionStateSchema,
  results: z.array(GachaDrawResultSchema).optional(),
});
export type ProgressionResponse = z.infer<typeof ProgressionResponseSchema>;
const errors = [
  'INSUFFICIENT_ITEMS',
  'ITEM_NOT_FOUND',
  'CONDITION_UNMET',
  'QUEST_ALREADY_CLAIMED',
] as const;
export const progressionEndpoints = {
  get: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/progression`,
    auth: 'user',
    request: EmptySchema,
    response: ProgressionResponseSchema,
    errors,
    summary: '法宝古宝与寻宝状态',
  }),
  draw: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/progression/draw`,
    auth: 'user',
    request: ProgressionDrawRequestSchema,
    response: ProgressionResponseSchema,
    errors,
    summary: '寻宝（请求幂等）',
  }),
  equip: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/progression/equip`,
    auth: 'user',
    request: ProgressionEquipRequestSchema,
    response: ProgressionResponseSchema,
    errors,
    summary: '装配本命或辅助法宝',
  }),
  upgrade: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/progression/upgrade`,
    auth: 'user',
    request: ProgressionUpgradeRequestSchema,
    response: ProgressionResponseSchema,
    errors,
    summary: '法宝古宝养成',
  }),
  claim: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/progression/claim`,
    auth: 'user',
    request: ProgressionClaimRequestSchema,
    response: ProgressionResponseSchema,
    errors,
    summary: '领取入门日常成就',
  }),
  history: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/progression/history`,
    auth: 'user',
    request: EmptySchema,
    response: z.object({ items: z.array(GachaHistoryEntrySchema) }),
    errors,
    summary: '最近百次寻宝请求',
  }),
};
