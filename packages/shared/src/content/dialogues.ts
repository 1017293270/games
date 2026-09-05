/**
 * NPC dialogue trees. One per NPC; the client walks nodes by id and the server
 * evaluates every `conditions` / `effects` list so choices cannot be forged.
 *
 * Every quest in `quests.ts` is both handed out and reported back through these
 * trees: an `accept_quest` branch gated on `quest_state: available`, and a
 * `complete_quest` branch gated on `quest_state: completed`. Both carry
 * `hideWhenBlocked`, so a root node that holds a dozen branches only ever shows
 * the two or three that apply right now.
 */

import { indexById } from '../core/util.js';
import { DialogueTreeSchema, type DialogueChoice, type DialogueTree } from '../domain/npc.js';

/** `弟子告退` and friends: the branch that closes the conversation. */
function leave(text: string): DialogueChoice {
  return { id: 'leave', text, conditions: [], effects: [], next: null, hideWhenBlocked: false };
}

/** A branch back to the node it came from. */
function back(text: string, to = 'root'): DialogueChoice {
  return { id: 'back', text, conditions: [], effects: [], next: to, hideWhenBlocked: false };
}

/** A branch that ends the conversation after the NPC has had the last word. */
function done(id: string, text: string): DialogueChoice {
  return { id, text, conditions: [], effects: [], next: null, hideWhenBlocked: false };
}

/** 领取任务: shown only while the quest is actually offerable. */
function accept(questId: string, text: string, next: string): DialogueChoice {
  return {
    id: `accept-${questId}`,
    text,
    conditions: [{ type: 'quest_state', questId, state: 'available' }],
    effects: [{ type: 'accept_quest', questId }],
    next,
    hideWhenBlocked: true,
  };
}

/** 复命: shown only once every objective is met. */
function turnIn(questId: string, text: string, next: string): DialogueChoice {
  return {
    id: `turnin-${questId}`,
    text,
    conditions: [{ type: 'quest_state', questId, state: 'completed' }],
    effects: [{ type: 'complete_quest', questId }],
    next,
    hideWhenBlocked: true,
  };
}

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
          accept('quest-c1-01', '请掌门指点入门', 'give-c1-01'),
          turnIn('quest-c1-01', '弟子已见过守山师弟', 'done-c1-01'),
          accept('quest-c1-04', '弟子想问筑基之事', 'give-c1-04'),
          turnIn('quest-c1-04', '练气已至圆满，请掌门验看', 'done-c1-04'),
          accept('quest-c2-01', '洛水城的事，弟子愿去', 'give-c2-01'),
          turnIn('quest-c2-01', '洛水水匪已清，特来复命', 'done-c2-01'),
          accept('quest-c3-01', '幽冥谷一行，弟子请命', 'give-c3-01'),
          turnIn('quest-c3-01', '幽冥谷的东西，弟子带回来了', 'done-c3-01'),
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
          leave('弟子告退'),
        ],
      },
      {
        id: 'guidance',
        text: '「修行如逆水行舟。境界满时不必强求，圆满之后再言突破——破境丹可备，然心境更要紧。」',
        art: null,
        onEnter: [],
        choices: [back('弟子受教')],
      },
      {
        id: 'give-c1-01',
        text: '「先去山门前见过守山的师弟，报上名号。规矩不可废。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子这就去')],
      },
      {
        id: 'done-c1-01',
        text: '「守山的师弟说你礼数周全。好。」他从袖中取出三枚丹药，「拿着，路还长。」',
        art: null,
        onEnter: [],
        choices: [back('多谢掌门')],
      },
      {
        id: 'give-c1-04',
        text: '「筑基不是熬出来的，是坐出来的。练气圆满之前，别来问我第二次。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子明白')],
      },
      {
        id: 'done-c1-04',
        text:
          '云鹤真人绕你走了一圈，指节在你肩上一叩：「气脉通了。」他递来一枚破境丹，' +
          '「洛水城那边，怕是要你去一趟。」',
        art: null,
        onEnter: [],
        choices: [back('弟子听凭吩咐')],
      },
      {
        id: 'give-c2-01',
        text: '「洛水城连失七人，皆是筑基修士。先去清了河面上的水匪，问问他们看见了什么。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子领命')],
      },
      {
        id: 'done-c2-01',
        text: '「水匪只是被人驱使。」他把玩着那枚玉简，「真正在河底的东西，还没露头。」',
        art: null,
        onEnter: [],
        choices: [back('弟子继续查')],
      },
      {
        id: 'give-c3-01',
        text: '云鹤真人取出一枚残破玉简，久久不语：「幽冥谷的鬼灯，是人熬出来的。你去，看清楚。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子去了')],
      },
      {
        id: 'done-c3-01',
        text:
          '他捏碎了一枚魂晶，指间落下一点灰。「三十年前，你师伯也带回来过这个。」' +
          '沉默良久，「他后来再没提过。」',
        art: null,
        onEnter: [],
        choices: [back('……')],
      },
      {
        id: 'luoshui',
        text: '「洛水城连失七人，皆是筑基修士。此事不寻常——你去看看，切记莫要独闯水底。」',
        art: null,
        onEnter: [],
        choices: [back('弟子明白')],
      },
      {
        id: 'youming',
        text: '云鹤真人沉默良久：「他去问一个不该问的问题。……你若也要去，先把金丹结稳了。」',
        art: null,
        onEnter: [],
        choices: [back('……')],
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
          accept('quest-c1-02', '弟子愿领差事', 'wolf'),
          turnIn('quest-c1-02', '狼群已清，复命', 'done-wolf'),
          accept('quest-c2-02', '洛水蛟之事，弟子请命', 'jiao'),
          turnIn('quest-c2-02', '蛟已伏诛', 'done-jiao'),
          accept('quest-c3-03', '白骨将的事，交给弟子', 'bone'),
          turnIn('quest-c3-03', '白骨将八员，已尽数打散', 'done-bone'),
          {
            id: 'rules',
            text: '请教宗门刑律',
            conditions: [],
            effects: [],
            next: 'rules',
            hideWhenBlocked: false,
          },
          leave('告退'),
        ],
      },
      {
        id: 'wolf',
        text: '「后山狼群伤了三名外门弟子。去，杀五头，回来复命。别逞强。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '是')],
      },
      {
        id: 'done-wolf',
        text: '他终于抬了下眼：「五头。不多不少。」笔尖在册子上一勾，「下次不必来问我该杀几头。」',
        art: null,
        onEnter: [],
        choices: [back('弟子记下了')],
      },
      {
        id: 'jiao',
        text: '「那蛟已开了灵智，能化人形。三头——若见着第四头，立刻撤。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子领命')],
      },
      {
        id: 'done-jiao',
        text:
          '玄阳长老盯着你身上的水痕看了很久：「第四头呢。」' +
          '不等你答，他自己摇了摇头，「罢了。这件道袍你拿去。」',
        art: null,
        onEnter: [],
        choices: [back('多谢长老')],
      },
      {
        id: 'bone',
        text:
          '「白骨将八员，守着鬼帝殿的前庭。」他把令牌推过来，' +
          '「这令是从第一批进谷的弟子身上收回来的。别让它再多添一块。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子去了')],
      },
      {
        id: 'done-bone',
        text: '他把令牌收回袖中，第一次给你倒了杯茶：「坐。」茶是凉的，他大概忘了。',
        art: null,
        onEnter: [],
        choices: [back('长老……')],
      },
      {
        id: 'rules',
        text: '「同门不得私斗；论道台上生死自负；擅入禁地者，废去修为逐出山门。记住了？」',
        art: null,
        onEnter: [],
        choices: [back('记住了')],
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
          accept('quest-c1-03', '需要帮忙采药么？', 'herb'),
          turnIn('quest-c1-03', '灵草采回来了', 'done-herb'),
          accept('quest-c2-03', '还有别的差事么？', 'silk'),
          turnIn('quest-c2-03', '云纹丝在此', 'done-silk'),
          accept('quest-c3-04', '前辈要炼什么？', 'lamp'),
          turnIn('quest-c3-04', '魂晶与灵玉都备齐了', 'done-lamp'),
          leave('改日再来'),
        ],
      },
      {
        id: 'herb',
        text: '「十株灵草，青云山遍地都是。老夫这把老骨头爬不动山咯。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '包在我身上')],
      },
      {
        id: 'done-herb',
        text: '老翁一株株数过去，数到第十株才笑：「成色不赖。喏，聚气丹五颗，你自己留着用。」',
        art: null,
        onEnter: [],
        choices: [back('多谢前辈')],
      },
      {
        id: 'silk',
        text: '「四缕云纹丝，要洛水城外的。别问老夫做什么用——问了也不告诉你。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '好')],
      },
      {
        id: 'done-silk',
        text: '他把丝收进袖里，动作快得不像个驼背老头：「不错。这两颗凝神丹，睡不着的时候吃。」',
        art: null,
        onEnter: [],
        choices: [back('……前辈睡不着？')],
      },
      {
        id: 'lamp',
        text: '「魂晶三枚，灵玉两块。」他难得正色，「幽冥谷里没有光，进去的人都是这么丢的。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '弟子这就去凑')],
      },
      {
        id: 'done-lamp',
        text:
          '老翁把魂晶嵌进灯壁，灯芯一点就着，火是青的。' +
          '「记住，灯灭了就往回走。别逞能。」',
        art: null,
        onEnter: [],
        choices: [back('记下了')],
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
          accept('quest-c2-04', '听说你有笔账收不回来？', 'debt'),
          turnIn('quest-c2-04', '账，替你收了', 'done-debt'),
          accept('quest-c3-05', '沉船的事，说来听听', 'wreck'),
          turnIn('quest-c3-05', '你的货，捞上来了', 'done-wreck'),
          {
            id: 'gossip',
            text: '近来镇上有什么消息？',
            conditions: [],
            effects: [],
            next: 'gossip',
            hideWhenBlocked: false,
          },
          leave('不了'),
        ],
      },
      {
        id: 'debt',
        text: '「一个散修，欠我三千灵石跑了。您去『讲讲道理』，收回来的算您的，我只要个面子。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '成交')],
      },
      {
        id: 'done-debt',
        text: '算盘停了一瞬。「痛快！」他推过来一袋灵石，「往后有这类事，还找您。」',
        art: null,
        onEnter: [],
        choices: [back('好说')],
      },
      {
        id: 'wreck',
        text:
          '「三年前的事了。船翻在洛水秘境底下，蛟龙老爷占着不撒手。」' +
          '他搓了搓手，「您把它请开，三成归您。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '几时动身？')],
      },
      {
        id: 'done-wreck',
        text:
          '钱多多亲自开箱，里头是两段天雷木。「说好三成。」他把整箱推了过来，' +
          '「……算了，您拿去。这东西我留着也是招雷。」',
        art: null,
        onEnter: [],
        choices: [back('那我不客气了')],
      },
      {
        id: 'gossip',
        text: '「昆仑墟那边最近热闹，据说有人挖出了上古的东西。真假嘛……我只卖货，不卖消息。」',
        art: null,
        onEnter: [],
        choices: [back('有意思')],
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
          {
            id: 'ask',
            text: '前辈认得我？',
            conditions: [],
            effects: [],
            next: 'know',
            hideWhenBlocked: false,
          },
          accept('quest-c3-02', '前辈有何吩咐', 'hat'),
          turnIn('quest-c3-02', '鬼帝殿里的东西，在此', 'done-hat'),
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
          leave('不打扰前辈'),
        ],
      },
      {
        id: 'know',
        text: '「认得？不认得。」他打了个哈欠，「老夫谁也不认得。去罢。」',
        art: null,
        onEnter: [],
        choices: [back('……')],
      },
      {
        id: 'gift',
        text: '老者接过丹药，掂了掂，笑了一声：「有心。」他随手在你肩上一拍，一股暖流窜入经脉。',
        art: null,
        onEnter: [],
        choices: [back('多谢前辈')],
      },
      {
        id: 'hat',
        text: '「鬼帝殿里有个东西，你带回来给我看看。别问是什么——见着了自然知道。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '好')],
      },
      {
        id: 'done-hat',
        text:
          '老者摘下斗笠。那张脸你在青云宗的画像上见过——只是画上的人年轻三十岁。' +
          '「回去告诉云鹤，」他说，「就说我还欠他一局棋。」',
        art: null,
        onEnter: [],
        choices: [back('前辈是……？')],
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
          accept('quest-c1-05', '需要什么材料？', 'iron'),
          turnIn('quest-c1-05', '玄铁精三块，拿去', 'done-iron'),
          accept('quest-c2-06', '那半截断刃是怎么回事？', 'blade'),
          turnIn('quest-c2-06', '妖丹六枚，够了么', 'done-blade'),
          leave('没事了'),
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
        choices: [done('end', '……我去找')],
      },
      {
        id: 'done-iron',
        text: '锤声停了。他把剑递过来时手上还带着火星：「拿去。别拿它砍柴。」',
        art: null,
        onEnter: [],
        choices: [back('多谢')],
      },
      {
        id: 'blade',
        text:
          '「洛水里捞上来的。断口是新的。」他把断刃举到火光下，' +
          '「妖丹六枚，我把它重新开锋——你带着，早晚用得上。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '好')],
      },
      {
        id: 'done-blade',
        text:
          '铁玄把妖丹一枚枚敲碎，掺进炉里。铃声骤然从炉中响起。' +
          '「它认了你。」他把铃递过来，声音低了些，「这刃原来的主人，姓云。」',
        art: null,
        onEnter: [],
        choices: [back('……云？')],
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
          {
            id: 'rules',
            text: '论道台的规矩？',
            conditions: [],
            effects: [],
            next: 'rules',
            hideWhenBlocked: false,
          },
          accept('quest-c2-05', '我来立擂', 'arena'),
          turnIn('quest-c2-05', '三场已胜，秘境也走过了', 'done-arena'),
          leave('只是路过'),
        ],
      },
      {
        id: 'rules',
        text: '「同境者相搏，胜负计入榜上。输了不伤根本，赢了也别得意——榜是活的。」',
        art: null,
        onEnter: [],
        choices: [back('明白了')],
      },
      {
        id: 'arena',
        text: '「胜三场，再入青云秘境走一遭。做到了，我便认你这个道友。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '一言为定')],
      },
      {
        id: 'done-arena',
        text:
          '她抬手在榜上添了你的名字，笔锋收得极稳：「青云宗的名字，已经很久没上过这一栏了。」' +
          '停了停，「道友。」',
        art: null,
        onEnter: [],
        choices: [back('承让')],
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
          accept('quest-c2-07', '后山可要人巡？', 'patrol'),
          turnIn('quest-c2-07', '灵猿六只，都打发了', 'done-patrol'),
          {
            id: 'ask',
            text: '这山上有什么去处？',
            conditions: [],
            effects: [],
            next: 'places',
            hideWhenBlocked: false,
          },
          leave('走开'),
        ],
      },
      {
        id: 'welcome',
        text: '他抱拳一礼，神色松了下来：「原来是同门，失礼。掌门就在殿上，师兄自去便是。」',
        art: null,
        onEnter: [],
        choices: [back('多谢')],
      },
      {
        id: 'places',
        text: '「后山可以练手，镇上药王和铁匠都在。至于幽冥谷……师兄现在还是别去的好。」',
        art: null,
        onEnter: [],
        choices: [back('记下了')],
      },
      {
        id: 'patrol',
        text: '「灵猿六只，专挑挑水的师弟下手。」他有些不好意思，「我得守山门，走不开。」',
        art: null,
        onEnter: [],
        choices: [done('ok', '交给我')],
      },
      {
        id: 'done-patrol',
        text: '「师兄真是……」他挠了挠头，把腰上的丹药囊解下来塞给你，「这个您拿着，我这儿还有。」',
        art: null,
        onEnter: [],
        choices: [back('留着自己用')],
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

/** Total dialogue nodes across every tree, used by the content report. */
export function dialogueNodeCount(): number {
  return DIALOGUES.reduce((total, tree) => total + tree.nodes.length, 0);
}
