/**
 * Mock for the W3 multiplayer surface: 组队 / 秘境副本 / 论道 / 围攻 / 好友.
 *
 * Registered from `handlers.ts` through `registerMultiplayerHandlers`, so that
 * file keeps one table of `on(endpoint, handler)` rows. Everything here runs
 * the real shared engine — `simulateBattle`, `computeStats`, `rollLoot` — so a
 * dungeon replay in mock mode has the shape the server will send.
 *
 * The world holds one human, so every "other player" is a bot drawn from the
 * same population the rankings use. Where a behaviour cannot exist without a
 * second human — a friend typing your invite code, someone challenging you —
 * the mock stands one in on a timer; those places are called out inline.
 */

import {
  API,
  combineSeeds,
  createRng,
  DUNGEON_BY_ID,
  MONSTER_BY_ID,
  simulateBattle,
  stageName,
  type ApiErrorCode,
  type ArenaRecord,
  type BattleResult,
  type CharacterState,
  type Combatant,
  type Endpoint,
  type Friend,
  type Party,
  type PartyMember,
  type RaidTarget,
  type Rng,
} from '@xianxia/shared';
import {
  addItem,
  buildView,
  emit,
  getWorld,
  grantExp,
  itemNames,
  monsterCombatant,
  rollLoot,
  statsFor,
  toCombatant,
  toProfile,
  type MockUser,
  type MockWorld,
} from './world';

/**
 * Structural copies of `handlers.ts`'s private types. Declared rather than
 * imported so this module has no runtime cycle with the table registering it.
 */
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

/** What `handlers.ts` lends this module so it can register its own rows. */
export interface MockKit {
  on: <E extends Endpoint>(endpoint: E, handler: Handler) => void;
  /** The error `index.ts` turns into a failure envelope. */
  Fail: new (code: ApiErrorCode, message: string) => Error;
  /** Settles, recomputes 战力, writes back. */
  refresh: (ctx: Ctx, char: CharacterState) => CharacterState;
  save: (ctx: Ctx, char: CharacterState) => CharacterState;
  rollDailyReset: (char: CharacterState, now: number) => CharacterState;
  page: <T>(items: T[], input: Record<string, unknown>) => unknown;
}

// ---------------------------------------------------------------- mock state

interface RaidRow {
  botId: string;
  hpPercent: number;
  protectedUntil: number;
  bounty: number;
}

interface MpState {
  seeded: boolean;
  /** The human's party, or null when solo. */
  party: Party | null;
  friends: Friend[];
  records: ArenaRecord[];
  raid: RaidRow[];
  /** Bot ids offered on the 论道 board, held steady between reloads. */
  opponentIds: string[];
  seq: number;
}

/**
 * Keyed off the world object so `resetWorld()` drops this with it — `world.ts`
 * has no hook to register a reset against.
 */
const STATE = new WeakMap<MockWorld, MpState>();

const RAID_TARGET_COUNT = 10;
const ARENA_OPPONENT_COUNT = 20;
/** No I/O/0/1: an invite code gets read aloud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function mpId(s: MpState, prefix: string): string {
  s.seq += 1;
  return `${prefix}-${s.seq.toString(36)}`;
}

function bots(w: MockWorld): CharacterState[] {
  return [...w.characters.values()].filter((c) => c.isBot);
}

/** Bots closest in 战力 to `char`, nearest first. */
function neighbours(w: MockWorld, char: CharacterState, count: number): CharacterState[] {
  return bots(w)
    .filter((b) => b.id !== char.id)
    .sort(
      (a, b) =>
        Math.abs(a.powerScore - char.powerScore) - Math.abs(b.powerScore - char.powerScore),
    )
    .slice(0, count);
}

function state(w: MockWorld, char: CharacterState | null): MpState {
  let s = STATE.get(w);
  if (!s) {
    s = { seeded: false, party: null, friends: [], records: [], raid: [], opponentIds: [], seq: 0 };
    STATE.set(w, s);
  }
  if (!s.seeded && char) seed(w, char, s);
  return s;
}

/** One-time population: a friends list, a raid board and some past 论道. */
function seed(w: MockWorld, char: CharacterState, s: MpState): void {
  s.seeded = true;
  const now = Date.now();
  const rng = createRng(combineSeeds('mp-seed', char.id));
  const near = neighbours(w, char, 48);

  // ---- 好友: four accepted, one waiting on you, one waiting on them.
  const specs: { state: Friend['state']; online: boolean; ago: number }[] = [
    { state: 'accepted', online: true, ago: 0 },
    { state: 'accepted', online: true, ago: 0 },
    { state: 'accepted', online: false, ago: 42 * 60_000 },
    { state: 'accepted', online: false, ago: 26 * 3_600_000 },
    { state: 'pending_in', online: true, ago: 0 },
    { state: 'pending_out', online: false, ago: 3 * 3_600_000 },
  ];
  s.friends = specs.flatMap((spec, i) => {
    const bot = near[i * 3 + 1];
    if (!bot) return [];
    return [
      {
        characterId: bot.id,
        name: bot.name,
        avatarArt: bot.avatarArt,
        stageIndex: bot.stageIndex,
        stageName: stageName(bot.stageIndex),
        powerScore: bot.powerScore,
        online: spec.online,
        lastSeenAt: now - spec.ago,
        state: spec.state,
      },
    ];
  });

  // Sampled across the near band rather than taken off the front: the bot
  // population clusters hard by stage, and twenty adjacent picks would all
  // carry the same 战力 and the same 胜算.
  const spread = (pool: CharacterState[], count: number, offset: number): CharacterState[] => {
    const step = Math.max(1, Math.floor(pool.length / count));
    const out: CharacterState[] = [];
    for (let i = offset; i < pool.length && out.length < count; i += step) {
      const pick = pool[i];
      if (pick) out.push(pick);
    }
    return out;
  };

  const band = neighbours(w, char, 120);
  s.opponentIds = spread(band, ARENA_OPPONENT_COUNT, 0).map((b) => b.id);
  const raided = new Set(s.opponentIds);

  // ---- 围攻: blood pools already partly drained; one target still recovering.
  s.raid = spread(
    band.filter((b) => !raided.has(b.id)),
    RAID_TARGET_COUNT,
    1,
  )
    .map((bot, i) => ({
      botId: bot.id,
      hpPercent: i === 0 ? 0.18 : i === 1 ? 0.46 : Math.max(0.3, 1 - rng.next() * 0.55),
      protectedUntil: i === 2 ? now + 11 * 60_000 : 0,
      bounty: 2_000 + Math.round(bot.powerScore * 0.9) + rng.int(0, 4_000),
    }));

  // ---- 战绩: eight past bouts, the three newest still holding a replay.
  near.slice(2, 10).forEach((bot, i) => {
    const won = rng.chance(0.55);
    const inbound = i % 3 === 0;
    s.records.push({
      id: `rec-seed-${i}`,
      attackerId: inbound ? bot.id : char.id,
      attackerName: inbound ? bot.name : char.name,
      defenderId: inbound ? char.id : bot.id,
      defenderName: inbound ? char.name : bot.name,
      winnerId: won ? char.id : bot.id,
      ratingDelta: won ? rng.int(8, 21) : -rng.int(6, 17),
      foughtAt: now - (i + 1) * 47 * 60_000,
      battle: i < 3 ? duel(w, char, bot, combineSeeds('record', char.id, bot.id)) : null,
    });
  });
}

// ------------------------------------------------------------------- 组队

function partyCode(rng: Rng): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[rng.int(0, CODE_ALPHABET.length - 1)] ?? 'A';
  return out;
}

function memberOf(w: MockWorld, char: CharacterState, leaderId: string): PartyMember {
  return {
    characterId: char.id,
    name: char.name,
    avatarArt: char.avatarArt,
    stageIndex: char.stageIndex,
    stageName: stageName(char.stageIndex),
    powerScore: statsFor(char, w.inventories.get(char.id) ?? []).power,
    online: true,
    isLeader: char.id === leaderId,
    hpPercent: char.hpPercent,
  };
}

/**
 * A second player walking in is the one thing a single-human world cannot
 * produce, so a bot joins a few seconds after the party opens — and only while
 * a socket is listening, otherwise the timer would outlive a unit test.
 */
function scheduleBotJoin(w: MockWorld, s: MpState, delayMs: number): void {
  if (w.listeners.size === 0) return;
  window.setTimeout(() => {
    const party = s.party;
    if (!party || party.members.length >= party.maxSize) return;
    const taken = new Set(party.members.map((m) => m.characterId));
    const joiner = bots(w).find((b) => !taken.has(b.id) && b.stageIndex >= 6);
    if (!joiner) return;
    s.party = { ...party, members: [...party.members, memberOf(w, joiner, party.leaderId)] };
    emit(w, 'party:update', { party: s.party, reason: 'joined', actorName: joiner.name });
  }, delayMs);
}

// ------------------------------------------------------------------- 战斗

function duel(
  w: MockWorld,
  attacker: CharacterState,
  defender: CharacterState,
  seed: number,
): BattleResult {
  return simulateBattle({
    seed,
    teamA: [toCombatant(attacker, w.inventories.get(attacker.id) ?? [])],
    teamB: [toCombatant(defender, w.inventories.get(defender.id) ?? [])],
    maxRounds: w.settings.maxBattleRounds,
  });
}

/**
 * Runs a 秘境 wave by wave, carrying 气血 forward. Duplicate 妖兽 inside one
 * wave get a `#slot` suffix so each keeps its own bar in `finalHp`; the client
 * resolves the name by stripping it, then by the wave roster's order.
 */
function runDungeon(
  w: MockWorld,
  roster: CharacterState[],
  dungeonId: string,
  seedBase: number,
): { battles: BattleResult[]; cleared: boolean } {
  const dungeon = DUNGEON_BY_ID.get(dungeonId);
  if (!dungeon) return { battles: [], cleared: false };

  const hp = new Map<string, number>();
  for (const member of roster) {
    const { stats } = statsFor(member, w.inventories.get(member.id) ?? []);
    hp.set(member.id, Math.max(1, stats.hp * Math.max(0.25, member.hpPercent)));
  }

  const waves: string[][] = [...dungeon.waves.map((ids) => [...ids]), [dungeon.bossId]];
  const battles: BattleResult[] = [];
  let cleared = true;

  waves.forEach((ids, waveIndex) => {
    if (!cleared) return;
    const teamA: Combatant[] = roster
      .filter((member) => (hp.get(member.id) ?? 0) > 0)
      .map((member) => toCombatant(member, w.inventories.get(member.id) ?? [], hp.get(member.id)));
    if (teamA.length === 0) {
      cleared = false;
      return;
    }

    const teamB: Combatant[] = ids.flatMap((id, slot) => {
      const monster = MONSTER_BY_ID.get(id);
      if (!monster) return [];
      return [{ ...monsterCombatant(monster), id: `${monster.id}#${slot}` }];
    });
    if (teamB.length === 0) return;

    const battle = simulateBattle({
      seed: combineSeeds(seedBase, waveIndex),
      teamA,
      teamB,
      maxRounds: w.settings.maxBattleRounds,
    });
    battles.push(battle);
    for (const member of roster) {
      const left = battle.finalHp[member.id];
      if (left !== undefined) hp.set(member.id, left);
    }
    if (battle.winner !== 'A') cleared = false;
  });

  return { battles, cleared };
}

// ---------------------------------------------------------------- 事件推送

/**
 * Background traffic the multiplayer screens need to look inhabited: a blood
 * pool draining under other raiders, one inbound 论道, one friend request.
 * Started and stopped by the mock socket.
 */
export function startMultiplayerFeed(): () => void {
  const w = getWorld();
  const [firstToken] = [...w.tokens.keys()];
  const userId = firstToken ? w.tokens.get(firstToken) : undefined;
  const characterId = userId ? w.usersById.get(userId)?.characterId : null;
  const char = characterId ? (w.characters.get(characterId) ?? null) : null;
  const s = state(w, char);
  const rng = createRng(combineSeeds('feed', Date.now()));
  const names = bots(w).map((b) => b.name);

  const raidTimer = setInterval(() => {
    const live = s.raid.filter((row) => row.hpPercent > 0 && row.protectedUntil < Date.now());
    const row = live[rng.int(0, Math.max(0, live.length - 1))];
    if (!row) return;
    const bot = w.characters.get(row.botId);
    if (!bot) return;
    const damage = 0.03 + rng.next() * 0.07;
    row.hpPercent = Math.max(0, row.hpPercent - damage);
    if (row.hpPercent === 0) {
      row.protectedUntil = Date.now() + w.settings.raidRecoverMinutes * 60_000;
    }
    emit(w, 'raid:update', {
      botId: row.botId,
      botName: bot.name,
      hpPercent: row.hpPercent,
      lastDamage: Math.round(damage * 10_000),
      attackerNames: [rng.pick(names) ?? '散修', rng.pick(names) ?? '散修'],
      defeated: row.hpPercent === 0,
      protectedUntil: row.protectedUntil,
    });
  }, 6_000);

  const challengeAt = window.setTimeout(() => {
    if (!char) return;
    const rival = neighbours(w, char, 12).at(-1);
    if (!rival) return;
    const battle = duel(w, rival, char, combineSeeds('inbound', char.id, Date.now()));
    const defenderLost = battle.winner === 'A';
    emit(w, 'arena:challenged', {
      attackerId: rival.id,
      attackerName: rival.name,
      attackerStageName: stageName(rival.stageIndex),
      defenderLost,
      ratingDelta: defenderLost ? -12 : 9,
      battle,
      foughtAt: Date.now(),
    });
  }, 14_000);

  const friendAt = window.setTimeout(() => {
    if (!char) return;
    const known = new Set(s.friends.map((f) => f.characterId));
    const suitor = neighbours(w, char, 40).find((b) => !known.has(b.id));
    if (!suitor) return;
    s.friends = [
      {
        characterId: suitor.id,
        name: suitor.name,
        avatarArt: suitor.avatarArt,
        stageIndex: suitor.stageIndex,
        stageName: stageName(suitor.stageIndex),
        powerScore: suitor.powerScore,
        online: true,
        lastSeenAt: Date.now(),
        state: 'pending_in',
      },
      ...s.friends,
    ];
    emit(w, 'friend:request', {
      fromCharacterId: suitor.id,
      fromName: suitor.name,
      fromStageName: stageName(suitor.stageIndex),
      at: Date.now(),
    });
  }, 34_000);

  return () => {
    clearInterval(raidTimer);
    window.clearTimeout(challengeAt);
    window.clearTimeout(friendAt);
  };
}

// ------------------------------------------------------------------ handlers

export function registerMultiplayerHandlers(kit: MockKit): void {
  const { on, Fail, refresh, save, rollDailyReset, page } = kit;

  const requireChar = (ctx: Ctx): CharacterState => {
    if (!ctx.char) throw new Fail('CHARACTER_NOT_FOUND', '尚未创建角色');
    return ctx.char;
  };

  /** Everyone the player brings along: themselves plus any party mates. */
  const roster = (ctx: Ctx, char: CharacterState, withParty: boolean): CharacterState[] => {
    const party = state(ctx.w, char).party;
    if (!withParty || !party) return [char];
    return party.members.flatMap((m) => {
      const found = m.characterId === char.id ? char : ctx.w.characters.get(m.characterId);
      return found ? [found] : [];
    });
  };

  // ---- 组队

  on(API.party.get, (ctx) => ({ party: state(ctx.w, ctx.char).party }));

  on(API.party.create, (ctx) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    if (s.party) throw new Fail('ALREADY_IN_PARTY', '你已在队中');
    s.party = {
      id: mpId(s, 'party'),
      code: partyCode(createRng(combineSeeds('party', char.id, ctx.now))),
      leaderId: char.id,
      members: [memberOf(ctx.w, char, char.id)],
      maxSize: ctx.w.settings.maxPartySize,
      createdAt: ctx.now,
    };
    scheduleBotJoin(ctx.w, s, 2_600);
    return s.party;
  });

  on(API.party.join, (ctx, input) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    if (s.party) throw new Fail('ALREADY_IN_PARTY', '你已在队中，先离队再说');
    const code = String(input.code ?? '').toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) {
      throw new Fail('INVALID_PARTY_CODE', '邀请码只认字母与数字');
    }

    // No second human exists here, so any well-formed code opens a party led by
    // a bot; the code itself seeds who is already inside, so it stays stable.
    const rng = createRng(combineSeeds('join', code));
    const pool = neighbours(ctx.w, char, 40);
    const leader = pool[rng.int(0, Math.max(0, pool.length - 1))];
    if (!leader) throw new Fail('PARTY_NOT_FOUND', '这个邀请码下没有队伍');
    const second = pool.find((b) => b.id !== leader.id);
    s.party = {
      id: mpId(s, 'party'),
      code,
      leaderId: leader.id,
      members: [
        memberOf(ctx.w, leader, leader.id),
        ...(second ? [memberOf(ctx.w, second, leader.id)] : []),
        memberOf(ctx.w, char, leader.id),
      ],
      maxSize: ctx.w.settings.maxPartySize,
      createdAt: ctx.now,
    };
    emit(ctx.w, 'party:update', { party: s.party, reason: 'joined', actorName: char.name });
    return s.party;
  });

  on(API.party.leave, (ctx) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    if (!s.party) throw new Fail('NOT_IN_PARTY', '你本来就没有队伍');
    const disbanded = s.party.leaderId === char.id;
    s.party = null;
    emit(ctx.w, 'party:update', {
      party: null,
      reason: disbanded ? 'disbanded' : 'left',
      actorName: char.name,
    });
    return {};
  });

  on(API.party.kick, (ctx, input) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    const party = s.party;
    if (!party) throw new Fail('NOT_IN_PARTY', '你本来就没有队伍');
    if (party.leaderId !== char.id) throw new Fail('NOT_PARTY_LEADER', '只有队长能请人离队');
    const targetId = String(input.characterId ?? '');
    if (targetId === char.id) throw new Fail('NOT_FOUND', '队长请自行解散，不必踢自己');
    if (!party.members.some((m) => m.characterId === targetId)) {
      throw new Fail('NOT_FOUND', '队中无此人');
    }
    s.party = { ...party, members: party.members.filter((m) => m.characterId !== targetId) };
    emit(ctx.w, 'party:update', { party: s.party, reason: 'kicked', actorName: char.name });
    return s.party;
  });

  // ---- 秘境副本

  on(API.explore.startDungeon, (ctx, input) => {
    let char = rollDailyReset(refresh(ctx, requireChar(ctx)), ctx.now);
    const dungeon = DUNGEON_BY_ID.get(String(input.dungeonId ?? ''));
    if (!dungeon) throw new Fail('NOT_FOUND', '没有这处秘境');
    if (char.stageIndex < dungeon.unlockStage) {
      throw new Fail('DUNGEON_LOCKED', `需 ${stageName(dungeon.unlockStage)} 方可入内`);
    }
    const limit = ctx.w.settings.dungeonDailyLimit + dungeon.bonusDailyEntries;
    if (char.dailyCounters.dungeon >= limit) {
      throw new Fail('DAILY_LIMIT_REACHED', '今日秘境已走满，明日请早');
    }

    const withParty = input.withParty === true;
    const s = state(ctx.w, char);
    if (withParty && !s.party) throw new Fail('NOT_IN_PARTY', '先结一支队伍再来');
    const team = roster(ctx, char, withParty);
    if (withParty && team.length < 2) throw new Fail('PARTY_TOO_SMALL', '队中只剩你一人');

    if (withParty) {
      emit(ctx.w, 'dungeon:start', {
        dungeonId: dungeon.id,
        dungeonName: dungeon.name,
        partyMemberIds: team.map((m) => m.id),
        startedAt: ctx.now,
      });
    }

    const seedBase = combineSeeds('dungeon', char.id, ctx.now);
    const { battles, cleared } = runDungeon(ctx.w, team, dungeon.id, seedBase);
    const rng = createRng(combineSeeds(seedBase, 'loot'));

    // A party splits the take, but not evenly enough to punish bringing help.
    const share = 1 / Math.max(1, team.length * 0.55);
    const reward = cleared
      ? {
          exp: Math.round(dungeon.reward.exp * share * ctx.w.settings.expRewardMultiplier),
          spiritStones: Math.round(
            dungeon.reward.spiritStones * share * ctx.w.settings.stoneRewardMultiplier,
          ),
          items: rollLoot(dungeon.reward.loot, rng, ctx.w.settings.dropRateMultiplier),
        }
      : { exp: 0, spiritStones: 0, items: [] as { itemId: string; qty: number }[] };

    const { stats } = statsFor(char, ctx.w.inventories.get(char.id) ?? []);
    const leftHp = battles.at(-1)?.finalHp[char.id] ?? stats.hp * char.hpPercent;
    char = {
      ...char,
      hpPercent: Math.max(0.05, Math.min(1, leftHp / Math.max(1, stats.hp))),
      dailyCounters: { ...char.dailyCounters, dungeon: char.dailyCounters.dungeon + 1 },
    };
    if (cleared) {
      char = grantExp(char, reward.exp);
      char = { ...char, spiritStones: char.spiritStones + reward.spiritStones };
      for (const drop of reward.items) addItem(ctx.w, char.id, drop.itemId, drop.qty);
    }
    const saved = save(ctx, char);
    const bundle = { ...reward, itemNames: itemNames(reward.items) };

    if (withParty) {
      emit(ctx.w, 'dungeon:result', {
        dungeonId: dungeon.id,
        dungeonName: dungeon.name,
        cleared,
        replay: battles,
        reward: {
          exp: bundle.exp,
          spiritStones: bundle.spiritStones,
          items: bundle.items.map((drop, i) => ({
            itemId: drop.itemId,
            qty: drop.qty,
            name: bundle.itemNames[i] ?? drop.itemId,
          })),
        },
        participantIds: team.map((m) => m.id),
      });
    }
    if (cleared) {
      emit(ctx.w, 'system:notice', {
        kind: 'boss_slain',
        text: `${saved.name} 一行破了 ${dungeon.name}，斩 ${MONSTER_BY_ID.get(dungeon.bossId)?.name ?? '妖王'}`,
        characterId: saved.id,
        at: ctx.now,
      });
    }

    return {
      dungeonId: dungeon.id,
      cleared,
      battles,
      reward: bundle,
      view: buildView(ctx.w, saved),
      participantIds: team.map((m) => m.id),
    };
  });

  // ---- 论道

  on(API.arena.opponents, (ctx) => {
    const char = rollDailyReset(refresh(ctx, requireChar(ctx)), ctx.now);
    const s = state(ctx.w, char);
    const mine = Math.max(1, char.powerScore);
    return {
      opponents: s.opponentIds.flatMap((id) => {
        const bot = ctx.w.characters.get(id);
        if (!bot) return [];
        const theirs = Math.max(1, bot.powerScore);
        return [
          {
            ...toProfile(ctx.w, bot),
            winHint: Math.max(0.05, Math.min(0.95, mine / (mine + theirs))),
          },
        ];
      }),
      challengesToday: char.dailyCounters.arena,
      dailyLimit: ctx.w.settings.arenaDailyLimit,
      rating: char.arenaRating,
    };
  });

  on(API.arena.challenge, (ctx, input) => {
    let char = rollDailyReset(refresh(ctx, requireChar(ctx)), ctx.now);
    const targetId = String(input.targetId ?? '');
    if (targetId === char.id) throw new Fail('SELF_CHALLENGE', '自己与自己论不出道理');
    const target = ctx.w.characters.get(targetId);
    if (!target) throw new Fail('CHARACTER_NOT_FOUND', '此人已不在册');
    if (char.dailyCounters.arena >= ctx.w.settings.arenaDailyLimit) {
      throw new Fail('DAILY_LIMIT_REACHED', '今日论道次数已尽，明日请早');
    }

    const battle = duel(ctx.w, char, target, combineSeeds('arena', char.id, targetId, ctx.now));
    const won = battle.winner === 'A';
    const ratingBefore = char.arenaRating;
    const gap = Math.max(-400, Math.min(400, target.arenaRating - ratingBefore));
    const delta = won ? Math.round(14 + gap / 25) : -Math.round(12 - gap / 30);
    const ratingAfter = Math.max(0, ratingBefore + delta);

    const { stats } = statsFor(char, ctx.w.inventories.get(char.id) ?? []);
    const reward = won
      ? {
          exp: Math.round(stats.hp * 1.4),
          spiritStones: 300 + Math.max(0, gap),
          items: [] as { itemId: string; qty: number }[],
        }
      : { exp: 0, spiritStones: 60, items: [] as { itemId: string; qty: number }[] };

    char = {
      ...char,
      arenaRating: ratingAfter,
      arenaWins: char.arenaWins + (won ? 1 : 0),
      arenaLosses: char.arenaLosses + (won ? 0 : 1),
      hpPercent: Math.max(0.15, (battle.finalHp[char.id] ?? stats.hp) / Math.max(1, stats.hp)),
      dailyCounters: { ...char.dailyCounters, arena: char.dailyCounters.arena + 1 },
    };
    char = grantExp(char, reward.exp);
    char = { ...char, spiritStones: char.spiritStones + reward.spiritStones };
    const saved = save(ctx, char);

    const s = state(ctx.w, saved);
    s.records = [
      {
        id: mpId(s, 'rec'),
        attackerId: saved.id,
        attackerName: saved.name,
        defenderId: target.id,
        defenderName: target.name,
        winnerId: won ? saved.id : target.id,
        ratingDelta: delta,
        foughtAt: ctx.now,
        battle,
      },
      ...s.records,
    ];

    return {
      won,
      battle,
      ratingBefore,
      ratingAfter,
      reward: { ...reward, itemNames: [] as string[] },
      opponent: toProfile(ctx.w, target),
    };
  });

  on(API.arena.records, (ctx, input) => page(state(ctx.w, ctx.char).records, input));

  // ---- 围攻

  on(API.raid.targets, (ctx) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    const targets: RaidTarget[] = s.raid.flatMap((row) => {
      const bot = ctx.w.characters.get(row.botId);
      if (!bot) return [];
      return [
        {
          ...toProfile(ctx.w, bot),
          hpPercent: row.hpPercent,
          protectedUntil: row.protectedUntil,
          bounty: row.bounty,
        },
      ];
    });
    return { targets };
  });

  on(API.raid.attack, (ctx, input) => {
    let char = refresh(ctx, requireChar(ctx));
    const s = state(ctx.w, char);
    const row = s.raid.find((r) => r.botId === String(input.botId ?? ''));
    const bot = row ? ctx.w.characters.get(row.botId) : undefined;
    if (!row || !bot) throw new Fail('CHARACTER_NOT_FOUND', '此人不在围攻榜上');
    if (!bot.isBot) throw new Fail('TARGET_NOT_BOT', '只可围攻傀儡修士');
    if (row.protectedUntil > ctx.now) throw new Fail('TARGET_PROTECTED', '此人尚在疗伤，稍后再来');
    if (row.hpPercent <= 0) throw new Fail('TARGET_PROTECTED', '血池已空，等它缓过来');

    const withParty = input.withParty !== false;
    const team = roster(ctx, char, withParty);
    const botStats = statsFor(bot, ctx.w.inventories.get(bot.id) ?? []);
    const poolBefore = Math.max(1, botStats.stats.hp * row.hpPercent);

    const battle = simulateBattle({
      seed: combineSeeds('raid', char.id, bot.id, ctx.now),
      teamA: team.map((m) => toCombatant(m, ctx.w.inventories.get(m.id) ?? [])),
      teamB: [{ ...toCombatant(bot, ctx.w.inventories.get(bot.id) ?? []), hp: poolBefore }],
      maxRounds: ctx.w.settings.maxBattleRounds,
    });

    const poolAfter = Math.max(0, battle.finalHp[bot.id] ?? poolBefore);
    row.hpPercent = Math.max(0, poolAfter / Math.max(1, botStats.stats.hp));
    const defeated = row.hpPercent <= 0;
    if (defeated) row.protectedUntil = ctx.now + ctx.w.settings.raidRecoverMinutes * 60_000;

    const dealt = Math.max(0, poolBefore - poolAfter);
    const cut = Math.round((row.bounty * dealt) / Math.max(1, botStats.stats.hp));
    const reward = {
      exp: Math.round(dealt * 1.5),
      spiritStones: Math.max(1, Math.round(cut / Math.max(1, team.length))),
      items: [] as { itemId: string; qty: number }[],
    };

    char = grantExp(char, reward.exp);
    char = { ...char, spiritStones: char.spiritStones + reward.spiritStones };
    const { stats } = statsFor(char, ctx.w.inventories.get(char.id) ?? []);
    char = {
      ...char,
      hpPercent: Math.max(0.1, (battle.finalHp[char.id] ?? stats.hp) / Math.max(1, stats.hp)),
    };
    save(ctx, char);

    emit(ctx.w, 'raid:update', {
      botId: bot.id,
      botName: bot.name,
      hpPercent: row.hpPercent,
      lastDamage: Math.round(dealt),
      attackerNames: team.map((m) => m.name),
      defeated,
      protectedUntil: row.protectedUntil,
    });
    if (defeated) {
      emit(ctx.w, 'system:notice', {
        kind: 'boss_slain',
        text: `${team.map((m) => m.name).join('、')} 合力放倒了 ${bot.name}`,
        characterId: bot.id,
        at: ctx.now,
      });
    }

    return {
      defeated,
      battle,
      remainingHpPercent: row.hpPercent,
      reward: { ...reward, itemNames: [] as string[] },
      participantIds: team.map((m) => m.id),
      target: {
        ...toProfile(ctx.w, bot),
        hpPercent: row.hpPercent,
        protectedUntil: row.protectedUntil,
        bounty: row.bounty,
      },
    };
  });

  // ---- 好友 (supersedes the M1 empty-list placeholder registered above)

  on(API.social.friends, (ctx) => ({ friends: state(ctx.w, ctx.char).friends }));

  on(API.social.friendRequest, (ctx, input) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    const target = ctx.w.characters.get(String(input.characterId ?? ''));
    if (!target || target.id === char.id) throw new Fail('CHARACTER_NOT_FOUND', '查无此人');
    const existing = s.friends.find((f) => f.characterId === target.id);
    if (existing?.state === 'accepted') throw new Fail('ALREADY_FRIENDS', '你们已是道友');
    if (existing) throw new Fail('FRIEND_REQUEST_EXISTS', '申请已在路上');
    s.friends = [
      ...s.friends,
      {
        characterId: target.id,
        name: target.name,
        avatarArt: target.avatarArt,
        stageIndex: target.stageIndex,
        stageName: stageName(target.stageIndex),
        powerScore: target.powerScore,
        online: true,
        lastSeenAt: target.lastSeenAt,
        state: 'pending_out',
      },
    ];
    return {};
  });

  on(API.social.friendAccept, (ctx, input) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    const targetId = String(input.characterId ?? '');
    if (!s.friends.some((f) => f.characterId === targetId)) {
      throw new Fail('FRIEND_NOT_FOUND', '没有这份申请');
    }
    s.friends = s.friends.map((f) =>
      f.characterId === targetId ? { ...f, state: 'accepted' as const } : f,
    );
    return { friends: s.friends };
  });

  on(API.social.friendRemove, (ctx, input) => {
    const char = requireChar(ctx);
    const s = state(ctx.w, char);
    const targetId = String(input.characterId ?? '');
    if (!s.friends.some((f) => f.characterId === targetId)) {
      throw new Fail('FRIEND_NOT_FOUND', '名册里没有此人');
    }
    s.friends = s.friends.filter((f) => f.characterId !== targetId);
    return { friends: s.friends };
  });
}
