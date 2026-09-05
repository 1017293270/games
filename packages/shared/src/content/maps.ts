/**
 * 四大地图 and their 奇遇. Each map unlocks at a realm boundary, holds exactly
 * two 妖兽, a 采药 table and at least two encounter events.
 */

import { indexById } from '../core/util.js';
import { EncounterSchema, ExploreMapSchema, type Encounter, type ExploreMap } from '../domain/map.js';

const ENCOUNTER_SPECS: Encounter[] = [
  // ---------------------------------------------------------------- 青云山
  {
    id: 'enc-qingyun-old-tree',
    name: '古松下的棋局',
    text: '山径转折处，一株千年古松下摆着残局，黑白子已落大半，却不见对弈之人。石上压着一枚玉简。',
    art: 'bg/map-qingyun-mountain',
    weight: 3,
    conditions: [],
    options: [
      {
        id: 'play',
        text: '落子续弈',
        conditions: [],
        outcomeText: '你凝神半晌，一子落下，满盘皆活。松风忽起，玉简化作清气没入眉心，心境为之一清。',
        effects: [{ type: 'give_exp', exp: 600 }],
        botWeight: 2,
      },
      {
        id: 'take',
        text: '取走玉简',
        conditions: [],
        outcomeText: '玉简入手温润，其上刻着几味药材的分布图。你依图寻去，果然采得不少灵草。',
        effects: [{ type: 'give_item', itemId: 'mat-spirit-herb', qty: 5 }],
        botWeight: 3,
      },
      {
        id: 'leave',
        text: '不扰弈者，转身离去',
        conditions: [],
        outcomeText: '你拱手一礼，绕道而行。行出数里，怀中忽多了一物——一枚温热的灵石。',
        effects: [{ type: 'give_spirit_stones', amount: 300 }],
        botWeight: 1,
      },
    ],
  },
  {
    id: 'enc-qingyun-waterfall',
    name: '瀑下练体',
    text: '万丈飞瀑砸落深潭，水声如雷。潭边石碑刻着两行字：「淬其形骸，方见本真」。',
    art: 'bg/map-qingyun-mountain',
    weight: 2,
    conditions: [],
    options: [
      {
        id: 'endure',
        text: '入瀑淬体（气血大损）',
        conditions: [],
        outcomeText: '瀑水如万钧铁锤砸在肩背。你咬牙立了半个时辰，出水时浑身青紫，筋骨却隐隐生出新力。',
        effects: [
          { type: 'give_exp', exp: 1200 },
          { type: 'give_item', itemId: 'pill-heal', qty: 1 },
        ],
        botWeight: 2,
      },
      {
        id: 'observe',
        text: '在潭边参悟水势',
        conditions: [],
        outcomeText: '你盘坐观瀑三日，于水之无形处略有所得。',
        effects: [{ type: 'give_exp', exp: 500 }],
        botWeight: 3,
      },
    ],
  },

  // ---------------------------------------------------------------- 洛水城
  {
    id: 'enc-luoshui-boat',
    name: '画舫夜宴',
    text: '洛水之上一艘画舫灯火通明，丝竹隐隐。舫头立着位锦衣公子，遥遥向你举杯：「道友可愿上船一叙？」',
    art: 'bg/map-luoshui-city',
    weight: 3,
    conditions: [],
    options: [
      {
        id: 'board',
        text: '登船赴宴',
        conditions: [],
        outcomeText: '席间觥筹交错，那公子谈吐不俗。临别时他塞给你一只锦囊：「萍水相逢，聊表心意。」',
        effects: [
          { type: 'give_spirit_stones', amount: 1500 },
          { type: 'give_item', itemId: 'pill-spirit', qty: 1 },
        ],
        botWeight: 3,
      },
      {
        id: 'trade',
        text: '上船，但只谈买卖',
        conditions: [{ type: 'spirit_stones_at_least', amount: 800 }],
        outcomeText: '你花八百灵石换得一枚品相极佳的丹药。那公子笑道：「道友是明白人。」',
        effects: [
          { type: 'give_spirit_stones', amount: -800 },
          { type: 'give_item', itemId: 'pill-breakthrough', qty: 1 },
        ],
        botWeight: 2,
      },
      {
        id: 'decline',
        text: '婉拒，独自沿岸而行',
        conditions: [],
        outcomeText: '你摇头离去。走出半里，回头望时画舫已无踪影，唯余一江冷月。岸边泥中露出半截玄铁。',
        effects: [{ type: 'give_item', itemId: 'mat-iron-essence', qty: 3 }],
        botWeight: 1,
      },
    ],
  },
  {
    id: 'enc-luoshui-drowned',
    name: '沉船遗宝',
    text: '退潮后，河床上露出一艘沉船的残骸。船舱半掩，水藻缠绕，隐约可见舱内有物微光闪动。',
    art: 'bg/map-luoshui-city',
    weight: 2,
    conditions: [],
    options: [
      {
        id: 'dive',
        text: '潜入舱中取宝',
        conditions: [],
        outcomeText: '舱内积水阴寒刺骨。你摸到一只铁匣，撬开是几块云纹丝与一枚妖丹——想来是当年商船的货。',
        effects: [
          { type: 'give_item', itemId: 'mat-cloud-silk', qty: 2 },
          { type: 'give_item', itemId: 'mat-beast-core', qty: 1 },
        ],
        botWeight: 3,
      },
      {
        id: 'report',
        text: '上报洛水城衙门',
        conditions: [],
        outcomeText: '城中主事记下你的姓名，赏了一笔谢银：「此乃十年前失踪的贡船，多谢道友。」',
        effects: [{ type: 'give_spirit_stones', amount: 2000 }],
        botWeight: 1,
      },
    ],
  },

  // ---------------------------------------------------------------- 幽冥谷
  {
    id: 'enc-youming-lantern',
    name: '引路灯',
    text: '雾中浮起一盏青灯，不疾不徐向谷深处飘去，似在引路。你听见极轻的哭声，辨不出方向。',
    art: 'bg/map-youming-valley',
    weight: 3,
    conditions: [],
    options: [
      {
        id: 'follow',
        text: '跟上青灯',
        conditions: [],
        outcomeText: '灯停在一方无字碑前。碑下埋着一具枯骨，怀中紧抱一枚魂晶。你为其掩土，取走了晶石。',
        effects: [
          { type: 'give_item', itemId: 'mat-soul-crystal', qty: 2 },
          { type: 'give_exp', exp: 8000 },
        ],
        botWeight: 3,
      },
      {
        id: 'extinguish',
        text: '出手灭灯',
        conditions: [],
        outcomeText: '灯灭的刹那，哭声戛然而止，一缕怨气反噬而来。你强行压下，反倒于生死之间悟出些许。',
        effects: [{ type: 'give_exp', exp: 14000 }],
        botWeight: 2,
      },
      {
        id: 'ignore',
        text: '闭目塞听，原路退出',
        conditions: [],
        outcomeText: '你退出雾区，背后再无声息。谨慎者未必得利，但活得久。',
        effects: [{ type: 'give_spirit_stones', amount: 1200 }],
        botWeight: 1,
      },
    ],
  },
  {
    id: 'enc-youming-altar',
    name: '枯木祭坛',
    text: '一片焦黑的枯木林中央立着石坛，坛上凹槽干涸已久，四周散落着断裂的兵器。',
    art: 'bg/map-youming-valley',
    weight: 2,
    conditions: [],
    options: [
      {
        id: 'offer',
        text: '以灵石为祭',
        conditions: [{ type: 'spirit_stones_at_least', amount: 3000 }],
        outcomeText: '灵石在凹槽中化作青烟。坛心裂开，浮出一枚温润的灵玉与一缕精纯灵力。',
        effects: [
          { type: 'give_spirit_stones', amount: -3000 },
          { type: 'give_item', itemId: 'mat-jade', qty: 2 },
          { type: 'give_exp', exp: 20000 },
        ],
        botWeight: 2,
      },
      {
        id: 'smash',
        text: '一掌击碎石坛',
        conditions: [],
        outcomeText: '石坛崩裂，底下压着一柄锈死的残剑与几块玄铁精。祭坛的怨念也随之消散。',
        effects: [
          { type: 'give_item', itemId: 'mat-iron-essence', qty: 5 },
          { type: 'give_exp', exp: 6000 },
        ],
        botWeight: 3,
      },
    ],
  },

  // ---------------------------------------------------------------- 昆仑墟
  {
    id: 'enc-kunlun-stele',
    name: '断碑残字',
    text: '雪原之上斜插着半截石碑，碑面刻满古篆，风蚀过半。金色天光斜照，字迹忽明忽暗。',
    art: 'bg/map-kunlun-ruins',
    weight: 3,
    conditions: [],
    options: [
      {
        id: 'read',
        text: '以神识拓印碑文',
        conditions: [],
        outcomeText: '碑文所载竟是一段上古炼气法门。虽残缺不全，仍令你受益匪浅。',
        effects: [{ type: 'give_exp', exp: 120000 }],
        botWeight: 3,
      },
      {
        id: 'dig',
        text: '掘开碑下冻土',
        conditions: [],
        outcomeText: '冻土之下埋着一段雷击木，色如焦炭而质重如铁。',
        effects: [
          { type: 'give_item', itemId: 'mat-thunder-wood', qty: 2 },
          { type: 'give_spirit_stones', amount: 6000 },
        ],
        botWeight: 2,
      },
    ],
  },
  {
    id: 'enc-kunlun-snowline',
    name: '雪线之上',
    text: '再往上，风雪已成实质，每一步都似有大山压肩。远处隐约可见一道盘坐的人影，早已冻成冰雕。',
    art: 'bg/map-kunlun-ruins',
    weight: 2,
    conditions: [],
    options: [
      {
        id: 'ascend',
        text: '继续登行，直至极处',
        conditions: [{ type: 'stage_at_least', stageIndex: 16 }],
        outcomeText: '你在极处盘坐一日一夜，风雪加身而神魂愈明。下山时，境界隐隐松动。',
        effects: [
          { type: 'give_exp', exp: 260000 },
          { type: 'give_item', itemId: 'pill-enlightenment', qty: 1 },
        ],
        botWeight: 2,
      },
      {
        id: 'salute',
        text: '向那冰雕之人行礼，就地参悟',
        conditions: [],
        outcomeText: '你依其坐姿盘膝，竟隐约触到一丝残留的道韵。冰雕手中滑落一物，是枚护身符。',
        effects: [
          { type: 'give_exp', exp: 90000 },
          { type: 'give_item', itemId: 'acc-talisman', qty: 1 },
        ],
        botWeight: 3,
      },
    ],
  },
];

export const ENCOUNTERS: readonly Encounter[] = ENCOUNTER_SPECS.map((e) => EncounterSchema.parse(e));
export const ENCOUNTER_BY_ID: ReadonlyMap<string, Encounter> = indexById(ENCOUNTERS);

const MAP_SPECS: ExploreMap[] = [
  {
    id: 'map-qingyun-mountain',
    name: '青云山',
    description: '青云宗后山，松崖瀑布，云雾终年不散。新入门的弟子多在此处历练。',
    art: 'bg/map-qingyun-mountain',
    unlockStage: 0,
    recommendedStage: 2,
    monsterIds: ['monster-qingyun-wolf', 'monster-spirit-ape'],
    gather: {
      cooldownSec: 300,
      expReward: 120,
      stoneReward: 30,
      loot: [
        { itemId: 'mat-spirit-herb', chance: 0.8, min: 1, max: 3 },
        { itemId: 'mat-iron-essence', chance: 0.1, min: 1, max: 1 },
      ],
    },
    encounterIds: ['enc-qingyun-old-tree', 'enc-qingyun-waterfall'],
    encounterChance: 0.18,
  },
  {
    id: 'map-luoshui-city',
    name: '洛水城',
    description: '临河而建的繁华城郭，画舫如织，柳色年年。城外水路却不太平。',
    art: 'bg/map-luoshui-city',
    unlockStage: 4,
    recommendedStage: 6,
    monsterIds: ['monster-river-bandit', 'monster-luoshui-flood-dragon'],
    gather: {
      cooldownSec: 300,
      expReward: 900,
      stoneReward: 120,
      loot: [
        { itemId: 'mat-spirit-herb', chance: 0.7, min: 2, max: 4 },
        { itemId: 'mat-cloud-silk', chance: 0.15, min: 1, max: 1 },
        { itemId: 'mat-beast-core', chance: 0.12, min: 1, max: 1 },
      ],
    },
    encounterIds: ['enc-luoshui-boat', 'enc-luoshui-drowned'],
    encounterChance: 0.18,
  },
  {
    id: 'map-youming-valley',
    name: '幽冥谷',
    description: '枯木遍地，磷火幽绿，雾气终日不开。传说此谷通往阴司。',
    art: 'bg/map-youming-valley',
    unlockStage: 8,
    recommendedStage: 10,
    monsterIds: ['monster-ghost-lantern', 'monster-bone-general'],
    gather: {
      cooldownSec: 300,
      expReward: 6000,
      stoneReward: 400,
      loot: [
        { itemId: 'mat-soul-crystal', chance: 0.45, min: 1, max: 2 },
        { itemId: 'mat-spirit-herb', chance: 0.6, min: 3, max: 6 },
        { itemId: 'mat-jade', chance: 0.08, min: 1, max: 1 },
      ],
    },
    encounterIds: ['enc-youming-lantern', 'enc-youming-altar'],
    encounterChance: 0.2,
  },
  {
    id: 'map-kunlun-ruins',
    name: '昆仑墟',
    description: '万古雪山，断柱残碑掩于风雪。金色天光自云隙落下，照着上古战场的遗迹。',
    art: 'bg/map-kunlun-ruins',
    unlockStage: 12,
    recommendedStage: 14,
    monsterIds: ['monster-ice-qilin', 'monster-golden-crow'],
    gather: {
      cooldownSec: 300,
      expReward: 60000,
      stoneReward: 1600,
      loot: [
        { itemId: 'mat-jade', chance: 0.4, min: 1, max: 3 },
        { itemId: 'mat-thunder-wood', chance: 0.15, min: 1, max: 1 },
        { itemId: 'mat-soul-crystal', chance: 0.3, min: 1, max: 2 },
      ],
    },
    encounterIds: ['enc-kunlun-stele', 'enc-kunlun-snowline'],
    encounterChance: 0.2,
  },
];

export const EXPLORE_MAPS: readonly ExploreMap[] = MAP_SPECS.map((m) => ExploreMapSchema.parse(m));
export const EXPLORE_MAP_BY_ID: ReadonlyMap<string, ExploreMap> = indexById(EXPLORE_MAPS);
export const EXPLORE_MAP_IDS: readonly string[] = EXPLORE_MAPS.map((m) => m.id);

/** Maps a character at `stageIndex` may enter. */
export function mapsAvailableAt(stageIndex: number): readonly ExploreMap[] {
  return EXPLORE_MAPS.filter((m) => m.unlockStage <= stageIndex);
}
