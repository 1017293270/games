import { expect, test, type Page } from '@playwright/test';
import {
  createCharacterViaUi,
  dismissOfflineReturn,
  goTab,
  registerViaUi,
  uniqueCharacterName,
  uniqueUsername,
  zoneKills,
} from './helpers';

/**
 * 一个人从头玩一遍：注册 → 创角 → 修炼 → 上战斗大地图打一场 → 去青云镇接任务。
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

  test('探索：上青云山斩获妖兽，再撤离回山河图', async () => {
    await goTab(page, '探索');
    await expect(page.getByRole('heading', { name: '山河图' })).toBeVisible();

    // 第一张图对练气·前期就是开的；点它就是进场，没有中间的行动单。
    const firstMap = page.locator('button.map-card:not(.map-card--locked)').first();
    await expect(firstMap).toBeVisible();
    const mapName = ((await firstMap.locator('.map-card__name').textContent()) ?? '').trim();
    expect(mapName, '第一张图的名字').not.toBe('');
    await firstMap.click();

    // 进了场，HUD 就压在画面上：顶栏报地图名，底下是战果与三个手动动作。
    const retreat = page.getByRole('button', { name: '撤离' });
    await expect(retreat).toBeVisible();
    await expect(page.locator('.zone-hud__name')).toHaveText(mapName);
    await expect(page.getByText('本次战果')).toBeVisible();
    await expect(page.getByRole('button', { name: '采药' })).toBeVisible();
    await expect(page.getByRole('button', { name: '循迹' })).toBeVisible();

    // 战斗全在服务端跑，客户端一下都不用点：站着就会有斩获，每五秒随
    // `zone:loot` 结一次账。图上散修多的时候十几秒就有一只，刚开服的空图上
    // 得自己走过去单挑，慢得多——所以给到一分半。
    await expect(zoneKills(page)).toHaveText(/^[1-9]/, { timeout: 90_000 });

    await retreat.click();
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
