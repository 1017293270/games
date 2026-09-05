import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CharacterView,
  QuestCompleteResponse,
  QuestListResponse,
} from '@xianxia/shared';
import { generateBots } from '../src/engine/bots/generate.js';
import { npcHandlers } from '../src/modules/npc/routes.js';
import { questHandlers } from '../src/modules/quest/routes.js';
import {
  auth,
  createHarness,
  expectFail,
  expectOk,
  makePlayer,
  type Harness,
  type Player,
} from './helpers.js';

/**
 * 任务链.
 *
 * The whole of chapter 1 is walked here end to end — 拜入山门 through 练气圆满
 * and the chapter flip — because the derived-progress design means a quest is
 * only really wired up once the thing it watches actually moves.
 */

const handlers = { ...npcHandlers, ...questHandlers };

describe('quests', () => {
  let h: Harness;
  let player: Player;

  beforeEach(async () => {
    h = createHarness({ handlers });
    player = await makePlayer(h);
  });
  afterEach(async () => {
    await h.close();
  });

  const list = async (): Promise<QuestListResponse> =>
    expectOk<QuestListResponse>(
      (await h.app.inject({ method: 'GET', url: '/api/quests', headers: auth(player.token) })).json(),
    );

  const accept = async (questId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/quests/accept',
      headers: auth(player.token),
      payload: { questId },
    });

  const complete = async (questId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/quests/complete',
      headers: auth(player.token),
      payload: { questId },
    });

  const talkTo = async (npcId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/npc/dialogue',
      headers: auth(player.token),
      payload: { npcId },
    });

  const fight = async (monsterId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/explore/battle',
      headers: auth(player.token),
      payload: { mapId: 'map-qingyun-mountain', monsterId },
    });

  /** Fights until `count` wins land, so a bad seed cannot flake the test. */
  const winFights = async (monsterId: string, count: number): Promise<void> => {
    let wins = 0;
    for (let i = 0; i < 60 && wins < count; i += 1) {
      h.clock.advance(1000);
      const result = expectOk<{ won: boolean }>((await fight(monsterId)).json());
      if (result.won) wins += 1;
    }
    expect(wins).toBe(count);
  };

  const stones = async (): Promise<number> =>
    expectOk<CharacterView>(
      (await h.app.inject({ method: 'GET', url: '/api/character', headers: auth(player.token) })).json(),
    ).character.spiritStones;

  it('offers only the opening quest to a fresh cultivator', async () => {
    const quests = await list();
    expect(quests.currentChapter).toBe(1);
    expect(quests.active).toHaveLength(0);
    const ids = quests.available.map((q) => q.quest.id);
    expect(ids).toContain('quest-c1-01');
    // 清剿山狼 needs 拜入山门 claimed first; 铁玄的托付 needs 练气二层.
    expect(ids).not.toContain('quest-c1-02');
    expect(ids).not.toContain('quest-c1-05');
  });

  it('refuses a quest whose prerequisite is unclaimed', async () => {
    const response = await accept('quest-c1-02');
    expect(response.statusCode).toBe(403);
    const error = expectFail(response.json());
    expect(error.code).toBe('CONDITION_UNMET');
    expect(error.message).toContain('拜入山门');
  });

  it('walks 拜入山门: talking to 守山弟子 completes it', async () => {
    expectOk(await accept('quest-c1-01').then((r) => r.json()));

    let quests = await list();
    const opening = quests.active.find((q) => q.quest.id === 'quest-c1-01')!;
    expect(opening.progress.state).toBe('active');
    expect(opening.claimable).toBe(false);
    expect(opening.objectiveText[0]).toContain('未完成');

    expectOk(await talkTo('npc-zhenshou').then((r) => r.json()));

    quests = await list();
    const talked = quests.active.find((q) => q.quest.id === 'quest-c1-01')!;
    expect(talked.progress.state).toBe('completed');
    expect(talked.claimable).toBe(true);
    expect(talked.objectiveText[0]).toContain('已完成');

    const before = await stones();
    const claimed = expectOk<QuestCompleteResponse>((await complete('quest-c1-01')).json());
    expect(claimed.reward.spiritStones).toBe(200);
    expect(claimed.reward.itemNames).toContain('聚气丹');
    expect(claimed.advancedToChapter).toBeNull();
    expect(await stones()).toBe(before + 200);

    // Claiming unlocks the next link in the chain.
    const after = await list();
    expect(after.claimed.map((q) => q.quest.id)).toContain('quest-c1-01');
    expect(after.available.map((q) => q.quest.id)).toContain('quest-c1-02');
  });

  it('rejects a second claim of the same quest', async () => {
    expectOk(await accept('quest-c1-01').then((r) => r.json()));
    expectOk(await talkTo('npc-zhenshou').then((r) => r.json()));
    expectOk(await complete('quest-c1-01').then((r) => r.json()));

    const response = await complete('quest-c1-01');
    expect(response.statusCode).toBe(409);
    expect(expectFail(response.json()).code).toBe('QUEST_ALREADY_CLAIMED');
  });

  it('counts 妖兽 kills through the explore hook and persists them', async () => {
    expectOk(await accept('quest-c1-01').then((r) => r.json()));
    expectOk(await talkTo('npc-zhenshou').then((r) => r.json()));
    expectOk(await complete('quest-c1-01').then((r) => r.json()));
    expectOk(await accept('quest-c1-02').then((r) => r.json()));

    const tooEarly = await complete('quest-c1-02');
    expect(tooEarly.statusCode).toBe(409);
    expect(expectFail(tooEarly.json()).code).toBe('QUEST_NOT_COMPLETE');

    await winFights('monster-qingyun-wolf', 5);

    // The tally must be in the database, not in a request-scoped cache: the
    // explore module only bumps the counter, and the next 任务 read is what
    // re-derives the state from it.
    const stored = h.ctx.characters.byId(player.characterId)!;
    expect(stored.quests.find((q) => q.questId === 'quest-c1-02')!.counters[0]).toBe(5);

    const progress = (await list()).active.find((q) => q.quest.id === 'quest-c1-02')!;
    expect(progress.progress.state).toBe('completed');
    expect(progress.objectiveText[0]).toBe('讨伐青云狼 5 / 5');

    const claimed = expectOk<QuestCompleteResponse>((await complete('quest-c1-02')).json());
    expect(claimed.reward.exp).toBe(500);
  });

  it('derives 收集 progress from the bag and spends the materials on turn-in', async () => {
    expectOk(await accept('quest-c1-01').then((r) => r.json()));
    expectOk(await talkTo('npc-zhenshou').then((r) => r.json()));
    expectOk(await complete('quest-c1-01').then((r) => r.json()));
    expectOk(await accept('quest-c1-03').then((r) => r.json()));

    // 新手包 ships five 灵草; the quest wants ten.
    let quests = await list();
    expect(quests.active.find((q) => q.quest.id === 'quest-c1-03')!.progress.counters[0]).toBe(5);

    h.ctx.inventory.add(player.characterId, 'mat-spirit-herb', 5);
    quests = await list();
    const ready = quests.active.find((q) => q.quest.id === 'quest-c1-03')!;
    expect(ready.progress.state).toBe('completed');
    expect(ready.objectiveText[0]).toBe('收集灵草 10 / 10');

    expectOk(await complete('quest-c1-03').then((r) => r.json()));
    expect(h.ctx.inventory.quantityOf(player.characterId, 'mat-spirit-herb')).toBe(0);

    // 采药之约 is repeatable, so it comes straight back on the board.
    const after = await list();
    expect(after.available.map((q) => q.quest.id)).toContain('quest-c1-03');
  });

  it('advances the chapter when 练气圆满 is claimed', async () => {
    expectOk(await accept('quest-c1-01').then((r) => r.json()));
    expectOk(await talkTo('npc-zhenshou').then((r) => r.json()));
    expectOk(await complete('quest-c1-01').then((r) => r.json()));
    expectOk(await accept('quest-c1-02').then((r) => r.json()));
    await winFights('monster-qingyun-wolf', 5);
    expectOk(await complete('quest-c1-02').then((r) => r.json()));

    expectOk(await accept('quest-c1-04').then((r) => r.json()));

    // 练气·圆满 is stage 3; put the cultivator there directly.
    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, stageIndex: 3, lastSettledAt: h.clock.now() });

    const quests = await list();
    expect(quests.active.find((q) => q.quest.id === 'quest-c1-04')!.claimable).toBe(true);

    const claimed = expectOk<QuestCompleteResponse>((await complete('quest-c1-04')).json());
    expect(claimed.advancedToChapter).toBe(2);
    expect(claimed.view.character.chapter).toBe(2);

    const after = await list();
    expect(after.currentChapter).toBe(2);
    expect(after.chapters.map((c) => c.chapter)).toContain(2);
  });

  it('reports 未接取 rather than 未完成 for a quest never taken', async () => {
    const response = await complete('quest-c1-05');
    expect(response.statusCode).toBe(409);
    expect(expectFail(response.json()).code).toBe('QUEST_NOT_ACTIVE');
  });

  it('refuses to hand out a quest that is already in the log', async () => {
    expectOk(await accept('quest-c1-01').then((r) => r.json()));
    const response = await accept('quest-c1-01');
    expect(response.statusCode).toBe(409);
    expect(expectFail(response.json()).code).toBe('QUEST_NOT_AVAILABLE');
  });

  it('scores 论道 wins over bots against a defeat_bot objective', async () => {
    const [bot] = generateBots(
      h.ctx,
      { count: 1, minStageIndex: 5, maxStageIndex: 5, seed: 42 },
      h.clock.now(),
    );
    expect(bot).toBeDefined();

    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, stageIndex: 5, lastSettledAt: h.clock.now() });
    expectOk(await accept('quest-c2-04').then((r) => r.json()));

    expect((await list()).active.find((q) => q.quest.id === 'quest-c2-04')!.progress.counters[0]).toBe(0);

    h.clock.advance(1000);
    h.ctx.battles.insert({
      kind: 'arena',
      attackerId: player.characterId,
      attackerName: player.name,
      defenderId: bot!.id,
      defenderName: bot!.name,
      winnerId: player.characterId,
      ratingDelta: 12,
      foughtAt: h.clock.now(),
      battle: null,
    });

    const quests = await list();
    const debt = quests.active.find((q) => q.quest.id === 'quest-c2-04')!;
    expect(debt.progress.counters[0]).toBe(1);
    expect(debt.claimable).toBe(true);
  });

  it('reads 通关副本 objectives out of dungeon_runs when that table exists', async () => {
    const exists = h.ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dungeon_runs'")
      .get();

    const current = h.ctx.characters.byId(player.characterId)!;
    h.ctx.characters.save({ ...current, stageIndex: 8, chapter: 3, lastSettledAt: h.clock.now() });
    expectOk(await accept('quest-c3-05').then((r) => r.json()));

    if (!exists) {
      // The dungeon module has not landed its migration; 0 is the honest answer.
      expect((await list()).active.find((q) => q.quest.id === 'quest-c3-05')!.progress.counters[0]).toBe(0);
      return;
    }

    h.clock.advance(1000);
    h.ctx.db
      .prepare(
        'INSERT INTO dungeon_runs (id, dungeon_id, leader_id, participant_ids_json, cleared, fought_at)' +
          ' VALUES (?, ?, ?, ?, 1, ?)',
      )
      .run(
        'run-test-1',
        'dungeon-luoshui',
        'someone-else',
        JSON.stringify(['someone-else', player.characterId]),
        h.clock.now(),
      );

    const quests = await list();
    expect(quests.active.find((q) => q.quest.id === 'quest-c3-05')!.claimable).toBe(true);
  });
});
