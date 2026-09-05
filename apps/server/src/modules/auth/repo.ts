import type { AppContext } from '../../context.js';
import type { InviteRow } from '../../db/repo/invites.js';

/** Invite lookups the registration flow owns. */

export function findInvite(ctx: AppContext, code: string): InviteRow | null {
  return ctx.invites.find(code);
}

export function redeemInvite(
  ctx: AppContext,
  code: string,
  userId: string,
  now: number,
): void {
  const invite = ctx.invites.find(code);
  if (!invite) return;
  ctx.invites.redeem(invite.code, userId, now);
}

/**
 * Writes the `INVITE_CODE` environment variable into `invites` as an unlimited
 * code, once. Re-running leaves an existing row untouched so an operator can
 * retire it from the panel without the next restart resurrecting it.
 */
export function ensureBootstrapInvite(ctx: AppContext, code: string, now: number): boolean {
  if (code.trim() === '') return false;
  const existing = ctx.invites.find(code.trim());
  if (existing) return false;
  ctx.invites.create(code.trim(), now, {
    createdBy: 'env:INVITE_CODE',
    note: '来自 INVITE_CODE 环境变量的常驻邀请码',
    maxUses: -1,
  });
  return true;
}
