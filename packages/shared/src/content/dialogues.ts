/**
 * NPC dialogue trees. One per NPC; the client walks nodes by id and the server
 * evaluates every `conditions` / `effects` list so choices cannot be forged.
 */

import { indexById } from '../core/util.js';
import { DialogueTreeSchema, type DialogueTree } from '../domain/npc.js';

const SPECS: DialogueTree[] = [
  // ------------------------------------------------------------ 云鹤真人
  {
    id: 'dlg-zhangmen',
    npcId: 'npc-zhangmen',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '云鹤真人放下拂尘，抬眼看你：「来了。坐罢——修行之事，急不得。」',
        art: null,
        onEnter: [],
        choices: [
          {
            id: 'quest',
            text: '弟子想请教修行之事',
            conditions: [],
            effects: [],
            next: 'guidance',
            hideWhenBlocked: false,
          },
          {
            id: 'accept-c1',
            text: '请掌门指点入门',
            conditions: [{ type: 'quest_state', questId: 'quest-c1-01', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c1-01' }],
            next: 'give-c1',
            hideWhenBlocked: true,
          },
          {
            id: 'chapter2',
            text: '听闻洛水城出了事？',
            conditions: [{ type: 'chapter_at_least', chapter: 2 }],
            effects: [],
            next: 'luoshui',
            hideWhenBlocked: true,
          },
          {
            id: 'chapter3',
            text: '师伯当年究竟去了何处？',
            conditions: [{ type: 'chapter_at_least', chapter: 3 }],
            effects: [],
            next: 'youming',
            hideWhenBlocked: true,
          },
          { id: 'leave', text: '弟子告退', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'guidance',
        text: '「修行如逆水行舟。境界满时不必强求，圆满之后再言突破——破境丹可备，然心境更要紧。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '弟子受教', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
      {
        id: 'give-c1',
        text: '「先去山门前见过守山的师弟，报上名号。规矩不可废。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '弟子这就去', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'luoshui',
        text: '「洛水城连失七人，皆是筑基修士。此事不寻常——你去看看，切记莫要独闯水底。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '弟子明白', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
      {
        id: 'youming',
        text: '云鹤真人沉默良久：「他去问一个不该问的问题。……你若也要去，先把金丹结稳了。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '……', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ 玄阳长老
  {
    id: 'dlg-zhanglao',
    npcId: 'npc-zhanglao',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '玄阳长老头也不抬：「何事？说重点。」',
        art: null,
        onEnter: [],
        choices: [
          {
            id: 'accept-wolf',
            text: '弟子愿领差事',
            conditions: [{ type: 'quest_state', questId: 'quest-c1-02', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c1-02' }],
            next: 'wolf',
            hideWhenBlocked: true,
          },
          {
            id: 'accept-jiao',
            text: '洛水蛟之事，弟子请命',
            conditions: [{ type: 'quest_state', questId: 'quest-c2-02', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c2-02' }],
            next: 'jiao',
            hideWhenBlocked: true,
          },
          { id: 'rules', text: '请教宗门刑律', conditions: [], effects: [], next: 'rules', hideWhenBlocked: false },
          { id: 'leave', text: '告退', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'wolf',
        text: '「后山狼群伤了三名外门弟子。去，杀五头，回来复命。别逞强。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '是', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'jiao',
        text: '「那蛟已开了灵智，能化人形。三头——若见着第四头，立刻撤。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '弟子领命', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'rules',
        text: '「同门不得私斗；论道台上生死自负；擅入禁地者，废去修为逐出山门。记住了？」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '记住了', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ 百草仙翁
  {
    id: 'dlg-yaowang',
    npcId: 'npc-yaowang',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '老翁从药篓里探出头来，葫芦晃了晃：「小友，买药还是卖药？老夫都收。」',
        art: null,
        onEnter: [],
        choices: [
          {
            id: 'shop',
            text: '看看丹药',
            conditions: [],
            effects: [{ type: 'open_shop', shopId: 'shop-yaowang' }],
            next: null,
            hideWhenBlocked: false,
          },
          {
            id: 'accept-herb',
            text: '需要帮忙采药么？',
            conditions: [{ type: 'quest_state', questId: 'quest-c1-03', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c1-03' }],
            next: 'herb',
            hideWhenBlocked: true,
          },
          {
            id: 'accept-silk',
            text: '还有别的差事么？',
            conditions: [{ type: 'quest_state', questId: 'quest-c2-03', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c2-03' }],
            next: 'silk',
            hideWhenBlocked: true,
          },
          { id: 'leave', text: '改日再来', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'herb',
        text: '「十株灵草，青云山遍地都是。老夫这把老骨头爬不动山咯。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '包在我身上', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'silk',
        text: '「四缕云纹丝，要洛水城外的。别问老夫做什么用——问了也不告诉你。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '好', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
    ],
  },

  // -------------------------------------------------------------- 钱多多
  {
    id: 'dlg-shangren',
    npcId: 'npc-shangren',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '钱多多噼啪拨着算盘，笑得眼睛都眯了：「哎哟，贵客！万宝阁只做公道买卖。」',
        art: null,
        onEnter: [],
        choices: [
          {
            id: 'shop',
            text: '看看货',
            conditions: [],
            effects: [{ type: 'open_shop', shopId: 'shop-shangren' }],
            next: null,
            hideWhenBlocked: false,
          },
          {
            id: 'accept-debt',
            text: '听说你有笔账收不回来？',
            conditions: [{ type: 'quest_state', questId: 'quest-c2-04', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c2-04' }],
            next: 'debt',
            hideWhenBlocked: true,
          },
          { id: 'gossip', text: '近来镇上有什么消息？', conditions: [], effects: [], next: 'gossip', hideWhenBlocked: false },
          { id: 'leave', text: '不了', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'debt',
        text: '「一个散修，欠我三千灵石跑了。您去『讲讲道理』，收回来的算您的，我只要个面子。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '成交', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'gossip',
        text: '「昆仑墟那边最近热闹，据说有人挖出了上古的东西。真假嘛……我只卖货，不卖消息。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '有意思', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ 无名老者
  {
    id: 'dlg-laozhe',
    npcId: 'npc-laozhe',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '老者靠在槐树下，斗笠压得很低。你走近时，他忽然开口：「你身上……有股熟悉的味道。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ask', text: '前辈认得我？', conditions: [], effects: [], next: 'know', hideWhenBlocked: false },
          {
            id: 'accept-hat',
            text: '前辈有何吩咐',
            conditions: [{ type: 'quest_state', questId: 'quest-c3-02', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c3-02' }],
            next: 'hat',
            hideWhenBlocked: true,
          },
          {
            id: 'gift',
            text: '给老者一枚回春丹',
            conditions: [{ type: 'has_item', itemId: 'pill-heal', qty: 1 }],
            effects: [
              { type: 'take_item', itemId: 'pill-heal', qty: 1 },
              { type: 'give_exp', exp: 2000 },
              { type: 'set_flag', flag: 'laozhe-favor', value: true },
            ],
            next: 'gift',
            hideWhenBlocked: false,
          },
          { id: 'leave', text: '不打扰前辈', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'know',
        text: '「认得？不认得。」他打了个哈欠，「老夫谁也不认得。去罢。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '……', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
      {
        id: 'gift',
        text: '老者接过丹药，掂了掂，笑了一声：「有心。」他随手在你肩上一拍，一股暖流窜入经脉。',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '多谢前辈', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
      {
        id: 'hat',
        text: '「鬼帝殿里有个东西，你带回来给我看看。别问是什么——见着了自然知道。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '好', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- 铁玄
  {
    id: 'dlg-tiejiang',
    npcId: 'npc-tiejiang',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '铁玄没停锤，火星四溅：「说。」',
        art: null,
        onEnter: [],
        choices: [
          {
            id: 'shop',
            text: '看看兵器',
            conditions: [],
            effects: [{ type: 'open_shop', shopId: 'shop-tiejiang' }],
            next: null,
            hideWhenBlocked: false,
          },
          {
            id: 'accept-iron',
            text: '需要什么材料？',
            conditions: [{ type: 'quest_state', questId: 'quest-c1-05', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c1-05' }],
            next: 'iron',
            hideWhenBlocked: true,
          },
          { id: 'leave', text: '没事了', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'iron',
        text: '「三块玄铁精。」他终于抬头，「拿来，我给你铸柄剑。不收钱。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '为谁铸的？', conditions: [], effects: [], next: 'whom', hideWhenBlocked: false },
        ],
      },
      {
        id: 'whom',
        text: '铁玄又低下头去，锤声不停：「问那么多做什么。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'end', text: '……我去找', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ 青鸾仙子
  {
    id: 'dlg-xianzi',
    npcId: 'npc-xianzi',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '青鸾仙子理了理鬓边羽饰：「论道台上，点到即止。道友是来观战，还是来立擂？」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'rules', text: '论道台的规矩？', conditions: [], effects: [], next: 'rules', hideWhenBlocked: false },
          {
            id: 'accept-arena',
            text: '我来立擂',
            conditions: [{ type: 'quest_state', questId: 'quest-c2-05', state: 'available' }],
            effects: [{ type: 'accept_quest', questId: 'quest-c2-05' }],
            next: 'arena',
            hideWhenBlocked: true,
          },
          { id: 'leave', text: '只是路过', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'rules',
        text: '「同境者相搏，胜负计入榜上。输了不伤根本，赢了也别得意——榜是活的。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '明白了', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
      {
        id: 'arena',
        text: '「胜三场，再入青云秘境走一遭。做到了，我便认你这个道友。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'ok', text: '一言为定', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ 守山弟子
  {
    id: 'dlg-zhenshou',
    npcId: 'npc-zhenshou',
    rootNodeId: 'root',
    nodes: [
      {
        id: 'root',
        text: '守山弟子按剑而立，上下打量你一番：「山门重地。道友是……新入门的？」',
        art: null,
        onEnter: [],
        choices: [
          {
            id: 'report',
            text: '报上名号',
            conditions: [],
            effects: [{ type: 'set_flag', flag: 'met-zhenshou', value: true }],
            next: 'welcome',
            hideWhenBlocked: false,
          },
          { id: 'ask', text: '这山上有什么去处？', conditions: [], effects: [], next: 'places', hideWhenBlocked: false },
          { id: 'leave', text: '走开', conditions: [], effects: [], next: null, hideWhenBlocked: false },
        ],
      },
      {
        id: 'welcome',
        text: '他抱拳一礼，神色松了下来：「原来是同门，失礼。掌门就在殿上，师兄自去便是。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '多谢', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
      {
        id: 'places',
        text: '「后山可以练手，镇上药王和铁匠都在。至于幽冥谷……师兄现在还是别去的好。」',
        art: null,
        onEnter: [],
        choices: [
          { id: 'back', text: '记下了', conditions: [], effects: [], next: 'root', hideWhenBlocked: false },
        ],
      },
    ],
  },
];

export const DIALOGUES: readonly DialogueTree[] = SPECS.map((d) => DialogueTreeSchema.parse(d));
export const DIALOGUE_BY_ID: ReadonlyMap<string, DialogueTree> = indexById(DIALOGUES);

export function getDialogue(id: string): DialogueTree | undefined {
  return DIALOGUE_BY_ID.get(id);
}

/** A node inside a tree, or undefined when the id is unknown. */
export function getDialogueNode(treeId: string, nodeId: string) {
  return DIALOGUE_BY_ID.get(treeId)?.nodes.find((n) => n.id === nodeId);
}
