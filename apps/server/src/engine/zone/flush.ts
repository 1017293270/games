import {
  ITEM_BY_ID,
  refreshCultivator,
  type CharacterState,
  type Stats,
  type WorldSettings,
  type ZoneLoot,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { transact } from '../../db/index.js';
import { resolveEquipment, settle, statsOf, withFreshPower } from '../../game/character.js';
import { grantExp } from '../../game/rewards.js';
import { recordMonsterKill } from '../../modules/quest/service.js';
import type { ZoneDelta, ZoneWorld } from './world.js';

/**
 * Banking a stint on the field.
 *
 * This is the only place the zone loop writes 修为, 灵石 or 道具, and it always
 * does it the same way: **re-read the row, then add the delta on**. The row it
 * reads may have been rewritten a second ago by a REST request, the bot tick or
 * an admin grant, and all three of those are equally authoritative — folding a
 * delta onto whatever is there now is what keeps every writer's work.
 *
 * A player is settled to `now` first, exactly as a REST read would settle it, so
 * the 修为 earned by standing still and the 修为 earned by killing land in one
 * write instead of racing each other. A 机器人修士 is not: the bot tick settles
 * bots at their own schedule multiplier, and doing it here too would pay them
 * twice for the same seconds.
 *
 * The whole pass is one transaction — the `inventory` rows and the character
 * rows either all land or none do — and every socket push happens after the
 * commit, so nothing is announced that is not durable.
 *
 * Each window also produces a receipt. A connected player is pushed it as
 * `zone:loot`; a logged-out one has it filed on its 图籍 by
 * `ZoneWorld.bankOffline`, inside the same transaction, and is handed the whole
 * tally the next time it walks back in.
 */

/** What one flush pass did, for tests and the caller's own bookkeeping. */
export interface ZoneFlushResult {
  /** Character rows written. */
  characters: number;
  exp: number;
  stones: number;
}

interface PendingPush {
  state: CharacterState;
  loot: ZoneLoot;
}

/** True when a window has earned its owner nothing at all. */
function deltaIsEmpty(delta: ZoneDelta): boolean {
  return (
    delta.exp === 0 &&
    delta.stones === 0 &&
    delta.kills === 0 &&
    delta.bossKills === 0 &&
    delta.items.size === 0 &&
    delta.monsterKills.size === 0
  );
}

interface PendingRefresh {
  slot: number;
  stats: Stats;
  skills: (string | null)[];
  stageIndex: number;
}

/**
 * Writes back the accrued spoils of `only`, or of everyone on the field.
 *
 * A window is consumed once it has been paid out; one that earned nothing stays
 * open. A character whose row has gone is taken off the field instead.
 */
export function flushZone(
  ctx: AppContext,
  world: ZoneWorld,
  settings: WorldSettings,
  now: number,
  only?: readonly string[],
): ZoneFlushResult {
  const ids = only ?? [...world.deltas.keys()];
  const result: ZoneFlushResult = { characters: 0, exp: 0, stones: 0 };
  if (ids.length === 0) return result;

  const dirty: CharacterState[] = [];
  const pushes: PendingPush[] = [];
  const refreshes: PendingRefresh[] = [];
  const vanished: string[] = [];

  transact(ctx.db, () => {
    for (const id of ids) {
      const delta = world.deltas.get(id);
      if (!delta) continue;

      // A window that earned nothing is left open, so its `since` keeps marking
      // when the accumulation started — and for a 机器人修士 it is skipped
      // outright. Most of a busy field is bots, and re-reading two hundred rows
      // twice a minute to add zero to them would cost more than the simulation.
      const banked = !deltaIsEmpty(delta);
      if (!banked && world.entityOf(id)?.kind !== 'player') continue;
      if (banked) world.deltas.delete(id);

      const fresh = ctx.characters.byId(id);
      if (!fresh) {
        world.deltas.delete(id);
        vanished.push(id);
        continue;
      }

      // Settling is what a REST read would do anyway; an empty window has
      // nothing to write, so it reads the row as it stands and only re-rates
      // the field from it — that is how a gear change makes it onto a field
      // the player has not killed anything on yet.
      let next = fresh.isBot || !banked ? fresh : settle(fresh, settings, now).character;
      next = grantExp(next, delta.exp);
      if (delta.stones > 0) {
        next = { ...next, spiritStones: next.spiritStones + delta.stones };
      }

      const items: ZoneLoot['items'] = [];
      for (const [itemId, qty] of delta.items) {
        if (qty <= 0) continue;
        items.push({ itemId, qty, name: ITEM_BY_ID.get(itemId)?.name ?? itemId });
        // 机器人修士 own no `inventory` rows — their loadout is derived from
        // their id and 大境界 — so a bot's drops are flavour, not storage.
        if (!next.isBot) ctx.inventory.add(next.id, itemId, qty);
      }

      for (const [monsterId, count] of delta.monsterKills) {
        for (let n = 0; n < count; n += 1) next = recordMonsterKill(next, monsterId);
      }

      const equipment = resolveEquipment(next, ctx.inventory);
      next = withFreshPower(next, equipment);

      const slot = world.slots.get(id);
      if (slot !== undefined) {
        refreshes.push({
          slot,
          stats: statsOf(next, equipment),
          skills: next.skillSlots,
          stageIndex: next.stageIndex,
        });
      }

      if (!banked) continue;
      dirty.push(next);
      result.exp += delta.exp;
      result.stones += delta.stones;
      if (next.isBot) continue;

      const loot: ZoneLoot = {
        exp: delta.exp,
        spiritStones: delta.stones,
        items,
        kills: delta.kills,
        bossKills: delta.bossKills,
        since: delta.since,
      };

      // Somebody is watching: the receipt goes straight out after the commit.
      // Nobody is: it is filed against the 图籍 instead, and handed over whole
      // on the 进图 that brings the player back. Without that, the spoils still
      // reached the character row — they always did — but the 「闭关归来 ›
      // 挂机战果」 panel had nothing to show for a night on the field.
      if (ctx.presence.isOnline(next.id)) pushes.push({ state: next, loot });
      else world.bankOffline(next.id, loot);
    }

    ctx.characters.saveMany(dirty);
  });

  result.characters = dirty.length;

  // The field's copy of a cultivator is refreshed from the row that was just
  // written, so a 小境界 crossed while farming — or a piece of gear swapped
  // over REST mid-window — shows up in the next tick's damage numbers.
  for (const refresh of refreshes) {
    refreshCultivator(world.sim, refresh.slot, {
      stats: refresh.stats,
      skills: refresh.skills,
      stageIndex: refresh.stageIndex,
      maxHp: refresh.stats.hp,
    });
  }

  for (const id of vanished) world.drop(id);

  for (const push of pushes) {
    ctx.realtime.characterUpdate(push.state);
    ctx.realtime.toCharacter(push.state.id, 'zone:loot', push.loot);
  }

  return result;
}
