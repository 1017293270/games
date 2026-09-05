/**
 * Endpoint handlers for the mock world. Keyed by `METHOD path` so the table is
 * driven by the same `API` registry the real client calls.
 */

import {
  API,
  attemptBreakthrough,
  BREAKTHROUGH_PILL_ID,
  combineSeeds,
  createRng,
  DUNGEONS,
  dayKey,
  ENCOUNTER_BY_ID,
  EXPLORE_MAP_BY_ID,
  EXPLORE_MAPS,
  ITEM_BY_ID,
  MONSTER_BY_ID,
  requiresTribulation,
  rollSpiritRoot,
  SKILL_BY_ID,
  stageName,
  TECHNIQUE_BY_ID,
  type ApiErrorCode,
  type BattleResult,
  type CharacterState,
  type Endpoint,
  type RankingEntry,
  type AvatarArtId,
} from '@xianxia/shared';
import {
  addItem,
  buildView,
  countItem,
  emit,
  fightMonster,
  getWorld,
  grantExp,
  isOnline,
  itemNames,
  makeCharacter,
  nextId,
  rollLoot,
  settleInto,
  statsFor,
  takeItem,
  toProfile,
  toUser,
  tribulationBattle,
  type MockUser,
  type MockWorld,
} from './world';
import { registerMultiplayerHandlers } from './multiplayer';
import { registerContentHandlers } from './content';

export class MockFail extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface Ctx {
  w: MockWorld;
  user: MockUser | null;
  char: CharacterState | null;
  now: number;
}

type Handler = (
  ctx: Ctx,
  input: Record<string, unknown>,
  params: Record<string, string | number>,
) => unknown;

function requireUser(ctx: Ctx): MockUser {
  if (!ctx.user) throw new MockFail('UNAUTHORIZED', '登录状态已失效，请重新登录');
  return ctx.user;
}

function requireChar(ctx: Ctx): CharacterState {
  requireUser(ctx);
  if (!ctx.char) throw new MockFail('CHARACTER_NOT_FOUND', '尚未创建角色');
  return ctx.char;
}

/** Settles, writes back, and returns the fresh record. */
function refresh(ctx: Ctx, char: CharacterState): CharacterState {
  const result = settleInto(ctx.w, char);
  const inv = ctx.w.inventories.get(char.id) ?? [];
  const next = { ...result.character, powerScore: statsFor(result.character, inv).power };
  ctx.w.characters.set(next.id, next);
  return next;
}

function save(ctx: Ctx, char: CharacterState): CharacterState {
  const inv = ctx.w.inventories.get(char.id) ?? [];
  const next = { ...char, powerScore: statsFor(char, inv).power, lastSeenAt: ctx.now };
  ctx.w.characters.set(next.id, next);
  return next;
}

function rollDailyReset(char: CharacterState, now: number): CharacterState {
  const today = dayKey(now);
  if (char.dailyCounters.date === today) return char;
  return { ...char, dailyCounters: { date: today, dungeon: 0, arena: 0, gatherAt: {} } };
}

// -------------------------------------------------------------------- table

const handlers = new Map<string, Handler>();

function on<E extends Endpoint>(endpoint: E, handler: Handler): void {
  handlers.set(`${endpoint.method} ${endpoint.path}`, handler);
}

// ---- auth

on(API.auth.register, (ctx, input) => {
  const username = String(input.username ?? '');
  const password = String(input.password ?? '');
  if (ctx.w.usersByName.has(username)) {
    throw new MockFail('USERNAME_TAKEN', '这个道号已被人占了，换一个吧');
  }
  if (ctx.w.settings.inviteRequired && !input.inviteCode) {
    throw new MockFail('INVITE_REQUIRED', '本服需邀请码方可入门');
  }
  const user: MockUser = {
    id: nextId(ctx.w, 'user'),
    username,
    password,
    isAdmin: false,
    banned: false,
    createdAt: ctx.now,
    characterId: null,
  };
  ctx.w.usersByName.set(username, user);
  ctx.w.usersById.set(user.id, user);
  return session(ctx.w, user);
});

on(API.auth.login, (ctx, input) => {
  const user = ctx.w.usersByName.get(String(input.username ?? ''));
  if (!user || user.password !== String(input.password ?? '')) {
    throw new MockFail('INVALID_CREDENTIALS', '道号或密钥不对');
  }
  if (user.banned) throw new MockFail('BANNED', '此账号已被封禁');
  return session(ctx.w, user);
});

on(API.auth.logout, (ctx) => {
  for (const [token, userId] of ctx.w.tokens) {
    if (userId === ctx.user?.id) ctx.w.tokens.delete(token);
  }
  return {};
});

on(API.auth.me, (ctx) => ({ user: toUser(requireUser(ctx)), serverTime: ctx.now }));

function session(w: MockWorld, user: MockUser) {
  const token = `mock-${user.id}-${(w.seq += 1).toString(36)}`;
  w.tokens.set(token, user.id);
  return { token, expiresAt: Date.now() + 7 * 86_400_000, user: toUser(user) };
}

// ---- character

on(API.character.create, (ctx, input) => {
  const user = requireUser(ctx);
  if (user.characterId) throw new MockFail('CHARACTER_EXISTS', '你已有角色在世');
  const name = String(input.name ?? '');
  for (const c of ctx.w.characters.values()) {
    if (c.name === name) throw new MockFail('NAME_TAKEN', '此道号已有人用，另取一个');
  }
  const rng = createRng(combineSeeds(name, ctx.now));
  const char = makeCharacter({
    id: nextId(ctx.w, 'char'),
    userId: user.id,
    name,
    gender: input.gender === 'female' ? 'female' : 'male',
    avatarArt: input.avatarArt as AvatarArtId,
    spiritRoot: rollSpiritRoot(rng),
    stageIndex: 0,
    now: ctx.now,
    spiritStones: 200,
  });
  user.characterId = char.id;
  ctx.w.characters.set(char.id, char);
  ctx.w.inventories.set(char.id, [
    { uid: nextId(ctx.w, 'inv'), itemId: 'pill-qi', qty: 3, equipped: false },
    { uid: nextId(ctx.w, 'inv'), itemId: 'pill-breakthrough', qty: 1, equipped: false },
    { uid: nextId(ctx.w, 'inv'), itemId: 'robe-linen', qty: 1, equipped: false },
    { uid: nextId(ctx.w, 'inv'), itemId: 'mat-spirit-herb', qty: 2, equipped: false },
  ]);
  return buildView(ctx.w, char);
});

on(API.character.get, (ctx) => buildView(ctx.w, refresh(ctx, requireChar(ctx))));

on(API.character.settle, (ctx) => {
  const char = requireChar(ctx);
  const result = settleInto(ctx.w, char);
  const stagesPassed: string[] = [];
  for (let i = 1; i <= result.stageUps; i += 1) {
    stagesPassed.push(stageName(result.fromStageIndex + i));
  }
  const next = save(ctx, rollDailyReset(result.character, ctx.now));
  return {
    view: buildView(ctx.w, next),
    gainedExp: result.gainedExp,
    elapsedSec: result.elapsedSec,
    creditedSec: result.creditedSec,
    forfeitedSec: result.forfeitedSec,
    stageUps: result.stageUps,
    stagesPassed,
  };
});

on(API.character.breakthrough, (ctx, input) => {
  let char = refresh(ctx, requireChar(ctx));
  const pills = Math.max(0, Math.min(4, Number(input.pills ?? 0)));
  if (pills > countItem(ctx.w, char.id, BREAKTHROUGH_PILL_ID)) {
    throw new MockFail('INSUFFICIENT_ITEMS', '破境丹不够');
  }

  const needsTribulation = requiresTribulation(char.stageIndex);
  let tribulation: BattleResult | null = null;
  if (needsTribulation) {
    tribulation = tribulationBattle(ctx.w, char);
    if (tribulation.winner !== 'A') {
      char = save(ctx, { ...char, hpPercent: 0.2 });
      return {
        success: false,
        chance: 0,
        pillsUsed: 0,
        fromStageIndex: char.stageIndex,
        toStageIndex: char.stageIndex,
        fromStageName: stageName(char.stageIndex),
        toStageName: stageName(char.stageIndex),
        expLost: 0,
        tribulation,
        view: buildView(ctx.w, char),
      };
    }
  }

  const rng = createRng(combineSeeds('breakthrough', char.id, ctx.now));
  const result = attemptBreakthrough(char, rng, {
    pills,
    world: ctx.w.settings,
    tribulationWon: tribulation?.winner === 'A',
  });
  if (result.blocked === 'not_at_perfection') {
    throw new MockFail('NOT_AT_PERFECTION', '尚未到圆满，不必强求');
  }
  if (result.blocked === 'exp_not_full') {
    throw new MockFail('EXP_NOT_FULL', '修为未满，再等等');
  }
  if (result.blocked === 'max_stage') throw new MockFail('MAX_STAGE', '已至大道尽头');

  for (let i = 0; i < result.pillsUsed; i += 1) takeItem(ctx.w, char.id, BREAKTHROUGH_PILL_ID, 1);
  const saved = save(ctx, result.character);

  if (result.success) {
    emit(ctx.w, 'system:notice', {
      kind: 'breakthrough',
      text: `${saved.name} 突破至 ${stageName(result.toStageIndex)}`,
      characterId: saved.id,
      at: ctx.now,
    });
  }

  return {
    success: result.success,
    chance: result.chance,
    pillsUsed: result.pillsUsed,
    fromStageIndex: result.fromStageIndex,
    toStageIndex: result.toStageIndex,
    fromStageName: stageName(result.fromStageIndex),
    toStageName: stageName(result.toStageIndex),
    expLost: result.expLost,
    tribulation,
    view: buildView(ctx.w, saved),
  };
});

on(API.character.equipSkills, (ctx, input) => {
  const char = requireChar(ctx);
  const slots = (input.slots as (string | null)[]) ?? [];
  for (const id of slots) {
    if (id && !char.learnedSkillIds.includes(id)) {
      throw new MockFail('SKILL_NOT_LEARNED', '尚未习得此神通');
    }
  }
  return buildView(ctx.w, save(ctx, { ...char, skillSlots: slots }));
});

on(API.character.learnSkill, (ctx, input) => {
  const char = requireChar(ctx);
  const skill = SKILL_BY_ID.get(String(input.skillId ?? ''));
  if (!skill) throw new MockFail('NOT_FOUND', '没有这门神通');
  if (char.learnedSkillIds.includes(skill.id)) return buildView(ctx.w, char);
  if (char.stageIndex < skill.unlockStage) {
    throw new MockFail('STAGE_TOO_LOW', `需 ${stageName(skill.unlockStage)} 方可修习`);
  }
  if (char.spiritStones < skill.learnCost) {
    throw new MockFail('INSUFFICIENT_STONES', '灵石不足');
  }
  return buildView(
    ctx.w,
    save(ctx, {
      ...char,
      spiritStones: char.spiritStones - skill.learnCost,
      learnedSkillIds: [...char.learnedSkillIds, skill.id],
    }),
  );
});

on(API.character.setTechnique, (ctx, input) => {
  const char = requireChar(ctx);
  const id = String(input.techniqueId ?? '');
  if (!char.learnedTechniqueIds.includes(id)) {
    throw new MockFail('TECHNIQUE_NOT_LEARNED', '尚未习得此功法');
  }
  return buildView(ctx.w, save(ctx, { ...char, techniqueId: id }));
});

on(API.character.learnTechnique, (ctx, input) => {
  const char = requireChar(ctx);
  const tech = TECHNIQUE_BY_ID.get(String(input.techniqueId ?? ''));
  if (!tech) throw new MockFail('NOT_FOUND', '没有这部功法');
  if (char.stageIndex < tech.requiredStage) {
    throw new MockFail('STAGE_TOO_LOW', `需 ${stageName(tech.requiredStage)} 方可参悟`);
  }
  if (char.spiritStones < tech.learnCost) throw new MockFail('INSUFFICIENT_STONES', '灵石不足');
  return buildView(
    ctx.w,
    save(ctx, {
      ...char,
      spiritStones: char.spiritStones - tech.learnCost,
      learnedTechniqueIds: [...char.learnedTechniqueIds, tech.id],
      techniqueId: tech.id,
    }),
  );
});

on(API.character.publicProfile, (ctx, _input, params) => {
  const target = ctx.w.characters.get(String(params.id));
  if (!target) throw new MockFail('CHARACTER_NOT_FOUND', '查无此人');
  return toProfile(ctx.w, target);
});

on(API.character.cultivators, (ctx, input) => {
  const q = String(input.q ?? '');
  const all = [...ctx.w.characters.values()].filter(
    (c) => (!q || c.name.includes(q)) && (!input.onlyOnline || isOnline(c)),
  );
  return page(all.map((c) => toProfile(ctx.w, c)), input);
});

on(API.character.rankings, (ctx, input) => {
  const board = String(input.board ?? 'realm') as 'realm' | 'power' | 'arena';
  const all = [...ctx.w.characters.values()];
  const sorted = [...all].sort((a, b) => {
    if (board === 'power') {
      return (
        statsFor(b, ctx.w.inventories.get(b.id) ?? []).power -
        statsFor(a, ctx.w.inventories.get(a.id) ?? []).power
      );
    }
    if (board === 'arena') return b.arenaRating - a.arenaRating;
    return b.stageIndex - a.stageIndex || b.exp - a.exp;
  });
  const entries: RankingEntry[] = sorted.map((c, i) => ({
    rank: i + 1,
    characterId: c.id,
    name: c.name,
    avatarArt: c.avatarArt,
    isBot: c.isBot,
    stageIndex: c.stageIndex,
    stageName: stageName(c.stageIndex),
    powerScore: statsFor(c, ctx.w.inventories.get(c.id) ?? []).power,
    arenaRating: c.arenaRating,
    online: isOnline(c),
  }));
  return { ...page(entries, input), board };
});

function page<T>(items: T[], input: Record<string, unknown>) {
  const pageNo = Math.max(1, Number(input.page ?? 1));
  const pageSize = Math.max(1, Number(input.pageSize ?? 20));
  const start = (pageNo - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page: pageNo,
    pageSize,
    total: items.length,
    hasMore: start + pageSize < items.length,
  };
}

// ---- inventory

on(API.inventory.list, (ctx) => {
  const char = requireChar(ctx);
  const inv = ctx.w.inventories.get(char.id) ?? [];
  const { stats, power } = statsFor(char, inv);
  return {
    items: inv,
    spiritStones: char.spiritStones,
    equipment: char.equipment,
    stats,
    powerScore: power,
  };
});

on(API.inventory.use, (ctx, input) => {
  let char = requireChar(ctx);
  const inv = ctx.w.inventories.get(char.id) ?? [];
  const row = inv.find((r) => r.uid === String(input.uid ?? ''));
  if (!row) throw new MockFail('ITEM_NOT_FOUND', '背包里没有这件东西');
  const item = ITEM_BY_ID.get(row.itemId);
  if (item?.kind !== 'pill') throw new MockFail('NOT_CONSUMABLE', '这东西不能服用');
  const qty = Math.max(1, Number(input.qty ?? 1));
  if (row.qty < qty) throw new MockFail('INSUFFICIENT_ITEMS', '数量不足');

  let message = `服下${item.name}。`;
  let gainedExp = 0;
  const effect = item.effect;
  switch (effect.type) {
    case 'cultivation_buff': {
      char = {
        ...char,
        buffs: [
          ...char.buffs,
          {
            id: nextId(ctx.w, 'buff'),
            itemId: item.id,
            bonus: effect.bonus,
            expiresAt: ctx.now + effect.durationSec * 1000 * qty,
          },
        ],
      };
      message = `服下${item.name}，修炼速度 +${Math.round(effect.bonus * 100)}%`;
      break;
    }
    case 'instant_exp': {
      gainedExp = effect.exp * qty;
      char = grantExp(char, gainedExp);
      message = `服下${item.name}，修为 +${gainedExp.toLocaleString('zh-CN')}`;
      break;
    }
    case 'heal': {
      char = { ...char, hpPercent: Math.min(1, char.hpPercent + effect.healPercent) };
      message = `服下${item.name}，气血回复 ${Math.round(effect.healPercent * 100)}%`;
      break;
    }
    case 'breakthrough_aid':
      throw new MockFail('NOT_CONSUMABLE', '破境丹在突破时使用');
    case 'stat_buff':
      message = `服下${item.name}，战力短时提升`;
      break;
    case 'unlock_skill_slot':
      message = `服下${item.name}，神通槽已开启`;
      break;
  }

  takeItem(ctx.w, char.id, item.id, qty);
  const saved = save(ctx, char);
  return { view: buildView(ctx.w, saved), message, gainedExp };
});

on(API.inventory.equip, (ctx, input) => {
  const char = requireChar(ctx);
  const inv = ctx.w.inventories.get(char.id) ?? [];
  const row = inv.find((r) => r.uid === String(input.uid ?? ''));
  if (!row) throw new MockFail('ITEM_NOT_FOUND', '背包里没有这件东西');
  const item = ITEM_BY_ID.get(row.itemId);
  if (item?.kind !== 'equipment') throw new MockFail('NOT_EQUIPPABLE', '这件东西无法穿戴');
  if (char.stageIndex < item.requiredStage) {
    throw new MockFail('STAGE_TOO_LOW', `需 ${stageName(item.requiredStage)} 方可驾驭`);
  }
  const previous = char.equipment[item.slot];
  ctx.w.inventories.set(
    char.id,
    inv.map((r) =>
      r.uid === row.uid
        ? { ...r, equipped: true }
        : r.uid === previous
          ? { ...r, equipped: false }
          : r,
    ),
  );
  return buildView(
    ctx.w,
    save(ctx, { ...char, equipment: { ...char.equipment, [item.slot]: row.uid } }),
  );
});

on(API.inventory.unequip, (ctx, input) => {
  const char = requireChar(ctx);
  const slot = String(input.slot ?? '') as keyof CharacterState['equipment'];
  const uid = char.equipment[slot];
  if (!uid) throw new MockFail('SLOT_MISMATCH', '这个槽位本来就是空的');
  const inv = ctx.w.inventories.get(char.id) ?? [];
  ctx.w.inventories.set(
    char.id,
    inv.map((r) => (r.uid === uid ? { ...r, equipped: false } : r)),
  );
  return buildView(ctx.w, save(ctx, { ...char, equipment: { ...char.equipment, [slot]: null } }));
});

// ---- explore

on(API.explore.maps, (ctx) => {
  const char = refresh(ctx, requireChar(ctx));
  return {
    maps: EXPLORE_MAPS.map((map) => ({
      ...map,
      unlocked: char.stageIndex >= map.unlockStage,
      gatherReadyAt: char.dailyCounters.gatherAt[map.id] ?? 0,
      monsters: map.monsterIds
        .map((id) => MONSTER_BY_ID.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m)),
    })),
  };
});

on(API.explore.battle, (ctx, input) => {
  let char = refresh(ctx, requireChar(ctx));
  const map = EXPLORE_MAP_BY_ID.get(String(input.mapId ?? ''));
  if (!map) throw new MockFail('NOT_FOUND', '没有这个去处');
  if (char.stageIndex < map.unlockStage) {
    throw new MockFail('MAP_LOCKED', `需 ${stageName(map.unlockStage)} 方可前往`);
  }

  const rng = createRng(combineSeeds('explore', char.id, ctx.now));
  const forced = input.monsterId ? String(input.monsterId) : null;

  if (!forced && rng.chance(map.encounterChance)) {
    const encounters = map.encounterIds
      .map((id) => ENCOUNTER_BY_ID.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const encounter = rng.weighted(encounters, encounters.map((e) => e.weight));
    const token = nextId(ctx.w, 'enc');
    ctx.w.encounters.set(token, { token, encounterId: encounter.id, mapId: map.id });
    return { kind: 'encounter', encounter, encounterToken: token, view: buildView(ctx.w, char) };
  }

  const monsterId = forced ?? rng.pick(map.monsterIds);
  const monster = MONSTER_BY_ID.get(monsterId);
  if (!monster) throw new MockFail('NOT_FOUND', '此地没有这头妖兽');

  const battle = fightMonster(ctx.w, char, monster, combineSeeds(char.id, monsterId, ctx.now));
  const won = battle.winner === 'A';
  const finalHp = battle.finalHp[char.id] ?? 0;
  const { stats } = statsFor(char, ctx.w.inventories.get(char.id) ?? []);
  char = { ...char, hpPercent: Math.max(0.05, finalHp / Math.max(1, stats.hp)) };

  const reward = won
    ? {
        exp: Math.round(monster.expReward * ctx.w.settings.expRewardMultiplier),
        spiritStones: Math.round(monster.stoneReward * ctx.w.settings.stoneRewardMultiplier),
        items: rollLoot(monster.loot, rng, ctx.w.settings.dropRateMultiplier),
      }
    : { exp: 0, spiritStones: 0, items: [] as { itemId: string; qty: number }[] };

  if (won) {
    char = grantExp(char, reward.exp);
    char = { ...char, spiritStones: char.spiritStones + reward.spiritStones };
    for (const drop of reward.items) addItem(ctx.w, char.id, drop.itemId, drop.qty);
  }

  const saved = save(ctx, char);
  return {
    kind: 'battle',
    monsterId: monster.id,
    monsterName: monster.name,
    battle,
    won,
    reward: { ...reward, itemNames: itemNames(reward.items) },
    view: buildView(ctx.w, saved),
  };
});

on(API.explore.gather, (ctx, input) => {
  let char = refresh(ctx, requireChar(ctx));
  char = rollDailyReset(char, ctx.now);
  const map = EXPLORE_MAP_BY_ID.get(String(input.mapId ?? ''));
  if (!map) throw new MockFail('NOT_FOUND', '没有这个去处');
  if (char.stageIndex < map.unlockStage) throw new MockFail('MAP_LOCKED', '此地尚未开启');
  const readyAt = char.dailyCounters.gatherAt[map.id] ?? 0;
  if (readyAt > ctx.now) throw new MockFail('GATHER_COOLDOWN', '灵草未长成，稍后再来');

  const rng = createRng(combineSeeds('gather', char.id, ctx.now));
  const items = rollLoot(map.gather.loot, rng, ctx.w.settings.dropRateMultiplier);
  const exp = Math.round(map.gather.expReward * ctx.w.settings.expRewardMultiplier);
  const stones = Math.round(map.gather.stoneReward * ctx.w.settings.stoneRewardMultiplier);
  const nextGatherAt = ctx.now + map.gather.cooldownSec * 1000;

  char = grantExp(char, exp);
  char = {
    ...char,
    spiritStones: char.spiritStones + stones,
    dailyCounters: {
      ...char.dailyCounters,
      gatherAt: { ...char.dailyCounters.gatherAt, [map.id]: nextGatherAt },
    },
  };
  for (const drop of items) addItem(ctx.w, char.id, drop.itemId, drop.qty);
  const saved = save(ctx, char);
  return {
    reward: { exp, spiritStones: stones, items, itemNames: itemNames(items) },
    nextGatherAt,
    view: buildView(ctx.w, saved),
  };
});

on(API.explore.chooseEvent, (ctx, input) => {
  let char = refresh(ctx, requireChar(ctx));
  const pending = ctx.w.encounters.get(String(input.encounterToken ?? ''));
  if (!pending) throw new MockFail('ENCOUNTER_NOT_ACTIVE', '此番机缘已散');
  const encounter = ENCOUNTER_BY_ID.get(pending.encounterId);
  const option = encounter?.options.find((o) => o.id === String(input.optionId ?? ''));
  if (!encounter || !option) throw new MockFail('INVALID_CHOICE', '没有这个选择');

  for (const condition of option.conditions) {
    if (condition.type === 'spirit_stones_at_least' && char.spiritStones < condition.amount) {
      throw new MockFail('CHOICE_BLOCKED', '灵石不足，此路不通');
    }
    if (condition.type === 'stage_at_least' && char.stageIndex < condition.stageIndex) {
      throw new MockFail('CHOICE_BLOCKED', `需 ${stageName(condition.stageIndex)} 方可为之`);
    }
    if (condition.type === 'has_item' && countItem(ctx.w, char.id, condition.itemId) < condition.qty) {
      throw new MockFail('CHOICE_BLOCKED', '缺少所需之物');
    }
  }

  let exp = 0;
  let stones = 0;
  const items: { itemId: string; qty: number }[] = [];
  for (const effect of option.effects) {
    switch (effect.type) {
      case 'give_exp':
        exp += effect.exp;
        break;
      case 'give_spirit_stones':
        stones += effect.amount;
        break;
      case 'give_item':
        items.push({ itemId: effect.itemId, qty: effect.qty });
        break;
      case 'take_item':
        takeItem(ctx.w, char.id, effect.itemId, effect.qty);
        break;
      default:
        break;
    }
  }

  char = grantExp(char, exp);
  char = { ...char, spiritStones: Math.max(0, char.spiritStones + stones) };
  for (const drop of items) addItem(ctx.w, char.id, drop.itemId, drop.qty);
  ctx.w.encounters.delete(pending.token);

  const saved = save(ctx, char);
  return {
    outcomeText: option.outcomeText,
    reward: {
      exp,
      spiritStones: Math.max(0, stones),
      items,
      itemNames: itemNames(items),
    },
    view: buildView(ctx.w, saved),
  };
});

on(API.explore.dungeons, (ctx) => {
  const char = requireChar(ctx);
  return {
    dungeons: DUNGEONS.flatMap((d) => {
      const boss = MONSTER_BY_ID.get(d.bossId);
      if (!boss) return [];
      return [
        {
          ...d,
          unlocked: char.stageIndex >= d.unlockStage,
          runsToday: char.dailyCounters.dungeon,
          dailyLimit: ctx.w.settings.dungeonDailyLimit + d.bonusDailyEntries,
          boss,
        },
      ];
    }),
  };
});

// ---- social

on(API.social.chatHistory, (ctx, input) => {
  const limit = Math.max(1, Number(input.limit ?? 50));
  const channel = String(input.channel ?? 'world');
  const messages = ctx.w.chat.filter((m) => m.channel === channel || m.channel === 'system');
  return { messages: messages.slice(-limit) };
});

on(API.social.friends, () => ({ friends: [] }));

// ---- 组队 / 秘境 / 论道 / 围攻 / 好友
//
// Registered from `./multiplayer` with the helpers above lent to it, so the W3
// surface keeps its own file. It re-registers `social.friends` over the empty
// M1 placeholder, which is why this call comes last.
registerMultiplayerHandlers({ on, Fail: MockFail, refresh, save, rollDailyReset, page });

// ---- 青云镇: NPC 对话 / 任务链 / 商店
//
// Also wraps `explore.battle` with the 击杀 counter the real server bumps
// inside `explore()`, which is why the current handler is handed over.
registerContentHandlers({ on, Fail: MockFail, save, exploreBattle: findHandler(API.explore.battle) });

// ------------------------------------------------------------------ dispatch

export function findHandler(endpoint: Endpoint): Handler | undefined {
  return handlers.get(`${endpoint.method} ${endpoint.path}`);
}

export function makeCtx(token: string | null): Ctx {
  const w = getWorld();
  const userId = token ? w.tokens.get(token) : undefined;
  const user = userId ? (w.usersById.get(userId) ?? null) : null;
  const char = user?.characterId ? (w.characters.get(user.characterId) ?? null) : null;
  return { w, user, char, now: Date.now() };
}
