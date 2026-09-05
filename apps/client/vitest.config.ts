import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same rationale as `vite.config.ts`: tests read the shared contract source.
    conditions: ['development', 'browser', 'module', 'import'],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    reporters: ['default'],
    env: { VITE_MOCK: '1' },
  },
});
