import { expect, test, type Page } from '@playwright/test';
import {
  createCharacterViaUi,
  dismissOfflineReturn,
  finishReplay,
  goTab,
  registerViaUi,
  uniqueCharacterName,
  uniqueUsername,
} from './helpers';

/**
 * 一个人从头玩一遍：注册 → 创角 → 修炼 → 探索打一架 → 去青云镇接任务。
 *
 * 全程走界面，不碰后台。这一条过了，就说明镜像里的前端、REST、SQLite、
 * 静态托管和 SPA 回退都是通的。
 */
test.describe.configure({ mode: 'serial' });

test.describe('独修一程', () => {
  let page: Page;
  const username = uniqueUsername('solo');
  const daoName = uniqueCharacterName('青');

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('注册、创角、入山门', async () => {
    await registerViaUi(page, username);
    await expect(page.getByRole('heading', { name: '结庐问道' })).toBeVisible();

    await createCharacterViaUi(page, daoName);

    // 进了主界面就该看到五个页签。
    const nav = page.getByRole('navigation', { name: '主导航' });
    for (const label of ['修炼', '探索', '秘境', '社交', '角色']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('修炼场报出境界与速率', async () => {
    await dismissOfflineReturn(page);

    // 新号必在练气·前期，速率是服务端按灵根和功法算出来的。
    await expect(page.getByRole('heading', { name: /^练气·/ })).toBeVisible();
    await expect(page.getByText('修炼速率')).toBeVisible();
    await expect(page.getByText('灵根').first()).toBeVisible();
    await expect(page.getByText(/距下一境|修为已满/)).toBeVisible();
  });

  test('角色页：属性与行囊都在', async () => {
    await goTab(page, '角色');
    await expect(page.getByText(daoName).first()).toBeVisible();
    await page.getByRole('tab', { name: '行囊' }).click();
    await expect(page.getByRole('tab', { name: '行囊' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('探索：讨伐一只妖兽并看完回放', async () => {
    await goTab(page, '探索');
    await expect(page.getByRole('heading', { name: '山河图' })).toBeVisible();

    // 第一张图对练气·前期就是开的；点开它的行动单。
    const firstMap = page.locator('button.map-card:not(.map-card--locked)').first();
    await expect(firstMap).toBeVisible();
    await firstMap.click();

    const sheet = page.getByRole('dialog');
    const strike = sheet.getByRole('button', { name: /讨伐 · / }).first();
    await expect(strike).toBeVisible();
    await strike.click();

    // 战斗完全在服务端跑，客户端只回放。看到回合数就说明日志是真的。
    const replay = page.getByRole('dialog', { name: '战斗回放' });
    await expect(replay).toBeVisible();
    await expect(replay.getByText(/第 \d+ 回合/)).toBeVisible();
    await finishReplay(page);

    await expect(page.getByRole('heading', { name: '山河图' })).toBeVisible();
  });

  test('青云镇：镇民在，任务簿里接下第一桩差事', async () => {
    await goTab(page, '探索');
    await page.getByRole('link', { name: /青云镇/ }).click();
    await expect(page.getByRole('heading', { name: '青云镇' })).toBeVisible();

    // 八位镇民，练气能见到的那几位是可点的。
    await expect(page.locator('button.npc-card').first()).toBeVisible();

    await page.getByRole('tab', { name: '任务簿' }).click();

    // 第一章第一桩「拜入山门」没有任何前置，新号一定能接。
    const quest = page.locator('article.quest').filter({ hasText: '拜入山门' });
    await expect(quest).toBeVisible();
    await quest.getByRole('button', { name: '接下' }).click();

    // 接下之后按钮变成「进行中」，目标行也跟着出来。
    await expect(quest.getByRole('button', { name: '进行中' })).toBeVisible();
    await expect(quest.locator('.quest__objectives')).toBeVisible();
  });
});
