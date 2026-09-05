#!/usr/bin/env node
/**
 * Walks the M1 screens on a `VITE_MOCK=1` dev server and writes one screenshot
 * per page to `apps/client/shots/` (gitignored).
 *
 * Run: pnpm --filter @xianxia/client run shots
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const CLIENT_DIR = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(CLIENT_DIR, 'shots');
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const DEMO = { username: 'qingyun', password: 'qingyun123' };

async function startDevServer() {
  // `vite/bin/vite.js` is not an exported subpath; go through package.json.
  const pkgPath = require.resolve('vite/package.json');
  const pkg = require('vite/package.json');
  const bin = path.join(path.dirname(pkgPath), pkg.bin.vite ?? pkg.bin);
  const child = spawn(
    process.execPath,
    [bin, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: CLIENT_DIR,
      env: { ...process.env, VITE_MOCK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('dev server did not come up in 60s');
    try {
      const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return child;
}

let index = 0;
async function shot(page, name) {
  index += 1;
  const file = path.join(SHOT_DIR, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  process.stdout.write(`  ${path.relative(CLIENT_DIR, file)}\n`);
}

/** Waits for fonts and the first paint of a route to settle. */
async function settle(page, ms = 500) {
  // Evaluated as a string: this runs in the page, not in Node, and the repo's
  // flat ESLint config only gives `.mjs` files Node globals.
  await page.evaluate('document.fonts ? document.fonts.ready : null');
  await page.waitForTimeout(ms);
}

async function loginAsDemo(page) {
  await page.goto(`${ORIGIN}/login`);
  await page.evaluate('(() => { try { localStorage.clear(); } catch {} })()');
  await page.reload();
  await page.getByRole('button', { name: '用演示道号' }).click();
  await page.getByLabel('密钥').fill(DEMO.password);
  await page.getByRole('button', { name: '入山门' }).click();
  await page.waitForURL(`${ORIGIN}/`);
}

async function run() {
  await rm(SHOT_DIR, { recursive: true, force: true });
  await mkdir(SHOT_DIR, { recursive: true });

  const server = await startDevServer();
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`[page] ${error.message}\n`));

    // ---------------------------------------------------------- 登录 / 创角
    await page.goto(`${ORIGIN}/login`);
    await settle(page, 900);
    await shot(page, 'login');

    await page.getByRole('tab', { name: '注册' }).click();
    await page.getByLabel('道号').fill(`shot${Date.now().toString(36).slice(-6)}`);
    await page.getByLabel('密钥').fill('shotpass123');
    await page.getByRole('button', { name: '录名入册' }).click();
    await page.waitForURL(`${ORIGIN}/create`);
    await page.getByLabel('道号').fill('青梧');
    await page.getByRole('button', { name: '女修' }).click();
    await page.getByRole('button', { name: '选用形貌 f03' }).click();
    await settle(page, 400);
    await shot(page, 'create');

    // ------------------------------------------------------------- 主修炼场
    await loginAsDemo(page);
    await page.getByRole('dialog').filter({ hasText: '闭关归来' }).waitFor();
    await settle(page, 500);
    await shot(page, 'offline-return');

    await page.getByRole('button', { name: '继续修行' }).click();
    await settle(page, 1200);
    await shot(page, 'cultivation');

    // --------------------------------------------------------------- 突破
    await page.getByRole('button', { name: /运功破境/ }).click();
    await settle(page, 500);
    await shot(page, 'breakthrough');
    await page.getByRole('button', { name: '再等等' }).click();

    // --------------------------------------------------------------- 角色
    await page.getByRole('link', { name: '角色' }).click();
    await settle(page, 500);
    await shot(page, 'character');

    await page.getByRole('tab', { name: '行囊' }).click();
    await settle(page, 400);
    await shot(page, 'bag');

    // --------------------------------------------------------------- 探索
    await page.getByRole('link', { name: '探索' }).click();
    await settle(page, 700);
    await shot(page, 'explore');

    await page.getByRole('button', { name: /幽冥谷/ }).first().click();
    await settle(page, 400);
    await page.getByRole('button', { name: /讨伐 · 白骨将/ }).click();
    await page.getByRole('dialog', { name: '战斗回放' }).waitFor();
    await page.waitForTimeout(3400);
    await shot(page, 'battle');
    await page.getByRole('button', { name: '跳过' }).click().catch(() => {});
    await settle(page, 300);
    await page.getByRole('button', { name: '收功' }).click();

    // --------------------------------------------------------------- 社交
    await page.getByRole('link', { name: '社交' }).click();
    await settle(page, 800);
    await shot(page, 'chat');

    await page.getByRole('tab', { name: '榜单' }).click();
    await settle(page, 800);
    await shot(page, 'rankings');

    await context.close();

    // ------------------------------------------------------------- 桌面画框
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const wide = await desktop.newPage();
    await loginAsDemo(wide);
    await wide.getByRole('button', { name: '继续修行' }).click().catch(() => {});
    await settle(wide, 1200);
    await shot(wide, 'desktop');
    await desktop.close();
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  process.stderr.write(`截图失败：${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
