import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { StatsSchema, type Stats } from '../domain/stats.js';

const ArtIdSchema = z.enum(ART_IDS);

/** 灵力 pool every combatant starts a battle with. */
export const COMBAT_MANA_MAX = 100;
/** 灵力 regained at the start of each of a combatant's turns. */
export const COMBAT_MANA_REGEN = 15;
/** Default round cap; a battle still running at this point is a draw. */
export const DEFAULT_MAX_ROUNDS = 30;
/** Damage multiplier applied on a critical hit. */
export const CRIT_MULTIPLIER = 1.5;
/** Damage roll spread, applied as a uniform factor. */
export const DAMAGE_VARIANCE = 0.1;
/** Basic attack coefficient, used when no 神通 is castable. */
export const BASIC_ATTACK_POWER = 1.0;
/** Hit chance is clamped into this band regardless of 命中 vs 闪避. */
export const MIN_HIT_CHANCE = 0.35;
export const MAX_HIT_CHANCE = 0.99;

export const CombatantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  art: ArtIdSchema.optional(),
  stats: StatsSchema,
  /** Up to four 神通 ids, cast in rotation order. */
  skills: z.array(z.string().min(1)).max(4),
  /** Overrides starting 气血; used for raid blood pools and wounded raiders. */
  hp: z.number().positive().optional(),
});
export type Combatant = z.infer<typeof CombatantSchema>;

export const BattleInputSchema = z.object({
  seed: z.number().int(),
  teamA: z.array(CombatantSchema).min(1),
  teamB: z.array(CombatantSchema).min(1),
  maxRounds: z.number().int().min(1).max(200).optional(),
});
export type BattleInput = z.infer<typeof BattleInputSchema>;

export const BATTLE_WINNERS = ['A', 'B', 'draw'] as const;
export const BattleWinnerSchema = z.enum(BATTLE_WINNERS);
export type BattleWinner = z.infer<typeof BattleWinnerSchema>;

export type TeamSide = 'A' | 'B';

/** Why a battle stopped. */
export const BATTLE_END_REASONS = ['team_wiped', 'max_rounds'] as const;
export const BattleEndReasonSchema = z.enum(BATTLE_END_REASONS);
export type BattleEndReason = z.infer<typeof BattleEndReasonSchema>;

export const BattleEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('round_start'),
    round: z.number().int().min(1),
    /** Combatant ids in the order they will act this round. */
    order: z.array(z.string()),
  }),
  z.object({
    type: z.literal('skill_cast'),
    round: z.number().int().min(1),
    actorId: z.string(),
    /** null for a basic attack. */
    skillId: z.string().nullable(),
    skillName: z.string(),
    manaSpent: z.number().min(0),
    targetIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal('damage'),
    round: z.number().int().min(1),
    actorId: z.string(),
    targetId: z.string(),
    skillId: z.string().nullable(),
    amount: z.number().min(0),
    crit: z.boolean(),
    dodged: z.boolean(),
    /** Target 气血 after the hit. */
    targetHp: z.number().min(0),
  }),
  z.object({
    type: z.literal('heal'),
    round: z.number().int().min(1),
    actorId: z.string(),
    targetId: z.string(),
    skillId: z.string().nullable(),
    amount: z.number().min(0),
    targetHp: z.number().min(0),
  }),
  z.object({
    type: z.literal('buff'),
    round: z.number().int().min(1),
    actorId: z.string(),
    targetId: z.string(),
    skillId: z.string().nullable(),
    stat: z.string(),
    amount: z.number(),
    durationRounds: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('debuff'),
    round: z.number().int().min(1),
    actorId: z.string(),
    targetId: z.string(),
    skillId: z.string().nullable(),
    stat: z.string(),
    amount: z.number(),
    durationRounds: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('death'),
    round: z.number().int().min(1),
    targetId: z.string(),
    killerId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('battle_end'),
    round: z.number().int().min(1),
    winner: BattleWinnerSchema,
    reason: BattleEndReasonSchema,
  }),
]);
export type BattleEvent = z.infer<typeof BattleEventSchema>;

export const BattleResultSchema = z.object({
  winner: BattleWinnerSchema,
  rounds: z.number().int().min(0),
  log: z.array(BattleEventSchema),
  /** Final 气血 of every combatant, keyed by id. */
  finalHp: z.record(z.string(), z.number()),
  /**
   * 气血 ceiling of every combatant, keyed by id. A replay needs a denominator
   * for its bars and the log alone cannot supply one, so the engine writes the
   * runtime maximum out beside the final value.
   */
  maxHp: z.record(z.string(), z.number()),
  /** Total damage each combatant dealt. */
  damageDealt: z.record(z.string(), z.number()),
  /** Echoed so a replay can be re-derived from the result alone. */
  seed: z.number().int(),
  reason: BattleEndReasonSchema,
});
export type BattleResult = z.infer<typeof BattleResultSchema>;

/** Runtime view of one combatant while a battle is running. */
export interface CombatantRuntime {
  readonly id: string;
  readonly name: string;
  readonly side: TeamSide;
  /** Position in its team, used to break ties deterministically. */
  readonly index: number;
  readonly base: Stats;
  readonly skills: readonly string[];
  hp: number;
  maxHp: number;
  mana: number;
  /** Rotation pointer into `skills`. */
  rotation: number;
  /** Remaining cooldown per skill, positionally aligned with `skills`. */
  cooldowns: number[];
  /** Active stat modifiers with their remaining round counts. */
  modifiers: { stat: keyof Stats; amount: number; rounds: number }[];
  alive: boolean;
}
