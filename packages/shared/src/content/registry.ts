/**
 * Cross-reference integrity for the content tables.
 *
 * Every id one table points at must resolve in another: a monster's skills, a
 * loot row's item, a map's monsters and encounters, a quest's objectives, a
 * dialogue effect's quest, a shop entry's item, an `art` field's asset ID.
 * `validateContent` walks all of it and returns a list of human-readable
 * problems; the test suite asserts that list is empty, and the admin panel can
 * surface it after a live content edit.
 */

import { isArtId, type ArtId } from '../core/art.js';
import { ITEMS, ITEM_BY_ID } from './items.js';
import { SKILLS, SKILL_BY_ID } from './skills.js';
import { TECHNIQUES, TECHNIQUE_BY_ID } from './techniques.js';
import { MONSTERS, MONSTER_BY_ID } from './monsters.js';
import { ENCOUNTERS, ENCOUNTER_BY_ID, EXPLORE_MAPS, EXPLORE_MAP_BY_ID } from './maps.js';
import { DUNGEONS } from './dungeons.js';
import { MONSTER_SPRITE, ZONES } from './zones.js';
import { zoneAreaInBounds, type Zone, type ZoneArea } from '../domain/zone.js';
import { NPCS, NPC_BY_ID } from './npcs.js';
import { DIALOGUES, DIALOGUE_BY_ID } from './dialogues.js';
import { QUESTS, QUEST_BY_ID, STORY_CHAPTERS } from './quests.js';
import { SHOPS, SHOP_BY_ID } from './shops.js';
import { BOT_ARCHETYPES } from './bots.js';
import type { Effect } from '../domain/script.js';

export interface ContentIssue {
  where: string;
  message: string;
}

function checkArt(issues: ContentIssue[], where: string, art: string | null | undefined): void {
  if (art == null) return;
  if (!isArtId(art)) issues.push({ where, message: `unknown art id "${art}"` });
}

function checkItem(issues: ContentIssue[], where: string, itemId: string): void {
  if (!ITEM_BY_ID.has(itemId)) issues.push({ where, message: `unknown item "${itemId}"` });
}

function checkSkill(issues: ContentIssue[], where: string, skillId: string): void {
  if (!SKILL_BY_ID.has(skillId)) issues.push({ where, message: `unknown skill "${skillId}"` });
}

function checkZoneArea(
  issues: ContentIssue[],
  where: string,
  zone: Zone,
  area: ZoneArea,
): void {
  if (!zoneAreaInBounds(area, zone.width, zone.height)) {
    issues.push({ where, message: `area ${area.x},${area.y} ${area.w}x${area.h} leaves the zone` });
  }
}

function checkEffects(issues: ContentIssue[], where: string, effects: readonly Effect[]): void {
  for (const [i, effect] of effects.entries()) {
    const at = `${where}.effects[${i}]`;
    switch (effect.type) {
      case 'give_item':
      case 'take_item':
        checkItem(issues, at, effect.itemId);
        break;
      case 'accept_quest':
      case 'complete_quest':
        if (!QUEST_BY_ID.has(effect.questId)) {
          issues.push({ where: at, message: `unknown quest "${effect.questId}"` });
        }
        break;
      case 'open_shop':
        if (!SHOP_BY_ID.has(effect.shopId)) {
          issues.push({ where: at, message: `unknown shop "${effect.shopId}"` });
        }
        break;
      case 'learn_technique':
        if (!TECHNIQUE_BY_ID.has(effect.techniqueId)) {
          issues.push({ where: at, message: `unknown technique "${effect.techniqueId}"` });
        }
        break;
      case 'learn_skill':
        checkSkill(issues, at, effect.skillId);
        break;
      case 'start_battle':
        if (!MONSTER_BY_ID.has(effect.monsterId)) {
          issues.push({ where: at, message: `unknown monster "${effect.monsterId}"` });
        }
        break;
      default:
        break;
    }
  }
}

/** Returns every dangling reference in the content tables. Empty means clean. */
export function validateContent(): ContentIssue[] {
  const issues: ContentIssue[] = [];

  for (const item of ITEMS) checkArt(issues, `item:${item.id}`, item.art);

  for (const monster of MONSTERS) {
    const where = `monster:${monster.id}`;
    checkArt(issues, where, monster.art);
    for (const s of monster.skills) checkSkill(issues, `${where}.skills`, s);
    for (const l of monster.loot) checkItem(issues, `${where}.loot`, l.itemId);
  }

  for (const map of EXPLORE_MAPS) {
    const where = `map:${map.id}`;
    checkArt(issues, where, map.art);
    for (const m of map.monsterIds) {
      if (!MONSTER_BY_ID.has(m)) issues.push({ where, message: `unknown monster "${m}"` });
    }
    for (const l of map.gather.loot) checkItem(issues, `${where}.gather`, l.itemId);
    for (const e of map.encounterIds) {
      if (!ENCOUNTER_BY_ID.has(e)) issues.push({ where, message: `unknown encounter "${e}"` });
    }
  }

  for (const enc of ENCOUNTERS) {
    const where = `encounter:${enc.id}`;
    checkArt(issues, where, enc.art);
    for (const opt of enc.options) checkEffects(issues, `${where}.${opt.id}`, opt.effects);
  }

  for (const d of DUNGEONS) {
    const where = `dungeon:${d.id}`;
    checkArt(issues, where, d.art);
    for (const wave of d.waves) {
      for (const m of wave) {
        if (!MONSTER_BY_ID.has(m)) issues.push({ where, message: `unknown monster "${m}"` });
      }
    }
    if (!MONSTER_BY_ID.has(d.bossId)) {
      issues.push({ where, message: `unknown boss "${d.bossId}"` });
    } else if (!MONSTER_BY_ID.get(d.bossId)?.isBoss) {
      issues.push({ where, message: `"${d.bossId}" is not flagged isBoss` });
    }
    for (const l of d.reward.loot) checkItem(issues, `${where}.reward`, l.itemId);
  }

  for (const zone of ZONES) {
    const where = `zone:${zone.id}`;
    if (!EXPLORE_MAP_BY_ID.has(zone.id)) {
      issues.push({ where, message: `no ExploreMap with id "${zone.id}"` });
    }
    checkArt(issues, `${where}.floorArt`, zone.floorArt);
    checkZoneArea(issues, `${where}.boss`, zone, zone.boss.area);
    for (const [i, spawn] of zone.spawns.entries()) {
      const at = `${where}.spawns[${i}]`;
      if (!MONSTER_BY_ID.has(spawn.monsterId)) {
        issues.push({ where: at, message: `unknown monster "${spawn.monsterId}"` });
      }
      checkZoneArea(issues, at, zone, spawn.area);
    }
    if (!MONSTER_BY_ID.has(zone.boss.monsterId)) {
      issues.push({ where, message: `unknown boss "${zone.boss.monsterId}"` });
    } else if (!MONSTER_BY_ID.get(zone.boss.monsterId)?.isBoss) {
      issues.push({ where, message: `"${zone.boss.monsterId}" is not flagged isBoss` });
    }
  }

  for (const monster of MONSTERS) {
    const sprite = MONSTER_SPRITE[monster.id];
    if (sprite === undefined) {
      issues.push({ where: `sprite:${monster.id}`, message: 'no top-down sprite' });
    } else {
      checkArt(issues, `sprite:${monster.id}`, sprite);
    }
  }
  for (const id of Object.keys(MONSTER_SPRITE)) {
    if (!MONSTER_BY_ID.has(id)) {
      issues.push({ where: `sprite:${id}`, message: `unknown monster "${id}"` });
    }
  }

  for (const npc of NPCS) {
    const where = `npc:${npc.id}`;
    checkArt(issues, where, npc.art);
    if (!DIALOGUE_BY_ID.has(npc.dialogueId)) {
      issues.push({ where, message: `unknown dialogue "${npc.dialogueId}"` });
    }
    if (npc.shopId && !SHOP_BY_ID.has(npc.shopId)) {
      issues.push({ where, message: `unknown shop "${npc.shopId}"` });
    }
    for (const q of npc.questIds) {
      if (!QUEST_BY_ID.has(q)) issues.push({ where, message: `unknown quest "${q}"` });
    }
  }

  for (const tree of DIALOGUES) {
    const where = `dialogue:${tree.id}`;
    if (!NPC_BY_ID.has(tree.npcId)) {
      issues.push({ where, message: `unknown npc "${tree.npcId}"` });
    }
    const nodeIds = new Set(tree.nodes.map((n) => n.id));
    if (!nodeIds.has(tree.rootNodeId)) {
      issues.push({ where, message: `root node "${tree.rootNodeId}" missing` });
    }
    for (const node of tree.nodes) {
      const at = `${where}.${node.id}`;
      checkArt(issues, at, node.art);
      checkEffects(issues, at, node.onEnter);
      for (const choice of node.choices) {
        const cat = `${at}.${choice.id}`;
        checkEffects(issues, cat, choice.effects);
        if (choice.next !== null && !nodeIds.has(choice.next)) {
          issues.push({ where: cat, message: `dangling next "${choice.next}"` });
        }
      }
    }
  }

  for (const quest of QUESTS) {
    const where = `quest:${quest.id}`;
    if (!NPC_BY_ID.has(quest.giverNpcId)) {
      issues.push({ where, message: `unknown giver "${quest.giverNpcId}"` });
    }
    if (!NPC_BY_ID.has(quest.turnInNpcId)) {
      issues.push({ where, message: `unknown turn-in "${quest.turnInNpcId}"` });
    }
    if (quest.prerequisiteQuestId && !QUEST_BY_ID.has(quest.prerequisiteQuestId)) {
      issues.push({ where, message: `unknown prerequisite "${quest.prerequisiteQuestId}"` });
    }
    for (const [i, obj] of quest.objectives.entries()) {
      const at = `${where}.objectives[${i}]`;
      switch (obj.type) {
        case 'kill_monster':
          if (!MONSTER_BY_ID.has(obj.monsterId)) {
            issues.push({ where: at, message: `unknown monster "${obj.monsterId}"` });
          }
          break;
        case 'collect_item':
          checkItem(issues, at, obj.itemId);
          break;
        case 'clear_dungeon':
          if (!DUNGEONS.some((d) => d.id === obj.dungeonId)) {
            issues.push({ where: at, message: `unknown dungeon "${obj.dungeonId}"` });
          }
          break;
        case 'talk_npc':
          if (!NPC_BY_ID.has(obj.npcId)) {
            issues.push({ where: at, message: `unknown npc "${obj.npcId}"` });
          }
          break;
        case 'defeat_bot':
        case 'reach_stage':
          break;
      }
    }
    for (const r of quest.reward.items) checkItem(issues, `${where}.reward`, r.itemId);
  }

  for (const chapter of STORY_CHAPTERS) {
    for (const q of chapter.questIds) {
      if (!QUEST_BY_ID.has(q)) {
        issues.push({ where: `chapter:${chapter.chapter}`, message: `unknown quest "${q}"` });
      }
    }
  }

  for (const shop of SHOPS) {
    const where = `shop:${shop.id}`;
    if (!NPC_BY_ID.has(shop.npcId)) {
      issues.push({ where, message: `unknown npc "${shop.npcId}"` });
    }
    for (const entry of shop.entries) checkItem(issues, where, entry.itemId);
  }

  for (const archetype of BOT_ARCHETYPES) {
    const where = `bot:${archetype.id}`;
    for (const a of archetype.avatarPool) checkArt(issues, where, a);
  }

  for (const skill of SKILLS) {
    if (skill.type === 'buff' || skill.type === 'debuff') {
      if (!skill.modifier) {
        issues.push({ where: `skill:${skill.id}`, message: 'buff/debuff without a modifier' });
      }
    }
  }

  for (const tech of TECHNIQUES) {
    if (tech.elementAffinity > 0 && tech.element === null) {
      issues.push({
        where: `technique:${tech.id}`,
        message: 'elementAffinity set on an element-less technique',
      });
    }
  }

  return issues;
}

/** Every `art` ID referenced anywhere in the content tables. */
export function referencedArtIds(): ArtId[] {
  const ids = new Set<string>();
  for (const i of ITEMS) ids.add(i.art);
  for (const m of MONSTERS) ids.add(m.art);
  for (const m of EXPLORE_MAPS) ids.add(m.art);
  for (const d of DUNGEONS) ids.add(d.art);
  for (const n of NPCS) ids.add(n.art);
  for (const e of ENCOUNTERS) if (e.art) ids.add(e.art);
  for (const a of BOT_ARCHETYPES) for (const av of a.avatarPool) ids.add(av);
  for (const t of DIALOGUES) for (const n of t.nodes) if (n.art) ids.add(n.art);
  for (const z of ZONES) ids.add(z.floorArt);
  for (const sprite of Object.values(MONSTER_SPRITE)) ids.add(sprite);
  return [...ids].filter(isArtId);
}
