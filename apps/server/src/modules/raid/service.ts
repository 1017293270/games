import {
  expRequired,
  realmOf,
  type CharacterState,
  type RaidAttackResponse,
  type RaidTarget,
  type RewardBundle,
  type Stats,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildPublicProfile, resolveEquipment, statsOf, withFreshPower } from '../../game/character.js';
import { battleSeed, characterCombatant, hpShareAfter, runBattle } from '../../game/combat.js';
import { applyReward, nameReward, scaleReward } from '../../game/rewards.js';
import { botRaidHpPercent, loadOtherHealed } from '../../game/hp.js';
import { activeMemberIds } from '../party/service.js';
import { grantPrestige, raidTargetIds } from './repo.js';

/**
 * 围攻 — players ganging up on a 机器人修士.
 *
 * A target is not a duel: it carries a 血池 across attacks, so a bot far above
 * any single player is still brought down by a party chipping at it over an
 * afternoon. Every wave is one `runBattle` against the bot at its *remaining*
 * 气血; whatever is left becomes the pool the next wave meets.
 *
 * Bringing one down pays a 灵石 bounty split among the raiders, one point of
 * 声望 each, and puts the bot behind a `raidRecoverMinutes` shield it comes back
 * from whole.
 */

/** 金丹·前期. Below this a bot is not worth ganging up on. */
export const RAID_STAGE_FLOOR = 8;

/** Targets the board offers. */
export const RAID_TARGET_LIMIT = 20;

/** Base bounty of a 练气 target; each major realm doubles it. */
export const RAID_BASE_BOUNTY = 500;

/** 灵石 pool the raiders split for bringing a target down. */
export function bountyFor(stageIndex: number): number {
  return RAID_BASE_BOUNTY * 2 ** realmOf(stageIndex);
}

/** A bot's board row: profile plus its live 血池 and shield. */
function toTarget(ctx: AppContext, bot: CharacterState, now: number): RaidTarget {
  return {
    ...buildPublicProfile(bot, ctx.presence.isOnline(bot.id), ctx.inventory),
    hpPercent: botRaidHpPercent(bot, now),
    protectedUntil: bot.protectedUntil > now ? bot.protectedUntil : 0,
    bounty: bountyFor(bot.stageIndex),
  };
}

/** `GET /api/raid/targets`. */
export function listTargets(ctx: AppContext, now: number): { targets: RaidTarget[] } {
  const ids = raidTargetIds(ctx, RAID_STAGE_FLOOR, RAID_TARGET_LIMIT);
  const byId = new Map(ctx.characters.byIds(ids).map((s) => [s.id, s]));
  const targets: RaidTarget[] = [];
  for (const id of ids) {
    const bot = byId.get(id);
    if (bot) targets.push(toTarget(ctx, bot, now));
  }
  return { targets };
}

interface Raider {
  state: CharacterState;
  stats: Stats;
}

/** Each raider settled and healed to `now`, so a party fights at its real strength. */
function loadRaiders(
  ctx: AppContext,
  ids: readonly string[],
  world: WorldSettings,
  now: number,
): Raider[] {
  const out: Raider[] = [];
  for (const id of ids) {
    const state = loadOtherHealed(ctx, id, world, now);
    if (!state) continue;
    out.push({ state, stats: statsOf(state, resolveEquipment(state, ctx.inventory)) });
  }
  return out;
}

/** Share of the run's pay-out one raider walks away with. */
function raidReward(
  state: CharacterState,
  stones: number,
  defeated: boolean,
  world: WorldSettings,
): RewardBundle {
  const share = defeated ? 0.03 : 0.008;
  const scaled = scaleReward(Math.round(expRequired(state.stageIndex) * share), stones, world);
  return nameReward({ ...scaled, items: [] });
}

/** `POST /api/raid/attack`. */
export function attack(
  ctx: AppContext,
  caller: CharacterState,
  input: { botId: string; withParty: boolean },
  world: WorldSettings,
  now: number,
): RaidAttackResponse {
  const bot = loadOtherHealed(ctx, input.botId, world, now);
  if (!bot) throw new ApiError('CHARACTER_NOT_FOUND', '查无此人');
  if (!bot.isBot) throw new ApiError('TARGET_NOT_BOT', '只能围攻机器人修士');
  if (bot.protectedUntil > now) {
    const wait = Math.ceil((bot.protectedUntil - now) / 60_000);
    throw new ApiError('TARGET_PROTECTED', `${bot.name} 正在闭关疗伤，还需 ${wait} 分钟`);
  }

  const record = input.withParty ? ctx.parties.byMember(caller.id) : null;
  const raiderIds = record ? activeMemberIds(ctx, record, caller.id) : [caller.id];
  const raiders = loadRaiders(ctx, raiderIds, world, now);
  if (raiders.length === 0) throw new ApiError('CHARACTER_NOT_FOUND', '没有可参战的修士');

  const botStats = statsOf(bot, resolveEquipment(bot, ctx.inventory));
  const hpBefore = botRaidHpPercent(bot, now);

  const battle = runBattle(
    raiders.map((r) => characterCombatant(r.state, r.stats, { hpPercent: r.state.hpPercent })),
    [characterCombatant(bot, botStats, { hpPercent: hpBefore })],
    battleSeed('raid', bot.id, caller.id, now),
    world,
  );

  // The bot's 血池 is the whole point: what it walks away from this wave with is
  // what the next raiders meet, so damage across attacks accumulates. It is
  // clamped downwards on purpose — a 神通 that heals mid-fight may keep the bot
  // standing, but it must never hand the pool back, or a target with 木灵愈体
  // could never be brought down at all.
  const hpAfter = Math.min(hpBefore, hpShareAfter(battle, bot.id, botStats.hp));
  const defeated = hpAfter <= 0;
  const bounty = bountyFor(bot.stageIndex);
  const stonesEach = defeated ? Math.floor(bounty / raiders.length) : 0;

  let callerReward = raidReward(caller, stonesEach, defeated, world);
  const participantIds = raiders.map((r) => r.state.id);

  for (const raider of raiders) {
    const reward = raidReward(raider.state, stonesEach, defeated, world);
    let next = applyReward(raider.state, reward, ctx.inventory);
    next = { ...next, hpPercent: hpShareAfter(battle, raider.state.id, raider.stats.hp) };
    const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
    ctx.characters.save(saved);
    ctx.realtime.characterUpdate(saved);
    if (saved.id === caller.id) callerReward = reward;
  }

  if (defeated) grantPrestige(ctx, participantIds);

  // The guard above already established the old shield had lapsed, so an attack
  // that does not bring the target down leaves it unshielded and wounded.
  const protectedUntil = defeated ? now + world.raidRecoverMinutes * 60_000 : 0;
  const savedBot: CharacterState = { ...bot, hpPercent: hpAfter, protectedUntil };
  ctx.characters.save(savedBot);

  ctx.battles.insert({
    kind: 'raid',
    attackerId: caller.id,
    attackerName: caller.name,
    defenderId: bot.id,
    defenderName: bot.name,
    winnerId: defeated ? caller.id : bot.id,
    ratingDelta: 0,
    foughtAt: now,
    battle,
  });
  ctx.counters.bump('battles', now);

  ctx.realtime.toWorld('raid:update', {
    botId: bot.id,
    botName: bot.name,
    hpPercent: hpAfter,
    lastDamage: Math.max(0, (hpBefore - hpAfter) * botStats.hp),
    attackerNames: raiders.map((r) => r.state.name),
    defeated,
    protectedUntil,
  });

  return {
    defeated,
    battle,
    remainingHpPercent: hpAfter,
    reward: callerReward,
    participantIds,
    target: toTarget(ctx, savedBot, now),
  };
}
