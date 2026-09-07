import { progressEvent } from '../../game/progression.js';
import type { z } from 'zod';
import {
  combineSeeds,
  createRng,
  DUNGEON_BY_ID,
  DUNGEONS,
  type DungeonListResponseSchema,
  ITEM_BY_ID,
  MONSTER_BY_ID,
  stageName,
  type BattleResult,
  type CharacterState,
  type Combatant,
  type DungeonStartResponse,
  type DungeonWave,
  type RewardBundle,
  type Stats,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildView, resolveEquipment, statsOf, withFreshPower } from '../../game/character.js';
import {
  battleSeed,
  characterCombatant,
  hpShareAfter,
  monsterTeam,
  runBattle,
} from '../../game/combat.js';
import { applyReward, emptyReward, nameReward, rollLoot, scaleReward } from '../../game/rewards.js';
import { loadOtherHealed } from '../../game/hp.js';
import { activeMemberIds } from '../party/service.js';

/**
 * 秘境副本.
 *
 * A run is the dungeon's trash waves in order followed by its BOSS, each wave
 * resolved through `runBattle`. 气血 carries between waves — that is what makes
 * a four-wave 秘境 a war of attrition rather than four unrelated duels — and a
 * lost wave ends the run where it stands.
 *
 * A party run is one shared fight per wave: everyone present is on team A, so
 * bringing friends is genuinely stronger, and the loot is rolled once and handed
 * to each participant in full.
 */

/**
 * shared exports `DungeonListResponseSchema` but no matching type alias, so the
 * response type is inferred here rather than restated.
 */
type DungeonListResponse = z.infer<typeof DungeonListResponseSchema>;

/** Entries a character may spend on one 秘境 today. */
export function dailyLimitFor(dungeonId: string, world: WorldSettings): number {
  return world.dungeonDailyLimit + (DUNGEON_BY_ID.get(dungeonId)?.bonusDailyEntries ?? 0);
}

/** `GET /api/dungeon`. */
export function listDungeons(state: CharacterState, world: WorldSettings): DungeonListResponse {
  return {
    dungeons: DUNGEONS.map((dungeon) => {
      const boss = MONSTER_BY_ID.get(dungeon.bossId);
      if (!boss) throw new ApiError('INTERNAL_ERROR', `秘境 ${dungeon.id} 的 BOSS 数据缺失`);
      return {
        ...dungeon,
        unlocked: state.stageIndex >= dungeon.unlockStage,
        runsToday: state.dailyCounters.dungeon,
        dailyLimit: dailyLimitFor(dungeon.id, world),
        boss,
      };
    }),
  };
}

/** 第一阵 … 第 N 阵, with the last wave named for what guards it. */
function waveName(index: number, total: number): string {
  const ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八'];
  if (index === total - 1) return '镇守';
  return `第 ${ORDINALS[index] ?? index + 1} 阵`;
}

/**
 * What stood in one wave, as the replay needs it.
 *
 * A duplicated 妖兽 is suffixed to keep the two apart in the battle log, so the
 * combatant id — not the 妖兽 id — is what a `finalHp` key can be matched on;
 * carrying the roster next to the replay is what saves the client from
 * reverse-engineering the cast from the keys it happens to see.
 */
function toWave(
  index: number,
  total: number,
  enemies: readonly Combatant[],
  battle: BattleResult,
): DungeonWave {
  return {
    name: waveName(index, total),
    enemies: enemies.map((enemy) => ({
      id: enemy.id,
      name: enemy.name,
      art: enemy.art ?? null,
      maxHp: battle.maxHp[enemy.id] ?? Math.max(1, Math.round(enemy.stats.hp)),
    })),
  };
}

/** One cultivator taking part in a run. */
interface Participant {
  state: CharacterState;
  stats: Stats;
}

/** Each participant settled and healed to `now` before the gate opens. */
function loadParticipants(
  ctx: AppContext,
  ids: readonly string[],
  world: WorldSettings,
  now: number,
): Participant[] {
  const out: Participant[] = [];
  for (const id of ids) {
    const state = loadOtherHealed(ctx, id, world, now);
    if (!state) continue;
    out.push({ state, stats: statsOf(state, resolveEquipment(state, ctx.inventory)) });
  }
  return out;
}

/** Both gates every participant has to clear before the gate opens. */
function assertCanEnter(
  participants: readonly Participant[],
  dungeonId: string,
  dungeonName: string,
  unlockStage: number,
  world: WorldSettings,
): void {
  const limit = dailyLimitFor(dungeonId, world);
  for (const { state } of participants) {
    if (state.stageIndex < unlockStage) {
      throw new ApiError(
        'DUNGEON_LOCKED',
        `${state.name} 需 ${stageName(unlockStage)} 方可进入${dungeonName}`,
      );
    }
    if (state.dailyCounters.dungeon >= limit) {
      throw new ApiError('DAILY_LIMIT_REACHED', `${state.name} 今日的秘境次数已经用完了`);
    }
  }
}

/** Resolves who is going in. */
function resolveRoster(
  ctx: AppContext,
  caller: CharacterState,
  withParty: boolean,
): { ids: string[]; partyId: string | null } {
  if (!withParty) return { ids: [caller.id], partyId: null };

  const record = ctx.parties.byMember(caller.id);
  if (!record) throw new ApiError('NOT_IN_PARTY', '你还没有队伍，无法组队进入秘境');
  if (record.leaderId !== caller.id) throw new ApiError('NOT_PARTY_LEADER', '只有队长可以开启秘境');

  const ids = activeMemberIds(ctx, record, caller.id);
  if (ids.length < 1) throw new ApiError('PARTY_TOO_SMALL', '队伍里没有能参战的道友');
  return { ids, partyId: record.id };
}

/** `POST /api/dungeon/start`. */
export function startDungeon(
  ctx: AppContext,
  caller: CharacterState,
  input: { dungeonId: string; withParty: boolean },
  world: WorldSettings,
  now: number,
): DungeonStartResponse {
  const dungeon = DUNGEON_BY_ID.get(input.dungeonId);
  if (!dungeon) throw new ApiError('NOT_FOUND', '没有这处秘境');

  const { ids, partyId } = resolveRoster(ctx, caller, input.withParty);
  const participants = loadParticipants(ctx, ids, world, now);
  if (participants.length === 0) throw new ApiError('NOT_FOUND', '没有可参战的修士');
  assertCanEnter(participants, dungeon.id, dungeon.name, dungeon.unlockStage, world);

  const participantIds = participants.map((p) => p.state.id);
  const startEvent = {
    dungeonId: dungeon.id,
    dungeonName: dungeon.name,
    partyMemberIds: participantIds,
    startedAt: now,
  };
  if (partyId) ctx.realtime.toParty(partyId, 'dungeon:start', startEvent);
  else ctx.realtime.toCharacter(caller.id, 'dungeon:start', startEvent);

  // ---- waves, BOSS last; 气血 carries forward through `hpShareAfter`
  const hpShares = new Map(participants.map((p) => [p.state.id, p.state.hpPercent]));
  const rosters: string[][] = [...dungeon.waves.map((w) => [...w]), [dungeon.bossId]];
  const battles: BattleResult[] = [];
  const waves: DungeonWave[] = [];
  let cleared = true;

  for (let index = 0; index < rosters.length; index += 1) {
    const enemies = monsterTeam(rosters[index] ?? []);
    if (enemies.length === 0) continue;

    const teamA = participants.map((p) =>
      characterCombatant(p.state, p.stats, { hpPercent: hpShares.get(p.state.id) ?? 1 }),
    );
    const battle = runBattle(
      teamA,
      enemies,
      battleSeed('dungeon', dungeon.id, caller.id, index, now),
      world,
    );
    battles.push(battle);
    waves.push(toWave(index, rosters.length, enemies, battle));

    for (const p of participants) {
      hpShares.set(p.state.id, hpShareAfter(battle, p.state.id, p.stats.hp));
    }
    if (battle.winner !== 'A') {
      cleared = false;
      break;
    }
  }

  // ---- one loot roll for the run; every participant receives a full copy, so
  // the party sees the same result and nobody is punished for being second.
  let reward: RewardBundle = emptyReward();
  if (cleared) {
    const rng = createRng(combineSeeds('dungeon-loot', dungeon.id, caller.id, now));
    const scaled = scaleReward(dungeon.reward.exp, dungeon.reward.spiritStones, world);
    reward = nameReward({ ...scaled, items: rollLoot(dungeon.reward.loot, rng, world) });
  }

  let callerState = caller;
  for (const { state } of participants) {
    let next = cleared ? applyReward(state, reward, ctx.inventory) : state;
    next = {
      ...next,
      hpPercent: hpShares.get(state.id) ?? next.hpPercent,
      dailyCounters: { ...next.dailyCounters, dungeon: next.dailyCounters.dungeon + 1 },
    };
    next = progressEvent(next, now, 'dungeon');
    if (cleared) next = progressEvent(next, now, 'first_boss');
    const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
    ctx.characters.save(saved);
    ctx.realtime.characterUpdate(saved);
    if (saved.id === caller.id) callerState = saved;
  }

  ctx.dungeonRuns.insert({
    dungeonId: dungeon.id,
    leaderId: caller.id,
    participantIds,
    cleared,
    foughtAt: now,
  });
  ctx.counters.bump('dungeons', now);

  const resultEvent = {
    dungeonId: dungeon.id,
    dungeonName: dungeon.name,
    cleared,
    replay: battles,
    waves,
    reward: {
      exp: reward.exp,
      spiritStones: reward.spiritStones,
      items: reward.items.map((item) => ({
        itemId: item.itemId,
        qty: item.qty,
        name: ITEM_BY_ID.get(item.itemId)?.name ?? item.itemId,
      })),
    },
    participantIds,
  };
  if (partyId) ctx.realtime.toParty(partyId, 'dungeon:result', resultEvent);
  else ctx.realtime.toCharacter(caller.id, 'dungeon:result', resultEvent);

  return {
    dungeonId: dungeon.id,
    cleared,
    battles,
    waves,
    reward,
    view: buildView(callerState, world, now, ctx.inventory),
    participantIds,
  };
}
