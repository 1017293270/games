import {
  expect,
  request as apiRequest,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  BASE_URL,
  DUNGEON_UNLOCK_STAGE,
  adminLogin,
  dismissArenaChallenge,
  dismissOfflineReturn,
  finishReplay,
  goTab,
  newCultivator,
  patchWorldSettings,
  raiseToStage,
} from './helpers';

/**
 * 两个人一起玩：各开一个浏览器上下文，组队、结伴打秘境、论道分胜负。
 *
 * 这一条才真正验到「联机」——两条 WebSocket 各自连着同一个容器，队伍变动、
 * 秘境战报都要跨上下文送到。反代（Caddy）如果没透传 Upgrade 头，这里必红。
 *
 * 秘境有境界门槛（青云秘境要筑基·前期），所以开头会用后台把修炼倍率临时开到
 * 100 倍把两个号推上去，推完立刻复原——跑完这套用例，世界设置和进来时一样。
 */
test.describe.configure({ mode: 'serial' });

test.describe('结伴同行', () => {
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let nameA: string;
  let nameB: string;
  let partyCode: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    const request = await apiRequest.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: true,
    });
    const adminToken = await adminLogin(request);

    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();

    const [jia, yi] = await Promise.all([
      newCultivator(pageA, { account: 'jia', dao: '甲', gender: 'male' }),
      newCultivator(pageB, { account: 'yi', dao: '乙', gender: 'female' }),
    ]);
    nameA = jia.name;
    nameB = yi.name;

    // 100 倍是世界设置允许的上限；练气一整个大境界的设计时长是 1152 秒，
    // 除以 100 大约十几秒，够把两个号推到筑基。
    await patchWorldSettings(request, adminToken, {
      cultivationMultiplier: 100,
      breakthroughChanceMultiplier: 10,
    });
    try {
      await Promise.all([
        raiseToStage(request, jia.token, DUNGEON_UNLOCK_STAGE),
        raiseToStage(request, yi.token, DUNGEON_UNLOCK_STAGE),
      ]);
    } finally {
      // 复原是必须的：后面的用例不该在一个「修为飞涨」的世界里跑，
      // 更不该把一台真服务器留在被调过的状态。
      await patchWorldSettings(request, adminToken, {
        cultivationMultiplier: 1,
        breakthroughChanceMultiplier: 1,
      });
      await request.dispose();
    }

    // 境界是绕过界面推上去的，刷一下让两边都看到新境界。
    await Promise.all([pageA.reload(), pageB.reload()]);
    await Promise.all([dismissOfflineReturn(pageA), dismissOfflineReturn(pageB)]);
  });

  test.afterAll(async () => {
    await ctxA.close();
    await ctxB.close();
  });

  // 这是个活着的世界：机器人 tick 每三十秒会挑战境界相近的玩家，被挑到的人
  // 秘境页顶上会挂出「有人向你论道」的战报条。它不挡页面，收掉只是为了
  // 让每条用例从干净的页头开始，真人玩到这儿也会顺手点一下「知道了」。
  test.beforeEach(async () => {
    await dismissArenaChallenge(pageA);
    await dismissArenaChallenge(pageB);
  });

  test('两个号都进了筑基', async () => {
    for (const page of [pageA, pageB]) {
      await expect(page.getByRole('heading', { name: /^筑基·/ })).toBeVisible();
    }
  });

  test('甲立一支队伍，乙投帖入队', async () => {
    await goTab(pageA, '社交');
    await pageA.getByRole('tab', { name: '组队' }).click();
    await pageA.getByRole('button', { name: '立一支队伍' }).click();

    const seal = pageA.locator('.code-seal__code');
    await expect(seal).toBeVisible();
    partyCode = ((await seal.textContent()) ?? '').trim();
    expect(partyCode, '队伍邀请码').toMatch(/^[A-Z0-9]{4,12}$/);

    await goTab(pageB, '社交');
    await pageB.getByRole('tab', { name: '组队' }).click();
    await pageB.getByLabel('邀请码').fill(partyCode);
    await pageB.getByRole('button', { name: '入队' }).click();

    // 乙自己看到两人。
    await expect(pageB.locator('.roster__row')).toHaveCount(2);
    await expect(pageB.getByText(nameA).first()).toBeVisible();

    // 甲这边没有刷新页面——名字是 party:update 通过 socket 推过来的。
    await expect(pageA.locator('.roster__row')).toHaveCount(2);
    await expect(pageA.getByText(nameB).first()).toBeVisible();
  });

  test('队长开秘境，两人同战，队友也收到战报', async () => {
    // 乙先守在秘境页：dungeon:result 推过来时，回放挂在这一页上。
    await goTab(pageB, '秘境');
    await expect(pageB.getByRole('heading', { name: '秘境论道' })).toBeVisible();

    await goTab(pageA, '秘境');
    const card = pageA.locator('article.dungeon-card:not(.dungeon-card--locked)').first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^结伴/ }).click();

    // 甲：自己开的，本地直接放回放。队友画在左边，说明服务端确实把两个人
    // 一起放进了同一场战斗。
    const replayA = pageA.getByRole('dialog', { name: '战斗回放' });
    await expect(replayA).toBeVisible();
    await expect(replayA.getByText(nameB).first()).toBeVisible();
    await finishReplay(pageA);

    // 乙：什么都没点，战报是 socket 送到的。
    const replayB = pageB.getByRole('dialog', { name: '战斗回放' });
    await expect(replayB).toBeVisible();
    await expect(replayB.getByText(nameA).first()).toBeVisible();
    await finishReplay(pageB);
  });

  test('论道台上分个胜负', async () => {
    await goTab(pageA, '秘境');
    await pageA.getByRole('tab', { name: '论道' }).click();
    await expect(pageA.locator('.standing__value')).toBeVisible();

    const opponent = pageA.locator('.opponent').first();
    await expect(opponent).toBeVisible();
    await opponent.getByRole('button', { name: '论道' }).click();

    const replay = pageA.getByRole('dialog', { name: '战斗回放' });
    await expect(replay).toBeVisible();

    const skip = replay.getByRole('button', { name: '跳过' });
    if (await skip.isVisible().catch(() => false)) await skip.click();

    // 结算面上的天梯变化是服务端算的，回放只是把它显示出来。
    await expect(replay.getByText(/天梯 \d+ → \d+/)).toBeVisible();
    await replay.getByRole('button', { name: '收功' }).click();
    await expect(replay).toBeHidden();

    // 这一场进了战绩册，说明服务端把它落库了（胜负都算数）。
    const record = pageA.locator('.record').first();
    await expect(record).toBeVisible();
    await expect(record.locator('.record__mark')).toHaveText(/胜|负/);
  });

  test('乙离队后，甲那边立刻只剩一人', async () => {
    await goTab(pageB, '社交');
    await pageB.getByRole('tab', { name: '组队' }).click();
    await pageB.getByRole('button', { name: '离队' }).click();
    await expect(pageB.getByRole('button', { name: '立一支队伍' })).toBeVisible();

    await goTab(pageA, '社交');
    await pageA.getByRole('tab', { name: '组队' }).click();
    await expect(pageA.locator('.roster__row')).toHaveCount(1);
  });
});
