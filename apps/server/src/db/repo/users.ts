import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

/** An account row. */
export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  banned: boolean;
  banReason: string;
  createdAt: number;
}

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** Hashes a password as `<salt hex>:<key hex>` with a fresh 16-byte salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Constant-time check of a password against a stored `salt:hash`. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

interface RawUser {
  id: string;
  username: string;
  password_hash: string;
  is_admin: number;
  banned: number;
  ban_reason: string;
  created_at: number;
}

function toUser(row: RawUser): UserRow {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    isAdmin: row.is_admin === 1,
    banned: row.banned === 1,
    banReason: row.ban_reason,
    createdAt: Number(row.created_at),
  };
}

export class UserRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(username: string, password: string, now: number, isAdmin = false): UserRow {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, is_admin, banned, ban_reason, created_at)' +
          ' VALUES (?, ?, ?, ?, 0, \'\', ?)',
      )
      .run(id, username, hashPassword(password), isAdmin ? 1 : 0, now);
    return {
      id,
      username,
      passwordHash: '',
      isAdmin,
      banned: false,
      banReason: '',
      createdAt: now,
    };
  }

  byId(id: string): UserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawUser | undefined;
    return row ? toUser(row) : null;
  }

  byUsername(username: string): UserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | RawUser
      | undefined;
    return row ? toUser(row) : null;
  }

  /** Case-insensitive existence check, so `Li` and `li` cannot both register. */
  usernameTaken(username: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS hit FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);
    return row !== undefined;
  }

  setPassword(userId: string, password: string): void {
    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(password), userId);
  }

  setBanned(userId: string, banned: boolean, reason: string): void {
    this.db
      .prepare('UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?')
      .run(banned ? 1 : 0, reason, userId);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return Number(row.c);
  }

  countBanned(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM users WHERE banned = 1').get() as {
      c: number;
    };
    return Number(row.c);
  }

  countCreatedSince(since: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?')
      .get(since) as { c: number };
    return Number(row.c);
  }

  list(
    limit: number,
    offset: number,
    filter: { q?: string; onlyBanned?: boolean } = {},
  ): { rows: UserRow[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.q) {
      where.push('username LIKE ?');
      args.push(`%${filter.q}%`);
    }
    if (filter.onlyBanned) where.push('banned = 1');
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM users ${clause}`).get(...args) as { c: number }).c,
    );
    const rows = this.db
      .prepare(`SELECT * FROM users ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset) as unknown as RawUser[];
    return { rows: rows.map(toUser), total };
  }
}
