import type {
  ProgressionGrade,
  TreasureDefinition,
  TreasureForm,
  RelicDefinition,
} from '../domain/progression.js';
import type { ArtId } from '../core/art.js';
export const PROGRESSION_GRADE_NAMES: Record<ProgressionGrade, string> = {
  mortal: '凡',
  spirit: '灵',
  immortal: '仙',
  saint: '圣',
  divine: '神',
};
export const PROGRESSION_GRADE_MULT: Record<ProgressionGrade, number> = {
  mortal: 1,
  spirit: 1.6,
  immortal: 2.6,
  saint: 4.2,
  divine: 6.5,
};
export const TREASURE_FORM_NAMES: Record<TreasureForm, string> = {
  bell: '铃',
  tower: '塔',
  chain: '链',
  seal: '印',
  banner: '幡',
  shield: '盾',
};
const forms = ['bell', 'tower', 'chain', 'seal', 'banner', 'shield'] as const;
const arts: ArtId[] = [
  'item/treasure-bell',
  'item/treasure-seal',
  'item/acc-prayer-beads',
  'item/treasure-seal',
  'item/treasure-fan',
  'item/acc-talisman',
];
const grades = ['spirit', 'immortal', 'saint', 'divine'] as const;
const prefixes = ['碧霄', '玄月', '太虚', '混元'];
export const TREASURES: TreasureDefinition[] = [
  {
    id: 't-starter-bell',
    name: '清音铃',
    grade: 'mortal',
    form: 'bell',
    art: 'item/treasure-bell',
    description: '入门本命法宝，清音破雾。',
  },
  {
    id: 't-starter-shield',
    name: '守心盾',
    grade: 'mortal',
    form: 'shield',
    art: 'item/acc-talisman',
    description: '凡阶守护法宝。',
  },
  ...grades.flatMap((grade, g) =>
    forms
      .slice(0, [6, 6, 4, 2][g])
      .map((form, i) => ({
        id: `t-${grade}-${form}`,
        name: `${prefixes[g]}${TREASURE_FORM_NAMES[form]}`,
        grade,
        form,
        art: arts[i]!,
        description: `${TREASURE_FORM_NAMES[form]}形法宝，可独立施展本命威能。`,
      })),
  ),
];
export const TREASURE_BY_ID = new Map(TREASURES.map((v) => [v.id, v]));
const relicNames = ['养元璧', '镇岳符', '流光珠', '凝心镜', '护魂灯', '聚灵壶'];
export const RELICS: RelicDefinition[] = grades.flatMap((grade, g) =>
  relicNames.map((name, i) => ({
    id: `r-${grade}-${i}`,
    name: `${prefixes[g]}${name}`,
    grade,
    art: arts[i]!,
    setId: `${grade}-${Math.floor(i / 3)}`,
    description: '收藏即生效，同套三件激活额外加成。',
    percent: i === 0 ? { hp: 0.008 } : i === 1 ? { atk: 0.008 } : i === 2 ? { def: 0.008 } : {},
    flat: i === 3 ? { crit: 0.001 } : i === 4 ? { critResist: 0.001 } : {},
    cultivationBonus: i === 5 ? 0.008 : 0,
  })),
);
export const RELIC_BY_ID = new Map(RELICS.map((v) => [v.id, v]));
/** 青云问道本作平衡数值，不代表参考手游概率。 */
export const GACHA_RULES = {
  singleCost: 160,
  tenCost: 1500,
  hardPity: 70,
  duplicateFragments: 10,
  grades: ['spirit', 'immortal', 'saint', 'divine'],
  weights: [60, 30, 8.5, 1.5],
} as const;
export const STAR_FRAGMENT_COSTS = [10, 20, 40, 80, 120] as const;
export const DAILY_QUESTS = [
  { id: 'kills', counter: 'kills', name: '斩妖除魔', target: 50 },
  { id: 'cultivation', counter: 'cultivationSeconds', name: '潜心修炼', target: 3600 },
  { id: 'dungeon', counter: 'dungeon', name: '秘境探幽', target: 1 },
  { id: 'arena', counter: 'arena', name: '论道切磋', target: 1 },
  { id: 'chat', counter: 'chat', name: '仙友传音', target: 1 },
] as const;
export const PROGRESSION_ACHIEVEMENTS = [
  { id: 'first_breakthrough', name: '初窥仙途' },
  { id: 'first_boss', name: '降伏妖王' },
] as const;

export const RELIC_SETS = [...new Set(RELICS.map((v) => v.setId))].map((id) => ({
  id,
  name: `${id.split('-')[0] === 'spirit' ? '碧霄' : id.split('-')[0] === 'immortal' ? '玄月' : id.split('-')[0] === 'saint' ? '太虚' : '混元'}藏珍`,
  relicIds: RELICS.filter((v) => v.setId === id).map((v) => v.id),
  description: '集齐三件：气血与攻击各 +1%，修炼 +0.5%。',
}));

export const DAILY_REWARD = {
  jade: 100,
  starStones: 20,
  stardust: 20,
  breakthroughWood: 1,
} as const;
export const ACHIEVEMENT_REWARD = {
  jade: 320,
  starStones: 50,
  stardust: 50,
  breakthroughWood: 3,
} as const;
export const STARTER_REWARD = {
  jade: 160,
  starStones: 40,
  stardust: 40,
  breakthroughWood: 0,
} as const;
