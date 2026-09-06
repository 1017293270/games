import {
  attemptBreakthrough,
  botCultivationMultiplier,
  botScheduleMultiplier,
  BREAKTHROUGH_BASE_CHANCE,
  combineSeeds,
  createRng,
  decideBotAction,
  hourOfDay,
  realmOf,
  requiresTribulation,
  stageName,
  tribulationAvatar,
  type BotParams,
  type CharacterState,
  type Stats,
  type WorldSettings,
} from '@xianxia/shared';
import type { AppContext } from '../../context.js';
import { resolveEquipment, statsOf, withFreshPower } from '../../game/character.js';
import { characterCombatant, monsterCombatant, runBattle } from '../../game/combat.js';
import { settle } from '../../game/character.js';
import { rollDailyCounters } from '../../game/rewards.js';
import { transact } from '../../db/index.js';
import { recordMessage } from '../../modules/social/service.js';
import { BOT_CHAT_COOLDOWN_MS, BOT_CHAT_PER_TICK, pickBotLine } from './chatter.js';
import { botEquipment, withBotGear } from './gear.js';
import { generateBots } from './generate.js';
import { allHeaders } from './repo.js';
import type { CharacterHeader } from '../../db/repo/characters.js';

/**
 * The bot world loop.
 *
 * Cultivation is lazy, so a tick never has to hand out 修为 second by second:
 * it settles each bot to `now` at its own schedule multiplier, then does the
 * things that *cannot* be derived from the clock — deciding, breaking through,
 * picking fights and talking.
 *
 * Everything a tick touches is read in two queries and written in one
 * transaction, which is what keeps a 200-bot round in single-digit
 * milliseconds.
 */

/** Rating exchanged by a decisive arena result. */
const ELO_K = 32;

/** How many stages either side of a bot it will look for an opponent in. */
const OPPONENT_STAGE_WINDOW = 3;

/** Ceiling on bots created in one tick, so raising `botCount` cannot stall it. */
const MAX_CREATED_PER_TICK = 500;

export interface BotTickStats {
  at: number;
  /** Bots present at the start of the tick, after topping the population up. */
  bots: number;
  created: number;
  breakthroughs: number;
  tribulations: number;
  battles: number;
  chats: number;
  durationMs: number;
}

export interface BotEngineOptions {
  /** Overrides the clock; tests drive ticks without waiting. */
  now?: () => number;
  /** Skips the timer entirely; tests call `tick()` themselves. */
  autoStart?: boolean;
}

/** New rating for `a` after a result against `b`. `score` is 1, 0.5 or 0. */
export function eloDelta(a: number, b: number, score: number): number {
  const expected = 1 / (1 + 10 ** ((b - a) / 400));
  return Math.round(ELO_K * (score - expected));
}

/**
 * Folds a bot's `insight` into the breakthrough odds.
 *
 * `attemptBreakthrough` takes 破境丹 and a world multiplier, not a flat bonus,
 * and bots hold no pills — so the +Npp of `insight` is expressed as the
 * multiplier that turns the stage's base chance into `base + insight`. The
 * world's own multiplier and the 95% ceiling still apply on top, exactly as
 * they do for a player.
 */
export function insightWorld(
  world: Pick<WorldSettings, 'breakthroughChanceMultiplier'>,
  params: BotParams | null,
  stageIndex: number,
): Pick<WorldSettings, 'breakthroughChanceMultiplier'> {
  const insight = params?.insight ?? 0;
  if (insight === 0) return world;
  const base = BREAKTHROUGH_BASE_CHANCE[realmOf(stageIndex)];
  if (base === undefined || base <= 0) return world;
  return {
    breakthroughChanceMultiplier:
      world.breakthroughChanceMultiplier * ((base + insight) / base),
  };
}

/** A bot's attributes: realm baseline, its 功法 and the gear its 大境界 carries. */
function botStats(state: CharacterState): Stats {
  return statsOf(state, botEquipment(state));
}

export class BotEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly clock: () => number;
  private readonly lastChatAt = new Map<string, number>();
  private stopSettingsWatch: (() => void) | null = null;

  /** Epoch ms of the last completed tick; surfaced by `admin/stats`. */
  lastTickAt: number | null = null;
  lastTick: BotTickStats | null = null;

  constructor(
    private readonly ctx: AppContext,
    options: BotEngineOptions = {},
  ) {
    this.clock = options.now ?? ctx.now;
  }

  /** Starts the timer. Re-times itself whenever `botTickSeconds` changes. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.ensureGear();
    this.stopSettingsWatch = this.ctx.settings.onChange(() => this.reschedule());
    this.schedule();
  }

  /**
   * Writes every bot's slot uids back into its row, and returns how many rows
   * changed.
   *
   * The loadout is derived, so this only mirrors it into storage — which is
   * what a world seeded before bots had gear needs, and what makes the admin
   * panel and a raw `state_json` read agree with 公开档案. Deriving the same
   * uids from `(id, 大境界)` every time makes it idempotent: the second run
   * over an unchanged world reports 0.
   */
  ensureGear(): number {
    const dirty: CharacterState[] = [];
    for (const bot of this.ctx.characters.allBots()) {
      const geared = withBotGear(bot);
      const fresh = withFreshPower(geared, botEquipment(geared));
      if (fresh !== bot) dirty.push(fresh);
    }
    if (dirty.length === 0) return 0;
    transact(this.ctx.db, () => this.ctx.characters.saveMany(dirty));
    return dirty.length;
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopSettingsWatch?.();
    this.stopSettingsWatch = null;
  }

  private schedule(): void {
    if (!this.running) return;
    const seconds = this.ctx.settings.get().botTickSeconds;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (error) {
        console.error('[bots] tick failed:', error);
      }
      this.schedule();
    }, Math.max(1, seconds) * 1000);
    this.timer.unref?.();
  }

  /** Restarts the countdown so a changed `botTickSeconds` takes effect now. */
  private reschedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedule();
  }

  /**
   * Tops the bot population up to `world.botCount`.
   *
   * Only ever adds: lowering `botCount` leaves the existing cultivators alone,
   * because deleting a bot that players have fought and ranked against would
   * silently rewrite their history. Removal is an explicit admin action.
   */
  ensurePopulation(now: number): number {
    const target = this.ctx.settings.get().botCount;
    const have = this.ctx.characters.countBots();
    const missing = Math.min(target - have, MAX_CREATED_PER_TICK);
    if (missing <= 0) return 0;
    return transact(this.ctx.db, () => generateBots(this.ctx, { count: missing }, now).length);
  }

  /** One simulation round. Safe to call directly; tests do exactly that. */
  tick(nowMs?: number): BotTickStats {
    const now = nowMs ?? this.clock();
    const started = Date.now();
    const world = this.ctx.settings.get();
    const utcHour = hourOfDay(now);

    const created = this.ensurePopulation(now);
    const bots = this.ctx.characters.allBots();
    const headers = allHeaders(this.ctx);

    const stats: BotTickStats = {
      at: now,
      bots: bots.length,
      created,
      breakthroughs: 0,
      tribulations: 0,
      battles: 0,
      chats: 0,
      durationMs: 0,
    };

    /** Everything the tick decided to write, applied in one transaction. */
    const dirty = new Map<string, CharacterState>();
    const notices: { text: string; characterId: string }[] = [];
    const chats: CharacterState[] = [];
    const fights: {
      attacker: CharacterState;
      defenderId: string;
      seed: number;
    }[] = [];

    for (const bot of bots) {
      const params = bot.botParams;
      if (!params) continue;

      // `settleCultivation` folds in talent x (1 + insight); the schedule and
      // diligence half of `botCultivationMultiplier` rides in as a world scale.
      const scheduleMultiplier = botScheduleMultiplier(params, utcHour);
      const result = settle(bot, world, now, scheduleMultiplier);
      let state = rollDailyCounters(result.character, now);

      // Raided bots heal back over `raidRecoverMinutes`.
      if (state.hpPercent < 1 && world.raidRecoverMinutes > 0) {
        const elapsedMin = Math.max(0, (now - bot.lastSettledAt) / 60_000);
        const healed = Math.min(1, state.hpPercent + elapsedMin / world.raidRecoverMinutes);
        state = { ...state, hpPercent: healed };
      }

      const rng = createRng(combineSeeds('bot-tick', state.id, now));
      const parked = result.atPerfection;

      const action = decideBotAction(
        {
          params,
          utcHour,
          atPerfection: parked,
          breakthroughPills: 0,
          dungeonRunsToday: state.dailyCounters.dungeon,
          arenaChallengesToday: state.dailyCounters.arena,
          dungeonDailyLimit: world.dungeonDailyLimit,
          arenaDailyLimit: world.arenaDailyLimit,
        },
        rng,
      );

      if (action === 'breakthrough' && parked) {
        const outcome = this.breakThrough(state, world, rng, now);
        state = outcome.state;
        if (outcome.attempted) stats.breakthroughs += outcome.success ? 1 : 0;
        if (outcome.tribulation) stats.tribulations += 1;
        if (outcome.success) {
          notices.push({
            text: `${state.name} 突破至 ${stageName(state.stageIndex)}`,
            characterId: state.id,
          });
        }
      } else if (action === 'arena' && state.dailyCounters.arena < world.arenaDailyLimit) {
        const target = this.pickOpponent(state, headers, rng);
        if (target) {
          fights.push({
            attacker: state,
            defenderId: target,
            seed: combineSeeds('arena', state.id, target, now),
          });
        }
      }

      // A bot speaks at most once every 30 minutes, and only while awake.
      const lastChat = this.lastChatAt.get(state.id) ?? 0;
      if (
        chats.length < BOT_CHAT_PER_TICK * 4 &&
        now - lastChat >= BOT_CHAT_COOLDOWN_MS &&
        scheduleMultiplier > 0.25 &&
        rng.chance(0.02)
      ) {
        chats.push(state);
      }

      // Gear follows the 大境界 the bot is in *now*, so a tick that broke it
      // through also re-equips it, and the cached 战力 is stamped from the
      // same pieces the next fight will use.
      const geared = withBotGear(state);
      dirty.set(geared.id, withFreshPower(geared, botEquipment(geared)));
    }

    // ---- fights, resolved after the settle pass so both sides are current
    for (const fight of fights) {
      const attacker = dirty.get(fight.attacker.id) ?? fight.attacker;
      const defender = dirty.get(fight.defenderId) ?? this.ctx.characters.byId(fight.defenderId);
      if (!defender) continue;

      const resolved = this.runArena(attacker, defender, fight.seed, world, now);
      dirty.set(resolved.attacker.id, resolved.attacker);
      dirty.set(resolved.defender.id, resolved.defender);
      stats.battles += 1;
    }

    // ---- one write for the whole round
    transact(this.ctx.db, () => {
      this.ctx.characters.saveMany([...dirty.values()]);
    });

    // ---- broadcasts, after the data is durable
    for (const notice of notices) {
      this.ctx.realtime.notice({
        kind: 'breakthrough',
        text: notice.text,
        characterId: notice.characterId,
        at: now,
      });
    }

    for (const bot of chats.slice(0, BOT_CHAT_PER_TICK)) {
      const rng = createRng(combineSeeds('bot-chat', bot.id, now));
      const message = recordMessage(
        this.ctx,
        {
          channel: 'world',
          senderId: bot.id,
          senderName: bot.name,
          stageIndex: bot.stageIndex,
          text: pickBotLine(bot, rng),
        },
        world,
        now,
      );
      this.lastChatAt.set(bot.id, now);
      this.ctx.realtime.chat(message);
      stats.chats += 1;
    }

    stats.durationMs = Date.now() - started;
    this.lastTickAt = now;
    this.lastTick = stats;
    return stats;
  }

  /** Rolls one bot's breakthrough, fighting the 天劫 when the stage demands it. */
  private breakThrough(
    state: CharacterState,
    world: WorldSettings,
    rng: ReturnType<typeof createRng>,
    now: number,
  ): { state: CharacterState; attempted: boolean; success: boolean; tribulation: boolean } {
    let tribulationWon = false;
    let tribulation = false;

    if (requiresTribulation(state.stageIndex)) {
      tribulation = true;
      const avatar = tribulationAvatar(state.stageIndex);
      const battle = runBattle(
        [characterCombatant(state, botStats(state))],
        [monsterCombatant(avatar)],
        combineSeeds('bot-tribulation', state.id, now),
        world,
      );
      tribulationWon = battle.winner === 'A';
      this.ctx.battles.insert({
        kind: 'tribulation',
        attackerId: state.id,
        attackerName: state.name,
        defenderId: avatar.id,
        defenderName: avatar.name,
        winnerId: tribulationWon ? state.id : null,
        ratingDelta: 0,
        foughtAt: now,
        battle,
      });
      if (!tribulationWon) return { state, attempted: false, success: false, tribulation };
    }

    const attempt = attemptBreakthrough(state, rng, {
      pills: 0,
      world: insightWorld(world, state.botParams, state.stageIndex),
      tribulationWon,
    });
    if (attempt.blocked) return { state, attempted: false, success: false, tribulation };

    // 战力 is stamped once per tick, after the gear pass, so a bot that just
    // crossed into a new 大境界 is rated with the pieces that realm carries.
    this.ctx.counters.bump('breakthroughs', now, attempt.success ? 1 : 0);
    return { state: attempt.character, attempted: true, success: attempt.success, tribulation };
  }

  /** Finds a nearby cultivator to challenge; players count, self does not. */
  private pickOpponent(
    bot: CharacterState,
    headers: readonly CharacterHeader[],
    rng: ReturnType<typeof createRng>,
  ): string | null {
    const near = headers.filter(
      (h) =>
        h.id !== bot.id &&
        Math.abs(h.stageIndex - bot.stageIndex) <= OPPONENT_STAGE_WINDOW,
    );
    if (near.length === 0) return null;

    // An aggressive bot prefers a live player — that is what makes the world
    // feel inhabited rather than self-contained.
    const players = near.filter((h) => !h.isBot && this.ctx.presence.isOnline(h.id));
    const pool = players.length > 0 && rng.chance(0.6) ? players : near;
    return rng.pick(pool).id;
  }

  /** Runs one arena fight, updates both ratings and notifies a human defender. */
  private runArena(
    attacker: CharacterState,
    defender: CharacterState,
    seed: number,
    world: WorldSettings,
    now: number,
  ): { attacker: CharacterState; defender: CharacterState } {
    // `resolveEquipment` already answers for both kinds of cultivator: an
    // `inventory` lookup for a player, the derived loadout for a bot.
    const attackerStats = statsOf(attacker, resolveEquipment(attacker, this.ctx.inventory));
    const defenderStats = statsOf(defender, resolveEquipment(defender, this.ctx.inventory));

    const battle = runBattle(
      [characterCombatant(attacker, attackerStats)],
      [characterCombatant(defender, defenderStats)],
      seed,
      world,
    );

    const attackerWon = battle.winner === 'A';
    const draw = battle.winner === 'draw';
    const score = draw ? 0.5 : attackerWon ? 1 : 0;
    const delta = eloDelta(attacker.arenaRating, defender.arenaRating, score);

    const nextAttacker: CharacterState = {
      ...attacker,
      arenaRating: Math.max(0, attacker.arenaRating + delta),
      arenaWins: attacker.arenaWins + (attackerWon ? 1 : 0),
      arenaLosses: attacker.arenaLosses + (!attackerWon && !draw ? 1 : 0),
      dailyCounters: { ...attacker.dailyCounters, arena: attacker.dailyCounters.arena + 1 },
    };
    const nextDefender: CharacterState = {
      ...defender,
      arenaRating: Math.max(0, defender.arenaRating - delta),
      arenaWins: defender.arenaWins + (!attackerWon && !draw ? 1 : 0),
      arenaLosses: defender.arenaLosses + (attackerWon ? 1 : 0),
    };

    this.ctx.battles.insert({
      kind: 'arena',
      attackerId: attacker.id,
      attackerName: attacker.name,
      defenderId: defender.id,
      defenderName: defender.name,
      winnerId: draw ? null : attackerWon ? attacker.id : defender.id,
      ratingDelta: delta,
      foughtAt: now,
      battle,
    });
    this.ctx.counters.bump('arena', now);

    if (!defender.isBot) {
      this.ctx.realtime.toCharacter(defender.id, 'arena:challenged', {
        attackerId: attacker.id,
        attackerName: attacker.name,
        attackerStageName: stageName(attacker.stageIndex),
        attackerAvatarArt: attacker.avatarArt,
        defenderLost: attackerWon,
        ratingDelta: -delta,
        battle,
        foughtAt: now,
      });
    }

    return { attacker: nextAttacker, defender: nextDefender };
  }

  /** Full cultivation multiplier a bot is running at right now, for the panel. */
  multiplierFor(params: BotParams, at: number): number {
    return botCultivationMultiplier(params, hourOfDay(at));
  }
}
