import {
  MONSTER_BY_ID,
  type Rng,
  type WorldSettings,
  type ZoneKill,
} from '@xianxia/shared';
import { rollLoot, scaleReward } from '../../game/rewards.js';

/**
 * Turning a 妖兽's death into 修为, 灵石 and drops.
 *
 * The simulation reports only *what* died and who hurt it (`ZoneKill`), because
 * a pure function cannot read a character row. This is the other half: the
 * content reward, put through the same `expRewardMultiplier` /
 * `stoneRewardMultiplier` / `dropRateMultiplier` every other source uses, then
 * through the two knobs that exist because a field kills all day long and a
 * 秘境 run does not.
 *
 * Nothing here writes anything. A share is banked into a per-character delta
 * and only reaches storage at the next flush (ARCHITECTURE §8).
 */

/** One cultivator's cut of one kill, addressed by slot rather than by id. */
export interface ZoneRewardShare {
  /** Slot in `ZoneSim.entities`; the caller maps it back to a character. */
  i: number;
  exp: number;
  stones: number;
  items: { itemId: string; qty: number }[];
  /** 妖兽 id to bump 击杀 quest objectives with, or null when it does not count. */
  questMonsterId: string | null;
  kills: number;
  bossKills: number;
}

/**
 * Whether the cultivator in slot `i` is present and logged in.
 * `null` means the slot holds no cultivator at all, so it is not paid.
 */
export type ZonePayeeLookup = (i: number) => boolean | null;

/**
 * Splits one kill's spoils.
 *
 * A rank-and-file 妖兽 pays its killer alone, at `zoneRewardScale` — the field
 * hands out kills far faster than 探索 does, so its per-kill value is a
 * fraction of the content number, drops included.
 *
 * A BOSS pays the top damage contributors (`ZONE_BOSS_LOOT_SHARE_TOP` of them)
 * and is *not* discounted: it appears every `bossIntervalMinutes` and is meant
 * to be worth crossing the map for. 修为 and 灵石 are divided by damage share,
 * so the whole BOSS is worth one BOSS however many people swung at it, while
 * the drop table is rolled once per contributor — a raid that brings one down
 * together should see loot, not one lucky killer.
 *
 * An offline player banks `zoneOfflineYield` of the 修为 and 灵石 either way.
 * Drops are left alone: a rate already multiplied by `zoneRewardScale` is thin
 * enough that halving it again would read as "offline gets nothing".
 */
export function zoneKillRewards(
  kill: ZoneKill,
  settings: WorldSettings,
  rng: Rng,
  payee: ZonePayeeLookup,
): ZoneRewardShare[] {
  const monster = kill.monsterId === undefined ? undefined : MONSTER_BY_ID.get(kill.monsterId);
  if (!monster) return [];
  const scaled = scaleReward(monster.expReward, monster.stoneReward, settings);

  if (!kill.isBoss) {
    const online = payee(kill.killerI);
    if (online === null) return [];
    const rate = settings.zoneRewardScale * (online ? 1 : settings.zoneOfflineYield);
    return [
      {
        i: kill.killerI,
        exp: Math.round(scaled.exp * rate),
        stones: Math.round(scaled.spiritStones * rate),
        items: rollLoot(monster.loot, rng, {
          dropRateMultiplier: settings.dropRateMultiplier * settings.zoneRewardScale,
        }),
        questMonsterId: monster.id,
        kills: 1,
        bossKills: 0,
      },
    ];
  }

  const shares: ZoneRewardShare[] = [];
  for (const [i, share] of kill.damageShares) {
    const online = payee(i);
    if (online === null) continue;
    const rate = share * (online ? 1 : settings.zoneOfflineYield);
    shares.push({
      i,
      exp: Math.round(scaled.exp * rate),
      stones: Math.round(scaled.spiritStones * rate),
      items: rollLoot(monster.loot, rng, settings),
      // 击杀 objectives all name a `monster-*` id; a BOSS is its own event.
      questMonsterId: null,
      kills: 0,
      bossKills: 1,
    });
  }
  return shares;
}
