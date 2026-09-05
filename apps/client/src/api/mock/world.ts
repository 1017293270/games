/**
 * In-memory stand-in for `apps/server`, active only when `VITE_MOCK=1`.
 *
 * Everything here runs the *real* shared formulas — `settleCultivation`,
 * `computeStats`, `attemptBreakthrough`, `simulateBattle` — so what the UI
 * renders in mock mode is shaped exactly like what the server will send. The
 * only things faked are storage, auth and the passage of bot time.
 */

import {
  activePillBonus,
  BOT_ARCHETYPES,
  CharacterStateSchema,
  combineSeeds,
  computeStats,
  createRng,
  cultivationRatePerSec,
  dayKey,
  DEFAULT_WORLD_SETTINGS,
  ENCOUNTER_BY_ID,
  EXPLORE_MAP_BY_ID,
  EXPLORE_MAPS,
  generateBotNames,
  getStage,
  getTechnique,
  isPerfection,
  ITEM_BY_ID,
  MAX_STAGE_INDEX,
  MONSTER_BY_ID,
  powerScore,
  rollSpiritRoot,
  secondsToNextStage,
  settleCultivation,
  simulateBattle,
  stageName,
  STARTER_TECHNIQUE_ID,
  starterSkillIds,
  TECHNIQUE_BY_ID,
  tribulationAvatar,
  type ArtId,
  type AvatarArtId,
  type BattleResult,
  type CharacterState,
  type CharacterView,
  type ChatMessage,
  type Combatant,
  type EquipmentItem,
  type Gender,
  type InventoryItem,
  type LootEntry,
  type Monster,
  type PublicProfile,
  type Rng,
  type ServerToClientEvents,
  type SpiritRoot,
  type User,
  type WorldSettings,
} from '@xianxia/shared';

export interface MockUser {
  id: string;
  username: string;
  password: string;
  isAdmin: boolean;
  banned: boolean;
  createdAt: number;
  characterId: string | null;
}

export interface PendingEncounter {
  token: string;
  encounterId: string;
  mapId: string;
}

type Emitter = <K extends keyof ServerToClientEvents>(
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
) => void;

export interface MockWorld {
  settings: WorldSettings;
  usersByName: Map<string, MockUser>;
  usersById: Map<string, MockUser>;
  tokens: Map<string, string>;
  characters: Map<string, CharacterState>;
  inventories: Map<string, InventoryItem[]>;
  chat: ChatMessage[];
  encounters: Map<string, PendingEncounter>;
  listeners: Set<Emitter>;
  seq: number;
}

/** Demo credentials surfaced on the login screen while running on the mock. */
export const DEMO_USERNAME = 'qingyun';
export const DEMO_PASSWORD = 'qingyun123';

const BOT_COUNT = 200;
const BOT_SEED = 0x9e3779b9;

function nextId(world: MockWorld, prefix: string): string {
  world.seq += 1;
  return `${prefix}-${world.seq.toString(36)}`;
}

function emptyDaily(now: number) {
  return { date: dayKey(now), dungeon: 0, arena: 0, gatherAt: {} };
}

export function makeCharacter(input: {
  id: string;
  userId: string;
  name: string;
  gender: Gender;
  avatarArt: AvatarArtId;
  spiritRoot: SpiritRoot;
  stageIndex: number;
  exp?: number;
  now: number;
  isBot?: boolean;
  botArchetypeId?: string | null;
  botParams?: CharacterState['botParams'];
  techniqueId?: string | null;
  spiritStones?: number;
  arenaRating?: number;
}): CharacterState {
  const skills = starterSkillIds(input.spiritRoot.element);
  const char = CharacterStateSchema.parse({
    id: input.id,
    userId: input.userId,
    name: input.name,
    gender: input.gender,
    avatarArt: input.avatarArt,
    isBot: input.isBot ?? false,
    botArchetypeId: input.botArchetypeId ?? null,
    botParams: input.botParams ?? null,
    spiritRoot: input.spiritRoot,
    stageIndex: input.stageIndex,
    exp: input.exp ?? 0,
    spiritStones: input.spiritStones ?? 0,
    skillSlots: [skills[0] ?? null, skills[1] ?? null, skills[2] ?? null, skills[3] ?? null],
    learnedSkillIds: skills,
    techniqueId: input.techniqueId === undefined ? STARTER_TECHNIQUE_ID : input.techniqueId,
    learnedTechniqueIds: input.techniqueId ? [input.techniqueId] : [STARTER_TECHNIQUE_ID],
    equipment: {},
    lastSettledAt: input.now,
    lastSeenAt: input.now,
    createdAt: input.now,
    dailyCounters: emptyDaily(input.now),
    arenaRating: input.arenaRating ?? 1000,
  });
  return { ...char, powerScore: powerScore(computeStats({ stageIndex: char.stageIndex })) };
}

function makeBot(index: number, name: string, rng: Rng, now: number): CharacterState {
  const archetype = rng.weighted(
    BOT_ARCHETYPES,
    BOT_ARCHETYPES.map((a) => a.weight),
  );
  const gender: Gender = rng.chance(0.5) ? 'male' : 'female';
  const pool = archetype.avatarPool.filter((a) =>
    gender === 'male' ? a.includes('/m') : a.includes('/f'),
  );
  const avatarArt = (pool.length ? rng.pick(pool) : rng.pick(archetype.avatarPool)) as AvatarArtId;

  // Talent spreads the population: 天骄 cluster high, 散修 stay low. The curve
  // is squared so the top of the ladder stays thin.
  const roll = rng.next() ** 1.8;
  const ceiling = 6 + archetype.params.talent * 9;
  const stageIndex = Math.min(MAX_STAGE_INDEX - 4, Math.max(0, Math.round(roll * ceiling)));

  const technique = [...TECHNIQUE_BY_ID.values()]
    .filter((t) => t.requiredStage <= stageIndex)
    .sort((a, b) => b.requiredStage - a.requiredStage)[0];

  const bot = makeCharacter({
    id: `bot-${index.toString(36)}`,
    userId: 'bot',
    name,
    gender,
    avatarArt,
    spiritRoot: rollSpiritRoot(rng),
    stageIndex,
    exp: getStage(stageIndex).expRequired * rng.next() * (isPerfection(stageIndex) ? 1 : 0.9),
    now: now - rng.int(0, 3600) * 1000,
    isBot: true,
    botArchetypeId: archetype.id,
    botParams: archetype.params,
    techniqueId: technique?.id ?? STARTER_TECHNIQUE_ID,
    spiritStones: rng.int(0, 40_000),
    arenaRating: 700 + Math.round(rng.next() * 900 + stageIndex * 12),
  });
  return {
    ...bot,
    powerScore: powerScore(
      computeStats({ stageIndex, technique: technique ?? getTechnique(STARTER_TECHNIQUE_ID) }),
    ),
    lastSeenAt: now - rng.int(0, 7200) * 1000,
  };
}

let world: MockWorld | null = null;

export function getWorld(): MockWorld {
  if (world) return world;
  const now = Date.now();
  const w: MockWorld = {
    settings: { ...DEFAULT_WORLD_SETTINGS, inviteRequired: false, botCount: BOT_COUNT },
    usersByName: new Map(),
    usersById: new Map(),
    tokens: new Map(),
    characters: new Map(),
    inventories: new Map(),
    chat: [],
    encounters: new Map(),
    listeners: new Set(),
    seq: 0,
  };
  world = w;

  const rng = createRng(BOT_SEED);
  const names = generateBotNames(BOT_SEED, BOT_COUNT);
  names.forEach((name, i) => {
    const bot = makeBot(i, name, rng, now);
    w.characters.set(bot.id, bot);
    w.inventories.set(bot.id, []);
  });

  seedDemoAccount(w, now);
  seedChat(w, now);
  return w;
}

/** A pre-rolled account so the game can be entered without registering. */
function seedDemoAccount(w: MockWorld, now: number): void {
  const user: MockUser = {
    id: 'user-demo',
    username: DEMO_USERNAME,
    password: DEMO_PASSWORD,
    isAdmin: true,
    banned: false,
    createdAt: now - 86_400_000 * 9,
    characterId: 'char-demo',
  };
  w.usersByName.set(user.username, user);
  w.usersById.set(user.id, user);

  // 金丹·圆满 with a full bar: the breakthrough hook is one tap away, and the
  // four-hour gap makes the 闭关归来 summary meaningful on first load.
  const stageIndex = 11;
  const char = makeCharacter({
    id: 'char-demo',
    userId: user.id,
    name: '云中鹤',
    gender: 'male',
    avatarArt: 'avatar/m01',
    spiritRoot: { element: 'water', quality: 'rare' },
    stageIndex,
    exp: getStage(stageIndex).expRequired * 0.62,
    now: now - 4 * 3600 * 1000,
    techniqueId: 'tech-xuanbing',
    spiritStones: 48_600,
    arenaRating: 1284,
  });

  const inv: InventoryItem[] = [
    { uid: 'inv-d1', itemId: 'pill-breakthrough', qty: 3, equipped: false },
    { uid: 'inv-d2', itemId: 'pill-qi', qty: 6, equipped: false },
    { uid: 'inv-d3', itemId: 'pill-heal', qty: 2, equipped: false },
    { uid: 'inv-d4', itemId: 'pill-enlightenment', qty: 1, equipped: false },
    { uid: 'inv-d5', itemId: 'treasure-bell', qty: 1, equipped: true },
    { uid: 'inv-d6', itemId: 'robe-daoist', qty: 1, equipped: true },
    { uid: 'inv-d7', itemId: 'acc-jade-pendant', qty: 1, equipped: true },
    { uid: 'inv-d8', itemId: 'pet-crane', qty: 1, equipped: false },
    { uid: 'inv-d9', itemId: 'mat-spirit-herb', qty: 24, equipped: false },
    { uid: 'inv-d10', itemId: 'mat-beast-core', qty: 5, equipped: false },
    { uid: 'inv-d11', itemId: 'mat-cloud-silk', qty: 2, equipped: false },
    { uid: 'inv-d12', itemId: 'treasure-sword', qty: 1, equipped: false },
  ];
  const equipped: CharacterState = {
    ...char,
    equipment: { treasure: 'inv-d5', robe: 'inv-d6', accessory: 'inv-d7', pet: null },
    learnedTechniqueIds: [STARTER_TECHNIQUE_ID, 'tech-tuna', 'tech-xuanbing'],
  };
  w.characters.set(equipped.id, equipped);
  w.inventories.set(equipped.id, inv);
  w.characters.set(equipped.id, { ...equipped, powerScore: statsFor(equipped).power });
}

function seedChat(w: MockWorld, now: number): void {
  const bots = [...w.characters.values()].filter((c) => c.isBot).slice(0, 40);
  const lines = [
    '幽冥谷的雾今日格外重，同去的道友可有？',
    '收灵草二十株，价高者得。',
    '刚从青云秘境出来，虎王的爪子是真疼。',
    '有没有人组队下洛水秘境？缺一个奶。',
    '筑基三日不成，是我功法选错了么',
    '论道台见，别怂。',
    '玄铁精谁有？拿魂晶换。',
    '恭喜楼上，早日结丹。',
  ];
  lines.forEach((text, i) => {
    const sender = bots[(i * 5) % bots.length];
    if (!sender) return;
    w.chat.push({
      id: `chat-seed-${i}`,
      channel: 'world',
      senderId: sender.id,
      senderName: sender.name,
      senderStageName: stageName(sender.stageIndex),
      text,
      sentAt: now - (lines.length - i) * 47_000,
    });
  });
}

/** Test hook: drops all state so the next `getWorld()` reseeds. */
export function resetWorld(): void {
  world = null;
}

// ------------------------------------------------------------------ helpers

export function issueToken(w: MockWorld, userId: string): string {
  const token = `mock-${userId}-${(w.seq += 1).toString(36)}`;
  w.tokens.set(token, userId);
  return token;
}

export function toUser(user: MockUser): User {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    banned: user.banned,
    createdAt: user.createdAt,
    characterId: user.characterId,
  };
}

export function equipmentOf(char: CharacterState, inv: readonly InventoryItem[]): EquipmentItem[] {
  const byUid = new Map(inv.map((row) => [row.uid, row]));
  const out: EquipmentItem[] = [];
  for (const uid of Object.values(char.equipment)) {
    if (!uid) continue;
    const row = byUid.get(uid);
    if (!row) continue;
    const item = ITEM_BY_ID.get(row.itemId);
    if (item?.kind === 'equipment') out.push(item);
  }
  return out;
}

export function statsFor(char: CharacterState, inv: readonly InventoryItem[] = []) {
  const technique = getTechnique(char.techniqueId);
  const stats = computeStats({
    stageIndex: char.stageIndex,
    equipment: equipmentOf(char, inv),
    technique,
  });
  return { stats, technique, power: powerScore(stats) };
}

export function buildView(w: MockWorld, char: CharacterState): CharacterView {
  const inv = w.inventories.get(char.id) ?? [];
  const { stats, technique, power } = statsFor(char, inv);
  const now = Date.now();
  const stage = getStage(char.stageIndex);
  return {
    character: { ...char, powerScore: power },
    stats,
    stageName: stage.name,
    expRequired: stage.expRequired,
    ratePerSec: cultivationRatePerSec({
      stageIndex: char.stageIndex,
      spiritRootQuality: char.spiritRoot.quality,
      techniqueBonus: technique?.cultivationBonus ?? 0,
      pillBonus: activePillBonus(char.buffs, now),
      world: w.settings,
    }),
    secondsToNextStage: secondsToNextStage(char, w.settings, { technique, nowMs: now }),
    atPerfection: isPerfection(char.stageIndex) && char.exp >= stage.expRequired,
    inventory: inv,
  };
}

export function toProfile(w: MockWorld, char: CharacterState): PublicProfile {
  const inv = w.inventories.get(char.id) ?? [];
  const { stats, technique, power } = statsFor(char, inv);
  return {
    id: char.id,
    name: char.name,
    gender: char.gender,
    avatarArt: char.avatarArt,
    isBot: char.isBot,
    stageIndex: char.stageIndex,
    stageName: stageName(char.stageIndex),
    spiritRoot: char.spiritRoot,
    powerScore: power,
    stats,
    techniqueName: technique?.name ?? null,
    skillIds: char.skillSlots.filter((s): s is string => Boolean(s)),
    equipmentItemIds: equipmentOf(char, inv).map((e) => e.id),
    arenaRating: char.arenaRating,
    arenaWins: char.arenaWins,
    arenaLosses: char.arenaLosses,
    online: isOnline(char),
    lastSeenAt: char.lastSeenAt,
    protectedUntil: char.protectedUntil,
  };
}

export function isOnline(char: CharacterState): boolean {
  return Date.now() - char.lastSeenAt < 10 * 60_000;
}

/** Applies instant 修为, rolling small stages over and parking at 圆满. */
export function grantExp(char: CharacterState, amount: number): CharacterState {
  let stageIndex = char.stageIndex;
  let exp = char.exp + Math.max(0, amount);
  for (;;) {
    const required = getStage(stageIndex).expRequired;
    if (exp < required) break;
    if (isPerfection(stageIndex) || stageIndex >= MAX_STAGE_INDEX) {
      exp = required;
      break;
    }
    exp -= required;
    stageIndex += 1;
  }
  return { ...char, stageIndex, exp };
}

export function addItem(
  w: MockWorld,
  characterId: string,
  itemId: string,
  qty: number,
): void {
  const inv = w.inventories.get(characterId) ?? [];
  const item = ITEM_BY_ID.get(itemId);
  if (!item) return;
  if (item.stackable) {
    const row = inv.find((r) => r.itemId === itemId && !r.equipped);
    if (row) {
      w.inventories.set(
        characterId,
        inv.map((r) => (r.uid === row.uid ? { ...r, qty: r.qty + qty } : r)),
      );
      return;
    }
    w.inventories.set(characterId, [
      ...inv,
      { uid: nextId(w, 'inv'), itemId, qty, equipped: false },
    ]);
    return;
  }
  const rows: InventoryItem[] = [...inv];
  for (let i = 0; i < qty; i += 1) {
    rows.push({ uid: nextId(w, 'inv'), itemId, qty: 1, equipped: false });
  }
  w.inventories.set(characterId, rows);
}

export function takeItem(w: MockWorld, characterId: string, itemId: string, qty: number): boolean {
  const inv = w.inventories.get(characterId) ?? [];
  const row = inv.find((r) => r.itemId === itemId && !r.equipped && r.qty >= qty);
  if (!row) return false;
  const rest = row.qty - qty;
  w.inventories.set(
    characterId,
    rest > 0 ? inv.map((r) => (r.uid === row.uid ? { ...r, qty: rest } : r)) : inv.filter((r) => r.uid !== row.uid),
  );
  return true;
}

export function countItem(w: MockWorld, characterId: string, itemId: string): number {
  const inv = w.inventories.get(characterId) ?? [];
  return inv.filter((r) => r.itemId === itemId).reduce((total, r) => total + r.qty, 0);
}

export function rollLoot(
  loot: readonly LootEntry[],
  rng: Rng,
  dropMultiplier: number,
): { itemId: string; qty: number }[] {
  const out: { itemId: string; qty: number }[] = [];
  for (const entry of loot) {
    if (!rng.chance(Math.min(1, entry.chance * dropMultiplier))) continue;
    out.push({ itemId: entry.itemId, qty: rng.int(entry.min, entry.max) });
  }
  return out;
}

export function itemNames(items: readonly { itemId: string; qty: number }[]): string[] {
  return items.map((i) => {
    const name = ITEM_BY_ID.get(i.itemId)?.name ?? i.itemId;
    return i.qty > 1 ? `${name}×${i.qty}` : name;
  });
}

export function toCombatant(
  char: CharacterState,
  inv: readonly InventoryItem[],
  hpOverride?: number,
): Combatant {
  const { stats } = statsFor(char, inv);
  return {
    id: char.id,
    name: char.name,
    art: char.avatarArt as ArtId,
    stats,
    skills: char.skillSlots.filter((s): s is string => Boolean(s)),
    ...(hpOverride === undefined ? {} : { hp: hpOverride }),
  };
}

export function monsterCombatant(monster: Monster): Combatant {
  return {
    id: monster.id,
    name: monster.name,
    art: monster.art,
    stats: monster.stats,
    skills: monster.skills,
  };
}

export function fightMonster(
  w: MockWorld,
  char: CharacterState,
  monster: Monster,
  seed: number,
): BattleResult {
  const inv = w.inventories.get(char.id) ?? [];
  return simulateBattle({
    seed,
    teamA: [toCombatant(char, inv)],
    teamB: [monsterCombatant(monster)],
    maxRounds: w.settings.maxBattleRounds,
  });
}

export function tribulationBattle(w: MockWorld, char: CharacterState): BattleResult {
  const avatar = tribulationAvatar(char.stageIndex);
  return fightMonster(w, char, avatar, combineSeeds('tribulation', char.id, Date.now()));
}

export function settleInto(w: MockWorld, char: CharacterState) {
  const technique = getTechnique(char.techniqueId);
  return settleCultivation(char, Date.now(), w.settings, { technique });
}

/** Broadcasts to the mock socket. */
export function emit<K extends keyof ServerToClientEvents>(
  w: MockWorld,
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
): void {
  for (const listener of w.listeners) listener(event, ...args);
}

export { EXPLORE_MAPS, EXPLORE_MAP_BY_ID, ENCOUNTER_BY_ID, MONSTER_BY_ID, nextId };
