/**
 * 功法. Purely passive; a character studies exactly one at a time.
 * Higher grades trade a larger 修炼 bonus against narrower stat coverage, so
 * the choice stays interesting rather than strictly ordered.
 */

import { indexById } from '../core/util.js';
import { ZERO_STAT_BONUS, type StatBonus } from '../domain/stats.js';
import { TechniqueSchema, type Technique } from '../domain/technique.js';

const bonus = (p: Partial<StatBonus>): StatBonus => ({ ...ZERO_STAT_BONUS, ...p });

const RAW: Technique[] = [
  {
    id: 'tech-qingyun',
    name: '青云诀',
    description: '青云宗基础功法，中正平和，人人可修。修炼速度 +10%。',
    grade: 'mortal',
    element: null,
    cultivationBonus: 0.1,
    percent: bonus({ hp: 0.05, atk: 0.05, def: 0.05 }),
    elementAffinity: 0,
    requiredStage: 0,
    learnCost: 0,
  },
  {
    id: 'tech-tuna',
    name: '吐纳养气篇',
    description: '专于吐纳，气机绵长。修炼速度 +25%，然于战力无甚增益。',
    grade: 'mortal',
    element: null,
    cultivationBonus: 0.25,
    percent: bonus({ hp: 0.08 }),
    elementAffinity: 0,
    requiredStage: 2,
    learnCost: 300,
  },
  {
    id: 'tech-lieyang',
    name: '烈阳焚天功',
    description: '刚猛霸道的火系功法，攻伐凌厉，火系神通威力大增。',
    grade: 'spirit',
    element: 'fire',
    cultivationBonus: 0.18,
    percent: bonus({ atk: 0.22, crit: 0.03, def: -0.05 }),
    elementAffinity: 0.15,
    requiredStage: 6,
    learnCost: 1500,
  },
  {
    id: 'tech-xuanbing',
    name: '玄冰真解',
    description: '水系正统，守御绵密，愈战愈稳。',
    grade: 'spirit',
    element: 'water',
    cultivationBonus: 0.18,
    percent: bonus({ hp: 0.18, def: 0.16, critResist: 0.03 }),
    elementAffinity: 0.15,
    requiredStage: 6,
    learnCost: 1500,
  },
  {
    id: 'tech-wuxing',
    name: '五行归元诀',
    description: '五行同修，无所偏废。全属性稳步提升，修炼速度 +40%。',
    grade: 'immortal',
    element: null,
    cultivationBonus: 0.4,
    percent: bonus({ hp: 0.2, atk: 0.2, def: 0.2, spd: 0.08 }),
    elementAffinity: 0,
    requiredStage: 14,
    learnCost: 9000,
  },
  {
    id: 'tech-taishang',
    name: '太上忘情录',
    description: '传说中的无上道典。忘情绝念，一日千里，然修者心冷如铁。',
    grade: 'saint',
    element: null,
    cultivationBonus: 0.75,
    percent: bonus({ hp: 0.3, atk: 0.3, def: 0.25, spd: 0.15, crit: 0.05 }),
    elementAffinity: 0,
    requiredStage: 24,
    learnCost: 60000,
  },
];

export const TECHNIQUES: readonly Technique[] = RAW.map((t) => TechniqueSchema.parse(t));
export const TECHNIQUE_BY_ID: ReadonlyMap<string, Technique> = indexById(TECHNIQUES);
export const TECHNIQUE_IDS: readonly string[] = TECHNIQUES.map((t) => t.id);

/** Every new character begins with 青云诀. */
export const STARTER_TECHNIQUE_ID = 'tech-qingyun';

export function getTechnique(id: string | null | undefined): Technique | null {
  if (!id) return null;
  return TECHNIQUE_BY_ID.get(id) ?? null;
}
