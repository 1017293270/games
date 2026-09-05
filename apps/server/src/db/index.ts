import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * SQLite access.
 *
 * One file, one connection, WAL mode. `node:sqlite` is synchronous, which suits
 * this game: every request touches a handful of rows and the bot tick writes a
 * few hundred inside one transaction, so there is nothing to gain from an async
 * driver and plenty to lose in complexity.
 */

/** Directory holding the numbered migration files. */
const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export interface MigrationRecord {
  name: string;
  appliedAt: number;
}

/**
 * Opens (creating if needed) the database at `file` and applies pending
 * migrations.
 */
export function openDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Applies every `NNN_name.sql` under `migrations/` that is not yet recorded in
 * `_migrations`, in filename order.
 *
 * Later work only ever *adds* a numbered file; the runner discovers it by
 * reading the directory, so nothing here needs editing to pick one up.
 */
export function runMigrations(db: DatabaseSync, dir = MIGRATIONS_DIR): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => String((row as { name: string }).name)),
  );

  if (!existsSync(dir)) {
    throw new Error(
      `找不到迁移目录 ${dir}。生产构建需要 \`pnpm build\` 里的 copy-migrations 步骤把` +
        ' src/db/migrations/*.sql 复制到 dist/db/migrations。',
    );
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  const record = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      record.run(file, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${file} 执行失败：${(error as Error).message}`, { cause: error });
    }
    ran.push(file);
  }

  return ran;
}

/** Migrations already applied, newest last. */
export function appliedMigrations(db: DatabaseSync): MigrationRecord[] {
  return db
    .prepare('SELECT name, applied_at FROM _migrations ORDER BY name')
    .all()
    .map((row) => {
      const r = row as { name: string; applied_at: number };
      return { name: r.name, appliedAt: Number(r.applied_at) };
    });
}

/**
 * Runs `fn` inside a transaction, rolling back if it throws.
 * Nested calls reuse the outer transaction rather than failing.
 */
export function transact<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
