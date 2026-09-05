/**
 * 妖兽 and 秘境 BOSS.
 *
 * Stats are derived from the realm baseline at the monster's reference stage
 * times a role profile, so the whole bestiary re-tunes automatically whenever
 * the attribute curve changes.
 *
 * Rewards are expressed in idle-time terms: a normal 妖兽 is worth 90 seconds
 * of baseline cultivation at its own stage, a BOSS 20 minutes. That keeps
 * active play roughly 3x an idle hour without ever eclipsing it.
 */

import { indexById, round } from '../core/util.js';
import { baseStatsForStage } from '../cultivation/attributes.js';
import { baseRatePerSec } from '../cultivation/realms.js';
import type { Stats } from '../domain/stats.js';
import { MonsterSchema, type LootEntry, type Monster } from '../domain/monster.js';

type Profile = 'normal' | 'brute' | 'swift' | 'caster' | 'boss';

const PROFILES: Record<Profile, { hp: number; atk: number; def: number; spd: number }> = {
  normal: { hp: 0.9, atk: 0.85, def: 0.85, spd: 1.0 },
  brute: { hp: 1.35, atk: 0.9, def: 1.15, spd: 0.85 },
  swift: { hp: 0.7, atk: 0.95, def: 0.7, spd: 1.3 },
  caster: { hp: 0.75, atk: 1.1, def: 0.75, spd: 1.05 },
  boss: { hp: 4.0, atk: 1.35, def: 1.3, spd: 1.05 },
};

/** Seconds of baseline cultivation a kill is worth. */
const NORMAL_EXP_SECONDS = 90;
const BOSS_EXP_SECONDS = 1200;

function monsterStats(stageIndex: number, profile: Profile): Stats {
  const base = baseStatsForStage(stageIndex);
  const p = PROFILES[profile];
  return {
    hp: Math.round(base.hp * p.hp),
    atk: Math.round(base.atk * p.atk),
    def: Math.round(base.def * p.def),
    spd: round(base.spd * p.spd, 2),
    crit: base.crit,
    critResist: base.critResist,
    acc: base.acc,
    eva: base.eva,
  };
}

function expReward(stageIndex: number, isBoss: boolean): number {
  const seconds = isBoss ? BOSS_EXP_SECONDS : NORMAL_EXP_SECONDS;
  return Math.round(baseRatePerSec(stageIndex) * seconds);
}

function stoneReward(stageIndex: number, isBoss: boolean): number {
  return Math.round(10 * (1 + stageIndex * 0.6) * (isBoss ? 15 : 1));
}

interface MonsterSpec {
  id: string;
  name: string;
  description: string;
  art: Monster['art'];
  stageIndex: number;
  profile: Profile;
  skills: string[];
  loot: LootEntry[];
  isBoss?: boolean;
}

function build(spec: MonsterSpec): Monster {
  const isBoss = spec.isBoss ?? false;
  return MonsterSchema.parse({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    art: spec.art,
    stageIndex: spec.stageIndex,
    stats: monsterStats(spec.stageIndex, spec.profile),
    skills: spec.skills,
    expReward: expReward(spec.stageIndex, isBoss),
    stoneReward: stoneReward(spec.stageIndex, isBoss),
    loot: spec.loot,
    isBoss,
  } satisfies Monster);
}

const SPECS: MonsterSpec[] = [
  // ---------------------------------------------------------------- 青云山
  {
    id: 'monster-qingyun-wolf',
    name: '青云狼',
    description: '青云山常见的群居妖狼，皮毛青灰，双目有灵光流转。',
    art: 'monster/qingyun-wolf',
    stageIndex: 1,
    profile: 'swift',
    skills: ['skill-metal-1'],
    loot: [
      { itemId: 'mat-spirit-herb', chance: 0.5, min: 1, max: 2 },
      { itemId: 'mat-beast-core', chance: 0.12, min: 1, max: 1 },
    ],
  },
  {
    id: 'monster-spirit-ape',
    name: '灵猿',
    description: '手持桃木杖的山中灵猿，力大而通些许法术。',
    art: 'monster/spirit-ape',
    stageIndex: 3,
    profile: 'brute',
    skills: ['skill-earth-1', 'skill-metal-1'],
    loot: [
      { itemId: 'mat-spirit-herb', chance: 0.45, min: 1, max: 3 },
      { itemId: 'mat-iron-essence', chance: 0.15, min: 1, max: 1 },
    ],
  },

  // ---------------------------------------------------------------- 洛水城
  {
    id: 'monster-river-bandit',
    name: '水匪修士',
    description: '盘踞洛水的散修水匪，蒙面持刀，专劫过路商船。',
    art: 'monster/river-bandit',
    stageIndex: 5,
    profile: 'normal',
    skills: ['skill-metal-1', 'skill-water-1'],
    loot: [
      { itemId: 'mat-iron-essence', chance: 0.35, min: 1, max: 2 },
      { itemId: 'pill-heal', chance: 0.2, min: 1, max: 1 },
    ],
  },
  {
    id: 'monster-luoshui-flood-dragon',
    name: '洛水蛟',
    description: '藏于洛水深处的蛟龙，探首而出时必掀百丈浪。',
    art: 'monster/luoshui-flood-dragon',
    stageIndex: 6,
    profile: 'brute',
    skills: ['skill-water-1', 'skill-water-2'],
    loot: [
      { itemId: 'mat-beast-core', chance: 0.4, min: 1, max: 2 },
      { itemId: 'mat-cloud-silk', chance: 0.1, min: 1, max: 1 },
    ],
  },

  // ---------------------------------------------------------------- 幽冥谷
  {
    id: 'monster-ghost-lantern',
    name: '幽冥灯鬼',
    description: '提一盏青灯飘游谷中，灯焰所照处生人气血尽衰。',
    art: 'monster/ghost-lantern',
    stageIndex: 9,
    profile: 'caster',
    skills: ['skill-fire-1', 'skill-wood-2'],
    loot: [
      { itemId: 'mat-soul-crystal', chance: 0.3, min: 1, max: 1 },
      { itemId: 'mat-spirit-herb', chance: 0.3, min: 2, max: 4 },
    ],
  },
  {
    id: 'monster-bone-general',
    name: '白骨将',
    description: '着残甲的白骨将军，生前不知是何方名将，死后仍守幽冥。',
    art: 'monster/bone-general',
    stageIndex: 11,
    profile: 'brute',
    skills: ['skill-metal-1', 'skill-earth-1', 'skill-metal-2'],
    loot: [
      { itemId: 'mat-soul-crystal', chance: 0.35, min: 1, max: 2 },
      { itemId: 'mat-iron-essence', chance: 0.3, min: 2, max: 3 },
    ],
  },

  // ---------------------------------------------------------------- 昆仑墟
  {
    id: 'monster-ice-qilin',
    name: '冰麒麟',
    description: '昆仑雪线之上的瑞兽遗种，冰晶鳞甲坚不可摧。',
    art: 'monster/ice-qilin',
    stageIndex: 13,
    profile: 'brute',
    skills: ['skill-water-2', 'skill-earth-1', 'skill-water-3'],
    loot: [
      { itemId: 'mat-jade', chance: 0.3, min: 1, max: 2 },
      { itemId: 'mat-thunder-wood', chance: 0.08, min: 1, max: 1 },
    ],
  },
  {
    id: 'monster-golden-crow',
    name: '金乌',
    description: '三足金乌，振翅则烈焰焚天，昆仑墟金光多由其而来。',
    art: 'monster/golden-crow',
    stageIndex: 15,
    profile: 'caster',
    skills: ['skill-fire-1', 'skill-fire-2', 'skill-fire-3'],
    loot: [
      { itemId: 'mat-jade', chance: 0.25, min: 1, max: 2 },
      { itemId: 'mat-thunder-wood', chance: 0.12, min: 1, max: 1 },
    ],
  },

  // -------------------------------------------------------------- 秘境 BOSS
  {
    id: 'boss-qingyun-tiger-king',
    name: '青云虎王',
    description: '青云秘境深处的巨白虎，一吼震落满山松雪。',
    art: 'boss/qingyun-tiger-king',
    stageIndex: 5,
    profile: 'boss',
    skills: ['skill-metal-1', 'skill-earth-1', 'skill-metal-2'],
    isBoss: true,
    loot: [
      { itemId: 'mat-beast-core', chance: 1, min: 2, max: 4 },
      { itemId: 'treasure-bell', chance: 0.15, min: 1, max: 1 },
      { itemId: 'pill-breakthrough', chance: 0.25, min: 1, max: 1 },
    ],
  },
  {
    id: 'boss-luoshui-dragon-lord',
    name: '洛水龙君',
    description: '人身龙首的洛水之主，掌一河水脉，喜怒即为潮汐。',
    art: 'boss/luoshui-dragon-lord',
    stageIndex: 9,
    profile: 'boss',
    skills: ['skill-water-1', 'skill-water-2', 'skill-water-3', 'skill-wood-1'],
    isBoss: true,
    loot: [
      { itemId: 'mat-cloud-silk', chance: 1, min: 2, max: 4 },
      { itemId: 'robe-cloud', chance: 0.12, min: 1, max: 1 },
      { itemId: 'pill-breakthrough', chance: 0.3, min: 1, max: 2 },
    ],
  },
  {
    id: 'boss-youming-ghost-emperor',
    name: '幽冥鬼帝',
    description: '冕旒垂面的幽冥之主，殿下白骨累累皆是当年问道之人。',
    art: 'boss/youming-ghost-emperor',
    stageIndex: 13,
    profile: 'boss',
    skills: ['skill-fire-2', 'skill-metal-3', 'skill-wood-2', 'skill-fire-3'],
    isBoss: true,
    loot: [
      { itemId: 'mat-soul-crystal', chance: 1, min: 3, max: 6 },
      { itemId: 'acc-talisman', chance: 0.12, min: 1, max: 1 },
      { itemId: 'pill-golden-core', chance: 0.2, min: 1, max: 1 },
    ],
  },
  {
    id: 'boss-kunlun-heaven-beast',
    name: '昆仑天兽',
    description: '九首异兽，守昆仑墟断柱残碑，据说与上古天庭有旧。',
    art: 'boss/kunlun-heaven-beast',
    stageIndex: 17,
    profile: 'boss',
    skills: ['skill-earth-2', 'skill-metal-3', 'skill-water-3', 'skill-earth-3'],
    isBoss: true,
    loot: [
      { itemId: 'mat-thunder-wood', chance: 1, min: 2, max: 4 },
      { itemId: 'treasure-seal', chance: 0.08, min: 1, max: 1 },
      { itemId: 'pill-enlightenment', chance: 0.15, min: 1, max: 1 },
    ],
  },
];

export const MONSTERS: readonly Monster[] = SPECS.map(build);
export const MONSTER_BY_ID: ReadonlyMap<string, Monster> = indexById(MONSTERS);
export const MONSTER_IDS: readonly string[] = MONSTERS.map((m) => m.id);

export const BOSSES: readonly Monster[] = MONSTERS.filter((m) => m.isBoss);

export function getMonster(id: string): Monster | undefined {
  return MONSTER_BY_ID.get(id);
}

/**
 * 天劫化身. The opponent of the 大乘·圆满 -> 渡劫 tribulation battle.
 * Generated rather than authored so it always scales to the challenger.
 */
export const TRIBULATION_MONSTER_ID = 'tribulation-avatar';

export function tribulationAvatar(stageIndex = 31): Monster {
  return MonsterSchema.parse({
    id: TRIBULATION_MONSTER_ID,
    name: '天劫化身',
    description: '墨云翻涌，雷光凝形。此乃天道之意，非血肉之躯。',
    art: 'boss/kunlun-heaven-beast',
    stageIndex,
    stats: monsterStats(stageIndex, 'boss'),
    skills: ['skill-metal-3', 'skill-fire-3', 'skill-water-3', 'skill-earth-3'],
    expReward: 0,
    stoneReward: 0,
    loot: [],
    isBoss: true,
  } satisfies Monster);
}
