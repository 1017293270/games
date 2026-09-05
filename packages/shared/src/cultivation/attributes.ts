/**
 * Combat attribute derivation.
 *
 *   base(stage) -> x(1 + technique% + equipment%) -> + equipment flat
 *
 * The percentage block is additive across sources so that a player can reason
 * about "+12% 攻击 from the sword, +15% from the technique" without compounding
 * surprises; flat bonuses land last so low-grade gear still matters early.
 */

import { clamp, round } from '../core/util.js';
import { getStage, MAX_STAGE_INDEX } from './realms.js';
import {
  STAT_KEYS,
  ZERO_STAT_BONUS,
  type StatBonus,
  type StatKey,
  type Stats,
} from '../domain/stats.js';
import { ITEM_GRADE_MULTIPLIER, type EquipmentItem } from '../domain/item.js';
import type { Technique } from '../domain/technique.js';

/** Realm-level scale for the four absolute stats. */
const STAT_REALM_MULT = [1, 2.2, 4.8, 10.5, 23, 50, 110, 240, 520] as const;

/** Sub-stage scale within a realm. */
const STAT_SUB_MULT = [1, 1.15, 1.32, 1.52] as const;

/** 练气·前期 reference values. */
const BASE_HP = 120;
const BASE_ATK = 18;
const BASE_DEF = 10;
const BASE_SPD = 10;

/** Rates grow slowly and linearly across all 36 stages. */
const BASE_CRIT = 0.05;
const CRIT_PER_STAGE = 0.002;
const BASE_CRIT_RESIST = 0.02;
const CRIT_RESIST_PER_STAGE = 0.0015;
const BASE_ACC = 0.9;
const ACC_PER_STAGE = 0.002;
const BASE_EVA = 0.03;
const EVA_PER_STAGE = 0.001;
/** Speed climbs gently so turn order stays legible at every realm. */
const SPD_PER_STAGE = 0.02;

/** Attributes of a bare character at `stageIndex`, no gear and no technique. */
export function baseStatsForStage(stageIndex: number): Stats {
  const stage = getStage(stageIndex);
  const scale =
    (STAT_REALM_MULT[stage.realm] as number) * (STAT_SUB_MULT[stage.sub] as number);
  return {
    hp: Math.round(BASE_HP * scale),
    atk: Math.round(BASE_ATK * scale),
    def: Math.round(BASE_DEF * scale),
    spd: round(BASE_SPD * (1 + SPD_PER_STAGE * stageIndex), 2),
    crit: round(BASE_CRIT + CRIT_PER_STAGE * stageIndex, 4),
    critResist: round(BASE_CRIT_RESIST + CRIT_RESIST_PER_STAGE * stageIndex, 4),
    acc: round(BASE_ACC + ACC_PER_STAGE * stageIndex, 4),
    eva: round(BASE_EVA + EVA_PER_STAGE * stageIndex, 4),
  };
}

function addBonus(target: StatBonus, source: Partial<StatBonus>, scale = 1): void {
  for (const key of STAT_KEYS) {
    const v = source[key];
    if (typeof v === 'number') target[key] += v * scale;
  }
}

export interface ComputeStatsInput {
  stageIndex: number;
  /** Resolved equipment pieces currently worn (at most one per slot). */
  equipment?: readonly EquipmentItem[];
  /** The 功法 currently being studied. */
  technique?: Technique | null;
  /** Temporary combat-stat modifiers from pills. */
  extraFlat?: Partial<StatBonus>;
  extraPercent?: Partial<StatBonus>;
}

/**
 * Full attribute derivation for a character. Bots go through the same path.
 */
export function computeStats(input: ComputeStatsInput): Stats {
  const base = baseStatsForStage(input.stageIndex);

  const percent: StatBonus = { ...ZERO_STAT_BONUS };
  const flat: StatBonus = { ...ZERO_STAT_BONUS };

  for (const piece of input.equipment ?? []) {
    const gradeScale = ITEM_GRADE_MULTIPLIER[piece.grade];
    addBonus(percent, piece.percent, gradeScale);
    addBonus(flat, piece.flat, gradeScale);
  }

  const technique = input.technique;
  if (technique) addBonus(percent, technique.percent);

  if (input.extraPercent) addBonus(percent, input.extraPercent);
  if (input.extraFlat) addBonus(flat, input.extraFlat);

  const scaled = (key: StatKey): number =>
    (base[key] as number) * (1 + (percent[key] as number)) + (flat[key] as number);

  return {
    hp: Math.max(1, Math.round(scaled('hp'))),
    atk: Math.max(0, Math.round(scaled('atk'))),
    def: Math.max(0, Math.round(scaled('def'))),
    spd: Math.max(1, round(scaled('spd'), 2)),
    crit: clamp(round(scaled('crit'), 4), 0, 1),
    critResist: clamp(round(scaled('critResist'), 4), 0, 1),
    acc: clamp(round(scaled('acc'), 4), 0, 2),
    eva: clamp(round(scaled('eva'), 4), 0, 1),
  };
}

/**
 * 战力. A single comparable number used by rankings, arena matchmaking and the
 * "can I beat this?" hint. Offence and defence are weighted so that neither a
 * glass cannon nor a pure wall dominates the ladder.
 */
export function powerScore(stats: Stats): number {
  const offence = stats.atk * (1 + stats.crit * 0.8 + stats.acc * 0.2);
  const defence = stats.def * 1.4 + stats.hp * 0.22;
  const tempo = stats.spd * 4 + (stats.eva + stats.critResist) * 60;
  return Math.max(0, Math.round(offence * 3 + defence + tempo));
}

/** Convenience: 战力 of a bare character at a stage, for tuning tables. */
export function baselinePowerAtStage(stageIndex: number): number {
  return powerScore(baseStatsForStage(stageIndex));
}

/** Every stage's baseline attributes, useful for admin tuning views. */
export function allBaselineStats(): readonly Stats[] {
  const out: Stats[] = [];
  for (let i = 0; i <= MAX_STAGE_INDEX; i += 1) out.push(baseStatsForStage(i));
  return out;
}
