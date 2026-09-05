import {
  ROOMS,
  stageName,
  type CharacterState,
  type Party,
  type PartyMember,
  type PartyUpdate,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import type { PartyRecord } from './store.js';

/**
 * 组队.
 *
 * The store owns membership; this file owns everything that needs the rest of
 * the world — rendering a party from live character rows, keeping the Socket.IO
 * rooms in step, and telling everyone what just changed.
 */

/** Renders one member row from the character store. */
function toMember(ctx: AppContext, state: CharacterState, leaderId: string): PartyMember {
  return {
    characterId: state.id,
    name: state.name,
    avatarArt: state.avatarArt,
    stageIndex: state.stageIndex,
    stageName: stageName(state.stageIndex),
    powerScore: state.powerScore,
    online: ctx.presence.isOnline(state.id),
    isLeader: state.id === leaderId,
    hpPercent: state.hpPercent,
  };
}

/** The wire shape of a party, always built from current character rows. */
export function buildParty(ctx: AppContext, record: PartyRecord): Party {
  const states = new Map(ctx.characters.byIds(record.memberIds).map((s) => [s.id, s]));
  const members: PartyMember[] = [];
  for (const id of record.memberIds) {
    const state = states.get(id);
    if (state) members.push(toMember(ctx, state, record.leaderId));
  }
  return {
    id: record.id,
    code: record.code,
    leaderId: record.leaderId,
    members,
    maxSize: record.maxSize,
    createdAt: record.createdAt,
  };
}

/** The party the caller is in, or null. */
export function currentParty(ctx: AppContext, characterId: string): Party | null {
  const record = ctx.parties.byMember(characterId);
  return record === null ? null : buildParty(ctx, record);
}

// ------------------------------------------------------------- socket rooms

/**
 * Moves every socket a character has open into (or out of) the party room.
 *
 * `socketsJoin` works on the room a socket is already in, so the character room
 * — which `socket.ts` joins on connect — is the handle for reaching all of one
 * player's tabs at once without holding socket references anywhere.
 */
export function joinPartyRoom(ctx: AppContext, characterId: string, partyId: string): void {
  const io = ctx.realtime.server;
  if (!io) return;
  io.in(ROOMS.character(characterId)).socketsJoin(ROOMS.party(partyId));
  stampPartyId(ctx, characterId, partyId);
}

export function leavePartyRoom(ctx: AppContext, characterId: string, partyId: string): void {
  const io = ctx.realtime.server;
  if (!io) return;
  io.in(ROOMS.character(characterId)).socketsLeave(ROOMS.party(partyId));
  stampPartyId(ctx, characterId, null);
}

/** Keeps `SocketData.partyId` honest for the sockets that are already open. */
function stampPartyId(ctx: AppContext, characterId: string, partyId: string | null): void {
  const io = ctx.realtime.server;
  if (!io) return;
  void io
    .in(ROOMS.character(characterId))
    .fetchSockets()
    .then((sockets) => {
      for (const socket of sockets) socket.data.partyId = partyId;
    })
    .catch(() => {
      // Best effort: the authoritative membership is `ctx.parties`, and every
      // reader falls back to it.
    });
}

// -------------------------------------------------------------- broadcasts

/** Tells the whole party what changed, in one shape. */
export function pushPartyUpdate(
  ctx: AppContext,
  record: PartyRecord,
  reason: PartyUpdate['reason'],
  actorName: string | null,
): Party {
  const party = buildParty(ctx, record);
  ctx.realtime.toParty(record.id, 'party:update', { party, reason, actorName });
  return party;
}

/** Tells one character it is no longer in a party. */
export function pushPartyCleared(
  ctx: AppContext,
  characterId: string,
  reason: PartyUpdate['reason'],
  actorName: string | null,
): void {
  ctx.realtime.toCharacter(characterId, 'party:update', { party: null, reason, actorName });
}

// --------------------------------------------------------------- endpoints

/** `POST /api/party/create`. */
export function createParty(ctx: AppContext, state: CharacterState, maxSize: number, now: number): Party {
  if (ctx.parties.byMember(state.id)) throw new ApiError('ALREADY_IN_PARTY', '你已经在一支队伍里了');
  const record = ctx.parties.create(state.id, maxSize, now);
  joinPartyRoom(ctx, state.id, record.id);
  return pushPartyUpdate(ctx, record, 'joined', state.name);
}

/** `POST /api/party/join`. */
export function joinParty(ctx: AppContext, state: CharacterState, code: string): Party {
  if (ctx.parties.byMember(state.id)) throw new ApiError('ALREADY_IN_PARTY', '你已经在一支队伍里了');

  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(trimmed)) throw new ApiError('INVALID_PARTY_CODE', '邀请码格式不对');

  const record = ctx.parties.byCode(trimmed);
  if (!record) throw new ApiError('PARTY_NOT_FOUND', '没有这支队伍，邀请码可能已经失效');
  if (record.memberIds.length >= record.maxSize) {
    throw new ApiError('PARTY_FULL', `队伍已满（${record.maxSize} 人）`);
  }

  const joined = ctx.parties.join(record.id, state.id);
  if (!joined) throw new ApiError('PARTY_FULL', `队伍已满（${record.maxSize} 人）`);

  joinPartyRoom(ctx, state.id, joined.id);
  return pushPartyUpdate(ctx, joined, 'joined', state.name);
}

/** `POST /api/party/leave`. */
export function leaveParty(ctx: AppContext, state: CharacterState): Record<string, never> {
  const record = ctx.parties.byMember(state.id);
  if (!record) throw new ApiError('NOT_IN_PARTY', '你还没有队伍');

  const partyId = record.id;
  const change = ctx.parties.remove(state.id);

  leavePartyRoom(ctx, state.id, partyId);
  pushPartyCleared(ctx, state.id, change.disbanded ? 'disbanded' : 'left', state.name);

  if (change.party) {
    pushPartyUpdate(ctx, change.party, change.newLeaderId ? 'leader_changed' : 'left', state.name);
  }
  return {};
}

/** `POST /api/party/kick`. Leader only. */
export function kickMember(ctx: AppContext, state: CharacterState, targetId: string): Party {
  const record = ctx.parties.byMember(state.id);
  if (!record) throw new ApiError('NOT_IN_PARTY', '你还没有队伍');
  if (record.leaderId !== state.id) throw new ApiError('NOT_PARTY_LEADER', '只有队长可以请人离队');
  if (targetId === state.id) throw new ApiError('NOT_FOUND', '队长不能踢自己，请直接离队');
  if (!record.memberIds.includes(targetId)) throw new ApiError('NOT_FOUND', '此人不在队伍中');

  const partyId = record.id;
  const change = ctx.parties.remove(targetId);

  leavePartyRoom(ctx, targetId, partyId);
  pushPartyCleared(ctx, targetId, 'kicked', state.name);

  // `remove` only returns null when the party emptied, which cannot happen here
  // — the leader is still in it.
  if (!change.party) throw new ApiError('INTERNAL_ERROR', '队伍状态异常');
  return pushPartyUpdate(ctx, change.party, 'kicked', state.name);
}

/**
 * The party members that will actually take part in a group activity.
 *
 * Membership is not participation: someone who closed the tab cannot fight, so
 * a run takes the caller plus every member holding a live socket. The caller is
 * always included — they are the one making the request.
 */
export function activeMemberIds(ctx: AppContext, record: PartyRecord, callerId: string): string[] {
  const ids = record.memberIds.filter((id) => id === callerId || ctx.presence.isOnline(id));
  return ids.includes(callerId) ? ids : [callerId, ...ids];
}
