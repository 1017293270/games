/**
 * 神通. Five elemental trees of three tiers each (15 total).
 *
 * A character equips four in slots that fire in rotation order. Tier 1 skills
 * are cheap filler, tier 2 adds a rider, tier 3 is the expensive finisher on a
 * cooldown. Costs are balanced against a 100 灵力 pool with +15 regen per round.
 */

import { indexById } from '../core/util.js';
import { SkillSchema, type Skill } from '../domain/skill.js';

const RAW: Skill[] = [
  // ---------------------------------------------------------------- 金 metal
  {
    id: 'skill-metal-1',
    name: '金锋斩',
    description: '凝金气为刃，一斩破敌。金系入门神通，消耗低廉，可持续输出。',
    element: 'metal',
    tier: 1,
    type: 'damage',
    target: 'enemy',
    power: 1.35,
    manaCost: 12,
    cooldown: 0,
    unlockStage: 0,
    learnCost: 0,
    modifier: null,
  },
  {
    id: 'skill-metal-2',
    name: '万剑归宗',
    description: '御百剑齐发，横扫当面之敌。',
    element: 'metal',
    tier: 2,
    type: 'damage',
    target: 'all_enemies',
    power: 0.95,
    manaCost: 30,
    cooldown: 2,
    unlockStage: 6,
    learnCost: 800,
    modifier: null,
  },
  {
    id: 'skill-metal-3',
    name: '太白剑域',
    description: '剑域笼罩，敌防御大损，剑气随之贯体。',
    element: 'metal',
    tier: 3,
    type: 'debuff',
    target: 'enemy',
    power: 1.8,
    manaCost: 45,
    cooldown: 3,
    unlockStage: 14,
    learnCost: 4200,
    modifier: { stats: { def: -0.3 }, durationRounds: 3 },
  },

  // ----------------------------------------------------------------- 木 wood
  {
    id: 'skill-wood-1',
    name: '木灵愈体',
    description: '引木灵之气温养经脉，回复气血。',
    element: 'wood',
    tier: 1,
    type: 'heal',
    target: 'ally',
    power: 1.6,
    manaCost: 15,
    cooldown: 1,
    unlockStage: 0,
    learnCost: 0,
    modifier: null,
  },
  {
    id: 'skill-wood-2',
    name: '缠藤缚',
    description: '灵藤自地下暴起，缠缚敌足，速度大减。',
    element: 'wood',
    tier: 2,
    type: 'debuff',
    target: 'enemy',
    power: 0.7,
    manaCost: 22,
    cooldown: 2,
    unlockStage: 6,
    learnCost: 800,
    modifier: { stats: { spd: -0.35, eva: -0.05 }, durationRounds: 3 },
  },
  {
    id: 'skill-wood-3',
    name: '青木回春诀',
    description: '青木大阵回春，重伤者气血翻涌，兼固己身。',
    element: 'wood',
    tier: 3,
    type: 'heal',
    target: 'ally',
    power: 3.4,
    manaCost: 42,
    cooldown: 3,
    unlockStage: 14,
    learnCost: 4200,
    modifier: null,
  },

  // ---------------------------------------------------------------- 水 water
  {
    id: 'skill-water-1',
    name: '寒水诀',
    description: '寒水成矢，透骨而入。',
    element: 'water',
    tier: 1,
    type: 'damage',
    target: 'enemy',
    power: 1.3,
    manaCost: 11,
    cooldown: 0,
    unlockStage: 0,
    learnCost: 0,
    modifier: null,
  },
  {
    id: 'skill-water-2',
    name: '玄冰封',
    description: '玄冰封身，敌手迟滞难行，出招亦缓。',
    element: 'water',
    tier: 2,
    type: 'debuff',
    target: 'enemy',
    power: 1.15,
    manaCost: 26,
    cooldown: 2,
    unlockStage: 6,
    learnCost: 800,
    modifier: { stats: { spd: -0.25, atk: -0.12 }, durationRounds: 2 },
  },
  {
    id: 'skill-water-3',
    name: '沧澜怒涛',
    description: '沧海倒卷，怒涛压顶，一击而定胜负。',
    element: 'water',
    tier: 3,
    type: 'damage',
    target: 'enemy',
    power: 3.6,
    manaCost: 48,
    cooldown: 3,
    unlockStage: 14,
    learnCost: 4200,
    modifier: null,
  },

  // ----------------------------------------------------------------- 火 fire
  {
    id: 'skill-fire-1',
    name: '烈焰掌',
    description: '掌心生焰，近身焚敌。火系入门神通，伤害略高而耗力稍多。',
    element: 'fire',
    tier: 1,
    type: 'damage',
    target: 'enemy',
    power: 1.45,
    manaCost: 14,
    cooldown: 0,
    unlockStage: 0,
    learnCost: 0,
    modifier: null,
  },
  {
    id: 'skill-fire-2',
    name: '焚天符',
    description: '符成即焚，敌身披火，护体灵光尽损。',
    element: 'fire',
    tier: 2,
    type: 'debuff',
    target: 'enemy',
    power: 1.5,
    manaCost: 28,
    cooldown: 2,
    unlockStage: 6,
    learnCost: 800,
    modifier: { stats: { def: -0.2, critResist: -0.06 }, durationRounds: 3 },
  },
  {
    id: 'skill-fire-3',
    name: '三昧真火',
    description: '三昧真火出，焚尽当面一切生机。',
    element: 'fire',
    tier: 3,
    type: 'damage',
    target: 'all_enemies',
    power: 2.1,
    manaCost: 50,
    cooldown: 3,
    unlockStage: 14,
    learnCost: 4200,
    modifier: null,
  },

  // ---------------------------------------------------------------- 土 earth
  {
    id: 'skill-earth-1',
    name: '磐石身',
    description: '化身磐石，防御大涨，久战不衰。',
    element: 'earth',
    tier: 1,
    type: 'buff',
    target: 'self',
    power: 0,
    manaCost: 13,
    cooldown: 2,
    unlockStage: 0,
    learnCost: 0,
    modifier: { stats: { def: 0.4, critResist: 0.05 }, durationRounds: 3 },
  },
  {
    id: 'skill-earth-2',
    name: '大地之力',
    description: '汲取地脉之力灌注双臂，攻势陡增。',
    element: 'earth',
    tier: 2,
    type: 'buff',
    target: 'self',
    power: 0,
    manaCost: 24,
    cooldown: 2,
    unlockStage: 6,
    learnCost: 800,
    modifier: { stats: { atk: 0.35, crit: 0.06 }, durationRounds: 3 },
  },
  {
    id: 'skill-earth-3',
    name: '山河镇魂',
    description: '山河印落，镇敌魂魄，己身亦得厚土之护。',
    element: 'earth',
    tier: 3,
    type: 'damage',
    target: 'enemy',
    power: 2.9,
    manaCost: 44,
    cooldown: 3,
    unlockStage: 14,
    learnCost: 4200,
    modifier: null,
  },
];

export const SKILLS: readonly Skill[] = RAW.map((s) => SkillSchema.parse(s));
export const SKILL_BY_ID: ReadonlyMap<string, Skill> = indexById(SKILLS);
export const SKILL_IDS: readonly string[] = SKILLS.map((s) => s.id);

/** The three tiers of one element's tree, in order. */
export function skillTree(element: Skill['element']): readonly Skill[] {
  return SKILLS.filter((s) => s.element === element).sort((a, b) => a.tier - b.tier);
}

/** Skills a character at `stageIndex` is allowed to learn. */
export function skillsAvailableAt(stageIndex: number): readonly Skill[] {
  return SKILLS.filter((s) => s.unlockStage <= stageIndex);
}

/** The four tier-1 skills a new character starts with, given their element. */
export function starterSkillIds(element: Skill['element']): string[] {
  const own = SKILLS.filter((s) => s.element === element && s.tier === 1).map((s) => s.id);
  const others = SKILLS.filter((s) => s.element !== element && s.tier === 1).map((s) => s.id);
  return [...own, ...others].slice(0, 4);
}
