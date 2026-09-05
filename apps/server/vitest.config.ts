import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    // Bot-engine and socket tests boot a real server plus a 200-bot world.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each file opens its own SQLite file under a fresh temp DATA_DIR; running
    // them in one process at a time keeps those handles from piling up.
    fileParallelism: false,
  },
});
