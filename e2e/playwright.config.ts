import { defineConfig, devices } from '@playwright/test';

/**
 * 冒烟测试跑在一台**真实跑着的服务器**上——通常就是
 * `docker compose -f deploy/docker-compose.yml up -d` 起来的那一套。
 * 这里不配 `webServer`：这套用例的价值恰恰在于它验的是镜像，而不是 dev 服务器。
 *
 *   pnpm --filter e2e e2e                    # 打 http://localhost:3000
 *   E2E_BASE_URL=http://localhost:8080 \
 *   E2E_ADMIN_PASSWORD=xxx pnpm --filter e2e e2e
 */
export default defineConfig({
  testDir: './tests',

  // 用例里有「等修为涨够 → 突破」的轮询，比一般的 UI 用例慢。
  timeout: 180_000,
  expect: { timeout: 20_000 },

  // 所有用例共用同一个世界：同一个数据库、同一份世界设置、同一批机器人。
  // 并行跑会互相踩（比如一个把修炼倍率改回 1，另一个还等着涨修为）。
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  // list 给人看，html 留在 playwright-report/ 供失败后翻 trace。
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // 反代和 TLS 都在 Caddy 那一侧；本地测试常用自签或纯 HTTP，别让证书挡路。
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 这是个竖屏为先的游戏，按手机宽度跑更接近真实用法。
        viewport: { width: 430, height: 932 },
      },
    },
  ],
});
