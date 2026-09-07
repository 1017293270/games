/**
 * 战斗大地图, simulated in the browser for `VITE_MOCK=1`.
 *
 * This is not a fake field: it runs `packages/shared/src/zone/sim.ts`, the very
 * same pure core the server will drive, at the same 250ms tick and the same 4 Hz
 * frame rate. The player and a dozen of the mock world's bots stand on the real
 * layout and fight the real 妖兽 with their real stats, so the renderer, the HUD
 * and the store are exercised against genuine frames with no server running.
 *
 * What is faked is only the economy around it: 掉落 are not rolled, and nothing
 * is credited to the character. `zone:loot` reports each 妖兽's own 修为/灵石
 * reward, which is what the numbers will look like, without touching the world.
 */

import {
  addCultivator,
  mainTreasureCombat,
  getProgression,
  buildFrame,
  canEnterZone,
  createZoneSim,
  DEFAULT_WORLD_SETTINGS,
  ITEM_BY_ID,
  MONSTER_BY_ID,
  pushZoneEvent,
  removeEntity,
  stageName,
  stepZone,
  zoneFor,
  ZONE_BY_ID,
  type CharacterState,
  type ServerToClientEvents,
  type ZoneLoot,
  type ZoneRules,
  type ZoneSim,
} from '@xianxia/shared';
import { EXPLORE_MAP_BY_ID, getWorld, isOnline, statsFor, type MockWorld } from './world';

type Bridge = <K extends keyof ServerToClientEvents>(
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
) => void;

/** Cultivators the mock puts on the field beside the player. */
const MOCK_BOTS = 12;
/** Fixed, so two runs of the same screenshot show the same opening. */
const MOCK_SEED = 0x5f3a91;
/** How often the driver banks and reports what the player earned. */
const LOOT_INTERVAL_MS = 5_000;
/** Kills between two stand-in drops. */
const DROP_EVERY = 5;

/**
 * A 秘境 BOSS every three minutes rather than the world default of thirty:
 * long enough to be a countdown, short enough to actually see one arrive.
 */
const MOCK_RULES: ZoneRules = {
  tickMs: DEFAULT_WORLD_SETTINGS.zoneTickMs,
  mapPvp: DEFAULT_WORLD_SETTINGS.mapPvp,
  mapPvpStoneLoss: DEFAULT_WORLD_SETTINGS.mapPvpStoneLoss,
  mapDeathRespawnSec: DEFAULT_WORLD_SETTINGS.mapDeathRespawnSec,
  monsterDensity: DEFAULT_WORLD_SETTINGS.monsterDensity,
  respawnMultiplier: DEFAULT_WORLD_SETTINGS.respawnMultiplier,
  bossIntervalMinutes: 3,
};

const FRAME_MS = Math.round(1000 / DEFAULT_WORLD_SETTINGS.zoneSnapshotHz);

export interface MockZoneDriver {
  /** `null` restores whatever field the character is standing on. */
  enter: (zoneId: string | null) => void;
  leave: () => void;
  retreat: () => void;
  stop: () => void;
}

/** The character behind the first issued token — the mock has exactly one player. */
function currentCharacter(world: MockWorld): CharacterState | null {
  for (const userId of world.tokens.values()) {
    const user = world.usersById.get(userId);
    const char = user?.characterId ? world.characters.get(user.characterId) : null;
    if (char) return char;
  }
  return null;
}

/** Bots the zone's own difficulty band would have sent here, in world order. */
function fieldBots(world: MockWorld, zoneId: string): CharacterState[] {
  const bots = [...world.characters.values()].filter((c) => c.isBot);
  const local = bots.filter((bot) => zoneFor(bot.stageIndex).id === zoneId);
  const pool = local.length >= MOCK_BOTS ? local : [...local, ...bots];
  return pool.slice(0, MOCK_BOTS);
}

function emptyTally(since: number): ZoneLoot {
  return { exp: 0, spiritStones: 0, items: [], kills: 0, bossKills: 0, since };
}

export function createZoneDriver(bridge: Bridge): MockZoneDriver {
  const world = getWorld();
  let sim: ZoneSim | null = null;
  let selfSlot = -1;
  let enteredAt = 0;
  let watching = false;
  let tally = emptyTally(Date.now());
  let stepTimer: ReturnType<typeof setInterval> | null = null;
  let lootTimer: ReturnType<typeof setInterval> | null = null;

  const flushLoot = (): void => {
    if (!sim) return;
    const now = Date.now();
    if (tally.kills > 0 || tally.exp > 0 || tally.items.length > 0) bridge('zone:loot', tally);
    tally = emptyTally(now);
  };

  const teardown = (): void => {
    if (stepTimer !== null) clearInterval(stepTimer);
    if (lootTimer !== null) clearInterval(lootTimer);
    stepTimer = null;
    lootTimer = null;
    sim = null;
    selfSlot = -1;
    watching = false;
  };

  const step = (): void => {
    if (!sim) return;
    const out = stepZone(sim, Date.now());

    // 妖兽 kills, deaths and the BOSS's comings and goings are pushed by the
    // simulation itself. Spoils from a PvP kill are an economy decision, so the
    // owner of the loop mints those — as the server will.
    for (const kill of out.pvpKills) {
      const victim = sim.entities[kill.victimI];
      const stones = victim
        ? Math.round(
            (world.characters.get(victim.id)?.spiritStones ?? 0) * sim.rules.mapPvpStoneLoss,
          )
        : 0;
      pushZoneEvent(sim, { t: 'pvp_kill', killer: kill.killerI, victim: kill.victimI, stones });
    }

    for (const kill of out.kills) {
      if (kill.killerI !== selfSlot) continue;
      const monster = kill.monsterId ? MONSTER_BY_ID.get(kill.monsterId) : undefined;
      const self = sim.entities[selfSlot];
      const char = self && world.characters.get(self.id);
      if (char) {
        const progression = getProgression(char.progression, Date.now());
        progression.daily.kills++;
        if (kill.isBoss && !progression.achievements.includes('first_boss'))
          progression.achievements.push('first_boss');
        world.characters.set(char.id, { ...char, progression });
      }
      const kills = tally.kills + 1;
      // Stand-in for the drop table: every fifth 妖兽, and every BOSS, parts
      // with the first thing on its own loot list.
      const drops = monster && (kill.isBoss || kills % DROP_EVERY === 0);
      tally = {
        ...tally,
        kills,
        bossKills: tally.bossKills + (kill.isBoss ? 1 : 0),
        exp: tally.exp + (monster?.expReward ?? 0),
        spiritStones: tally.spiritStones + (monster?.stoneReward ?? 0),
        items: drops ? withDrop(tally.items, monster.loot[0]?.itemId) : tally.items,
      };
    }

    for (const death of out.deaths) {
      if (death.victimI !== selfSlot) continue;
      const killer = death.killerI >= 0 ? sim.entities[death.killerI] : null;
      bridge('zone:death', {
        killerName: killer?.name ?? '不知何物',
        stonesLost: 0,
        respawnAt: death.respawnAt,
      });
    }

    // Always ship the frame `buildFrame` produced, empty or not: it has already
    // consumed the sim's seq, and a client that never sees it reads a gap.
    const frame = buildFrame(sim, false);
    if (watching) bridge('zone:frame', frame);
  };

  return {
    enter(zoneId) {
      const char = currentCharacter(world);
      if (!char) return;
      const id = zoneId ?? sim?.zone.id ?? null;
      if (id === null) return; // Nothing to restore; the player is not on a field.

      const zone = ZONE_BY_ID.get(id);
      if (!zone) {
        bridge('zone:error', { code: 'NOT_FOUND', message: '没有这个去处' });
        return;
      }
      if (!canEnterZone(id, char.stageIndex)) {
        const need = EXPLORE_MAP_BY_ID.get(id)?.unlockStage ?? 0;
        bridge('zone:error', {
          code: 'MAP_LOCKED',
          message: `需 ${stageName(need)} 方可前往此地`,
        });
        return;
      }

      if (!sim || sim.zone.id !== id) {
        teardown();
        const now = Date.now();
        const next = createZoneSim(zone, MOCK_RULES, MOCK_SEED, now);
        const { stats } = statsFor(char, world.inventories.get(char.id) ?? []);
        selfSlot = addCultivator(next, {
          id: char.id,
          kind: 'player',
          name: char.name,
          art: char.avatarArt,
          stageIndex: char.stageIndex,
          stats,
          skills: char.skillSlots,
          mainTreasure: mainTreasureCombat(char.progression),
          hpShare: char.hpPercent,
          online: true,
          aggression: 0.1,
        }).i;

        for (const bot of fieldBots(world, id)) {
          addCultivator(next, {
            id: bot.id,
            kind: 'bot',
            name: bot.name,
            art: bot.avatarArt,
            stageIndex: bot.stageIndex,
            stats: statsFor(bot, []).stats,
            skills: bot.skillSlots,
            mainTreasure: mainTreasureCombat(bot.progression),
            hpShare: 1,
            online: isOnline(bot),
            aggression: bot.botParams?.aggression ?? 0.2,
          });
        }

        sim = next;
        enteredAt = now;
        tally = emptyTally(now);
        stepTimer = setInterval(step, FRAME_MS);
        lootTimer = setInterval(flushLoot, LOOT_INTERVAL_MS);
      }

      watching = true;
      // Idempotent by contract: re-entering the field you are already on just
      // restates it, which is exactly what a resync after a dropped frame needs.
      bridge('zone:joined', {
        zoneId: id,
        self: selfSlot,
        enteredAt,
        frame: buildFrame(sim, true),
      });
    },

    /** Stop watching; the field keeps fighting and the tally keeps growing. */
    leave() {
      watching = false;
    },

    retreat() {
      if (!sim) return;
      flushLoot();
      if (selfSlot >= 0) removeEntity(sim, selfSlot);
      teardown();
      bridge('zone:left', { reason: 'retreat' });
    },

    stop() {
      teardown();
    },
  };
}

/** Adds one of the 妖兽's own drops to the tally, without rolling for it. */
function withDrop(items: ZoneLoot['items'], itemId: string | undefined): ZoneLoot['items'] {
  const item = itemId ? ITEM_BY_ID.get(itemId) : undefined;
  if (!item) return items;
  const held = items.find((row) => row.itemId === item.id);
  if (held)
    return items.map((row) => (row.itemId === item.id ? { ...row, qty: row.qty + 1 } : row));
  return [...items, { itemId: item.id, qty: 1, name: item.name }];
}
