/**
 * Socket.IO contract.
 *
 * The two event maps plug straight into the Socket.IO generics:
 *
 *   server: `new Server<ClientToServerEvents, ServerToClientEvents>(httpServer)`
 *   client: `io<ServerToClientEvents, ClientToServerEvents>(url, { auth: { token } })`
 *
 * Note the deliberate order swap — Socket.IO's `Socket` type takes
 * `<Listen, Emit>`, so the server listens to C2S and the client listens to S2C.
 *
 * Handshake: `{ auth: { token } }`, the same token `POST /api/auth/login`
 * returned. A socket with an invalid token is disconnected immediately.
 */

import { z } from 'zod';
import { ART_AVATARS } from '../core/art.js';
import { CharacterStateSchema } from '../domain/character.js';
import { BattleResultSchema } from '../combat/types.js';
import { DungeonWaveSchema } from './explore.js';
import { ChatChannelSchema, ChatMessageSchema, PartySchema } from './social.js';
import {
  ZoneEnterSchema,
  type ZoneDeathSchema,
  type ZoneErrorSchema,
  type ZoneFrameSchema,
  type ZoneJoinedSchema,
  type ZoneLeftSchema,
  type ZoneLootSchema,
} from './zone.js';

export const HandshakeAuthSchema = z.object({ token: z.string().min(1) });
export type HandshakeAuth = z.infer<typeof HandshakeAuthSchema>;

// ------------------------------------------------------------- client -> server

export const ChatSendSchema = z.object({
  channel: z.enum(['world', 'party']),
  text: z.string().min(1).max(200),
});
export type ChatSend = z.infer<typeof ChatSendSchema>;

// ------------------------------------------------------------- server -> client

export const PresenceUpdateSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  online: z.boolean(),
  /** Total online cultivators, for the header count. */
  onlineCount: z.number().int().min(0),
});
export type PresenceUpdate = z.infer<typeof PresenceUpdateSchema>;

/**
 * Incremental character patch. Only the changed fields are sent; the client
 * merges into its store. `stageIndex`/`exp` arrive on every settle tick.
 */
export const CharacterUpdateSchema = CharacterStateSchema.partial().extend({
  id: z.string().min(1),
  /** Recomputed 战力, present whenever stats changed. */
  powerScore: z.number().int().optional(),
  stageName: z.string().optional(),
});
export type CharacterUpdate = z.infer<typeof CharacterUpdateSchema>;

export const PartyUpdateSchema = z.object({
  party: PartySchema.nullable(),
  /** Why the party changed, for a toast. */
  reason: z.enum(['joined', 'left', 'kicked', 'disbanded', 'leader_changed', 'sync']),
  /** Who triggered it. */
  actorName: z.string().nullable(),
});
export type PartyUpdate = z.infer<typeof PartyUpdateSchema>;

export const DungeonStartEventSchema = z.object({
  dungeonId: z.string(),
  dungeonName: z.string(),
  partyMemberIds: z.array(z.string()),
  startedAt: z.number().int(),
});
export type DungeonStartEvent = z.infer<typeof DungeonStartEventSchema>;

export const DungeonResultEventSchema = z.object({
  dungeonId: z.string(),
  dungeonName: z.string(),
  cleared: z.boolean(),
  /** Wave-by-wave replays, boss last. */
  replay: z.array(BattleResultSchema),
  /** What stood in each wave, same length and order as `replay`. */
  waves: z.array(DungeonWaveSchema),
  reward: z.object({
    exp: z.number().int().min(0),
    spiritStones: z.number().int().min(0),
    items: z.array(z.object({ itemId: z.string(), qty: z.number().int(), name: z.string() })),
  }),
  participantIds: z.array(z.string()),
});
export type DungeonResultEvent = z.infer<typeof DungeonResultEventSchema>;

export const ArenaChallengedEventSchema = z.object({
  attackerId: z.string(),
  attackerName: z.string(),
  attackerStageName: z.string(),
  attackerAvatarArt: z.enum(ART_AVATARS),
  /** True when the defender lost. */
  defenderLost: z.boolean(),
  ratingDelta: z.number().int(),
  battle: BattleResultSchema,
  foughtAt: z.number().int(),
});
export type ArenaChallengedEvent = z.infer<typeof ArenaChallengedEventSchema>;

export const RaidUpdateEventSchema = z.object({
  botId: z.string(),
  botName: z.string(),
  hpPercent: z.number().min(0).max(1),
  /** Damage the latest wave of raiders did. */
  lastDamage: z.number().min(0),
  attackerNames: z.array(z.string()),
  defeated: z.boolean(),
  protectedUntil: z.number().int(),
});
export type RaidUpdateEvent = z.infer<typeof RaidUpdateEventSchema>;

export const SYSTEM_NOTICE_KINDS = [
  'breakthrough',
  'boss_slain',
  'announcement',
  'server',
  'rare_drop',
] as const;
export const SystemNoticeKindSchema = z.enum(SYSTEM_NOTICE_KINDS);
export type SystemNoticeKind = z.infer<typeof SystemNoticeKindSchema>;

export const SystemNoticeSchema = z.object({
  kind: SystemNoticeKindSchema,
  /** Pre-rendered zh-CN line, e.g. 「李清子 突破至 金丹·前期」. */
  text: z.string(),
  /** Subject of the notice, when there is one. */
  characterId: z.string().nullable(),
  at: z.number().int(),
});
export type SystemNotice = z.infer<typeof SystemNoticeSchema>;

export const FriendRequestEventSchema = z.object({
  fromCharacterId: z.string(),
  fromName: z.string(),
  fromStageName: z.string(),
  at: z.number().int(),
});
export type FriendRequestEvent = z.infer<typeof FriendRequestEventSchema>;

/** Events the client may emit. */
export interface ClientToServerEvents {
  'chat:send': (payload: ChatSend) => void;
  'presence:ping': () => void;
  /** Walk into a 战斗大地图; `zoneId: null` resumes the current one. */
  'zone:enter': (payload: z.infer<typeof ZoneEnterSchema>) => void;
  /** Stop watching. The character stays on the field and keeps farming. */
  'zone:leave': () => void;
  /** Leave the field for good, banking whatever was earned. */
  'zone:retreat': () => void;
}

/** Events the server may emit. */
export interface ServerToClientEvents {
  'chat:message': (payload: z.infer<typeof ChatMessageSchema>) => void;
  'presence:update': (payload: PresenceUpdate) => void;
  'character:update': (payload: CharacterUpdate) => void;
  'party:update': (payload: PartyUpdate) => void;
  'dungeon:start': (payload: DungeonStartEvent) => void;
  'dungeon:result': (payload: DungeonResultEvent) => void;
  'arena:challenged': (payload: ArenaChallengedEvent) => void;
  'raid:update': (payload: RaidUpdateEvent) => void;
  'system:notice': (payload: SystemNotice) => void;
  'friend:request': (payload: FriendRequestEvent) => void;
  'zone:joined': (payload: z.infer<typeof ZoneJoinedSchema>) => void;
  /** Delta frame, `zoneSnapshotHz` per second. Sent volatile. */
  'zone:frame': (payload: z.infer<typeof ZoneFrameSchema>) => void;
  'zone:left': (payload: z.infer<typeof ZoneLeftSchema>) => void;
  'zone:loot': (payload: z.infer<typeof ZoneLootSchema>) => void;
  'zone:death': (payload: z.infer<typeof ZoneDeathSchema>) => void;
  'zone:error': (payload: z.infer<typeof ZoneErrorSchema>) => void;
}

/** Reserved for Socket.IO's own inter-server events; empty for this game. */
export interface InterServerEvents {
  ping: () => void;
}

/** Per-socket data the server attaches after authenticating the handshake. */
export interface SocketData {
  userId: string;
  characterId: string;
  isAdmin: boolean;
  /** Party room the socket is currently joined to, if any. */
  partyId: string | null;
  /**
   * 战斗大地图 room the socket is *watching*, if any.
   *
   * Distinct from where the character stands: `zone:leave` stops the frames
   * while the character keeps fighting, so this is cleared and the character
   * stays on the field. Only `zone:retreat` takes it off.
   */
  zoneId: string | null;
}

export const CLIENT_TO_SERVER_EVENTS = [
  'chat:send',
  'presence:ping',
  'zone:enter',
  'zone:leave',
  'zone:retreat',
] as const;

export const SERVER_TO_CLIENT_EVENTS = [
  'chat:message',
  'presence:update',
  'character:update',
  'party:update',
  'dungeon:start',
  'dungeon:result',
  'arena:challenged',
  'raid:update',
  'system:notice',
  'friend:request',
  'zone:joined',
  'zone:frame',
  'zone:left',
  'zone:loot',
  'zone:death',
  'zone:error',
] as const;

/**
 * Runtime validators for the client-to-server payloads. The server must parse
 * every inbound event with these — socket payloads are as untrusted as bodies.
 */
export const CLIENT_EVENT_SCHEMAS = {
  'chat:send': ChatSendSchema,
  'presence:ping': z.void(),
  'zone:enter': ZoneEnterSchema,
  'zone:leave': z.void(),
  'zone:retreat': z.void(),
} as const;

/** Room naming, shared so both sides derive the same strings. */
export const ROOMS = {
  world: () => 'world',
  party: (partyId: string) => `party:${partyId}`,
  character: (characterId: string) => `char:${characterId}`,
  zone: (zoneId: string) => `zone:${zoneId}`,
} as const;

export { ChatChannelSchema, ChatMessageSchema };
