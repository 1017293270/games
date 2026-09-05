import { randomUUID } from 'node:crypto';
import {
  botAvatarPool,
  clamp,
  combineSeeds,
  createRng,
  dayKey,
  generateBotNames,
  getStage,
  MAX_STAGE_INDEX,
  rollBotArchetype,
  rollSpiritRoot,
  SKILL_SLOT_COUNT,
  starterSkillIds,
  STARTER_TECHNIQUE_ID,
  type BotArchetype,
  type CharacterState,
  type Rng,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { resolveEquipment, withFreshPower } from '../../game/character.js';
import { botLoadout } from './gear.js';
import { takenNames } from './repo.js';

/**
 * 机器人修仙者 generation.
 *
 * A bot is an ordinary `CharacterState` — same schema, same formulas, same
 * ranking board. Only `isBot`, `botArchetypeId` and `botParams` differ, which is
 * what makes a bot's 战力 mean exactly what a player's does.
 *
 * Archetypes are drawn from the *database* table, not the shared constant, so
 * an operator retuning 天骄 in the admin panel changes who gets generated next.
 */

/** Synthetic owner id every bot shares; `characters.user_id` is NOT NULL. */
export const BOT_OWNER_ID = 'bot';

export interface GenerateOptions {
  count: number;
  /** Force one archetype instead of drawing by population weight. */
  archetypeId?: string;
  minStageIndex?: number;
  maxStageIndex?: number;
  /** Fixes the name/root/avatar/stage rolls so a cohort can be reproduced. */
  seed?: number;
}

/**
 * Draws a starting stage skewed towards the low end.
 *
 * A uniform draw would produce a suspiciously flat ladder; the cube-ish curve
 * gives the pyramid a real server has, where 练气 is crowded and 元婴 is not.
 */
function rollStageIndex(rng: Rng, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  const skewed = rng.next() ** 1.8;
  return min + Math.min(span, Math.floor(skewed * (span + 1)));
}

/** Picks an archetype by population weight from the live table. */
function pickArchetype(rng: Rng, archetypes: readonly BotArchetype[]): BotArchetype {
  if (archetypes.length === 0) return rollBotArchetype(rng);
  return rng.weighted(
    archetypes,
    archetypes.map((a) => a.weight),
  );
}

/** Builds `count` bots and writes them. Returns what was created. */
export function generateBots(
  ctx: AppContext,
  options: GenerateOptions,
  now: number,
): CharacterState[] {
  const count = Math.max(0, Math.floor(options.count));
  if (count === 0) return [];

  const archetypes = ctx.archetypes.all();
  const forced = options.archetypeId
    ? (archetypes.find((a) => a.id === options.archetypeId) ?? null)
    : null;
  if (options.archetypeId && !forced) return [];

  const min = clamp(options.minStageIndex ?? 0, 0, MAX_STAGE_INDEX);
  const max = clamp(options.maxStageIndex ?? 11, min, MAX_STAGE_INDEX);
  const seed = options.seed ?? combineSeeds('bots', now, ctx.characters.countBots());

  const used = takenNames(ctx);
  // Over-draw so collisions with existing 道号 still leave enough names.
  const pool = generateBotNames(seed, count * 3 + 16).filter((n) => !used.has(n));

  const created: CharacterState[] = [];
  let poolIndex = 0;
  let salt = 0;

  for (let i = 0; i < count; i += 1) {
    const rng = createRng(combineSeeds(seed, i));

    let name = pool[poolIndex];
    poolIndex += 1;
    while (name === undefined || used.has(name)) {
      salt += 1;
      const extra = generateBotNames(combineSeeds(seed, 'extra', salt), 8).filter(
        (n) => !used.has(n),
      );
      name = extra[0];
      if (name === undefined && salt > 64) break;
    }
    if (name === undefined) break;
    used.add(name);

    const archetype = forced ?? pickArchetype(rng, archetypes);
    const gender = rng.chance(0.5) ? 'male' : 'female';
    const avatarPool = botAvatarPool(archetype, gender);
    const avatarArt = rng.pick(avatarPool) as CharacterState['avatarArt'];
    const spiritRoot = rollSpiritRoot(rng);
    const stageIndex = rollStageIndex(rng, min, max);

    const starters = starterSkillIds(spiritRoot.element);
    const slots: (string | null)[] = new Array<string | null>(SKILL_SLOT_COUNT).fill(null);
    for (let s = 0; s < Math.min(SKILL_SLOT_COUNT, starters.length); s += 1) {
      slots[s] = starters[s] ?? null;
    }

    const id = randomUUID();
    const state: CharacterState = {
      id,
      userId: BOT_OWNER_ID,
      name,
      gender,
      avatarArt,

      isBot: true,
      botArchetypeId: archetype.id,
      botParams: { ...archetype.params },

      spiritRoot,
      stageIndex,
      // Land mid-stage so the cohort is not all sitting on a round number.
      exp: Math.round(getStage(stageIndex).expRequired * rng.range(0, 0.85)),
      spiritStones: rng.int(100, 2000) * (1 + Math.floor(stageIndex / 4)),

      skillSlots: slots,
      learnedSkillIds: starters,
      techniqueId: STARTER_TECHNIQUE_ID,
      learnedTechniqueIds: [STARTER_TECHNIQUE_ID],
      // Gear is derived from `(id, 大境界)`, not owned as inventory rows; the
      // slots are written here so a raw row reads the same as 公开档案 does.
      equipment: botLoadout(id, stageIndex, archetype.params),

      buffs: [],
      hpPercent: 1,
      protectedUntil: 0,

      chapter: 1,
      quests: [],
      flags: {},

      lastSettledAt: now,
      lastSeenAt: now,
      createdAt: now,

      dailyCounters: { date: dayKey(now), dungeon: 0, arena: 0, gatherAt: {} },

      arenaRating: 1000 + rng.int(-120, 220),
      arenaWins: 0,
      arenaLosses: 0,
      powerScore: 0,
    };

    const withPower = withFreshPower(state, resolveEquipment(state, ctx.inventory));
    ctx.characters.insert(withPower);
    created.push(withPower);
  }

  return created;
}
