/**
 * 青云镇 NPCs. Eight fixed characters, each with a portrait from
 * `docs/ASSETS.md`, a dialogue tree, and where relevant a shop and quests.
 */

import { indexById } from '../core/util.js';
import { NpcSchema, type Npc } from '../domain/npc.js';

export const TOWN_QINGYUN = '青云镇';

const SPECS: Npc[] = [
  {
    id: 'npc-zhangmen',
    name: '云鹤真人',
    title: '青云宗掌门',
    description: '白须及胸，手持拂尘，目光温煦。掌青云一宗百余年，从不轻易动怒。',
    art: 'npc/zhangmen',
    role: 'sect_master',
    location: TOWN_QINGYUN,
    shopId: null,
    dialogueId: 'dlg-zhangmen',
    questIds: ['quest-c1-01', 'quest-c1-04', 'quest-c2-01', 'quest-c3-01'],
    unlockStage: 0,
  },
  {
    id: 'npc-zhanglao',
    name: '玄阳长老',
    title: '青云宗执法长老',
    description: '中年模样，浓眉如剑，一身青道袍纤尘不染。执掌宗门刑律，弟子畏之如虎。',
    art: 'npc/zhanglao',
    role: 'elder',
    location: TOWN_QINGYUN,
    shopId: null,
    dialogueId: 'dlg-zhanglao',
    questIds: ['quest-c1-02', 'quest-c2-02', 'quest-c3-03'],
    unlockStage: 0,
  },
  {
    id: 'npc-yaowang',
    name: '百草仙翁',
    title: '药王',
    description: '驼背老翁，背着比人还高的药篓，腰间葫芦叮当作响。识得天下药草。',
    art: 'npc/yaowang',
    role: 'alchemist',
    location: TOWN_QINGYUN,
    shopId: 'shop-yaowang',
    dialogueId: 'dlg-yaowang',
    questIds: ['quest-c1-03', 'quest-c2-03', 'quest-c3-04'],
    unlockStage: 0,
  },
  {
    id: 'npc-shangren',
    name: '钱多多',
    title: '万宝阁商人',
    description: '圆脸富态，锦袍加身，算盘从不离手。他说自己「只做公道买卖」。',
    art: 'npc/shangren',
    role: 'merchant',
    location: TOWN_QINGYUN,
    shopId: 'shop-shangren',
    dialogueId: 'dlg-shangren',
    questIds: ['quest-c2-04', 'quest-c3-05'],
    unlockStage: 0,
  },
  {
    id: 'npc-laozhe',
    name: '无名老者',
    title: '来历不明',
    description: '斗笠遮面，破蓑衣，常在镇口老槐树下打盹。没人见过他的脸。',
    art: 'npc/laozhe',
    role: 'hermit',
    location: TOWN_QINGYUN,
    shopId: null,
    dialogueId: 'dlg-laozhe',
    questIds: ['quest-c3-02'],
    unlockStage: 3,
  },
  {
    id: 'npc-tiejiang',
    name: '铁玄',
    title: '青云镇铁匠',
    description: '壮硕如熊，赤膊系围裙，一柄铁锤使了三十年。话少，手艺极好。',
    art: 'npc/tiejiang',
    role: 'blacksmith',
    location: TOWN_QINGYUN,
    shopId: 'shop-tiejiang',
    dialogueId: 'dlg-tiejiang',
    questIds: ['quest-c1-05', 'quest-c2-06'],
    unlockStage: 0,
  },
  {
    id: 'npc-xianzi',
    name: '青鸾仙子',
    title: '论道台主持',
    description: '素衣女修，鬓边一支青鸾羽饰。主持镇上的论道台，赏罚分明。',
    art: 'npc/xianzi',
    role: 'arena_host',
    location: TOWN_QINGYUN,
    shopId: null,
    dialogueId: 'dlg-xianzi',
    questIds: ['quest-c2-05'],
    unlockStage: 4,
  },
  {
    id: 'npc-zhenshou',
    name: '守山弟子',
    title: '青云宗外门',
    description: '年轻弟子，持剑立于山门前。见了新人总要多问两句。',
    art: 'npc/zhenshou',
    role: 'guard',
    location: TOWN_QINGYUN,
    shopId: null,
    dialogueId: 'dlg-zhenshou',
    questIds: ['quest-c2-07'],
    unlockStage: 0,
  },
];

export const NPCS: readonly Npc[] = SPECS.map((n) => NpcSchema.parse(n));
export const NPC_BY_ID: ReadonlyMap<string, Npc> = indexById(NPCS);
export const NPC_IDS: readonly string[] = NPCS.map((n) => n.id);

export function getNpc(id: string): Npc | undefined {
  return NPC_BY_ID.get(id);
}

export function npcsAvailableAt(stageIndex: number): readonly Npc[] {
  return NPCS.filter((n) => n.unlockStage <= stageIndex);
}
