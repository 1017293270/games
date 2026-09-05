import { beforeAll, describe, expect, it } from 'vitest';
import { API, type Endpoint } from '@xianxia/shared';
import { setTokenSource } from '../http';
import { api } from '../endpoints';
import { DEMO_PASSWORD, DEMO_USERNAME } from './index';

/**
 * 青云镇 mock.
 *
 * Same contract as `mock.test.ts`: every payload is parsed against the shared
 * response schema, so a drift between the mock and the server's shape fails
 * here rather than in a blank screen. The 第一章 chain is walked end to end
 * because that is what the town screen is for.
 */

let token: string | null = null;

function expectShape<E extends Endpoint>(endpoint: E, data: unknown): void {
  const result = endpoint.response.safeParse(data);
  if (!result.success) {
    throw new Error(
      `${endpoint.method} ${endpoint.path} 响应不合契约: ${JSON.stringify(result.error.issues)}`,
    );
  }
}

beforeAll(async () => {
  setTokenSource(() => token);
  const session = await api.login({ username: DEMO_USERNAME, password: DEMO_PASSWORD });
  token = session.token;
});

describe('青云镇 mock', () => {
  it('answers the NPC roster in contract shape', async () => {
    const roster = await api.npcs();
    expectShape(API.npc.list, roster);
    expect(roster.npcs).toHaveLength(8);
    expect(roster.npcs.find((n) => n.id === 'npc-zhangmen')!.unlocked).toBe(true);
  });

  it('opens a conversation and hides the branches that do not apply', async () => {
    const view = await api.npcDialogue('npc-zhangmen');
    expectShape(API.npc.dialogue, view);
    expect(view.node.id).toBe('root');
    const ids = view.choices.map((c) => c.id);
    expect(ids).toContain('accept-quest-c1-01');
    expect(ids).not.toContain('turnin-quest-c1-01');
  });

  it('hands back a shop id when a branch opens one, and prices the shelf', async () => {
    const talked = await api.npcTalk({ npcId: 'npc-yaowang', nodeId: 'root', choiceId: 'shop' });
    expectShape(API.npc.talk, talked);
    expect(talked.openShopId).toBe('shop-yaowang');

    const shop = await api.shop('shop-yaowang');
    expectShape(API.shop.list, shop);
    expect(shop.shop.name).toBe('百草堂');
    expect(shop.entries.find((e) => e.itemId === 'pill-qi')!.price).toBe(60);
  });

  it('buys and sells against the same purse', async () => {
    const before = (await api.shop('shop-shangren')).spiritStones;

    const bought = await api.shopBuy({ shopId: 'shop-shangren', itemId: 'mat-spirit-herb', qty: 2 });
    expectShape(API.shop.buy, bought);
    expect(bought.stonesDelta).toBe(-40);
    expect(bought.spiritStones).toBe(before - 40);

    const row = Object.keys(bought.shopView.sellPrices)[0]!;
    const sold = await api.shopSell({ shopId: 'shop-shangren', uid: row, qty: 1 });
    expectShape(API.shop.sell, sold);
    expect(sold.stonesDelta).toBeGreaterThan(0);
    expect(sold.spiritStones).toBe(bought.spiritStones + sold.stonesDelta);
  });

  it('refuses a shelf above the buyer\'s realm, and one the shop never stocks', async () => {
    // 玄天印 sits behind 炼虚 at 铁玄铺; the demo cultivator is 金丹.
    await expect(
      api.shopBuy({ shopId: 'shop-tiejiang', itemId: 'treasure-seal', qty: 1 }),
    ).rejects.toMatchObject({ code: 'CONDITION_UNMET' });

    await expect(
      api.shopBuy({ shopId: 'shop-yaowang', itemId: 'treasure-seal', qty: 1 }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_SOLD_HERE' });
  });

  it('walks 拜入山门 from accept to reward', async () => {
    const opened = await api.quests();
    expectShape(API.quests.list, opened);
    expect(opened.available.map((q) => q.quest.id)).toContain('quest-c1-01');

    const accepted = await api.acceptQuest('quest-c1-01');
    expectShape(API.quests.accept, accepted);
    const active = accepted.active.find((q) => q.quest.id === 'quest-c1-01')!;
    expect(active.claimable).toBe(false);
    expect(active.objectiveText[0]).toContain('未完成');

    // 与守山弟子交谈 is the objective.
    await api.npcDialogue('npc-zhenshou');

    const ready = (await api.quests()).active.find((q) => q.quest.id === 'quest-c1-01')!;
    expect(ready.claimable).toBe(true);

    const claimed = await api.completeQuest('quest-c1-01');
    expectShape(API.quests.complete, claimed);
    expect(claimed.reward.spiritStones).toBe(200);
    expect((await api.quests()).claimed.map((q) => q.quest.id)).toContain('quest-c1-01');
  });

  it('refuses to claim a quest whose objectives are unmet', async () => {
    await api.acceptQuest('quest-c1-02');
    await expect(api.completeQuest('quest-c1-02')).rejects.toMatchObject({
      code: 'QUEST_NOT_COMPLETE',
    });
  });

  it('turns a finished quest in from inside the conversation', async () => {
    // 铁玄的托付 wants three 玄铁精; buy them rather than farming in a unit test.
    await api.acceptQuest('quest-c1-05');
    await api.shopBuy({ shopId: 'shop-tiejiang', itemId: 'mat-iron-essence', qty: 3 });

    const view = await api.npcTalk({
      npcId: 'npc-tiejiang',
      nodeId: 'root',
      choiceId: 'turnin-quest-c1-05',
    });
    expectShape(API.npc.talk, view);
    expect(view.node.id).toBe('done-iron');
    expect(view.reward).not.toBeNull();
    expect(view.reward!.itemNames).toContain('青锋剑');
  });
});
