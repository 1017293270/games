import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { Invite } from '@xianxia/shared';

/**
 * Stored invite.
 *
 * Identical to the wire shape: `Invite` carries the redemption bookkeeping
 * (`maxUses` -1 for unlimited, `uses`), so the panel reads the same numbers
 * registration checks against.
 */
export type InviteRow = Invite;

interface RawInvite {
  code: string;
  created_at: number;
  created_by: string;
  used_by: string | null;
  used_at: number | null;
  expires_at: number | null;
  note: string;
  max_uses: number;
  uses: number;
}

function toInvite(row: RawInvite): InviteRow {
  return {
    code: row.code,
    createdAt: Number(row.created_at),
    createdBy: row.created_by,
    usedBy: row.used_by,
    usedAt: row.used_at === null ? null : Number(row.used_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    note: row.note,
    maxUses: Number(row.max_uses),
    uses: Number(row.uses),
  };
}

/** Six-character human-typable code; no vowels, so no accidental words. */
export function newInviteCode(): string {
  const alphabet = '23456789BCDFGHJKLMNPQRSTVWXYZ';
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export class InviteRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(
    code: string,
    now: number,
    options: { createdBy?: string; note?: string; expiresAt?: number | null; maxUses?: number } = {},
  ): InviteRow {
    this.db
      .prepare(
        'INSERT INTO invites (code, created_at, created_by, used_by, used_at, expires_at, note,' +
          ' max_uses, uses) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 0)',
      )
      .run(
        code,
        now,
        options.createdBy ?? 'system',
        options.expiresAt ?? null,
        options.note ?? '',
        options.maxUses ?? 1,
      );
    return {
      code,
      createdAt: now,
      createdBy: options.createdBy ?? 'system',
      usedBy: null,
      usedAt: null,
      expiresAt: options.expiresAt ?? null,
      note: options.note ?? '',
      maxUses: options.maxUses ?? 1,
      uses: 0,
    };
  }

  find(code: string): InviteRow | null {
    const row = this.db.prepare('SELECT * FROM invites WHERE code = ? COLLATE NOCASE').get(code) as
      | RawInvite
      | undefined;
    return row ? toInvite(row) : null;
  }

  /** True when the code exists, has not expired and still has uses left. */
  isRedeemable(invite: InviteRow, now: number): boolean {
    if (invite.expiresAt !== null && invite.expiresAt <= now) return false;
    if (invite.maxUses < 0) return true;
    return invite.uses < invite.maxUses;
  }

  redeem(code: string, userId: string, now: number): void {
    this.db
      .prepare('UPDATE invites SET uses = uses + 1, used_by = ?, used_at = ? WHERE code = ?')
      .run(userId, now, code);
  }

  list(): InviteRow[] {
    const rows = this.db
      .prepare('SELECT * FROM invites ORDER BY created_at DESC')
      .all() as unknown as RawInvite[];
    return rows.map(toInvite);
  }

  remove(code: string): boolean {
    const result = this.db.prepare('DELETE FROM invites WHERE code = ?').run(code);
    return Number(result.changes) > 0;
  }
}
