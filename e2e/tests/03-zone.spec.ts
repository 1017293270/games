import { join } from 'node:path';
import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  BASE_URL,
  FIRST_ZONE_NAME,
  adminLogin,
  enterZone,
  goTab,
  latchDomRoster,
  newCultivator,
  patchWorldSettings,
  retreatZone,
  zoneKills,
  zoneRow,
} from './helpers';

/**
 * 两个人站在同一张战斗大地图上。
 *
 * 这一条验的是 M4a 的承诺：一张图是一个服务端一直跑着的场，谁走上去谁就在
 * 里面，别人也看得见他。所以断言全落在「不点任何东西也会发生的事」上——名册
 * 里多出一个道号、战果自己往上跳、开了 PvP 就有人倒下。
 *
 * 画布用 `?canvas=off` 关掉：PixiJS 画出来的是一张 canvas，里面没有 DOM 可查，
 * 而同一份数据的 DOM 名册（`features/zone/ZoneList.tsx`）能按道号断言。
 *
 * 跑完世界设置会还原（`mapPvp` 关回 false）——这台服务器后面还要给别人用。
 */
test.describe.configure({ mode: 'serial' });

/** 服务端给新入场者的护身期，见 `content/zones.ts` 的 `ZONE_PVP_PROTECT_MS`。 */
const PROTECT_MS = 60_000;

/** 开了 PvP 之后，最多等这么久才认输。 */
const PVP_WINDOW_MS = 90_000;

/** 留档截图落在 `e2e/shots/`，跑完可以直接翻这一版长什么样。 */
const SHOTS = join(import.meta.dirname, '..', 'shots');

/** 「身死道消」那张弹层。 */
function deathCard(page: Page): Locator {
  return page.getByRole('alertdialog', { name: '身死道消' });
}

/** 此刻挂在页面上吗？查不到（页面正巧在跳转）一律算没有。 */
function showing(target: Locator): Promise<boolean> {
  return target.isVisible().catch(() => false);
}

/**
 * 记下这一页的 socket 上出现过哪些 `zone:frame` 事件。
 *
 * `pvp_kill` 是帧里的一条记录，界面上并没有对应的一行字（`ZoneHud` 只画
 * 「身死道消」，而那张弹层对妖兽咬死和被人打死是一样的）。要证明「大地图 PvP
 * 真的打起来了」，最诚实的地方就是线上那一帧本身：Socket.IO 的 websocket 帧是
 * `42["zone:frame",{...}]` 这样的文本，找字样即可。
 *
 * 必须在页面开出 socket **之前**挂上，所以是创建页面之后立刻调用。
 */
function sniffZoneEvents(page: Page): (kind: string) => boolean {
  const seen = new Set<string>();
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
      for (const kind of ['kill', 'death', 'pvp_kill', 'boss_spawn']) {
        if (text.includes(`"t":"${kind}"`)) seen.add(kind);
      }
    });
  });
  return (kind: string) => seen.has(kind);
}

test.describe('同场厮杀', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let nameA: string;
  let nameB: string;
  let sawA: (kind: string) => boolean;
  let sawB: (kind: string) => boolean;
  let request: APIRequestContext;
  let adminToken: string;
  /** 两个号走进图里的时刻，用来算护身期什么时候过。 */
  let enteredAt = 0;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);

    request = await apiRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
    adminToken = await adminLogin(request);

    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
    sawA = sniffZoneEvents(pageA);
    sawB = sniffZoneEvents(pageB);

    // 这一步必须是标签页打开的第一个地址，`?canvas=off` 才latch得进 sessionStorage。
    await Promise.all([latchDomRoster(pageA), latchDomRoster(pageB)]);

    const [bing, ding] = await Promise.all([
      newCultivator(pageA, { account: 'bing', dao: '丙', gender: 'male' }),
      newCultivator(pageB, { account: 'ding', dao: '丁', gender: 'female' }),
    ]);
    nameA = bing.name;
    nameB = ding.name;
  });

  test.afterAll(async () => {
    // 还原是必须的：PvP 是全服开关，不该把一台真服务器留在开着的状态。
    await patchWorldSettings(request, adminToken, { mapPvp: false, mapDeathRespawnSec: 10 });
    await request.dispose();
    await ctxA.close();
    await ctxB.close();
  });

  test('两人同上青云山，名册里互相看得见', async () => {
    await goTab(pageA, '探索');
    await expect(pageA.getByRole('heading', { name: '山河图' })).toBeVisible();
    await pageA.screenshot({ path: join(SHOTS, 'zone-maps.png') });

    await enterZone(pageA, FIRST_ZONE_NAME);
    await enterZone(pageB, FIRST_ZONE_NAME);
    enteredAt = Date.now();

    // 关了画布，场上就是一份 DOM 名册：自己那一行带「你」。
    await expect(pageA.locator('.zone-row--self')).toContainText(nameA);
    await expect(pageB.locator('.zone-row--self')).toContainText(nameB);

    // 谁都没刷新页面：对方是 `zone:frame` 推过来的。这才是「同一个场」。
    await expect(zoneRow(pageA, nameB)).toBeVisible({ timeout: 30_000 });
    await expect(zoneRow(pageB, nameA)).toBeVisible({ timeout: 30_000 });

    // 名册上还站着一整张图的妖兽和散修，不只有这两个人。
    await expect(pageA.locator('.zone-row')).not.toHaveCount(2);

    await pageA.screenshot({ path: join(SHOTS, 'zone-hud.png') });
  });

  test('站着不动，两个人的战果都自己往上跳', async () => {
    // 一下都不点：服务端每五秒结一次账，斩获从 0 变成别的就说明这个号
    // 真的在场上打死了东西。刚开服的空图上要自己走过去单挑，所以给一分半。
    await expect(zoneKills(pageA)).toHaveText(/^[1-9]/, { timeout: 90_000 });
    await expect(zoneKills(pageB)).toHaveText(/^[1-9]/, { timeout: 90_000 });
  });

  test('开了大地图 PvP，场上就有人身死道消', async () => {
    test.setTimeout(240_000);

    // 死了多躺一会儿，那张「身死道消」才留得住给断言看；默认 10 秒对一个
    // 每半秒轮询一次的循环来说太紧。
    await patchWorldSettings(request, adminToken, { mapPvp: true, mapDeathRespawnSec: 15 });

    // 图上得有别人才谈得上 PvP。散修（机器人）是这张图上人数的大头，一个都
    // 没有就别等了——那是世界空着，不是 PvP 没生效。
    await expect(pageA.locator('.zone-row').filter({ hasText: '散修' }).first()).toBeVisible();

    // 新入场的人有 60 秒护身，护身期内谁也碰不了他——等它过去，否则等的是
    // 一个规则上不可能发生的事。
    const wait = enteredAt + PROTECT_MS + 2_000 - Date.now();
    if (wait > 0) await pageA.waitForTimeout(wait);

    const deadline = Date.now() + PVP_WINDOW_MS;
    let fallen: string | null = null;
    while (Date.now() < deadline) {
      if (await showing(deathCard(pageA))) {
        fallen = nameA;
        break;
      }
      if (await showing(deathCard(pageB))) {
        fallen = nameB;
        break;
      }
      if (sawA('pvp_kill') || sawB('pvp_kill')) break;
      await pageA.waitForTimeout(500);
    }

    // 两条证据认一条。
    //   `pvp_kill`：图上任意两名修士分出了生死——这是「PvP 真的开了」最直接的
    //   证据，而且不要求倒下的正好是这两个测试号（练气·前期离图上多数散修有
    //   五阶之差，`ZONE_PVP_STAGE_WINDOW` 根本不许他们动手）。
    //   「身死道消」：这两个号里有一个被打倒了。谁倒下不写死——场上是活的。
    expect(
      fallen !== null || sawA('pvp_kill') || sawB('pvp_kill'),
      `开了 mapPvp 之后等了 ${String(PVP_WINDOW_MS / 1000)} 秒，帧里没有 pvp_kill，` +
        '两个号也都没弹出「身死道消」',
    ).toBe(true);

    if (fallen !== null) {
      const card = fallen === nameA ? deathCard(pageA) : deathCard(pageB);
      await expect(card).toContainText('败于');
    }

    // 开关立刻关回去，剩下的用例不该在一个开着 PvP 的世界里跑。
    // `afterAll` 里还会再关一次，那一次管的是这条用例中途红掉的情况。
    await patchWorldSettings(request, adminToken, { mapPvp: false, mapDeathRespawnSec: 10 });
  });

  test('撤离之后回到山河图', async () => {
    // 刚倒下的那个号头上还压着「身死道消」，那张弹层会吃掉点击；等它自己散。
    await expect(deathCard(pageA)).toBeHidden({ timeout: 40_000 });
    await expect(deathCard(pageB)).toBeHidden({ timeout: 40_000 });

    await retreatZone(pageA);
    await retreatZone(pageB);
    await expect(pageA.locator('button.map-card').first()).toBeVisible();
  });
});
