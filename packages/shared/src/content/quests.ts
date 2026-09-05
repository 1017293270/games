/**
 * 剧情任务链. Three chapters gated by realm, each a chain of quests handed out
 * by the 青云镇 NPCs. `prerequisiteQuestId` strings the main line together and
 * `requirements` gates the side work; every quest here has matching accept and
 * turn-in branches in `dialogues.ts`, so the whole set is reachable by talking.
 */

import { indexById } from '../core/util.js';
import { QuestSchema, StoryChapterSchema, type Quest, type StoryChapter } from '../domain/quest.js';

const SPECS: Quest[] = [
  // ============================ 第一章 · 初入青云 (练气) ============================
  {
    id: 'quest-c1-01',
    name: '拜入山门',
    description: '云鹤真人要你先去山门前见过守山弟子，报上名号，方算正式入门。',
    kind: 'main',
    chapter: 1,
    giverNpcId: 'npc-zhangmen',
    turnInNpcId: 'npc-zhangmen',
    requirements: [],
    objectives: [{ type: 'talk_npc', npcId: 'npc-zhenshou' }],
    reward: {
      exp: 200,
      spiritStones: 200,
      items: [{ itemId: 'pill-qi', qty: 3 }],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c1-02',
    name: '清剿山狼',
    description: '玄阳长老说后山狼群近来伤了几名外门弟子，命你去处置。',
    kind: 'main',
    chapter: 1,
    giverNpcId: 'npc-zhanglao',
    turnInNpcId: 'npc-zhanglao',
    requirements: [{ type: 'quest_state', questId: 'quest-c1-01', state: 'claimed' }],
    objectives: [{ type: 'kill_monster', monsterId: 'monster-qingyun-wolf', count: 5 }],
    reward: {
      exp: 500,
      spiritStones: 400,
      items: [{ itemId: 'pill-heal', qty: 2 }],
    },
    prerequisiteQuestId: 'quest-c1-01',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c1-03',
    name: '采药之约',
    description: '百草仙翁要炼一炉聚气丹，缺十株灵草。他说药篓太沉，走不动路。',
    kind: 'side',
    chapter: 1,
    giverNpcId: 'npc-yaowang',
    turnInNpcId: 'npc-yaowang',
    requirements: [{ type: 'quest_state', questId: 'quest-c1-01', state: 'claimed' }],
    objectives: [{ type: 'collect_item', itemId: 'mat-spirit-herb', count: 10 }],
    reward: {
      exp: 400,
      spiritStones: 300,
      items: [{ itemId: 'pill-qi', qty: 5 }],
    },
    prerequisiteQuestId: 'quest-c1-01',
    advancesChapterTo: null,
    repeatable: true,
  },
  {
    id: 'quest-c1-05',
    name: '铁玄的托付',
    description: '铁玄要三块玄铁精重铸一柄剑。他不肯说是为谁铸的。',
    kind: 'side',
    chapter: 1,
    giverNpcId: 'npc-tiejiang',
    turnInNpcId: 'npc-tiejiang',
    requirements: [{ type: 'stage_at_least', stageIndex: 1 }],
    objectives: [{ type: 'collect_item', itemId: 'mat-iron-essence', count: 3 }],
    reward: {
      exp: 600,
      spiritStones: 200,
      items: [{ itemId: 'treasure-sword', qty: 1 }],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c1-04',
    name: '练气圆满',
    description: '云鹤真人说，练气圆满方能议筑基之事。修行本无捷径。',
    kind: 'main',
    chapter: 1,
    giverNpcId: 'npc-zhangmen',
    turnInNpcId: 'npc-zhangmen',
    requirements: [{ type: 'quest_state', questId: 'quest-c1-02', state: 'claimed' }],
    objectives: [{ type: 'reach_stage', stageIndex: 3 }],
    reward: {
      exp: 0,
      spiritStones: 1000,
      items: [{ itemId: 'pill-breakthrough', qty: 1 }],
    },
    prerequisiteQuestId: 'quest-c1-02',
    advancesChapterTo: 2,
    repeatable: false,
  },

  // ============================ 第二章 · 洛水风波 (筑基) ============================
  {
    id: 'quest-c2-01',
    name: '洛水来信',
    description: '洛水城传来急信，城中修士接连失踪。云鹤真人命你前去查看。',
    kind: 'main',
    chapter: 2,
    giverNpcId: 'npc-zhangmen',
    turnInNpcId: 'npc-zhangmen',
    requirements: [{ type: 'stage_at_least', stageIndex: 4 }],
    objectives: [{ type: 'kill_monster', monsterId: 'monster-river-bandit', count: 8 }],
    reward: {
      exp: 6000,
      spiritStones: 2500,
      items: [{ itemId: 'pill-foundation', qty: 2 }],
    },
    prerequisiteQuestId: 'quest-c1-04',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c2-02',
    name: '蛟患',
    description: '玄阳长老查明失踪案与洛水蛟有关。此物已成气候，需早除之。',
    kind: 'main',
    chapter: 2,
    giverNpcId: 'npc-zhanglao',
    turnInNpcId: 'npc-zhanglao',
    requirements: [{ type: 'quest_state', questId: 'quest-c2-01', state: 'claimed' }],
    objectives: [{ type: 'kill_monster', monsterId: 'monster-luoshui-flood-dragon', count: 3 }],
    reward: {
      exp: 12000,
      spiritStones: 4000,
      items: [{ itemId: 'robe-daoist', qty: 1 }],
    },
    prerequisiteQuestId: 'quest-c2-01',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c2-03',
    name: '云纹丝',
    description: '百草仙翁要几缕云纹丝配药，说是能安神。你怀疑他另有用处。',
    kind: 'side',
    chapter: 2,
    giverNpcId: 'npc-yaowang',
    turnInNpcId: 'npc-yaowang',
    requirements: [{ type: 'stage_at_least', stageIndex: 5 }],
    objectives: [{ type: 'collect_item', itemId: 'mat-cloud-silk', count: 4 }],
    reward: {
      exp: 8000,
      spiritStones: 2000,
      items: [{ itemId: 'pill-spirit', qty: 2 }],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: true,
  },
  {
    id: 'quest-c2-04',
    name: '钱多多的账',
    description: '钱多多有笔货款收不回来，欠债的是个散修。他想请你「讲讲道理」。',
    kind: 'side',
    chapter: 2,
    giverNpcId: 'npc-shangren',
    turnInNpcId: 'npc-shangren',
    requirements: [{ type: 'stage_at_least', stageIndex: 5 }],
    objectives: [{ type: 'defeat_bot', botId: null, count: 1 }],
    reward: {
      exp: 5000,
      spiritStones: 5000,
      items: [],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: true,
  },
  {
    id: 'quest-c2-05',
    name: '论道台',
    description: '青鸾仙子邀你上论道台。她说：「纸上得来终觉浅。」',
    kind: 'main',
    chapter: 2,
    giverNpcId: 'npc-xianzi',
    turnInNpcId: 'npc-xianzi',
    requirements: [{ type: 'quest_state', questId: 'quest-c2-02', state: 'claimed' }],
    objectives: [
      { type: 'defeat_bot', botId: null, count: 3 },
      { type: 'clear_dungeon', dungeonId: 'dungeon-qingyun' },
    ],
    reward: {
      exp: 30000,
      spiritStones: 8000,
      items: [{ itemId: 'pill-breakthrough', qty: 2 }],
    },
    prerequisiteQuestId: 'quest-c2-02',
    advancesChapterTo: 3,
    repeatable: false,
  },
  {
    id: 'quest-c2-06',
    name: '断刃',
    description: '铁玄从炉边摸出半截断刃：「妖丹六枚，我给它重新开锋。这刃是从洛水里捞上来的。」',
    kind: 'side',
    chapter: 2,
    giverNpcId: 'npc-tiejiang',
    turnInNpcId: 'npc-tiejiang',
    requirements: [
      { type: 'stage_at_least', stageIndex: 5 },
      { type: 'quest_state', questId: 'quest-c1-05', state: 'claimed' },
    ],
    objectives: [{ type: 'collect_item', itemId: 'mat-beast-core', count: 6 }],
    reward: {
      exp: 9000,
      spiritStones: 1500,
      items: [{ itemId: 'treasure-bell', qty: 1 }],
    },
    prerequisiteQuestId: 'quest-c1-05',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c2-07',
    name: '后山巡守',
    description: '守山弟子搓着手：「灵猿最近闹得凶，师兄若得空……」后半句他没敢说出口。',
    kind: 'daily',
    chapter: 2,
    giverNpcId: 'npc-zhenshou',
    turnInNpcId: 'npc-zhenshou',
    requirements: [{ type: 'quest_state', questId: 'quest-c1-01', state: 'claimed' }],
    objectives: [{ type: 'kill_monster', monsterId: 'monster-spirit-ape', count: 6 }],
    reward: {
      exp: 3000,
      spiritStones: 1200,
      items: [{ itemId: 'pill-heal', qty: 2 }],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: true,
  },

  // ============================ 第三章 · 幽冥问道 (金丹) ============================
  {
    id: 'quest-c3-01',
    name: '幽冥谷之约',
    description: '云鹤真人取出一枚残破玉简：「三十年前，你师伯入幽冥谷，再未出来。」',
    kind: 'main',
    chapter: 3,
    giverNpcId: 'npc-zhangmen',
    turnInNpcId: 'npc-zhangmen',
    requirements: [{ type: 'stage_at_least', stageIndex: 8 }],
    objectives: [
      { type: 'kill_monster', monsterId: 'monster-ghost-lantern', count: 10 },
      { type: 'collect_item', itemId: 'mat-soul-crystal', count: 5 },
    ],
    reward: {
      exp: 200000,
      spiritStones: 20000,
      items: [{ itemId: 'pill-golden-core', qty: 1 }],
    },
    prerequisiteQuestId: 'quest-c2-05',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c3-03',
    name: '白骨令',
    description: '玄阳长老将一枚焦黑的令牌拍在案上：「幽冥谷的白骨将，是拿我宗门弟子的骨头堆起来的。」',
    kind: 'main',
    chapter: 3,
    giverNpcId: 'npc-zhanglao',
    turnInNpcId: 'npc-zhanglao',
    requirements: [{ type: 'quest_state', questId: 'quest-c3-01', state: 'claimed' }],
    objectives: [{ type: 'kill_monster', monsterId: 'monster-bone-general', count: 8 }],
    reward: {
      exp: 400000,
      spiritStones: 30000,
      items: [{ itemId: 'acc-prayer-beads', qty: 1 }],
    },
    prerequisiteQuestId: 'quest-c3-01',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c3-02',
    name: '老者的斗笠',
    description: '无名老者忽然开口：「你若能从鬼帝殿中带回一物，我便告诉你一件事。」',
    kind: 'main',
    chapter: 3,
    giverNpcId: 'npc-laozhe',
    turnInNpcId: 'npc-laozhe',
    requirements: [{ type: 'quest_state', questId: 'quest-c3-03', state: 'claimed' }],
    objectives: [{ type: 'clear_dungeon', dungeonId: 'dungeon-youming' }],
    reward: {
      exp: 800000,
      spiritStones: 50000,
      items: [{ itemId: 'pill-enlightenment', qty: 1 }],
    },
    prerequisiteQuestId: 'quest-c3-03',
    advancesChapterTo: null,
    repeatable: false,
  },
  {
    id: 'quest-c3-04',
    name: '引路灯',
    description: '百草仙翁难得正色：「魂晶三枚，灵玉两块。老夫炼一盏引路灯给你——进谷时点上。」',
    kind: 'side',
    chapter: 3,
    giverNpcId: 'npc-yaowang',
    turnInNpcId: 'npc-yaowang',
    requirements: [{ type: 'stage_at_least', stageIndex: 9 }],
    objectives: [
      { type: 'collect_item', itemId: 'mat-soul-crystal', count: 3 },
      { type: 'collect_item', itemId: 'mat-jade', count: 2 },
    ],
    reward: {
      exp: 120000,
      spiritStones: 12000,
      items: [{ itemId: 'pill-golden-core', qty: 1 }],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: true,
  },
  {
    id: 'quest-c3-05',
    name: '洛水沉船',
    description: '钱多多压低了嗓子：「洛水秘境底下沉着我一船货。您替我取回来，三成归您。」',
    kind: 'side',
    chapter: 3,
    giverNpcId: 'npc-shangren',
    turnInNpcId: 'npc-shangren',
    requirements: [{ type: 'stage_at_least', stageIndex: 8 }],
    objectives: [{ type: 'clear_dungeon', dungeonId: 'dungeon-luoshui' }],
    reward: {
      exp: 150000,
      spiritStones: 25000,
      items: [{ itemId: 'mat-thunder-wood', qty: 2 }],
    },
    prerequisiteQuestId: null,
    advancesChapterTo: null,
    repeatable: false,
  },
];

export const QUESTS: readonly Quest[] = SPECS.map((q) => QuestSchema.parse(q));
export const QUEST_BY_ID: ReadonlyMap<string, Quest> = indexById(QUESTS);
export const QUEST_IDS: readonly string[] = QUESTS.map((q) => q.id);

const CHAPTER_SPECS: StoryChapter[] = [
  {
    chapter: 1,
    title: '第一章 · 初入青云',
    summary: '你自凡尘而来，拜入青云宗门下。练气三月，方知修行之难。',
    unlockStage: 0,
    questIds: ['quest-c1-01', 'quest-c1-02', 'quest-c1-03', 'quest-c1-05', 'quest-c1-04'],
  },
  {
    chapter: 2,
    title: '第二章 · 洛水风波',
    summary: '洛水城修士离奇失踪，蛟龙潜于河底。一桩旧案就此翻起。',
    unlockStage: 4,
    questIds: [
      'quest-c2-01',
      'quest-c2-02',
      'quest-c2-03',
      'quest-c2-04',
      'quest-c2-06',
      'quest-c2-07',
      'quest-c2-05',
    ],
  },
  {
    chapter: 3,
    title: '第三章 · 幽冥问道',
    summary: '三十年前失踪的师伯，斗笠下不肯露面的老者，鬼帝殿中的那件旧物。',
    unlockStage: 8,
    questIds: [
      'quest-c3-01',
      'quest-c3-03',
      'quest-c3-04',
      'quest-c3-05',
      'quest-c3-02',
    ],
  },
];

export const STORY_CHAPTERS: readonly StoryChapter[] = CHAPTER_SPECS.map((c) =>
  StoryChapterSchema.parse(c),
);

export function getQuest(id: string): Quest | undefined {
  return QUEST_BY_ID.get(id);
}

/** Quests handed out by one NPC. */
export function questsFromNpc(npcId: string): readonly Quest[] {
  return QUESTS.filter((q) => q.giverNpcId === npcId);
}

/** Quests reported back to one NPC. */
export function questsTurnedInAt(npcId: string): readonly Quest[] {
  return QUESTS.filter((q) => q.turnInNpcId === npcId);
}

/** Quests belonging to one story chapter, in the chapter's own order. */
export function questsInChapter(chapter: number): readonly Quest[] {
  const spec = STORY_CHAPTERS.find((c) => c.chapter === chapter);
  if (!spec) return [];
  return spec.questIds.flatMap((id) => {
    const quest = QUEST_BY_ID.get(id);
    return quest ? [quest] : [];
  });
}

/** The chapter a stage index has unlocked, 1 when none is reached yet. */
export function chapterAtStage(stageIndex: number): number {
  let highest = 1;
  for (const c of STORY_CHAPTERS) {
    if (c.unlockStage <= stageIndex) highest = Math.max(highest, c.chapter);
  }
  return highest;
}
