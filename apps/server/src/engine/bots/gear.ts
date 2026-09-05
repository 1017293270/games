import {
  clamp,
  combineSeeds,
  createRng,
  EQUIP_SLOTS,
  EQUIPMENT_ITEMS,
  ITEM_BY_ID,
  realmOf,
  type BotParams,
  type CharacterState,
  type EquipmentItem,
  type EquipmentSlots,
  type EquipSlot,
} from '@xianxia/shared';

/**
 * 机器人的装备.
 *
 * A bot owns no inventory rows — it is generated, not played — so its four
 * equip slots hold a synthetic `bot:<itemId>` uid instead of pointing at the
 * `inventory` table. `resolveEquipment` reads that prefix and looks the piece
 * up in the item table directly, which is why every module that already went
 * through `resolveEquipment` (论道, 围攻, 公开档案, 排行榜) sees bot gear
 * without knowing anything about bots.
 *
 * The loadout is a *pure function* of `(bot id, 大境界, BotParams)`:
 *
 *   - the same bot gets the same pieces on every server start (no reshuffling),
 *   - crossing a 大境界 re-rolls it, and the higher `requiredStage` tiers that
 *     just came into reach are what it re-rolls into,
 *   - and the stored slots are only a mirror of the derivation, so a bot whose
 *     stage was moved by hand cannot end up wearing something it never earned.
 *
 * Variance comes from three places, all folded into the two knobs below:
 * `talent` buys grade, `diligence` buys coverage, and a per-bot lifetime
 * 机缘 roll separates two cultivators of the same 原型.
 */

/** Marks a slot uid this module owns rather than an `inventory` row. */
export const BOT_UID_PREFIX = 'bot:';

/** The uid a bot's slot holds for `itemId`. */
export function botSlotUid(itemId: string): string {
  return `${BOT_UID_PREFIX}${itemId}`;
}

/** The item id inside a bot slot uid, or null when the uid is an inventory row. */
export function botSlotItemId(uid: string): string | null {
  return uid.startsWith(BOT_UID_PREFIX) ? uid.slice(BOT_UID_PREFIX.length) : null;
}

/** Order slots are spent in: the 法宝 is what a cultivator buys first. */
const SLOT_PRIORITY: readonly EquipSlot[] = ['treasure', 'robe', 'pet', 'accessory'];

/** Chance of carrying anything in a slot at full 家底, before the affluence scale. */
const SLOT_FILL: Record<EquipSlot, number> = {
  treasure: 0.95,
  robe: 0.8,
  pet: 0.55,
  accessory: 0.45,
};

/** Fill scale at 家底 0 and at 家底 1. */
const FILL_SCALE_MIN = 0.3;
const FILL_SCALE_MAX = 1;

/** Chance of reaching for the newest tier, at the low and high end of the blend. */
const TOP_TIER_CHANCE_MIN = 0.15;
const TOP_TIER_CHANCE_MAX = 0.85;

/** Newest-tier pieces one bot may carry; nobody is best-in-slot everywhere. */
const TOP_TIER_LIMIT = 1;

/** Chance of dropping one further tier once the newest one was missed. */
const EXTRA_STEP_DOWN_CHANCE = 0.2;

/**
 * Stages a piece stays out of reach after it becomes legal.
 *
 * Grade multipliers make a freshly unlocked 圣阶 法宝 worth more than half a
 * cultivator's 战力 at the exact stage it unlocks; the lag lets the realm
 * baseline grow into it first, which is what keeps the same-stage spread
 * inside a band instead of spiking at every 6/14/22 boundary. Entry-tier gear
 * (`requiredStage` 0) is exempt, so even a 练气·前期 散修 owns something.
 */
const GEAR_LAG_STAGES = 2;

function tiersOf(slot: EquipSlot): readonly EquipmentItem[] {
  return EQUIPMENT_ITEMS.filter((i) => i.slot === slot).sort(
    (a, b) => a.requiredStage - b.requiredStage,
  );
}

/** Every slot's pieces, cheapest first. Built once; the item table is static. */
const TIERS: Record<EquipSlot, readonly EquipmentItem[]> = {
  treasure: tiersOf('treasure'),
  robe: tiersOf('robe'),
  accessory: tiersOf('accessory'),
  pet: tiersOf('pet'),
};

/** Neutral parameters, for the rare bot row with a null `botParams`. */
const NEUTRAL: Pick<BotParams, 'talent' | 'diligence'> = { talent: 1, diligence: 0.5 };

/** 天赋 mapped onto [0, 1] across the 散修 0.8 – 天骄 2.5 range. */
function talentPart(params: Pick<BotParams, 'talent'>): number {
  return clamp((params.talent - 0.8) / 1.7, 0, 1);
}

/**
 * 机缘: one lifetime roll per bot, seeded by its id alone.
 *
 * Keeping it out of the per-realm seed is what makes a bot's standing stable —
 * a well-supplied 苦修 stays well-supplied after it breaks into the next realm,
 * even though the pieces themselves are re-rolled there.
 */
function fortuneOf(botId: string): number {
  return createRng(combineSeeds('bot-gear-fortune', botId)).next();
}

/** 家底 in [0, 1]: how fully a bot's slots are filled. */
function affluenceOf(botId: string, params: Pick<BotParams, 'talent' | 'diligence'>): number {
  return clamp(
    0.34 * talentPart(params) + 0.3 * clamp(params.diligence, 0, 1) + 0.36 * fortuneOf(botId),
    0,
    1,
  );
}

/** The pieces a bot of this stage may carry in a slot, cheapest first. */
function eligible(slot: EquipSlot, stageIndex: number): readonly EquipmentItem[] {
  return TIERS[slot].filter(
    (i) => stageIndex >= i.requiredStage + (i.requiredStage === 0 ? 0 : GEAR_LAG_STAGES),
  );
}

/** Empty slots, the shape `CharacterState.equipment` expects. */
function emptySlots(): EquipmentSlots {
  return { treasure: null, robe: null, accessory: null, pet: null };
}

/**
 * The four slot uids a bot carries at `stageIndex`.
 *
 * Deterministic: `(botId, 大境界)` seeds the draw, so repeated calls — a
 * restart, a backfill, two ticks in a row — return byte-identical uids.
 */
export function botLoadout(
  botId: string,
  stageIndex: number,
  params: BotParams | null,
): EquipmentSlots {
  const tuning = params ?? NEUTRAL;
  const rng = createRng(combineSeeds('bot-gear', botId, realmOf(stageIndex)));
  const affluence = affluenceOf(botId, tuning);
  const fillScale = FILL_SCALE_MIN + (FILL_SCALE_MAX - FILL_SCALE_MIN) * affluence;
  const topChance =
    TOP_TIER_CHANCE_MIN +
    (TOP_TIER_CHANCE_MAX - TOP_TIER_CHANCE_MIN) *
      clamp(0.6 * talentPart(tuning) + 0.4 * affluence, 0, 1);

  const slots = emptySlots();
  let topTiers = 0;

  for (const slot of SLOT_PRIORITY) {
    const candidates = eligible(slot, stageIndex);
    if (candidates.length === 0) continue;
    if (!rng.chance(SLOT_FILL[slot] * fillScale)) continue;

    let tier = candidates.length - 1;
    if (topTiers >= TOP_TIER_LIMIT || !rng.chance(topChance)) {
      tier -= 1;
    } else {
      topTiers += 1;
    }
    if (tier > 0 && rng.chance(EXTRA_STEP_DOWN_CHANCE)) tier -= 1;

    const piece = candidates[Math.max(0, tier)] as EquipmentItem;
    slots[slot] = botSlotUid(piece.id);
  }

  return slots;
}

/** Resolved pieces a bot is wearing. Reads no table; the loadout is derived. */
export function botEquipment(state: CharacterState): EquipmentItem[] {
  const slots = botLoadout(state.id, state.stageIndex, state.botParams);
  const pieces: EquipmentItem[] = [];
  for (const slot of EQUIP_SLOTS) {
    const uid = slots[slot];
    if (uid === null) continue;
    const itemId = botSlotItemId(uid);
    const item = itemId === null ? undefined : ITEM_BY_ID.get(itemId);
    if (item?.kind === 'equipment') pieces.push(item);
  }
  return pieces;
}

/**
 * The same state with the loadout its stage calls for written into the slots.
 *
 * Returns the argument untouched when the slots already match, so the tick can
 * call it on every bot and a backfill can run twice without dirtying a row.
 */
export function withBotGear(state: CharacterState): CharacterState {
  if (!state.isBot) return state;
  const slots = botLoadout(state.id, state.stageIndex, state.botParams);
  const same = EQUIP_SLOTS.every((slot) => state.equipment[slot] === slots[slot]);
  return same ? state : { ...state, equipment: slots };
}
