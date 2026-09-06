import { z } from 'zod';
import { ART_AVATARS } from '../core/art.js';
import { PublicProfileSchema } from '../domain/character.js';
import { BattleResultSchema } from '../combat/types.js';
import { RewardBundleSchema } from './explore.js';
import { API_PREFIX, EmptySchema, endpoint, paginated, PaginationQuerySchema } from './common.js';

// ---------------------------------------------------------------- 组队 party

export const PartyMemberSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  avatarArt: z.enum(ART_AVATARS),
  stageIndex: z.number().int(),
  stageName: z.string(),
  powerScore: z.number().int(),
  online: z.boolean(),
  isLeader: z.boolean(),
  hpPercent: z.number().min(0).max(1),
});
export type PartyMember = z.infer<typeof PartyMemberSchema>;

export const PartySchema = z.object({
  id: z.string(),
  /** Six-character code friends type in to join. */
  code: z.string(),
  leaderId: z.string(),
  members: z.array(PartyMemberSchema),
  maxSize: z.number().int(),
  createdAt: z.number().int(),
});
export type Party = z.infer<typeof PartySchema>;

export const PartyStateSchema = z.object({ party: PartySchema.nullable() });

export const JoinPartyRequestSchema = z.object({ code: z.string().min(4).max(12) });
export const KickPartyRequestSchema = z.object({ characterId: z.string().min(1) });

// -------------------------------------------------------------- 好友 friends

export const FRIEND_STATES = ['pending_in', 'pending_out', 'accepted'] as const;
export const FriendStateSchema = z.enum(FRIEND_STATES);
export type FriendState = z.infer<typeof FriendStateSchema>;

export const FriendSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  avatarArt: z.enum(ART_AVATARS),
  stageIndex: z.number().int(),
  stageName: z.string(),
  powerScore: z.number().int(),
  online: z.boolean(),
  lastSeenAt: z.number().int(),
  state: FriendStateSchema,
});
export type Friend = z.infer<typeof FriendSchema>;

export const FriendListResponseSchema = z.object({ friends: z.array(FriendSchema) });
export type FriendListResponse = z.infer<typeof FriendListResponseSchema>;

export const FriendTargetRequestSchema = z.object({ characterId: z.string().min(1) });

// ------------------------------------------------------------------ 聊天 chat

export const CHAT_CHANNELS = ['world', 'party', 'system'] as const;
export const ChatChannelSchema = z.enum(CHAT_CHANNELS);
export type ChatChannel = z.infer<typeof ChatChannelSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  channel: ChatChannelSchema,
  /** null for system broadcasts. */
  senderId: z.string().nullable(),
  senderName: z.string(),
  senderStageName: z.string().nullable(),
  text: z.string().max(200),
  sentAt: z.number().int(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatHistoryQuerySchema = z.object({
  channel: ChatChannelSchema.default('world'),
  limit: z.number().int().min(1).max(200).default(50),
  /** Return only messages older than this epoch ms. */
  before: z.number().int().optional(),
  /**
   * Required for `channel: 'party'` — one party's scrollback is not another's.
   * The server answers only for a party the caller is currently in.
   */
  partyId: z.string().min(1).optional(),
});

export const ChatHistoryResponseSchema = z.object({ messages: z.array(ChatMessageSchema) });

// ------------------------------------------------------------ 论道 arena / 围攻 raid

export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;

export const ArenaOpponentSchema = PublicProfileSchema.extend({
  /** Rough odds hint shown before challenging, 0-1. */
  winHint: z.number().min(0).max(1),
});
export type ArenaOpponent = z.infer<typeof ArenaOpponentSchema>;

export const ArenaOpponentsResponseSchema = z.object({
  opponents: z.array(ArenaOpponentSchema),
  challengesToday: z.number().int().min(0),
  dailyLimit: z.number().int().min(0),
  rating: z.number().int(),
});

export type ArenaOpponentsResponse = z.infer<typeof ArenaOpponentsResponseSchema>;

export const ArenaChallengeRequestSchema = z.object({ targetId: z.string().min(1) });

export const ArenaChallengeResponseSchema = z.object({
  won: z.boolean(),
  battle: BattleResultSchema,
  ratingBefore: z.number().int(),
  ratingAfter: z.number().int(),
  reward: RewardBundleSchema,
  opponent: PublicProfileSchema,
});
export type ArenaChallengeResponse = z.infer<typeof ArenaChallengeResponseSchema>;

export const ArenaRecordSchema = z.object({
  id: z.string(),
  attackerId: z.string(),
  attackerName: z.string(),
  defenderId: z.string(),
  defenderName: z.string(),
  winnerId: z.string().nullable(),
  ratingDelta: z.number().int(),
  foughtAt: z.number().int(),
  /** Full replay, kept for a bounded window. */
  battle: BattleResultSchema.nullable(),
});
export type ArenaRecord = z.infer<typeof ArenaRecordSchema>;

export const RaidTargetSchema = PublicProfileSchema.extend({
  /** Bot's remaining 气血 share; a raided bot needs time to recover. */
  hpPercent: z.number().min(0).max(1),
  /** Epoch ms; while in the future the bot cannot be attacked. */
  protectedUntil: z.number().int(),
  /** 灵石 pool the raiders split on a win. */
  bounty: z.number().int().min(0),
});
export type RaidTarget = z.infer<typeof RaidTargetSchema>;

export const RaidTargetsResponseSchema = z.object({ targets: z.array(RaidTargetSchema) });

export type RaidTargetsResponse = z.infer<typeof RaidTargetsResponseSchema>;

export const RaidAttackRequestSchema = z.object({
  botId: z.string().min(1),
  /** Bring the whole party; everyone present shares the bounty. */
  withParty: z.boolean().default(true),
});
export type RaidAttackRequest = z.infer<typeof RaidAttackRequestSchema>;

export const RaidAttackResponseSchema = z.object({
  defeated: z.boolean(),
  battle: BattleResultSchema,
  /** Bot 气血 share left after the attack; 0 means it was brought down. */
  remainingHpPercent: z.number().min(0).max(1),
  reward: RewardBundleSchema,
  participantIds: z.array(z.string()),
  target: RaidTargetSchema,
});
export type RaidAttackResponse = z.infer<typeof RaidAttackResponseSchema>;

export const partyEndpoints = {
  get: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/party`,
    auth: 'user',
    request: EmptySchema,
    response: PartyStateSchema,
    errors: [],
    summary: '当前队伍（未组队返回 party: null）',
  }),
  create: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/party/create`,
    auth: 'user',
    request: EmptySchema,
    response: PartySchema,
    errors: ['ALREADY_IN_PARTY'],
    summary: '创建队伍，返回可分享的邀请码',
  }),
  join: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/party/join`,
    auth: 'user',
    request: JoinPartyRequestSchema,
    response: PartySchema,
    errors: ['PARTY_NOT_FOUND', 'PARTY_FULL', 'ALREADY_IN_PARTY', 'INVALID_PARTY_CODE'],
    summary: '用邀请码加入队伍',
  }),
  leave: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/party/leave`,
    auth: 'user',
    request: EmptySchema,
    response: EmptySchema,
    errors: ['NOT_IN_PARTY'],
    summary: '离开队伍（队长离开则解散或移交）',
  }),
  kick: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/party/kick`,
    auth: 'user',
    request: KickPartyRequestSchema,
    response: PartySchema,
    errors: ['NOT_IN_PARTY', 'NOT_PARTY_LEADER', 'NOT_FOUND'],
    summary: '踢出队员（仅队长）',
  }),
} as const;

export const socialEndpoints = {
  chatHistory: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/chat/history`,
    auth: 'user',
    request: ChatHistoryQuerySchema,
    response: ChatHistoryResponseSchema,
    errors: [],
    summary: '聊天回溯（实时消息走 Socket.IO）',
  }),
  friends: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/friends`,
    auth: 'user',
    request: EmptySchema,
    response: FriendListResponseSchema,
    errors: [],
    summary: '好友与待处理的申请',
  }),
  friendRequest: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/friends/request`,
    auth: 'user',
    request: FriendTargetRequestSchema,
    response: EmptySchema,
    errors: ['CHARACTER_NOT_FOUND', 'ALREADY_FRIENDS', 'FRIEND_REQUEST_EXISTS', 'FRIEND_LIMIT'],
    summary: '发送好友申请',
  }),
  friendAccept: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/friends/accept`,
    auth: 'user',
    request: FriendTargetRequestSchema,
    response: FriendListResponseSchema,
    errors: ['FRIEND_NOT_FOUND', 'FRIEND_LIMIT'],
    summary: '接受好友申请',
  }),
  friendRemove: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/friends/remove`,
    auth: 'user',
    request: FriendTargetRequestSchema,
    response: FriendListResponseSchema,
    errors: ['FRIEND_NOT_FOUND'],
    summary: '删除好友或拒绝申请',
  }),
} as const;

export const arenaEndpoints = {
  opponents: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/arena/opponents`,
    auth: 'user',
    request: EmptySchema,
    response: ArenaOpponentsResponseSchema,
    errors: [],
    summary: '论道对手列表（同境界附近的玩家与机器人）',
  }),
  challenge: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/arena/challenge`,
    auth: 'user',
    request: ArenaChallengeRequestSchema,
    response: ArenaChallengeResponseSchema,
    errors: ['DAILY_LIMIT_REACHED', 'INVALID_OPPONENT', 'SELF_CHALLENGE', 'CHARACTER_NOT_FOUND'],
    summary: '发起论道（PK）',
  }),
  records: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/arena/records`,
    auth: 'user',
    request: PaginationQuerySchema,
    response: paginated(ArenaRecordSchema),
    errors: [],
    summary: '论道战绩与回放',
  }),
} as const;

export const raidEndpoints = {
  targets: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/raid/targets`,
    auth: 'user',
    request: EmptySchema,
    response: RaidTargetsResponseSchema,
    errors: [],
    summary: '可围攻的机器人修士（带血池与保护期）',
  }),
  attack: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/raid/attack`,
    auth: 'user',
    request: RaidAttackRequestSchema,
    response: RaidAttackResponseSchema,
    errors: ['CHARACTER_NOT_FOUND', 'TARGET_NOT_BOT', 'TARGET_PROTECTED'],
    summary: '围攻机器人。队伍共享血池，打空才算击破',
  }),
} as const;
