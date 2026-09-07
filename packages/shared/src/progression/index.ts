import { createRng, hashSeed } from '../core/rng.js';
import { ZERO_STAT_BONUS, type StatBonus } from '../domain/stats.js';
import {
  ProgressionStateSchema,
  type ProgressionState,
  type GachaDrawResult,
  type MainTreasureCombat,
  type ProgressionMaterials,
} from '../domain/progression.js';
import {
  TREASURES,
  TREASURE_BY_ID,
  RELICS,
  RELIC_BY_ID,
  PROGRESSION_GRADE_MULT,
  GACHA_RULES,
  STAR_FRAGMENT_COSTS,
  DAILY_QUESTS,
  PROGRESSION_ACHIEVEMENTS,
  DAILY_REWARD,
  ACHIEVEMENT_REWARD,
  STARTER_REWARD,
} from '../content/progression.js';
import type {
  ProgressionDrawRequest,
  ProgressionEquipRequest,
  ProgressionUpgradeRequest,
  ProgressionClaimRequest,
} from '../protocol/progression.js';
import type { ApiErrorCode } from '../protocol/common.js';
export class ProgressionError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
const emptyMaterials = (): ProgressionMaterials => ({
  jade: 0,
  stardust: 0,
  starStones: 0,
  breakthroughWood: 0,
});
export function getProgression(
  state: ProgressionState | undefined,
  nowMs: number,
): ProgressionState {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const p: ProgressionState = state
    ? structuredClone(state)
    : {
        materials: emptyMaterials(),
        treasures: [],
        relics: [],
        gacha: { treasure: { pity: 0, total: 0 }, relic: { pity: 0, total: 0 } },
        daily: {
          date,
          kills: 0,
          cultivationSeconds: 0,
          dungeon: 0,
          arena: 0,
          chat: 0,
          claimed: [],
          freePools: [],
        },
        achievements: [],
        claimedAchievements: [],
        starterClaimed: false,
      };
  if (p.daily.date !== date)
    p.daily = {
      date,
      kills: 0,
      cultivationSeconds: 0,
      dungeon: 0,
      arena: 0,
      chat: 0,
      claimed: [],
      freePools: [],
    };
  return checked(p);
}
function check(ok: unknown, code: ApiErrorCode, message: string): asserts ok {
  if (!ok) throw new ProgressionError(code, message);
}
function spend(p: ProgressionState, cost: Partial<ProgressionMaterials>) {
  for (const key of Object.keys(cost) as (keyof ProgressionMaterials)[])
    check(p.materials[key] >= cost[key]!, 'INSUFFICIENT_ITEMS', '养成材料不足');
  for (const key of Object.keys(cost) as (keyof ProgressionMaterials)[])
    p.materials[key] -= cost[key]!;
}
export function drawProgression(
  state: ProgressionState | undefined,
  request: ProgressionDrawRequest,
  seed: number,
  nowMs: number,
): { progression: ProgressionState; results: GachaDrawResult[] } {
  const p = getProgression(state, nowMs);
  check(request.count === 1 || request.count === 10, 'VALIDATION_ERROR', '抽取次数无效');
  check(request.pool === 'treasure' || request.pool === 'relic', 'VALIDATION_ERROR', '奖池无效');
  if (request.free) {
    check(
      request.count === 1 && !p.daily.freePools.includes(request.pool),
      'CONDITION_UNMET',
      '今日免费次数已用',
    );
    p.daily.freePools.push(request.pool);
  } else spend(p, { jade: request.count === 10 ? GACHA_RULES.tenCost : GACHA_RULES.singleCost });
  const rng = createRng(seed),
    results: GachaDrawResult[] = [];
  const counter = p.gacha[request.pool];
  for (let i = 0; i < request.count; i++) {
    let grade = rng.weighted(GACHA_RULES.grades, GACHA_RULES.weights);
    if (counter.pity >= 69) grade = 'divine';
    else if (
      request.count === 10 &&
      i === 9 &&
      !results.some((v) => v.grade === 'saint' || v.grade === 'divine') &&
      grade !== 'divine'
    )
      grade = 'saint';
    const candidates = (request.pool === 'treasure' ? TREASURES : RELICS).filter(
      (v) => v.grade === grade,
    );
    const def = rng.pick(candidates);
    const owned =
      request.pool === 'treasure'
        ? p.treasures.find((v) => v.definitionId === def.id)
        : p.relics.find((v) => v.definitionId === def.id);
    if (owned) owned.fragments += 10;
    else if (request.pool === 'treasure')
      p.treasures.push({
        uid: `owned-${def.id}`,
        definitionId: def.id,
        level: 1,
        spiritLevel: 0,
        stars: 0,
        fragments: 0,
        slot: null,
      });
    else p.relics.push({ definitionId: def.id, spiritLevel: 0, stars: 0, fragments: 0 });
    counter.pity = grade === 'divine' ? 0 : counter.pity + 1;
    counter.total++;
    results.push({
      pool: request.pool,
      definitionId: def.id,
      grade,
      duplicate: !!owned,
      fragments: owned ? 10 : 0,
      pity: counter.pity,
    });
  }
  return { progression: checked(p), results };
}
export function equipProgression(
  state: ProgressionState,
  request: ProgressionEquipRequest,
): ProgressionState {
  const p = structuredClone(state),
    owned = p.treasures.find((v) => v.uid === request.uid);
  check(owned, 'ITEM_NOT_FOUND', '法宝未拥有');
  check(request.slot === null || [0, 1, 2].includes(request.slot), 'VALIDATION_ERROR', '槽位无效');
  if (request.slot !== null)
    for (const t of p.treasures) if (t.slot === request.slot) t.slot = null;
  owned.slot = request.slot;
  return checked(p);
}
export function progressionUpgradeCost(
  state: ProgressionState,
  request: ProgressionUpgradeRequest,
): Partial<ProgressionMaterials> & { fragments?: number } {
  const owned =
    request.kind === 'treasure'
      ? state.treasures.find((v) => v.uid === request.id)
      : state.relics.find((v) => v.definitionId === request.id);
  check(owned, 'ITEM_NOT_FOUND', '尚未拥有');
  if (request.action === 'star') {
    check(owned.stars < 5, 'CONDITION_UNMET', '已达五星');
    return { fragments: STAR_FRAGMENT_COSTS[owned.stars]!, stardust: 20 * (owned.stars + 1) };
  }
  if (request.action === 'infuse') {
    check(owned.spiritLevel < 10, 'CONDITION_UNMET', '注灵已满');
    return { stardust: 20 * (owned.spiritLevel + 1) };
  }
  check(request.action === 'level' && 'level' in owned, 'CONDITION_UNMET', '古宝不支持等级养成');
  const level = Number(owned.level);
  check(level < 100, 'CONDITION_UNMET', '等级已满');
  return {
    starStones: 5 + level * 2,
    ...(level % 10 === 0 ? { breakthroughWood: Math.floor(level / 10) } : {}),
  };
}
export function upgradeProgression(
  state: ProgressionState,
  request: ProgressionUpgradeRequest,
): ProgressionState {
  const p = structuredClone(state),
    cost = progressionUpgradeCost(p, request),
    owned =
      request.kind === 'treasure'
        ? p.treasures.find((v) => v.uid === request.id)!
        : p.relics.find((v) => v.definitionId === request.id)!;
  check(owned.fragments >= (cost.fragments ?? 0), 'INSUFFICIENT_ITEMS', '本体碎片不足');
  const { fragments, ...materials } = cost;
  spend(p, materials);
  owned.fragments -= fragments ?? 0;
  if (request.action === 'star') owned.stars++;
  else if (request.action === 'infuse') owned.spiritLevel++;
  else if ('level' in owned) owned.level = Number(owned.level) + 1;
  return checked(p);
}
export function claimProgression(
  state: ProgressionState | undefined,
  request: ProgressionClaimRequest,
  nowMs: number,
): ProgressionState {
  const p = getProgression(state, nowMs);
  if (request.kind === 'starter') {
    check(request.id === 'starter', 'NOT_FOUND', '奖励不存在');
    check(!p.starterClaimed, 'QUEST_ALREADY_CLAIMED', '已领入门馈赠');
    p.starterClaimed = true;
    p.treasures.push({
      uid: 'owned-t-starter-bell',
      definitionId: 't-starter-bell',
      level: 1,
      spiritLevel: 0,
      stars: 0,
      fragments: 0,
      slot: p.treasures.some((v) => v.slot === 0) ? null : 0,
    });
    p.treasures.push({
      uid: 'owned-t-starter-shield',
      definitionId: 't-starter-shield',
      level: 1,
      spiritLevel: 0,
      stars: 0,
      fragments: 0,
      slot: null,
    });
    awardProgressionMaterials(p, STARTER_REWARD);
    return checked(p);
  }
  if (request.kind === 'daily') {
    const q = DAILY_QUESTS.find((v) => v.id === request.id);
    check(q, 'NOT_FOUND', '日常不存在');
    check(!p.daily.claimed.includes(q.id), 'QUEST_ALREADY_CLAIMED', '已领取');
    check(p.daily[q.counter] >= q.target, 'QUEST_NOT_COMPLETE', '日常尚未完成');
    p.daily.claimed.push(q.id);
    awardProgressionMaterials(p, DAILY_REWARD);
  } else {
    check(
      PROGRESSION_ACHIEVEMENTS.some((v) => v.id === request.id),
      'NOT_FOUND',
      '成就不存在',
    );
    check(p.achievements.includes(request.id), 'QUEST_NOT_COMPLETE', '成就尚未完成');
    check(!p.claimedAchievements.includes(request.id), 'QUEST_ALREADY_CLAIMED', '已领取');
    p.claimedAchievements.push(request.id);
    awardProgressionMaterials(p, ACHIEVEMENT_REWARD);
  }
  return checked(p);
}
export function progressionBonuses(state?: ProgressionState): {
  extraFlat: StatBonus;
  extraPercent: StatBonus;
  cultivationBonus: number;
} {
  const result = {
    extraFlat: { ...ZERO_STAT_BONUS },
    extraPercent: { ...ZERO_STAT_BONUS },
    cultivationBonus: 0,
  };
  if (!state) return result;
  for (const t of state.treasures) {
    if (t.slot === null) continue;
    const def = TREASURE_BY_ID.get(t.definitionId);
    if (!def) continue;
    const scale =
      PROGRESSION_GRADE_MULT[def.grade] *
      (1 +
        (t.level - 1) * 0.01 +
        t.spiritLevel * 0.04 +
        t.stars * 0.06 +
        (t.stars === 5 ? 0.1 : 0));
    result.extraPercent.atk += 0.025 * scale;
    result.extraPercent.hp += 0.015 * scale;
  }
  const sets = new Map<string, number>();
  for (const r of state.relics) {
    const def = RELIC_BY_ID.get(r.definitionId);
    if (!def) continue;
    const scale =
      PROGRESSION_GRADE_MULT[def.grade] *
      (1 + r.spiritLevel * 0.08 + r.stars * 0.12 + (r.stars === 5 ? 0.2 : 0));
    for (const key of Object.keys(def.percent) as (keyof StatBonus)[])
      result.extraPercent[key] += (def.percent[key] ?? 0) * scale;
    for (const key of Object.keys(def.flat) as (keyof StatBonus)[])
      result.extraFlat[key] += (def.flat[key] ?? 0) * scale;
    result.cultivationBonus += def.cultivationBonus * scale;
    sets.set(def.setId, (sets.get(def.setId) ?? 0) + 1);
  }
  for (const count of sets.values())
    if (count >= 3) {
      result.extraPercent.hp += 0.01;
      result.extraPercent.atk += 0.01;
      result.cultivationBonus += 0.005;
    }
  return result;
}
export function mainTreasureCombat(state?: ProgressionState): MainTreasureCombat | undefined {
  const t = state?.treasures.find((v) => v.slot === 0);
  if (!t) return;
  const def = TREASURE_BY_ID.get(t.definitionId);
  if (!def) return;
  return {
    definitionId: def.id,
    name: def.name,
    art: def.art,
    form: def.form,
    intervalMs: { bell: 1000, tower: 2500, chain: 3500, seal: 4000, banner: 6000, shield: 8000 }[
      def.form
    ],
    power:
      1 +
      (PROGRESSION_GRADE_MULT[def.grade] - 1) * 0.04 +
      (t.level - 1) * 0.004 +
      t.spiritLevel * 0.02 +
      t.stars * 0.025,
    awakened: t.stars === 5,
  };
}
export function botProgression(id: string, stageIndex: number): ProgressionState {
  const p = getProgression(undefined, 0),
    rng = createRng(hashSeed(id));
  const grade =
    stageIndex >= 24
      ? 'divine'
      : stageIndex >= 12
        ? 'saint'
        : stageIndex >= 4
          ? 'immortal'
          : 'spirit';
  const def = rng.pick(TREASURES.filter((v) => v.grade === grade));
  p.treasures = [
    {
      uid: `bot-${def.id}`,
      definitionId: def.id,
      level: Math.min(100, 1 + stageIndex * 2),
      spiritLevel: Math.min(10, Math.floor(stageIndex / 4)),
      stars: Math.min(5, Math.floor(stageIndex / 7)),
      fragments: 0,
      slot: 0,
    },
  ];
  p.relics = RELICS.filter((v) => v.grade === grade)
    .slice(0, Math.min(6, 1 + Math.floor(stageIndex / 5)))
    .map((v) => ({
      definitionId: v.id,
      stars: Math.min(5, Math.floor(stageIndex / 8)),
      spiritLevel: Math.min(10, Math.floor(stageIndex / 5)),
      fragments: 0,
    }));
  return checked(p);
}

function checked(p: ProgressionState): ProgressionState {
  check(ProgressionStateSchema.safeParse(p).success, 'VALIDATION_ERROR', '养成数据超出安全范围');
  return p;
}
/** Mutates only the supplied working copy, with overflow checks before writes. */
export function awardProgressionMaterials(
  p: ProgressionState,
  reward: Partial<ProgressionMaterials>,
): void {
  for (const key of Object.keys(reward) as (keyof ProgressionMaterials)[])
    check(
      Number.isSafeInteger(reward[key]) &&
        reward[key]! >= 0 &&
        Number.isSafeInteger(p.materials[key] + reward[key]!),
      'VALIDATION_ERROR',
      '材料数量超出安全范围',
    );
  for (const key of Object.keys(reward) as (keyof ProgressionMaterials)[])
    p.materials[key] += reward[key]!;
}
