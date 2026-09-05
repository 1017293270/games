import {
  createRng,
  realmNameOf,
  stageName,
  type CharacterState,
  type Rng,
} from '@xianxia/shared';

/**
 * World-chat lines for bot cultivators.
 *
 * The shared content package carries no chat table, so the templates live here.
 * They are written so that a line reads plausibly at any realm: `{name}` is the
 * speaker's 道号, `{stage}` their full stage (金丹·后期) and `{realm}` the major
 * realm alone (金丹).
 */
export const BOT_CHAT_TEMPLATES: readonly string[] = [
  '闭关三月，总算摸到{stage}的门槛了。',
  '哪位道友知道{realm}期该用什么丹药稳固境界？',
  '今日在山中遇一头妖兽，险些没能回来。',
  '灵石又见底了，谁家收灵草？价钱好商量。',
  '修行至{realm}，方知从前所谓的「快」有多可笑。',
  '有没有道友一起下秘境？我{stage}，能扛两波。',
  '论道台上又输了一场，回去闭关。',
  '师父说过，急于突破的人多半死在雷劫下。共勉。',
  '谁在幽冥谷见过魂晶？我找了三日一无所获。',
  '夜里打坐，忽觉丹田一暖——莫非要进阶了？',
  '这世道，散修想活下去太难了。',
  '恭喜方才那位道友破境。我等还需努力。',
  '青云山的灵草又被采空了，来晚一步。',
  '有道友愿以功法换丹药么？我这有一部残卷。',
  '{realm}之后路愈难行，诸位保重。',
  '刚在昆仑墟捡到一块残碑，看不懂上面的字。',
  '不与人争，只与昨日之我争。',
  '再有半月，我便要试着冲一冲大境界了。',
];

/** Minimum gap between two lines from the same bot. */
export const BOT_CHAT_COOLDOWN_MS = 30 * 60 * 1000;

/** Ceiling on how many bot lines one tick may produce. */
export const BOT_CHAT_PER_TICK = 3;

/** Fills a template for one speaker. */
export function renderBotLine(template: string, bot: CharacterState): string {
  return template
    .replaceAll('{name}', bot.name)
    .replaceAll('{stage}', stageName(bot.stageIndex))
    .replaceAll('{realm}', realmNameOf(bot.stageIndex));
}

/** Picks a line for a bot. Deterministic given the same rng. */
export function pickBotLine(bot: CharacterState, rng: Rng): string {
  return renderBotLine(rng.pick(BOT_CHAT_TEMPLATES), bot);
}

/** Convenience for callers that only have a seed. */
export function botLineFromSeed(bot: CharacterState, seed: number): string {
  return pickBotLine(bot, createRng(seed));
}
