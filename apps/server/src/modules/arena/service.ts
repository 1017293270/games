import {
  clamp,
  expRequired,
  realmOf,
  stageName,
  type ArenaChallengeResponse,
  type CharacterState,
  type PublicProfile,
  type RewardBundle,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildPublicProfile, resolveEquipment, statsOf, withFreshPower } from '../../game/character.js';
import { battleSeed, characterCombatant, hpShareAfter, runBattle } from '../../game/combat.js';
import { applyReward, nameReward, scaleReward } from '../../game/rewards.js';
import { loadOtherHealed } from '../../game/hp.js';
import { eloDelta } from '../../engine/bots/engine.js';
import { nearbyOpponentIds, pruneReplays } from './repo.js';

/**
 * 论道 (PvP).
 *
 * A challenge is one fight between two stored cultivators — the defender never
 * has to be online, because their `CharacterState` *is* the snapshot the fight
 * runs against. Rating moves by the same `eloDelta` the bot world uses, so a
 * player's 论道 rank means the same thing whether they climbed it against
 * people or against 机器人修士.
 *
 * Both sides walk away with the 气血 the fight left them (`game/hp.ts` heals it
 * back over ten minutes), which is what keeps a daily quota of challenges from
 * being ten identical fresh duels.
 */

/** Stages either side of the challenger an opponent may be drawn from. */
export const OPPONENT_STAGE_WINDOW = 3;

/** Opponents offered on the 论道 screen. */
export const OPPONENT_LIST_SIZE = 12;

/** Odds hint is squeezed into this band: no fight is ever shown as certain. */
const WIN_HINT_MIN = 0.1;
const WIN_HINT_MAX = 0.9;

/** Rough odds from the two 战力 scores, for the pre-fight hint only. */
export function winHint(mine: number, theirs: number): number {
  const total = mine + theirs;
  if (total <= 0) return 0.5;
  return clamp(mine / total, WIN_HINT_MIN, WIN_HINT_MAX);
}

/** `GET /api/arena/opponents`. */
export function listOpponents(
  ctx: AppContext,
  state: CharacterState,
  world: WorldSettings,
): {
  opponents: (PublicProfile & { winHint: number })[];
  challengesToday: number;
  dailyLimit: number;
  rating: number;
} {
  const ids = nearbyOpponentIds(ctx, {
    characterId: state.id,
    stageIndex: state.stageIndex,
    arenaRating: state.arenaRating,
    window: OPPONENT_STAGE_WINDOW,
    limit: OPPONENT_LIST_SIZE,
  });

  const byId = new Map(ctx.characters.byIds(ids).map((s) => [s.id, s]));
  const opponents: (PublicProfile & { winHint: number })[] = [];
  for (const id of ids) {
    const other = byId.get(id);
    if (!other) continue;
    const profile = buildPublicProfile(other, ctx.presence.isOnline(id), ctx.inventory);
    opponents.push({ ...profile, winHint: winHint(state.powerScore, profile.powerScore) });
  }

  return {
    opponents,
    challengesToday: state.dailyCounters.arena,
    dailyLimit: world.arenaDailyLimit,
    rating: state.arenaRating,
  };
}

/** 论道 pay-out: a slice of a stage plus pocket 灵石, scaled by the world. */
function challengeReward(state: CharacterState, won: boolean, world: WorldSettings): RewardBundle {
  const share = won ? 0.015 : 0.004;
  const stones = (won ? 60 : 15) * (realmOf(state.stageIndex) + 1);
  const scaled = scaleReward(Math.round(expRequired(state.stageIndex) * share), stones, world);
  return nameReward({ ...scaled, items: [] });
}

/** `POST /api/arena/challenge`. */
export function challenge(
  ctx: AppContext,
  attacker: CharacterState,
  targetId: string,
  world: WorldSettings,
  now: number,
): ArenaChallengeResponse {
  if (targetId === attacker.id) throw new ApiError('SELF_CHALLENGE', '自己与自己论道毫无意义');
  if (attacker.dailyCounters.arena >= world.arenaDailyLimit) {
    throw new ApiError('DAILY_LIMIT_REACHED', '今日的论道次数已经用完了');
  }

  const defender = loadOtherHealed(ctx, targetId, world, now);
  if (!defender) throw new ApiError('CHARACTER_NOT_FOUND', '查无此人');
  if (Math.abs(defender.stageIndex - attacker.stageIndex) > OPPONENT_STAGE_WINDOW) {
    throw new ApiError(
      'INVALID_OPPONENT',
      `只能与境界相差 ${OPPONENT_STAGE_WINDOW} 阶以内的修士论道`,
    );
  }

  const attackerStats = statsOf(attacker, resolveEquipment(attacker, ctx.inventory));
  const defenderStats = statsOf(defender, resolveEquipment(defender, ctx.inventory));

  // A 机器人修士 duels at full strength: its `hpPercent` is the 围攻 血池, and
  // 论道 has no business draining or reading that pool.
  const defenderHp = defender.isBot ? 1 : defender.hpPercent;
  const battle = runBattle(
    [characterCombatant(attacker, attackerStats, { hpPercent: attacker.hpPercent })],
    [characterCombatant(defender, defenderStats, { hpPercent: defenderHp })],
    battleSeed('arena', attacker.id, defender.id, now),
    world,
  );

  const won = battle.winner === 'A';
  const draw = battle.winner === 'draw';
  const delta = eloDelta(attacker.arenaRating, defender.arenaRating, draw ? 0.5 : won ? 1 : 0);

  const reward = challengeReward(attacker, won, world);
  let nextAttacker = applyReward(attacker, reward, ctx.inventory);
  nextAttacker = {
    ...nextAttacker,
    arenaRating: Math.max(0, attacker.arenaRating + delta),
    arenaWins: attacker.arenaWins + (won ? 1 : 0),
    arenaLosses: attacker.arenaLosses + (!won && !draw ? 1 : 0),
    dailyCounters: { ...nextAttacker.dailyCounters, arena: nextAttacker.dailyCounters.arena + 1 },
    hpPercent: hpShareAfter(battle, attacker.id, attackerStats.hp),
  };

  const nextDefender: CharacterState = {
    ...defender,
    arenaRating: Math.max(0, defender.arenaRating - delta),
    arenaWins: defender.arenaWins + (!won && !draw ? 1 : 0),
    arenaLosses: defender.arenaLosses + (won ? 1 : 0),
    hpPercent: defender.isBot
      ? defender.hpPercent
      : hpShareAfter(battle, defender.id, defenderStats.hp),
  };

  const savedAttacker = withFreshPower(nextAttacker, resolveEquipment(nextAttacker, ctx.inventory));
  const savedDefender = withFreshPower(nextDefender, resolveEquipment(nextDefender, ctx.inventory));
  ctx.characters.save(savedAttacker);
  ctx.characters.save(savedDefender);
  ctx.realtime.characterUpdate(savedAttacker);
  ctx.realtime.characterUpdate(savedDefender);

  ctx.battles.insert({
    kind: 'arena',
    attackerId: attacker.id,
    attackerName: attacker.name,
    defenderId: defender.id,
    defenderName: defender.name,
    winnerId: draw ? null : won ? attacker.id : defender.id,
    ratingDelta: delta,
    foughtAt: now,
    battle,
  });
  ctx.counters.bump('arena', now);
  pruneReplays(ctx, attacker.id);
  pruneReplays(ctx, defender.id);

  if (!defender.isBot) {
    ctx.realtime.toCharacter(defender.id, 'arena:challenged', {
      attackerId: attacker.id,
      attackerName: attacker.name,
      attackerStageName: stageName(attacker.stageIndex),
      attackerAvatarArt: attacker.avatarArt,
      defenderLost: won,
      ratingDelta: -delta,
      battle,
      foughtAt: now,
    });
  }

  return {
    won,
    battle,
    ratingBefore: attacker.arenaRating,
    ratingAfter: savedAttacker.arenaRating,
    reward,
    opponent: buildPublicProfile(
      savedDefender,
      ctx.presence.isOnline(savedDefender.id),
      ctx.inventory,
    ),
  };
}
