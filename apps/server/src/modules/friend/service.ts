import {
  stageName,
  type CharacterState,
  type Friend,
  type FriendState,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';

/**
 * 好友.
 *
 * A request writes both directions at once — `pending_out` for the sender,
 * `pending_in` for the recipient — so neither side has to reason about who
 * asked. Accepting rewrites the pair, removing drops the pair, and there is no
 * state in which one cultivator is a friend of someone who is not a friend back.
 */

/** Accepted friends one cultivator may hold. */
export const FRIEND_LIMIT = 50;

/** Renders one 好友 row from the character store. */
function toFriend(state: CharacterState, friendState: FriendState, online: boolean): Friend {
  return {
    characterId: state.id,
    name: state.name,
    avatarArt: state.avatarArt,
    stageIndex: state.stageIndex,
    stageName: stageName(state.stageIndex),
    powerScore: state.powerScore,
    online,
    lastSeenAt: state.lastSeenAt,
    state: friendState,
  };
}

/** Sort: accepted first, then incoming requests, then the ones still waiting. */
const STATE_ORDER: Record<FriendState, number> = { accepted: 0, pending_in: 1, pending_out: 2 };

/** `GET /api/friends` — friends and both directions of pending requests. */
export function listFriends(ctx: AppContext, characterId: string): { friends: Friend[] } {
  const edges = ctx.friends.list(characterId);
  const states = new Map(ctx.characters.byIds(edges.map((e) => e.friendId)).map((s) => [s.id, s]));

  const friends: Friend[] = [];
  for (const edge of edges) {
    const other = states.get(edge.friendId);
    if (!other) continue;
    friends.push(toFriend(other, edge.state, ctx.presence.isOnline(other.id)));
  }

  friends.sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.powerScore - a.powerScore,
  );
  return { friends };
}

/** Throws when the character is already at the 好友 cap. */
function assertRoom(ctx: AppContext, characterId: string, who: string): void {
  if (ctx.friends.countAccepted(characterId) >= FRIEND_LIMIT) {
    throw new ApiError('FRIEND_LIMIT', `${who}的好友已经满 ${FRIEND_LIMIT} 位了`);
  }
}

/** Writes an accepted friendship in both directions. */
function bond(ctx: AppContext, a: string, b: string, now: number): void {
  ctx.friends.put(a, b, 'accepted', now);
  ctx.friends.put(b, a, 'accepted', now);
}

/** `POST /api/friends/request`. */
export function requestFriend(
  ctx: AppContext,
  self: CharacterState,
  targetId: string,
  now: number,
): Record<string, never> {
  if (targetId === self.id) throw new ApiError('VALIDATION_ERROR', '不能加自己为好友');

  const target = ctx.characters.byId(targetId);
  if (!target) throw new ApiError('CHARACTER_NOT_FOUND', '查无此人');

  const mine = ctx.friends.edge(self.id, targetId);
  if (mine?.state === 'accepted') throw new ApiError('ALREADY_FRIENDS', '你们已经是好友了');
  if (mine?.state === 'pending_out') throw new ApiError('FRIEND_REQUEST_EXISTS', '申请已经发出，等他答复吧');

  assertRoom(ctx, self.id, '你');
  assertRoom(ctx, targetId, target.name);

  // They already asked first: two people asking each other is a friendship, not
  // a pair of requests nobody remembers to accept.
  if (mine?.state === 'pending_in') {
    bond(ctx, self.id, targetId, now);
    return {};
  }

  ctx.friends.put(self.id, targetId, 'pending_out', now);
  ctx.friends.put(targetId, self.id, 'pending_in', now);

  ctx.realtime.toCharacter(targetId, 'friend:request', {
    fromCharacterId: self.id,
    fromName: self.name,
    fromStageName: stageName(self.stageIndex),
    at: now,
  });
  return {};
}

/** `POST /api/friends/accept`. */
export function acceptFriend(
  ctx: AppContext,
  self: CharacterState,
  targetId: string,
  now: number,
): { friends: Friend[] } {
  const mine = ctx.friends.edge(self.id, targetId);
  if (!mine || mine.state !== 'pending_in') {
    throw new ApiError('FRIEND_NOT_FOUND', '没有这封拜帖');
  }

  const target = ctx.characters.byId(targetId);
  if (!target) throw new ApiError('FRIEND_NOT_FOUND', '此人已不在了');

  assertRoom(ctx, self.id, '你');
  assertRoom(ctx, targetId, target.name);

  bond(ctx, self.id, targetId, now);
  return listFriends(ctx, self.id);
}

/** `POST /api/friends/remove` — also the way a pending request is refused. */
export function removeFriend(
  ctx: AppContext,
  self: CharacterState,
  targetId: string,
): { friends: Friend[] } {
  if (!ctx.friends.edge(self.id, targetId)) {
    throw new ApiError('FRIEND_NOT_FOUND', '你们之间没有这层关系');
  }
  ctx.friends.removePair(self.id, targetId);
  return listFriends(ctx, self.id);
}
