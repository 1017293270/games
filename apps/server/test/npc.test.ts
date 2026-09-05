import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DIALOGUES, NPCS, type DialogueView, type QuestListResponse } from '@xianxia/shared';
import { npcHandlers } from '../src/modules/npc/routes.js';
import { questHandlers } from '../src/modules/quest/routes.js';
import { shopHandlers } from '../src/modules/shop/routes.js';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

const handlers = { ...npcHandlers, ...questHandlers, ...shopHandlers };

describe('npc', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness({ handlers });
    player = await makePlayer(h);
  });
  afterEach(async () => {
    await h.close();
  });

  const roster = async () =>
    expectOk<{ npcs: { id: string; unlocked: boolean; hasQuest: boolean }[] }>(
      (await h.app.inject({ method: 'GET', url: '/api/npc', headers: auth(player.token) })).json(),
    );

  const open = async (npcId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/npc/dialogue',
      headers: auth(player.token),
      payload: { npcId },
    });

  const say = async (npcId: string, nodeId: string, choiceId?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/npc/talk',
      headers: auth(player.token),
      payload: choiceId === undefined ? { npcId, nodeId } : { npcId, nodeId, choiceId },
    });

  const quests = async () =>
    expectOk<QuestListResponse>(
      (await h.app.inject({ method: 'GET', url: '/api/quests', headers: auth(player.token) })).json(),
    );

  it('lists all eight 青云镇 NPCs with their unlock state', async () => {
    const list = await roster();
    expect(list.npcs).toHaveLength(NPCS.length);
    expect(list.npcs.find((n) => n.id === 'npc-zhangmen')!.unlocked).toBe(true);
    // 无名老者 waits until 练气·圆满, 青鸾仙子 until 筑基.
    expect(list.npcs.find((n) => n.id === 'npc-laozhe')!.unlocked).toBe(false);
    expect(list.npcs.find((n) => n.id === 'npc-xianzi')!.unlocked).toBe(false);
  });

  it('marks the NPC that has a quest to hand out', async () => {
    const list = await roster();
    expect(list.npcs.find((n) => n.id === 'npc-zhangmen')!.hasQuest).toBe(true);
    expect(list.npcs.find((n) => n.id === 'npc-zhenshou')!.hasQuest).toBe(false);
  });

  it('refuses to open a locked NPC', async () => {
    const response = await open('npc-laozhe');
    expect(response.statusCode).toBe(403);
    expect(expectFail(response.json()).code).toBe('NPC_LOCKED');
  });

  it('404s an NPC that does not exist', async () => {
    expect((await open('npc-nobody')).statusCode).toBe(404);
  });

  it('opens a conversation on the root node with only the branches that apply', async () => {
    const view = expectOk<DialogueView>((await open('npc-zhangmen')).json());
    expect(view.npcName).toBe('云鹤真人');
    expect(view.node.id).toBe('root');
    expect(view.openShopId).toBeNull();

    const ids = view.choices.map((c) => c.id);
    expect(ids).toContain('accept-quest-c1-01');
    // Chapter branches and later quests are hidden, not greyed out.
    expect(ids).not.toContain('chapter2');
    expect(ids).not.toContain('accept-quest-c3-01');
    expect(view.choices.every((c) => c.available)).toBe(true);
  });

  it('takes a quest through the dialogue tree', async () => {
    expectOk((await open('npc-zhangmen')).json());
    const view = expectOk<DialogueView>(
      (await say('npc-zhangmen', 'root', 'accept-quest-c1-01')).json(),
    );
    expect(view.node.id).toBe('give-c1-01');

    const log = await quests();
    expect(log.active.map((q) => q.quest.id)).toContain('quest-c1-01');

    // The accept branch is gone on the way back through the root.
    const back = expectOk<DialogueView>((await say('npc-zhangmen', 'root')).json());
    expect(back.choices.map((c) => c.id)).not.toContain('accept-quest-c1-01');
  });

  it('turns a finished quest in from the conversation, reward and all', async () => {
    expectOk((await say('npc-zhangmen', 'root', 'accept-quest-c1-01')).json());
    // Walking up to 守山弟子 is the objective.
    expectOk((await open('npc-zhenshou')).json());

    const view = expectOk<DialogueView>(
      (await say('npc-zhangmen', 'root', 'turnin-quest-c1-01')).json(),
    );
    expect(view.node.id).toBe('done-c1-01');
    expect(view.reward).not.toBeNull();
    expect(view.reward!.spiritStones).toBe(200);
    expect(view.reward!.itemNames).toContain('聚气丹');

    const log = await quests();
    expect(log.claimed.map((q) => q.quest.id)).toContain('quest-c1-01');
  });

  it('blocks a branch whose condition fails rather than trusting the client', async () => {
    // 给老者一枚回春丹 needs a 回春丹 in the bag; 无名老者 needs 练气·圆满.
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, stageIndex: 3, lastSettledAt: h.clock.now() });
    h.ctx.inventory.removeByItemId(player.characterId, 'pill-heal', 2);

    const view = expectOk<DialogueView>((await open('npc-laozhe')).json());
    const gift = view.choices.find((c) => c.id === 'gift')!;
    expect(gift.available).toBe(false);
    expect(gift.blockedReason).toContain('回春丹');

    const response = await say('npc-laozhe', 'root', 'gift');
    expect(response.statusCode).toBe(403);
    expect(expectFail(response.json()).code).toBe('CHOICE_BLOCKED');
  });

  it('runs a branch effect once its condition is met', async () => {
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, stageIndex: 3, lastSettledAt: h.clock.now() });

    const before = h.ctx.inventory.quantityOf(player.characterId, 'pill-heal');
    expect(before).toBeGreaterThan(0);

    const view = expectOk<DialogueView>((await say('npc-laozhe', 'root', 'gift')).json());
    expect(view.node.id).toBe('gift');
    expect(view.reward!.exp).toBe(2000);
    expect(h.ctx.inventory.quantityOf(player.characterId, 'pill-heal')).toBe(before - 1);
    expect(h.ctx.characters.byId(player.characterId)!.flags['laozhe-favor']).toBe(true);
  });

  it('hands back a shop id when a branch opens one', async () => {
    const view = expectOk<DialogueView>((await say('npc-yaowang', 'root', 'shop')).json());
    expect(view.openShopId).toBe('shop-yaowang');
    // `next: null` keeps the client on the node it was showing.
    expect(view.node.id).toBe('root');
  });

  it('rejects a choice that does not belong to the node', async () => {
    const response = await say('npc-zhangmen', 'root', 'no-such-choice');
    expect(response.statusCode).toBe(400);
    expect(expectFail(response.json()).code).toBe('INVALID_CHOICE');
  });

  it('rejects a node that does not belong to the tree', async () => {
    const response = await say('npc-zhangmen', 'no-such-node');
    expect(response.statusCode).toBe(404);
    expect(expectFail(response.json()).code).toBe('DIALOGUE_NOT_FOUND');
  });

  it('can walk every unconditional branch of every tree without breaking', async () => {
    // 大乘 sees every gate open, so the whole content set is reachable.
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, stageIndex: 30, chapter: 3, lastSettledAt: h.clock.now() });

    for (const tree of DIALOGUES) {
      const npc = NPCS.find((n) => n.dialogueId === tree.id)!;
      const opened = expectOk<DialogueView>((await open(npc.id)).json());
      expect(opened.node.id).toBe(tree.rootNodeId);

      for (const node of tree.nodes) {
        const view = expectOk<DialogueView>((await say(npc.id, node.id)).json());
        expect(view.node.id).toBe(node.id);
        expect(view.node.text.length).toBeGreaterThan(0);
        // Every node must offer a way onward, or the player is stuck.
        expect(node.choices.length).toBeGreaterThan(0);
      }
    }
  });
});
