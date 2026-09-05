/**
 * Copies `src/db/migrations/*.sql` into `dist/db/migrations`.
 *
 * `tsc` only emits JavaScript, so the SQL files the migration runner reads at
 * boot would be missing from a production build without this step. Run as part
 * of `pnpm build`.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(packageRoot, 'src', 'db', 'migrations');
const to = join(packageRoot, 'dist', 'db', 'migrations');

if (!existsSync(from)) {
  console.error(`[copy-migrations] 找不到迁移目录：${from}`);
  process.exit(1);
}

cpSync(from, to, { recursive: true });
const copied = readdirSync(to).filter((f) => f.endsWith('.sql'));
console.log(`[copy-migrations] 已复制 ${copied.length} 个迁移文件到 dist/db/migrations`);
