import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { adminLogin, enterZone, goTab, latchDomRoster, newCultivator, zoneKills } from './helpers';

interface Progression {
  materials: { jade: number; starStones: number; stardust: number };
  treasures: {
    uid: string;
    definitionId: string;
    level: number;
    spiritLevel: number;
    slot: number | null;
  }[];
  relics: { definitionId: string; spiritLevel: number }[];
  gacha: { treasure: { total: number }; relic: { total: number } };
  daily: { claimed: string[] };
}
interface Result {
  view: { character: { id: string }; stats: Record<string, number> };
  progression: Progression;
  results?: { definitionId: string; grade: string }[];
}
async function payload<T>(response: { json(): Promise<unknown> }): Promise<T> {
  const envelope = (await response.json()) as { ok: boolean; data: T; error?: unknown };
  expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
  return envelope.data;
}
function nextMutation(page: Page, action: string): Promise<Response> {
  return page.waitForResponse(
    (r) => r.url().endsWith(`/api/progression/${action}`) && r.request().method() === 'POST',
  );
}
async function current(request: APIRequestContext, token: string): Promise<Result> {
  return payload<Result>(
    await request.get('/api/progression', { headers: { Authorization: `Bearer ${token}` } }),
  );
}

test('洞府养成：入门、双池寻宝、十连重试、古宝、日课与地图持久化', async ({ page, request }) => {
  test.setTimeout(180_000);
  // The same UI must work on the deployed plain-HTTP host, where randomUUID is absent.
  await page.addInitScript(() =>
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined }),
  );
  await latchDomRoster(page);
  const account = await newCultivator(page, { account: 'treasure', dao: '寻宝' });
  const auth = { Authorization: `Bearer ${account.token}` };

  await page
    .getByRole('navigation', { name: '养成入口' })
    .getByRole('link', { name: /本命法宝/ })
    .click();
  const starterResponse = nextMutation(page, 'claim');
  await page.getByRole('button', { name: '领取入门法宝' }).click();
  const starter = await payload<Result>(await starterResponse);
  expect(starter.progression.treasures.find((t) => t.slot === 0)?.definitionId).toBe(
    't-starter-bell',
  );
  await page.getByRole('button', { name: '清音铃', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '清音铃' });
  const upgradeResponse = nextMutation(page, 'upgrade');
  await detail.getByRole('button', { name: '升级', exact: true }).click();
  const upgraded = await payload<Result>(await upgradeResponse);
  expect(
    upgraded.progression.treasures.find((t) => t.definitionId === 't-starter-bell')?.level,
  ).toBe(2);
  expect(upgraded.progression.materials.starStones).toBeLessThan(
    starter.progression.materials.starStones,
  );
  await detail.getByRole('button', { name: '关闭面板' }).click();

  await page.getByRole('link', { name: '‹ 回洞府' }).click();
  await page
    .getByRole('navigation', { name: '养成入口' })
    .getByRole('link', { name: /寻宝阁/ })
    .click();
  const freeTreasureResponse = nextMutation(page, 'draw');
  await page.getByRole('button', { name: '每日免费寻宝' }).click();
  const freeTreasure = await payload<Result>(await freeTreasureResponse);
  expect(freeTreasure.results).toHaveLength(1);
  expect(freeTreasure.progression.materials.jade).toBe(starter.progression.materials.jade);
  await page.getByRole('button', { name: '收入囊中' }).click();
  await expect(page.getByRole('button', { name: '今日免费已用' })).toBeDisabled();

  await page.getByRole('button', { name: '古宝遗珍' }).click();
  const freeRelicResponse = nextMutation(page, 'draw');
  await page.getByRole('button', { name: '每日免费寻宝' }).click();
  const freeRelic = await payload<Result>(await freeRelicResponse);
  expect(freeRelic.progression.gacha.treasure.total).toBe(1);
  expect(freeRelic.progression.gacha.relic.total).toBe(1);
  const relicName = await page
    .getByRole('dialog', { name: '仙缘已至' })
    .locator('.pg-result strong')
    .textContent();
  expect(relicName).toBeTruthy();
  await page.getByRole('button', { name: '收入囊中' }).click();

  // Test preparation uses the real admin API and targets only this new test account.
  const adminToken = await adminLogin(request);
  await payload(
    await request.post('/api/admin/players/grant', {
      headers: { 'x-admin-token': adminToken },
      data: { characterId: freeRelic.view.character.id, jade: 1500, stardust: 100 },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: '古宝遗珍' }).click();
  const beforeTen = await current(request, account.token);
  const tenResponsePromise = nextMutation(page, 'draw');
  await page.getByRole('button', { name: '寻宝十次 · 1500仙玉' }).click();
  const tenResponse = await tenResponsePromise;
  const ten = await payload<Result>(tenResponse);
  expect(ten.results).toHaveLength(10);
  expect(ten.results?.some((r) => r.grade === 'saint' || r.grade === 'divine')).toBe(true);
  expect(ten.progression.materials.jade).toBe(beforeTen.progression.materials.jade - 1500);
  const replay = await payload<Result>(
    await request.post('/api/progression/draw', {
      headers: auth,
      data: tenResponse.request().postDataJSON() as Record<string, unknown>,
    }),
  );
  expect(replay.results).toEqual(ten.results);
  expect(replay.progression.materials.jade).toBe(ten.progression.materials.jade);
  expect(replay.progression.gacha).toEqual(ten.progression.gacha);
  await page.getByRole('button', { name: '跳过揭示动画' }).click();
  await page.screenshot({
    path: join(import.meta.dirname, '..', 'shots', 'm4b-ten-pull.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '收入囊中' }).click();
  await page.getByRole('button', { name: '概率与规则' }).click();
  await expect(page.getByRole('dialog', { name: '寻宝规则公示' })).toContainText('1.5%');
  await page
    .getByRole('dialog', { name: '寻宝规则公示' })
    .getByRole('button', { name: '关闭面板' })
    .click();

  await page.goto('/relics');
  await page.getByRole('button', { name: relicName as string, exact: true }).click();
  const relicDetail = page.getByRole('dialog', { name: relicName as string });
  const infusedResponse = nextMutation(page, 'upgrade');
  await relicDetail.getByRole('button', { name: '注灵', exact: true }).click();
  const infused = await payload<Result>(await infusedResponse);
  expect(
    infused.progression.relics.find((r) => r.definitionId === freeRelic.results?.[0]?.definitionId)
      ?.spiritLevel,
  ).toBe(1);
  await relicDetail.getByRole('button', { name: '关闭面板' }).click();

  await goTab(page, '社交');
  await page.getByLabel('世界频道发言').fill('寻宝归来，今日共修。');
  await page.getByRole('button', { name: '传音', exact: true }).click();
  await expect(page.locator('.msg--mine')).toContainText('寻宝归来，今日共修。');
  await page.goto('/daily');
  const chatTask = page.locator('.pg-task').filter({ hasText: '仙友传音' });
  await chatTask.getByRole('button', { name: '领取日课奖励' }).click();
  await expect(chatTask.getByRole('button', { name: '已领取' })).toBeDisabled();
  await page.reload();
  await expect(chatTask.getByRole('button', { name: '已领取' })).toBeDisabled();

  await enterZone(page, '青云山');
  await expect(page.locator('.zone-row--self')).toContainText('清音铃');
  await expect(zoneKills(page)).toHaveText(/^[1-9]/, { timeout: 90_000 });
  const afterBattle = await current(request, account.token);
  expect(
    afterBattle.progression.treasures.find((t) => t.definitionId === 't-starter-bell')?.level,
  ).toBe(2);
  expect(afterBattle.progression.daily.claimed).toContain('chat');
  expect(
    afterBattle.progression.relics.find(
      (r) => r.definitionId === freeRelic.results?.[0]?.definitionId,
    )?.spiritLevel,
  ).toBe(1);

  await page.goto('/gacha');
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole('heading', { name: '寻宝阁', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: join(import.meta.dirname, '..', 'shots', 'm4b-gacha-360.png'),
    fullPage: true,
  });
});
