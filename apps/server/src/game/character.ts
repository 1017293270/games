import {
  activePillBonus,
  botProgression,
  progressionBonuses,
  mainTreasureCombat,
  computeStats,
  cultivationRatePerSec,
  EQUIP_SLOTS,
  expRequired,
  getStage,
  getTechnique,
  isPerfection,
  ITEM_BY_ID,
  powerScore,
  secondsToNextStage,
  settleCultivation,
  spiritRootName,
  stageName,
  type CharacterState,
  type CharacterView,
  type EquipmentItem,
  type ProfileEquipment,
  type PublicProfile,
  type SettleResult,
  type Stats,
  type WorldSettings,
} from '@xianxia/shared';
import type { InventoryRepo } from '../db/repo/inventory.js';
import { progressCultivation } from './progression.js';
import { botEquipment } from '../engine/bots/gear.js';

/**
 * Derivations every module needs: attributes, 战力, the settle wrapper and the
 * two response shapes (`CharacterView` for the owner, `PublicProfile` for
 * everyone else).
 */

/**
 * Resolves the four equip slots into the equipment pieces they point at.
 *
 * A 机器人修士 owns no `inventory` rows, so its slots are derived from its id
 * and 大境界 instead (`engine/bots/gear.ts`). Routing that through the one
 * function every module already calls is what gives 论道, 围攻, 公开档案 and
 * the rankings a geared bot without any of them special-casing one.
 */
export function resolveEquipment(state: CharacterState, inventory: InventoryRepo): EquipmentItem[] {
  if (state.isBot) return botEquipment(state);

  const pieces: EquipmentItem[] = [];
  for (const uid of Object.values(state.equipment)) {
    if (uid === null) continue;
    const row = inventory.byUid(uid);
    if (!row || row.characterId !== state.id) continue;
    const item = ITEM_BY_ID.get(row.itemId);
    if (item?.kind === 'equipment') pieces.push(item);
  }
  return pieces;
}

/** Bots use the same content and formulas with a deterministic earned loadout. */
export function progressionOf(state: CharacterState) {
  return state.isBot ? botProgression(state.id, state.stageIndex) : state.progression;
}
export function mainTreasureOf(state: CharacterState) {
  return mainTreasureCombat(progressionOf(state));
}

/** Full attributes with gear and 功法 folded in. */
export function statsOf(
  state: CharacterState,
  equipment: readonly EquipmentItem[],
  nowMs = state.lastSettledAt,
): Stats {
  const bonuses = progressionBonuses(progressionOf(state));
  for (const buff of state.buffs) {
    if (buff.expiresAt <= nowMs || !buff.stats) continue;
    for (const key of Object.keys(bonuses.extraPercent) as (keyof Stats)[]) {
      bonuses.extraPercent[key] += buff.stats[key] ?? 0;
    }
  }
  return computeStats({
    stageIndex: state.stageIndex,
    ...bonuses,
    equipment,
    technique: getTechnique(state.techniqueId),
  });
}

/**
 * Recomputes and stamps `powerScore`.
 *
 * The cached value is what rankings sort on, so it is refreshed on every path
 * that can change attributes: settle, breakthrough, equip, learn.
 */
export function withFreshPower(
  state: CharacterState,
  equipment: readonly EquipmentItem[],
  nowMs = state.lastSettledAt,
): CharacterState {
  const power = powerScore(statsOf(state, equipment, nowMs));
  return state.powerScore === power ? state : { ...state, powerScore: power };
}

/** Live cultivation points per second, all multipliers applied. */
export function ratePerSecOf(
  state: CharacterState,
  world: WorldSettings,
  nowMs: number,
  extraMultiplier = 1,
): number {
  return cultivationRatePerSec({
    stageIndex: state.stageIndex,
    spiritRootQuality: state.spiritRoot.quality,
    techniqueBonus: getTechnique(state.techniqueId)?.cultivationBonus ?? 0,
    progressionBonus: progressionBonuses(progressionOf(state)).cultivationBonus,
    pillBonus: activePillBonus(state.buffs, nowMs),
    world: { cultivationMultiplier: world.cultivationMultiplier * extraMultiplier },
    botMultiplier:
      state.isBot && state.botParams ? state.botParams.talent * (1 + state.botParams.insight) : 1,
  });
}

/**
 * Lazy settle. Every request that reads a character runs this first, so 修为 is
 * always a pure function of the wall clock (ARCHITECTURE §8).
 *
 * `cultivationMultiplier` may be scaled by `extraMultiplier` — the bot tick
 * passes the schedule/diligence part of `botCultivationMultiplier` that way.
 */
export function settle(
  state: CharacterState,
  world: WorldSettings,
  nowMs: number,
  extraMultiplier = 1,
): SettleResult {
  return settleCultivation(
    progressCultivation(
      state.isBot ? { ...state, progression: progressionOf(state) } : state,
      nowMs,
      world.offlineCapHours,
    ),
    nowMs,
    {
      cultivationMultiplier: world.cultivationMultiplier * extraMultiplier,
      offlineCapHours: world.offlineCapHours,
    },
    { technique: getTechnique(state.techniqueId) },
  );
}

/** Stage names crossed during a settle window, for the 闭关归来 summary. */
export function stagesPassed(from: number, stageUps: number): string[] {
  const names: string[] = [];
  for (let i = 1; i <= stageUps; i += 1) names.push(stageName(from + i));
  return names;
}

/** True when the character is parked at 圆满 with a full 修为 bar. */
export function atPerfection(state: CharacterState): boolean {
  return isPerfection(state.stageIndex) && state.exp >= getStage(state.stageIndex).expRequired;
}

/** The owner-facing character payload. */
export function buildView(
  state: CharacterState,
  world: WorldSettings,
  nowMs: number,
  inventory: InventoryRepo,
): CharacterView {
  const equipment = resolveEquipment(state, inventory);
  return {
    character: state,
    stats: statsOf(state, equipment, nowMs),
    stageName: stageName(state.stageIndex),
    expRequired: expRequired(state.stageIndex),
    ratePerSec: ratePerSecOf(state, world, nowMs),
    secondsToNextStage: secondsToNextStage(
      state.isBot ? { ...state, progression: progressionOf(state) } : state,
      { cultivationMultiplier: world.cultivationMultiplier },
      { technique: getTechnique(state.techniqueId), nowMs },
    ),
    atPerfection: atPerfection(state),
    inventory: inventory.view(state.id, Object.values(state.equipment)),
  };
}

/** Equipped pieces in slot order, with what a dossier slot needs to draw one. */
function profileEquipment(equipment: readonly EquipmentItem[]): ProfileEquipment[] {
  const bySlot = new Map(equipment.map((piece) => [piece.slot, piece]));
  const out: ProfileEquipment[] = [];
  for (const slot of EQUIP_SLOTS) {
    const piece = bySlot.get(slot);
    if (!piece) continue;
    out.push({
      slot,
      itemId: piece.id,
      name: piece.name,
      grade: piece.grade,
      art: piece.art,
    });
  }
  return out;
}

/** What any player may see about another cultivator. */
export function buildPublicProfile(
  state: CharacterState,
  online: boolean,
  inventory: InventoryRepo,
  nowMs = state.lastSettledAt,
): PublicProfile {
  const equipment = resolveEquipment(state, inventory);
  const stats = statsOf(state, equipment, nowMs);
  return {
    id: state.id,
    name: state.name,
    gender: state.gender,
    avatarArt: state.avatarArt,
    isBot: state.isBot,
    stageIndex: state.stageIndex,
    stageName: stageName(state.stageIndex),
    spiritRoot: state.spiritRoot,
    powerScore: powerScore(stats),
    stats,
    techniqueName: getTechnique(state.techniqueId)?.name ?? null,
    skillIds: state.skillSlots.filter((s): s is string => s !== null),
    equipmentItemIds: equipment.map((e) => e.id),
    equipment: profileEquipment(equipment),
    arenaRating: state.arenaRating,
    arenaWins: state.arenaWins,
    arenaLosses: state.arenaLosses,
    online,
    lastSeenAt: state.lastSeenAt,
    protectedUntil: state.protectedUntil,
  };
}

/** Display string for a spirit root, re-exported so modules import one place. */
export { spiritRootName };
