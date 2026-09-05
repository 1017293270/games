import { API, type AuthSession, type MeResponse, type User } from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { verifyPassword } from '../../db/repo/users.js';
import type { UserRow } from '../../db/repo/users.js';
import { findInvite, redeemInvite } from './repo.js';

/**
 * Accounts, sessions and invite gating.
 *
 * A session token is the single credential in the game: REST sends it as a
 * bearer token and Socket.IO sends the same string in its handshake.
 */

/** Shapes a stored account for the wire, resolving its cultivator id. */
export function toUserPayload(ctx: AppContext, user: UserRow): User {
  const character = ctx.characters.byUserId(user.id);
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    banned: user.banned,
    createdAt: user.createdAt,
    characterId: character?.id ?? null,
  };
}

function issueSession(ctx: AppContext, user: UserRow, now: number): AuthSession {
  const session = ctx.sessions.create(user.id, now, ctx.config.sessionTtlDays);
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: toUserPayload(ctx, user),
  };
}

export function register(
  ctx: AppContext,
  input: { username: string; password: string; inviteCode?: string },
  now: number,
): AuthSession {
  const world = ctx.settings.get();

  if (!world.registrationOpen) {
    throw new ApiError('REGISTRATION_CLOSED', '本服已关闭注册，请联系服主');
  }

  if (world.inviteRequired) {
    const code = input.inviteCode?.trim() ?? '';
    if (code === '') throw new ApiError('INVITE_REQUIRED', '本服需要邀请码才能注册');

    const invite = findInvite(ctx, code);
    if (!invite || !ctx.invites.isRedeemable(invite, now)) {
      throw new ApiError('INVITE_INVALID', '邀请码无效或已被用尽');
    }
  }

  if (ctx.users.usernameTaken(input.username)) {
    throw new ApiError('USERNAME_TAKEN', '该用户名已被占用');
  }

  const user = ctx.users.create(input.username, input.password, now);

  if (world.inviteRequired && input.inviteCode) {
    redeemInvite(ctx, input.inviteCode.trim(), user.id, now);
  }

  return issueSession(ctx, user, now);
}

export function login(
  ctx: AppContext,
  input: { username: string; password: string },
  now: number,
): AuthSession {
  const user = ctx.users.byUsername(input.username);
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new ApiError('INVALID_CREDENTIALS', '用户名或密码不正确');
  }
  if (user.banned) {
    throw new ApiError(
      'BANNED',
      user.banReason ? `账号已被封禁：${user.banReason}` : '该账号已被封禁',
    );
  }

  ctx.sessions.purgeExpired(now);
  return issueSession(ctx, user, now);
}

export function me(ctx: AppContext, user: UserRow, now: number): MeResponse {
  return { user: toUserPayload(ctx, user), serverTime: now };
}

/** Endpoint constants this module implements, for the registry keys. */
export const AUTH_ENDPOINTS = API.auth;
