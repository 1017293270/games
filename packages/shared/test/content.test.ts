import { describe, expect, it } from 'vitest';
import { validateContent } from '../src/content/registry.js';
import { EQUIPMENT_ITEMS, ITEMS, ITEM_BY_ID, MATERIAL_ITEMS, PILL_ITEMS } from '../src/content/items.js';
import { SKILLS, SKILL_BY_ID, skillTree, starterSkillIds } from '../src/content/skills.js';
import { TECHNIQUES } from '../src/content/techniques.js';
import { BOSSES, MONSTERS, tribulationAvatar } from '../src/content/monsters.js';
import type { Monster } from '../src/domain/monster.js';
import { ENCOUNTERS, EXPLORE_MAPS } from '../src/content/maps.js';
import { DUNGEONS } from '../src/content/dungeons.js';
import { NPCS } from '../src/content/npcs.js';
import { DIALOGUES } from '../src/content/dialogues.js';
import { QUESTS, QUEST_BY_ID, STORY_CHAPTERS } from '../src/content/quests.js';
import { SHOPS, buyPriceAt, sellPriceAt } from '../src/content/shops.js';
import {
  BOT_ARCHETYPES,
  botCultivationMultiplier,
  decideBotAction,
  generateBotName,
  generateBotNames,
  rollBotArchetype,
} from '../src/content/bots.js';
import { ELEMENTS } from '../src/domain/stats.js';
import { createRng } from '../src/core/rng.js';
import { MAX_STAGE_INDEX } from '../src/cultivation/realms.js';

describe('cross-reference integrity', () => {
  it('has no dangling references anywhere in the content tables', () => {
    const issues = validateContent();
    if (issues.length > 0) {
      throw new Error(
        `content integrity failures:\n${issues.map((i) => `  ${i.where}: ${i.message}`).join('\n')}`,
      );
    }
    expect(issues).toEqual([]);
  });
});

describe('items', () => {
  it('defines all 30 道具 from the asset contract', () => {
    expect(ITEMS).toHaveLength(30);
    expect(PILL_ITEMS).toHaveLength(8);
    expect(MATERIAL_ITEMS).toHaveLength(8);
    expect(EQUIPMENT_ITEMS).toHaveLength(14);
  });

  it('gives every item a unique id and a unique art asset', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(30);
    expect(new Set(ITEMS.map((i) => i.art)).size).toBe(30);
  });

  it('covers all four equipment slots', () => {
    const bySlot = new Map<string, number>();
    for (const e of EQUIPMENT_ITEMS) bySlot.set(e.slot, (bySlot.get(e.slot) ?? 0) + 1);
    expect(bySlot.get('treasure')).toBe(4);
    expect(bySlot.get('robe')).toBe(4);
    expect(bySlot.get('accessory')).toBe(3);
    expect(bySlot.get('pet')).toBe(3);
  });

  it('prices buying above selling so trading is never free money', () => {
    for (const item of ITEMS) {
      if (item.buyPrice !== null) expect(item.buyPrice).toBeGreaterThan(item.sellPrice);
    }
  });

  it('keeps equipment requiredStage inside the ladder', () => {
    for (const e of EQUIPMENT_ITEMS) {
      expect(e.requiredStage).toBeGreaterThanOrEqual(0);
      expect(e.requiredStage).toBeLessThanOrEqual(MAX_STAGE_INDEX);
    }
  });
});

describe('skills', () => {
  it('defines 15 神通: five elements x three tiers', () => {
    expect(SKILLS).toHaveLength(15);
    for (const element of ELEMENTS) {
      const tree = skillTree(element);
      expect(tree).toHaveLength(3);
      expect(tree.map((s) => s.tier)).toEqual([1, 2, 3]);
    }
  });

  it('covers every skill type', () => {
    const types = new Set(SKILLS.map((s) => s.type));
    expect(types).toEqual(new Set(['damage', 'heal', 'buff', 'debuff']));
  });

  it('raises cost and unlock stage with tier', () => {
    for (const element of ELEMENTS) {
      const [t1, t2, t3] = skillTree(element);
      expect(t1!.manaCost).toBeLessThan(t2!.manaCost);
      expect(t2!.manaCost).toBeLessThan(t3!.manaCost);
      expect(t1!.unlockStage).toBeLessThan(t2!.unlockStage);
      expect(t2!.unlockStage).toBeLessThan(t3!.unlockStage);
    }
  });

  it('keeps every skill castable against the 100 灵力 pool', () => {
    for (const s of SKILLS) expect(s.manaCost).toBeLessThanOrEqual(100);
  });

  it('hands new characters exactly four starter 神通', () => {
    for (const element of ELEMENTS) {
      const ids = starterSkillIds(element);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      for (const id of ids) {
        const skill = SKILL_BY_ID.get(id);
        expect(skill).toBeDefined();
        expect(skill!.unlockStage).toBe(0);
      }
      // The character's own element leads the rotation.
      expect(SKILL_BY_ID.get(ids[0]!)!.element).toBe(element);
    }
  });
});

describe('techniques', () => {
  it('defines at least six 功法', () => {
    expect(TECHNIQUES.length).toBeGreaterThanOrEqual(6);
  });

  it('raises the cultivation bonus with the learning cost', () => {
    const sorted = [...TECHNIQUES].sort((a, b) => a.learnCost - b.learnCost);
    expect(sorted[0]!.learnCost).toBe(0);
    expect(sorted[sorted.length - 1]!.cultivationBonus).toBeGreaterThan(
      sorted[0]!.cultivationBonus,
    );
  });
});

describe('monsters and dungeons', () => {
  it('defines 8 妖兽 and 4 BOSS', () => {
    expect(MONSTERS).toHaveLength(12);
    expect(BOSSES).toHaveLength(4);
    expect(MONSTERS.filter((m) => !m.isBoss)).toHaveLength(8);
  });

  it('makes BOSS stat blocks far beefier than a same-stage 妖兽', () => {
    const normals = MONSTERS.filter((m) => !m.isBoss);
    for (const boss of BOSSES) {
      // The nearest 妖兽 by 境界, whatever the gap: the entrance bands sit at
      // their field's 解锁阶, so the top BOSS has no neighbour within two.
      const peer = [...normals].sort(
        (a, b) =>
          Math.abs(a.stageIndex - boss.stageIndex) - Math.abs(b.stageIndex - boss.stageIndex),
      )[0];
      expect(peer).toBeDefined();
      expect(boss.stats.hp).toBeGreaterThan((peer as Monster).stats.hp * 2);
    }
  });

  it('scales rewards with the monster stage', () => {
    const normals = MONSTERS.filter((m) => !m.isBoss).sort((a, b) => a.stageIndex - b.stageIndex);
    for (let i = 1; i < normals.length; i += 1) {
      expect(normals[i]!.expReward).toBeGreaterThan(normals[i - 1]!.expReward);
    }
  });

  it('generates a 天劫化身 for the 渡劫 breakthrough', () => {
    const avatar = tribulationAvatar();
    expect(avatar.isBoss).toBe(true);
    expect(avatar.stats.hp).toBeGreaterThan(0);
    expect(avatar.skills.length).toBe(4);
    // It exists purely as a gate; it drops nothing.
    expect(avatar.loot).toEqual([]);
    expect(avatar.expReward).toBe(0);
  });

  it('defines 4 秘境 with a distinct BOSS each', () => {
    expect(DUNGEONS).toHaveLength(4);
    expect(new Set(DUNGEONS.map((d) => d.bossId)).size).toBe(4);
    for (const d of DUNGEONS) expect(d.waves.length).toBeGreaterThanOrEqual(1);
  });

  it('unlocks dungeons in ascending order', () => {
    const unlocks = DUNGEONS.map((d) => d.unlockStage);
    expect([...unlocks].sort((a, b) => a - b)).toEqual(unlocks);
  });
});

describe('maps', () => {
  it('defines the four maps with two 妖兽 and at least two 奇遇 each', () => {
    expect(EXPLORE_MAPS).toHaveLength(4);
    for (const m of EXPLORE_MAPS) {
      expect(m.monsterIds).toHaveLength(2);
      expect(m.encounterIds.length).toBeGreaterThanOrEqual(2);
      expect(m.gather.loot.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('unlocks 青云山 -> 洛水城 -> 幽冥谷 -> 昆仑墟 in order', () => {
    expect(EXPLORE_MAPS.map((m) => m.id)).toEqual([
      'map-qingyun-mountain',
      'map-luoshui-city',
      'map-youming-valley',
      'map-kunlun-ruins',
    ]);
    const unlocks = EXPLORE_MAPS.map((m) => m.unlockStage);
    expect(unlocks).toEqual([0, 4, 8, 12]);
  });

  it('gives every 奇遇 at least two choices with outcomes', () => {
    expect(ENCOUNTERS.length).toBeGreaterThanOrEqual(8);
    for (const e of ENCOUNTERS) {
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(new Set(e.options.map((o) => o.id)).size).toBe(e.options.length);
      for (const o of e.options) expect(o.outcomeText.length).toBeGreaterThan(0);
    }
  });

  it('keeps loot chances a valid probability', () => {
    for (const m of EXPLORE_MAPS) {
      for (const l of m.gather.loot) {
        expect(l.chance).toBeGreaterThan(0);
        expect(l.chance).toBeLessThanOrEqual(1);
        expect(l.max).toBeGreaterThanOrEqual(l.min);
      }
    }
    for (const m of MONSTERS) {
      for (const l of m.loot) {
        expect(l.chance).toBeGreaterThan(0);
        expect(l.chance).toBeLessThanOrEqual(1);
        expect(l.max).toBeGreaterThanOrEqual(l.min);
      }
    }
  });
});

describe('npcs, dialogue and quests', () => {
  it('defines the eight 青云镇 NPCs', () => {
    expect(NPCS).toHaveLength(8);
    expect(new Set(NPCS.map((n) => n.art)).size).toBe(8);
    const roles = new Set(NPCS.map((n) => n.role));
    for (const role of ['sect_master', 'elder', 'alchemist', 'merchant', 'hermit', 'blacksmith', 'arena_host', 'guard']) {
      expect(roles.has(role as never)).toBe(true);
    }
  });

  it('gives every NPC a reachable dialogue tree', () => {
    expect(DIALOGUES).toHaveLength(8);
    for (const tree of DIALOGUES) {
      const nodeIds = new Set(tree.nodes.map((n) => n.id));
      expect(nodeIds.has(tree.rootNodeId)).toBe(true);
      // Every node must be reachable from the root.
      const seen = new Set<string>([tree.rootNodeId]);
      const queue = [tree.rootNodeId];
      while (queue.length > 0) {
        const id = queue.shift() as string;
        const node = tree.nodes.find((n) => n.id === id);
        for (const choice of node?.choices ?? []) {
          if (choice.next && !seen.has(choice.next)) {
            seen.add(choice.next);
            queue.push(choice.next);
          }
        }
      }
      expect(seen.size).toBe(tree.nodes.length);
    }
  });

  it('gives every dialogue node at least one way out', () => {
    for (const tree of DIALOGUES) {
      for (const node of tree.nodes) {
        expect(node.choices.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers all six objective kinds across the quest set', () => {
    const kinds = new Set(QUESTS.flatMap((q) => q.objectives.map((o) => o.type)));
    expect(kinds).toEqual(
      new Set([
        'kill_monster',
        'collect_item',
        'reach_stage',
        'defeat_bot',
        'clear_dungeon',
        'talk_npc',
      ]),
    );
  });

  it('defines three chapters with quests that exist', () => {
    expect(STORY_CHAPTERS).toHaveLength(3);
    for (const c of STORY_CHAPTERS) {
      expect(c.questIds.length).toBeGreaterThan(0);
      for (const q of c.questIds) expect(QUEST_BY_ID.has(q)).toBe(true);
    }
    expect(STORY_CHAPTERS.map((c) => c.unlockStage)).toEqual([0, 4, 8]);
  });

  it('forms an acyclic prerequisite chain', () => {
    for (const quest of QUESTS) {
      const seen = new Set<string>([quest.id]);
      let cursor = quest.prerequisiteQuestId;
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = QUEST_BY_ID.get(cursor)?.prerequisiteQuestId ?? null;
      }
    }
  });

  it('makes chapter 1 completable from a fresh character', () => {
    const chapter1 = QUESTS.filter((q) => q.chapter === 1);
    expect(chapter1.length).toBeGreaterThanOrEqual(4);
    // The opening quest must have no prerequisite and no stage gate.
    const opener = QUEST_BY_ID.get('quest-c1-01');
    expect(opener).toBeDefined();
    expect(opener!.prerequisiteQuestId).toBeNull();
    expect(opener!.requirements).toEqual([]);
    // Exactly one chapter-1 quest advances the story.
    expect(chapter1.filter((q) => q.advancesChapterTo !== null)).toHaveLength(1);
  });
});

describe('shops', () => {
  it('defines three shops bound to their NPCs', () => {
    expect(SHOPS).toHaveLength(3);
    for (const shop of SHOPS) {
      expect(shop.entries.length).toBeGreaterThan(0);
      expect(NPCS.some((n) => n.id === shop.npcId)).toBe(true);
    }
  });

  it('always sells above what it buys back for', () => {
    for (const shop of SHOPS) {
      for (const entry of shop.entries) {
        const sell = sellPriceAt(shop.id, entry.itemId);
        expect(entry.price).toBeGreaterThan(sell);
      }
    }
  });

  it('resolves prices only for stocked items', () => {
    expect(buyPriceAt('shop-yaowang', 'pill-qi')).toBe(60);
    expect(buyPriceAt('shop-yaowang', 'treasure-seal')).toBeNull();
    expect(buyPriceAt('no-such-shop', 'pill-qi')).toBeNull();
    expect(sellPriceAt('shop-shangren', 'mat-spirit-herb')).toBe(
      Math.floor(ITEM_BY_ID.get('mat-spirit-herb')!.sellPrice * 0.4),
    );
  });
});

describe('bots', () => {
  it('defines the six archetypes with the specified parameters', () => {
    expect(BOT_ARCHETYPES).toHaveLength(6);
    const byName = new Map(BOT_ARCHETYPES.map((a) => [a.name, a.params]));
    expect(byName.get('天骄')).toMatchObject({
      talent: 2.5,
      diligence: 0.9,
      insight: 0.15,
      aggression: 0.3,
    });
    expect(byName.get('苦修')).toMatchObject({ talent: 1.0, diligence: 1.0, insight: 0, aggression: 0.1 });
    expect(byName.get('散修')).toMatchObject({ talent: 0.8, diligence: 0.5, insight: 0, aggression: 0.2 });
    expect(byName.get('纨绔')).toMatchObject({ talent: 1.5, diligence: 0.3, insight: 0, aggression: 0.4 });
    expect(byName.get('魔修')).toMatchObject({ talent: 1.2, diligence: 0.7, insight: 0.05, aggression: 0.8 });
    expect(byName.get('隐士')).toMatchObject({ talent: 1.0, diligence: 0.6, insight: 0.1, aggression: 0 });
  });

  it('gives every archetype a legal active-hour window', () => {
    for (const a of BOT_ARCHETYPES) {
      const [start, end] = a.params.activeHours;
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThanOrEqual(23);
      expect(end).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(24);
    }
  });

  it('generates stable, plausible 道号', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const name = generateBotName(seed);
      expect(name).toBe(generateBotName(seed));
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(16);
      expect(name).toMatch(/^[一-龥]+$/);
    }
  });

  it('generates a batch of distinct names', () => {
    const names = generateBotNames(1234, 200);
    expect(names).toHaveLength(200);
    expect(new Set(names).size).toBe(200);
    // Reproducible from the same seed.
    expect(generateBotNames(1234, 200)).toEqual(names);
  });

  it('picks archetypes by weight', () => {
    const rng = createRng(99);
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i += 1) {
      const a = rollBotArchetype(rng);
      counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
    }
    // 散修 has the highest weight (34) and 天骄 the lowest-but-one (6).
    expect(counts.get('bot-sanxiu')!).toBeGreaterThan(counts.get('bot-tianjiao')!);
  });

  it('slows a bot outside its active hours', () => {
    const nightOwl = BOT_ARCHETYPES.find((a) => a.id === 'bot-moxiu')!.params; // 18-6
    const atNight = botCultivationMultiplier(nightOwl, 22);
    const atNoon = botCultivationMultiplier(nightOwl, 12);
    expect(atNight).toBeGreaterThan(atNoon);
  });

  it('always tries to break through when parked at 圆满', () => {
    const rng = createRng(1);
    for (const a of BOT_ARCHETYPES) {
      expect(
        decideBotAction(
          {
            params: a.params,
            utcHour: 12,
            atPerfection: true,
            breakthroughPills: 0,
            dungeonRunsToday: 0,
            arenaChallengesToday: 0,
            dungeonDailyLimit: 3,
            arenaDailyLimit: 10,
          },
          rng,
        ),
      ).toBe('breakthrough');
    }
  });

  it('returns only legal actions', () => {
    const legal = new Set(['cultivate', 'explore', 'dungeon', 'arena', 'breakthrough']);
    const rng = createRng(7);
    for (const a of BOT_ARCHETYPES) {
      for (let hour = 0; hour < 24; hour += 1) {
        for (let i = 0; i < 20; i += 1) {
          const action = decideBotAction(
            {
              params: a.params,
              utcHour: hour,
              atPerfection: false,
              breakthroughPills: 0,
              dungeonRunsToday: 0,
              arenaChallengesToday: 0,
              dungeonDailyLimit: 3,
              arenaDailyLimit: 10,
            },
            rng,
          );
          expect(legal.has(action)).toBe(true);
        }
      }
    }
  });

  it('makes 魔修 pick fights far more often than 隐士', () => {
    const aggressive = BOT_ARCHETYPES.find((a) => a.id === 'bot-moxiu')!.params;
    const peaceful = BOT_ARCHETYPES.find((a) => a.id === 'bot-yinshi')!.params;
    const count = (params: typeof aggressive): number => {
      const rng = createRng(31);
      let arena = 0;
      for (let i = 0; i < 2000; i += 1) {
        const action = decideBotAction(
          {
            params,
            utcHour: params.activeHours[0],
            atPerfection: false,
            breakthroughPills: 0,
            dungeonRunsToday: 0,
            arenaChallengesToday: 0,
            dungeonDailyLimit: 3,
            arenaDailyLimit: 10,
          },
          rng,
        );
        if (action === 'arena') arena += 1;
      }
      return arena;
    };
    expect(count(aggressive)).toBeGreaterThan(count(peaceful));
    expect(count(peaceful)).toBe(0);
  });
});
