import { randomUUID } from 'node:crypto';
import {
  EQUIP_SLOT_NAMES,
  ITEM_BY_ID,
  stageName,
  type CharacterState,
  type CharacterView,
  type EquipSlot,
  type InventoryListResponse,
  type UseItemResponse,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../http/errors.js';
import { buildView, resolveEquipment, statsOf, withFreshPower } from '../../game/character.js';
import { grantExp } from '../../game/rewards.js';

/** 背包与装备. */

export function list(
  ctx: AppContext,
  state: CharacterState,
  world: WorldSettings,
  now: number,
): InventoryListResponse {
  void world;
  void now;
  const equipment = resolveEquipment(state, ctx.inventory);
  const stats = statsOf(state, equipment);
  return {
    items: ctx.inventory.view(state.id, Object.values(state.equipment)),
    spiritStones: state.spiritStones,
    equipment: { ...state.equipment },
    stats,
    powerScore: state.powerScore,
  };
}

/**
 * Consumes a pill.
 *
 * 破境丹 is deliberately not consumable here: it is spent by
 * `POST /api/character/breakthrough`, which is where its bonus applies.
 */
export function useItem(
  ctx: AppContext,
  state: CharacterState,
  uid: string,
  qty: number,
  world: WorldSettings,
  now: number,
): UseItemResponse {
  const row = ctx.inventory.byUid(uid);
  if (!row || row.characterId !== state.id) {
    throw new ApiError('ITEM_NOT_FOUND', '背包里没有这件物品');
  }
  if (row.qty < qty) {
    throw new ApiError('INSUFFICIENT_ITEMS', `数量不足，只剩 ${row.qty} 个`);
  }

  const item = ITEM_BY_ID.get(row.itemId);
  if (!item || item.kind !== 'pill') {
    throw new ApiError('NOT_CONSUMABLE', '这件物品不能服用');
  }
  if (item.effect.type === 'breakthrough_aid') {
    throw new ApiError('NOT_CONSUMABLE', `${item.name}要在冲击大境界时才能用上`);
  }

  let next = state;
  let message: string;
  let gainedExp = 0;

  switch (item.effect.type) {
    case 'cultivation_buff': {
      const buffs = [...next.buffs];
      for (let i = 0; i < qty; i += 1) {
        buffs.push({
          id: randomUUID(),
          itemId: item.id,
          bonus: item.effect.bonus,
          expiresAt: now + item.effect.durationSec * 1000,
        });
      }
      next = { ...next, buffs };
      message = `服下${item.name}，修炼速度提升 ${Math.round(item.effect.bonus * 100)}%`;
      break;
    }
    case 'instant_exp': {
      gainedExp = Math.round(item.effect.exp * qty * world.expRewardMultiplier);
      next = grantExp(next, gainedExp);
      message = `服下${item.name}，修为增长 ${gainedExp}`;
      break;
    }
    case 'heal': {
      const healed = Math.min(1, next.hpPercent + item.effect.healPercent * qty);
      next = { ...next, hpPercent: healed };
      message = `服下${item.name}，气血恢复至 ${Math.round(healed * 100)}%`;
      break;
    }
    case 'stat_buff': {
      // Combat-stat pills are consumed for their flavour text in M1; the fight
      // modifiers land with the arena module, which is where a timed combat
      // buff first has something to apply to.
      message = `服下${item.name}，一股暖流游走四肢百骸`;
      break;
    }
    case 'unlock_skill_slot': {
      message = `服下${item.name}，神识为之开阔`;
      break;
    }
    default: {
      message = `服下${item.name}`;
      break;
    }
  }

  ctx.inventory.removeFromStack(uid, qty);
  const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved);

  return { view: buildView(saved, world, now, ctx.inventory), message, gainedExp };
}

/** Wears a piece of equipment, swapping out whatever occupied the slot. */
export function equip(
  ctx: AppContext,
  state: CharacterState,
  uid: string,
  world: WorldSettings,
  now: number,
): CharacterView {
  const row = ctx.inventory.byUid(uid);
  if (!row || row.characterId !== state.id) {
    throw new ApiError('ITEM_NOT_FOUND', '背包里没有这件装备');
  }

  const item = ITEM_BY_ID.get(row.itemId);
  if (!item || item.kind !== 'equipment') {
    throw new ApiError('NOT_EQUIPPABLE', '这件物品不能装备');
  }
  if (state.stageIndex < item.requiredStage) {
    throw new ApiError('STAGE_TOO_LOW', `境界不足，需 ${stageName(item.requiredStage)}`);
  }

  const next: CharacterState = {
    ...state,
    equipment: { ...state.equipment, [item.slot]: uid },
  };
  const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved, { equipment: saved.equipment });
  return buildView(saved, world, now, ctx.inventory);
}

/** Empties one equip slot. */
export function unequip(
  ctx: AppContext,
  state: CharacterState,
  slot: EquipSlot,
  world: WorldSettings,
  now: number,
): CharacterView {
  if (state.equipment[slot] === null) {
    throw new ApiError('SLOT_MISMATCH', `${EQUIP_SLOT_NAMES[slot]}槽位本来就是空的`);
  }
  const next: CharacterState = { ...state, equipment: { ...state.equipment, [slot]: null } };
  const saved = withFreshPower(next, resolveEquipment(next, ctx.inventory));
  ctx.characters.save(saved);
  ctx.realtime.characterUpdate(saved, { equipment: saved.equipment });
  return buildView(saved, world, now, ctx.inventory);
}
