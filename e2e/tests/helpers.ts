import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 冒烟测试的共用零件。
 *
 * 两条原则：
 *  1. 凡是「玩家会做的事」一律走界面——注册、创角、打怪、组队、论道、接任务。
 *     这些正是要证明部署出来的镜像真的能玩。
 *  2. 凡是「只为把测试号推到某个状态」的操作走 HTTP——把修炼倍率开到 100 倍再
 *     等修为涨够，比在界面上枯坐二十分钟讲道理。
 */

// ------------------------------------------------------------------ 环境

/** 注册要用的邀请码；对应 deploy/.env 的 INVITE_CODE。 */
export const INVITE_CODE = process.env.E2E_INVITE_CODE ?? 'qingyun';

/** 后台账号；用来临时调高修炼倍率，跑完会复原。 */
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

/** 所有测试号共用的密钥。服务端只要求 6-72 位。 */
export const PASSWORD = 'daoyou-e2e-2026';

/** 客户端存 token 的 localStorage 键，见 apps/client/src/store/session.ts。 */
const TOKEN_KEY = 'xianxia.token';

/**
 * 被测服务器。和 playwright.config.ts 里的 `baseURL` 同源——那个是给页面用的
 * 测试级 fixture，`beforeAll` 里取不到，所以这里直接读环境变量。
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** 秘境「青云秘境」的解锁境界（筑基·前期）。 */
export const DUNGEON_UNLOCK_STAGE = 4;

// ------------------------------------------------------------------ 杂项

let counter = 0;

/** 每次运行都不重名的账号名。服务端限 3-20 位 [A-Za-z0-9_-]。 */
export function uniqueUsername(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${String(counter)}`.slice(0, 20);
}

/** 道号。服务端限 2-12 位汉字/字母/数字/下划线。 */
export function uniqueCharacterName(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 6)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------ HTTP

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/** 拆开统一响应包；失败时把服务端的错误码原样报出来，方便定位。 */
async function unwrap<T>(response: {
  ok: () => boolean;
  status: () => number;
  text: () => Promise<string>;
}): Promise<T> {
  const raw = await response.text();
  let body: Envelope<T>;
  try {
    body = JSON.parse(raw) as Envelope<T>;
  } catch {
    throw new Error(`HTTP ${String(response.status())} 返回的不是 JSON：${raw.slice(0, 200)}`);
  }
  if (!body.ok || body.data === undefined) {
    throw new Error(
      `HTTP ${String(response.status())} ${body.error?.code ?? '?'}：${body.error?.message ?? raw}`,
    );
  }
  return body.data;
}

/** 当前登录态的 token，从页面的 localStorage 里取。 */
export async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key: string) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, '页面里应当已经有登录 token').toBeTruthy();
  return token as string;
}

/** 后台登录，拿一个 admin token。 */
export async function adminLogin(request: APIRequestContext): Promise<string> {
  expect(
    ADMIN_PASSWORD,
    '需要 E2E_ADMIN_PASSWORD（与容器的 ADMIN_PASSWORD 一致）才能调世界设置',
  ).not.toBe('');
  const session = await unwrap<{ token: string }>(
    await request.post('/api/admin/login', {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    }),
  );
  return session.token;
}

/** 部分更新世界设置；只有列出的键会变。 */
export async function patchWorldSettings(
  request: APIRequestContext,
  adminToken: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return unwrap<Record<string, unknown>>(
    await request.put('/api/admin/settings', {
      headers: { 'x-admin-token': adminToken },
      data: patch,
    }),
  );
}

interface CharacterView {
  character: { id: string; name: string; stageIndex: number };
  stageName: string;
  atPerfection: boolean;
}

/** `POST /api/character/settle`，顺带把当前视图带回来。 */
async function settle(request: APIRequestContext, token: string): Promise<CharacterView> {
  const result = await unwrap<{ view: CharacterView }>(
    await request.post('/api/character/settle', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    }),
  );
  return result.view;
}

/**
 * 把一个测试号推到 `target` 阶。
 *
 * 修为是懒结算的——服务端按「上次结算到现在」的真实秒数补，所以这里能做的
 * 只有：把世界倍率开到 100 倍（练气一整个大境界的设计时长是 1152 秒，除以
 * 100 大约 12 秒），反复结算，到圆满就突破。突破失败会掉 20% 修为并留在圆满，
 * 循环会自然重试。
 *
 * 调用方负责先把 `cultivationMultiplier` / `breakthroughChanceMultiplier` 调上去。
 */
export async function raiseToStage(
  request: APIRequestContext,
  token: string,
  target: number,
  timeoutMs = 120_000,
): Promise<CharacterView> {
  const auth = { Authorization: `Bearer ${token}` };
  const deadline = Date.now() + timeoutMs;
  let view = await settle(request, token);

  while (view.character.stageIndex < target) {
    if (Date.now() > deadline) {
      throw new Error(
        `等了 ${String(Math.round(timeoutMs / 1000))} 秒，${view.character.name} 仍停在` +
          ` ${view.stageName}（第 ${String(view.character.stageIndex)} 阶），没能到第` +
          ` ${String(target)} 阶`,
      );
    }
    if (view.atPerfection) {
      await request.post('/api/character/breakthrough', { headers: auth, data: { pills: 0 } });
    } else {
      await sleep(800);
    }
    view = await settle(request, token);
  }
  return view;
}

// ------------------------------------------------------------------ 界面

/** 注册一个新账号，停在创角页。 */
export async function registerViaUi(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('tab', { name: '注册' }).click();
  await page.getByLabel('道号').fill(username);
  await page.getByLabel('密钥').fill(PASSWORD);
  await page.getByLabel('邀请码').fill(INVITE_CODE);
  await page.getByRole('button', { name: '录名入册' }).click();
  await page.waitForURL('**/create');
}

/** 在创角页测灵根、入山门，停在修炼场。 */
export async function createCharacterViaUi(
  page: Page,
  name: string,
  gender: 'male' | 'female' = 'male',
): Promise<void> {
  await page.getByLabel('道号').fill(name);
  await page.getByRole('button', { name: gender === 'male' ? '男修' : '女修' }).click();
  await page.getByRole('button', { name: '测灵根' }).click();

  // 灵根是服务端按 70/25/5 掷的，只断言这一屏出现了，不断言掷出了什么。
  await expect(page.getByText('测得灵根')).toBeVisible();
  await page.getByRole('button', { name: '入山门' }).click();

  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await dismissOfflineReturn(page);
}

/** 注册 + 创角一步到位，返回这个号的 token。 */
export async function newCultivator(
  page: Page,
  options: { account: string; dao: string; gender?: 'male' | 'female' },
): Promise<{ username: string; name: string; token: string }> {
  const username = uniqueUsername(options.account);
  const name = uniqueCharacterName(options.dao);
  await registerViaUi(page, username);
  await createCharacterViaUi(page, name, options.gender ?? 'male');
  return { username, name, token: await tokenOf(page) };
}

/** 「闭关归来」弹窗如果冒出来了就关掉；没冒出来也不算错。 */
export async function dismissOfflineReturn(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: '继续修行' });
  if (await button.isVisible().catch(() => false)) await button.click();
}

/**
 * 收掉「有人向你论道」的通报条。
 *
 * 这不是测试的噪音，是这个世界的真实行为：机器人 tick 会挑战境界相近的玩家，
 * 挑到谁，谁的秘境页顶上就会挂出这条战报。它不遮页面，底下照样能点；
 * 收掉只是让截图和断言看到干净的页头，真人玩也会顺手点「知道了」。
 */
export async function dismissArenaChallenge(page: Page): Promise<void> {
  const ack = page.getByRole('button', { name: '知道了' });
  if (await ack.isVisible().catch(() => false)) await ack.click();
}

/** 切主导航的页签。 */
export async function goTab(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label }).click();
}

/**
 * 看完一场战斗回放并关掉它。
 *
 * 秘境是多阵连打：每阵播完按「再进一阵」，最后一阵才是「收功」。
 * 回放本身是逐帧演的，先按「跳过」直接跳到结算。
 */
export async function finishReplay(page: Page, closeLabel = '收功'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '战斗回放' });

  for (let wave = 0; wave < 8; wave += 1) {
    await expect(dialog).toBeVisible();

    const skip = dialog.getByRole('button', { name: '跳过' });
    if (await skip.isVisible().catch(() => false)) await skip.click();

    const next = dialog.getByRole('button', { name: '再进一阵' });
    const close = dialog.getByRole('button', { name: closeLabel });
    await expect(next.or(close)).toBeVisible();

    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await expect(dialog).toBeHidden();
      return;
    }

    // 阵与阵之间有一屏「整息片刻」的过场；下一轮的 toBeVisible 会等下一阵挂上来。
    await next.click();
  }
  throw new Error('战斗回放播了 8 阵还没结束，多半是卡住了');
}
