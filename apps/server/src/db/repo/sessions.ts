import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

/** A live player session. */
export interface SessionRow {
  token: string;
  userId: string;
  expiresAt: number;
}

/** 32 random bytes, hex-encoded. Also the Socket.IO handshake token. */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export class SessionRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(userId: string, now: number, ttlDays: number): SessionRow {
    const token = newToken();
    const expiresAt = now + Math.max(1, ttlDays) * 86_400_000;
    this.db
      .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, expiresAt, now);
    return { token, userId, expiresAt };
  }

  /** Returns the session only while it is still valid. */
  find(token: string, now: number): SessionRow | null {
    const row = this.db
      .prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?')
      .get(token) as { token: string; user_id: string; expires_at: number } | undefined;
    if (!row) return null;
    if (Number(row.expires_at) <= now) return null;
    return { token: row.token, userId: row.user_id, expiresAt: Number(row.expires_at) };
  }

  remove(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  removeForUser(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpired(now: number): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    return Number(result.changes);
  }
}

/** Admin panel sessions. Same shape, separate table and lifetime. */
export class AdminSessionRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(username: string, now: number, ttlDays: number): { token: string; expiresAt: number } {
    const token = newToken();
    const expiresAt = now + Math.max(1, ttlDays) * 86_400_000;
    this.db
      .prepare(
        'INSERT INTO admin_sessions (token, username, expires_at, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(token, username, expiresAt, now);
    return { token, expiresAt };
  }

  find(token: string, now: number): { token: string; username: string; expiresAt: number } | null {
    const row = this.db
      .prepare('SELECT token, username, expires_at FROM admin_sessions WHERE token = ?')
      .get(token) as { token: string; username: string; expires_at: number } | undefined;
    if (!row || Number(row.expires_at) <= now) return null;
    return { token: row.token, username: row.username, expiresAt: Number(row.expires_at) };
  }

  purgeExpired(now: number): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now);
  }
}
