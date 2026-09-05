/**
 * 机器人修仙者.
 *
 * Bots are ordinary `CharacterState` records with `isBot: true` and a
 * `BotParams` block. They cultivate through `settleCultivation`, break through
 * with `attemptBreakthrough` and fight through `simulateBattle` — every formula
 * is shared with human players, so a bot's 战力 means exactly what a player's
 * does. The archetype only decides how fast and how aggressively.
 *
 * All six archetypes are editable from the admin panel; these are the seeds.
 */

import { createRng, combineSeeds, type Rng } from '../core/rng.js';
import { clamp, indexById, inHourWindow } from '../core/util.js';
import {
  BOT_OFFPEAK_RATE,
  BotArchetypeSchema,
  type BotAction,
  type BotArchetype,
  type BotParams,
} from '../domain/bot.js';
import { ART_AVATARS } from '../core/art.js';

const MALE_AVATARS = ART_AVATARS.filter((a) => a.startsWith('avatar/m'));
const FEMALE_AVATARS = ART_AVATARS.filter((a) => a.startsWith('avatar/f'));
const ALL_AVATARS = [...ART_AVATARS];

const SPECS: BotArchetype[] = [
  {
    id: 'bot-tianjiao',
    name: '天骄',
    description: '万中无一的修行天才。进境神速，眼高于顶，偶尔才屈尊与人动手。',
    weight: 6,
    avatarPool: [...ALL_AVATARS],
    params: {
      talent: 2.5,
      diligence: 0.9,
      insight: 0.15,
      aggression: 0.3,
      activeHours: [8, 24],
      explorePref: 'dungeon',
    },
  },
  {
    id: 'bot-kuxiu',
    name: '苦修',
    description: '资质平平，却日夜不辍。数十年如一日地打坐，从不与人争执。',
    weight: 22,
    avatarPool: [...ALL_AVATARS],
    params: {
      talent: 1.0,
      diligence: 1.0,
      insight: 0,
      aggression: 0.1,
      activeHours: [0, 24],
      explorePref: 'cultivate',
    },
  },
  {
    id: 'bot-sanxiu',
    name: '散修',
    description: '无门无派，四处游历。修为不高，见识却广，最爱在野外碰运气。',
    weight: 34,
    avatarPool: [...ALL_AVATARS],
    params: {
      talent: 0.8,
      diligence: 0.5,
      insight: 0,
      aggression: 0.2,
      activeHours: [6, 22],
      explorePref: 'explore',
    },
  },
  {
    id: 'bot-wanku',
    name: '纨绔',
    description: '出身不凡，天资也好，就是懒。修行三日打鱼，两日晒网，却总爱找人比试。',
    weight: 18,
    avatarPool: [...ALL_AVATARS],
    params: {
      talent: 1.5,
      diligence: 0.3,
      insight: 0,
      aggression: 0.4,
      activeHours: [12, 4],
      explorePref: 'arena',
    },
  },
  {
    id: 'bot-moxiu',
    name: '魔修',
    description: '走的是杀伐夺取的路子。见人便战，见宝便夺，夜里最是活跃。',
    weight: 12,
    avatarPool: [...ALL_AVATARS],
    params: {
      talent: 1.2,
      diligence: 0.7,
      insight: 0.05,
      aggression: 0.8,
      activeHours: [18, 6],
      explorePref: 'arena',
    },
  },
  {
    id: 'bot-yinshi',
    name: '隐士',
    description: '避世独修，深居简出。心境澄明，破境往往一蹴而就。从不主动惹事。',
    weight: 8,
    avatarPool: [...ALL_AVATARS],
    params: {
      talent: 1.0,
      diligence: 0.6,
      insight: 0.1,
      aggression: 0,
      activeHours: [4, 10],
      explorePref: 'cultivate',
    },
  },
];

export const BOT_ARCHETYPES: readonly BotArchetype[] = SPECS.map((a) =>
  BotArchetypeSchema.parse(a),
);
export const BOT_ARCHETYPE_BY_ID: ReadonlyMap<string, BotArchetype> = indexById(BOT_ARCHETYPES);
export const BOT_ARCHETYPE_IDS: readonly string[] = BOT_ARCHETYPES.map((a) => a.id);

export function getBotArchetype(id: string): BotArchetype | undefined {
  return BOT_ARCHETYPE_BY_ID.get(id);
}

/** Picks an archetype by its population weight. */
export function rollBotArchetype(rng: Rng): BotArchetype {
  return rng.weighted(
    BOT_ARCHETYPES,
    BOT_ARCHETYPES.map((a) => a.weight),
  );
}

// --------------------------------------------------------------------------
// 道号 generator
// --------------------------------------------------------------------------

/** 姓. Includes a few 复姓 for flavour. */
export const BOT_SURNAMES: readonly string[] = [
  '李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '马', '朱', '胡', '林', '何', '高', '郭', '罗',
  '秦', '萧', '谢', '沈', '韩', '唐', '冯', '董', '程', '曹',
  '袁', '云', '风', '玄', '墨', '洛', '慕', '南宫', '欧阳', '司徒',
];

/** 字. */
export const BOT_GIVEN_NAMES: readonly string[] = [
  '清', '玄', '寒', '逸', '尘', '霜', '阳', '虚', '平', '无',
  '长', '明', '元', '真', '静', '远', '苍', '疏', '观', '行',
  '照', '鸣', '衡', '岐', '独', '孤', '冷', '素', '漠', '幽',
  '青', '白', '朝', '暮', '空', '澜', '临', '知', '若', '归',
];

/** 尾缀 / 道号后缀. */
export const BOT_SUFFIXES: readonly string[] = [
  '子', '生', '客', '翁', '君', '仙', '真人', '道人', '散人', '上人',
  '居士', '老祖', '剑主', '行者',
];

/**
 * Generates a 道号. Same `seed` always yields the same name, so a bot
 * regenerated from its id keeps its identity.
 */
export function generateBotName(seed: number): string {
  const rng = createRng(seed);
  const surname = rng.pick(BOT_SURNAMES);
  const given = rng.pick(BOT_GIVEN_NAMES);
  // Two-character given names appear about a third of the time.
  const given2 = rng.chance(0.35) ? rng.pick(BOT_GIVEN_NAMES) : '';
  // Roughly half of all cultivators carry a 道号 suffix.
  const suffix = rng.chance(0.5) ? rng.pick(BOT_SUFFIXES) : '';
  return `${surname}${given}${given2}${suffix}`;
}

/** Generates `count` distinct 道号 from one seed. */
export function generateBotNames(seed: number, count: number): string[] {
  const names = new Set<string>();
  let salt = 0;
  while (names.size < count && salt < count * 200) {
    names.add(generateBotName(combineSeeds(seed, salt)));
    salt += 1;
  }
  return [...names];
}

/** Avatar pool matching a gender, drawn from the archetype's own list. */
export function botAvatarPool(archetype: BotArchetype, gender: 'male' | 'female'): string[] {
  const preferred = gender === 'male' ? MALE_AVATARS : FEMALE_AVATARS;
  const allowed = archetype.avatarPool.filter((a) => (preferred as readonly string[]).includes(a));
  return allowed.length > 0 ? allowed : [...preferred];
}

// --------------------------------------------------------------------------
// Bot behaviour
// --------------------------------------------------------------------------

/**
 * Multiplier a bot's cultivation rate is scaled by at a given hour.
 *
 * `talent` and `insight` are folded into the rate by `settleCultivation`
 * itself; this function covers only the schedule-dependent part, so the server
 * can bill a tick's worth of time at the right value.
 */
export function botScheduleMultiplier(params: BotParams, utcHour: number): number {
  const [start, end] = params.activeHours;
  const active = inHourWindow(utcHour, start, end);
  return (active ? 1 : BOT_OFFPEAK_RATE) * params.diligence;
}

/** Full cultivation multiplier for a bot at `utcHour`. */
export function botCultivationMultiplier(params: BotParams, utcHour: number): number {
  return params.talent * (1 + params.insight) * botScheduleMultiplier(params, utcHour);
}

export interface BotDecisionInput {
  params: BotParams;
  utcHour: number;
  /** True when the bot is parked at 圆满 with a full 修为 bar. */
  atPerfection: boolean;
  /** 破境丹 the bot holds. */
  breakthroughPills: number;
  /** Daily quotas already consumed. */
  dungeonRunsToday: number;
  arenaChallengesToday: number;
  dungeonDailyLimit: number;
  arenaDailyLimit: number;
}

/**
 * Chooses what a bot does on one tick. Deterministic given the same `rng`.
 *
 * A bot at 圆满 always tries to break through first — that is what produces the
 * `system:notice` breakthrough broadcasts players see in world chat.
 */
export function decideBotAction(input: BotDecisionInput, rng: Rng): BotAction {
  if (input.atPerfection) return 'breakthrough';

  const { params } = input;
  const active = inHourWindow(input.utcHour, params.activeHours[0], params.activeHours[1]);
  // Outside its active window a bot mostly just sits and cultivates.
  if (!active && !rng.chance(0.15)) return 'cultivate';

  // `diligence` is the share of ticks spent purely cultivating.
  if (rng.chance(clamp(params.diligence * 0.7, 0, 0.95))) return 'cultivate';

  if (rng.chance(params.aggression)) {
    if (input.arenaChallengesToday < input.arenaDailyLimit) return 'arena';
    return 'explore';
  }

  if (params.explorePref === 'dungeon' && input.dungeonRunsToday < input.dungeonDailyLimit) {
    return 'dungeon';
  }
  if (params.explorePref === 'arena' && input.arenaChallengesToday < input.arenaDailyLimit) {
    return 'arena';
  }
  if (params.explorePref === 'cultivate') return 'cultivate';
  return 'explore';
}
