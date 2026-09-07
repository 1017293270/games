import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BREAKTHROUGH_BASE_CHANCE,
  breakthroughChance,
  getStage,
  realmOf,
  zoneFor,
  ZONE_BOT_MIN_STAY_MS,
} from '@xianxia/shared';
import type { CharacterState } from '@xianxia/shared';
import { eloDelta, insightWorld, ZONE_ENTER_CHANCE } from '../src/engine/bots/engine.js';
import { generateBots } from '../src/engine/bots/generate.js';
import { BOT_CHAT_TEMPLATES, renderBotLine } from '../src/engine/bots/chatter.js';
import type { ZoneEnterResult, ZoneService, ZoneStats } from '../src/engine/zone/api.js';
import { createHarness, makePlayer, type Harness } from './helpers.js';

/**
 * Records where the engine sent each bot. The field itself is not simulated —
 * what is under test is the tick's decision to walk on or off one.
 */
class FakeZoneService implements ZoneService {
  readonly botEnters: { id: string; zoneId: string; stageIndex: number; at: number }[] = [];
  readonly botRetreats: { id: string; at: number }[] = [];
  readonly standing = new Map<string, string>();

  enter(): ZoneEnterResult {
    return { ok: false, code: 'NOT_FOUND', message: '战斗大地图尚未开放' };
  }

  resume(): ZoneEnterResult | null {
    return null;
  }

  retreat(): boolean {
    return false;
  }

  enterBot(state: CharacterState, zoneId: string, now: number): boolean {
    this.botEnters.push({ id: state.id, zoneId, stageIndex: state.stageIndex, at: now });
    this.standing.set(state.id, zoneId);
    return true;
  }

  retreatBot(characterId: string, now: number): boolean {
    this.botRetreats.push({ id: characterId, at: now });
    return this.standing.delete(characterId);
  }

  zoneOf(characterId: string): string | null {
    return this.standing.get(characterId) ?? null;
  }

  step(): void {}
  flush(): void {}
  start(): void {}
  stop(): void {}
  stats(): ZoneStats[] {
    return [];
  }
}

describe('bot engine', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('tops the population up to world.botCount on the first tick', () => {
    h.ctx.settings.patch({ botCount: 25 });
    expect(h.ctx.characters.countBots()).toBe(0);

    const stats = h.ctx.bots.tick(h.clock.now());
    expect(stats.created).toBe(25);
    expect(h.ctx.characters.countBots()).toBe(25);
    expect(stats.bots).toBe(25);

    // A second tick creates nothing more.
    expect(h.ctx.bots.tick(h.clock.now()).created).toBe(0);
  });

  it('tops up again when botCount is raised, and never deletes when lowered', () => {
    h.ctx.settings.patch({ botCount: 10 });
    h.ctx.bots.tick(h.clock.now());
    expect(h.ctx.characters.countBots()).toBe(10);

    h.ctx.settings.patch({ botCount: 18 });
    h.clock.advance(30_000);
    expect(h.ctx.bots.tick(h.clock.now()).created).toBe(8);
    expect(h.ctx.characters.countBots()).toBe(18);

    h.ctx.settings.patch({ botCount: 4 });
    h.clock.advance(30_000);
    expect(h.ctx.bots.tick(h.clock.now()).created).toBe(0);
    expect(h.ctx.characters.countBots()).toBe(18);
  });

  it('gives every bot a distinct 道号, an archetype and a rolled spirit root', () => {
    h.ctx.settings.patch({ botCount: 60 });
    h.ctx.bots.tick(h.clock.now());

    const bots = h.ctx.characters.allBots();
    expect(bots).toHaveLength(60);
    expect(new Set(bots.map((b) => b.name)).size).toBe(60);
    for (const bot of bots) {
      expect(bot.isBot).toBe(true);
      expect(bot.botParams).not.toBeNull();
      expect(bot.botArchetypeId).not.toBeNull();
      expect(bot.userId).toBe('bot');
      expect(['mortal', 'rare', 'heaven']).toContain(bot.spiritRoot.quality);
      expect(bot.powerScore).toBeGreaterThan(0);
      expect(bot.skillSlots.filter(Boolean).length).toBeGreaterThan(0);
    }
    // The population skews low, the way a real ladder does.
    expect(Math.min(...bots.map((b) => b.stageIndex))).toBeLessThan(4);
  });

  it('advances 修为 across ticks at the archetype rate', () => {
    h.ctx.settings.patch({ botCount: 12, botTickSeconds: 30 });
    h.ctx.bots.tick(h.clock.now());

    const before = h.ctx.characters.allBots().map((b) => ({
      id: b.id,
      stageIndex: b.stageIndex,
      exp: b.exp,
    }));

    h.clock.advance(20 * 60_000);
    h.ctx.bots.tick(h.clock.now());

    const after = new Map(h.ctx.characters.allBots().map((b) => [b.id, b]));
    let advanced = 0;
    for (const bot of before) {
      const now = after.get(bot.id)!;
      const grew =
        now.stageIndex > bot.stageIndex || (now.stageIndex === bot.stageIndex && now.exp > bot.exp);
      if (grew) advanced += 1;
    }
    // Everything except a bot parked at 圆满 should have moved.
    expect(advanced).toBeGreaterThanOrEqual(before.length - 2);
  });

  it('a faster archetype outgrows a slower one over the same window', () => {
    const now = h.clock.now();
    const [tianjiao] = generateBots(
      h.ctx,
      { count: 1, archetypeId: 'bot-tianjiao', minStageIndex: 0, maxStageIndex: 0, seed: 7 },
      now,
    );
    const [sanxiu] = generateBots(
      h.ctx,
      { count: 1, archetypeId: 'bot-sanxiu', minStageIndex: 0, maxStageIndex: 0, seed: 9 },
      now,
    );

    // Level the starting line: the generator lands bots mid-stage.
    for (const bot of [tianjiao!, sanxiu!]) {
      h.ctx.characters.save({ ...bot, stageIndex: 0, exp: 0, lastSettledAt: now });
    }

    h.clock.advance(3 * 60_000);
    h.ctx.bots.tick(h.clock.now());

    const fast = h.ctx.characters.byId(tianjiao!.id)!;
    const slow = h.ctx.characters.byId(sanxiu!.id)!;
    const progress = (c: CharacterState): number =>
      c.stageIndex * 1e9 + c.exp / getStage(c.stageIndex).expRequired;
    expect(progress(fast)).toBeGreaterThan(progress(slow));
  });

  it('breaks a parked bot through 圆满 and broadcasts the notice', () => {
    const notices: { text: string }[] = [];
    h.ctx.realtime.attach({
      to: () => ({
        emit: (event: string, payload: unknown) => {
          if (event === 'system:notice') notices.push(payload as { text: string });
        },
      }),
    } as never);

    const now = h.clock.now();
    const [bot] = generateBots(
      h.ctx,
      { count: 1, archetypeId: 'bot-kuxiu', minStageIndex: 3, maxStageIndex: 3, seed: 5 },
      now,
    );
    h.ctx.characters.save({
      ...bot!,
      stageIndex: 3,
      exp: getStage(3).expRequired,
      lastSettledAt: now,
    });
    h.ctx.settings.patch({ botCount: 1, breakthroughChanceMultiplier: 10 });

    let broke = false;
    for (let i = 0; i < 12 && !broke; i += 1) {
      h.clock.advance(60_000);
      const current = h.ctx.characters.byId(bot!.id)!;
      h.ctx.characters.save({
        ...current,
        stageIndex: 3,
        exp: getStage(3).expRequired,
        lastSettledAt: h.clock.now(),
      });
      h.ctx.bots.tick(h.clock.now());
      broke = h.ctx.characters.byId(bot!.id)!.stageIndex === 4;
    }

    expect(broke).toBe(true);
    expect(notices.some((n) => n.text.includes('筑基·前期'))).toBe(true);
  });

  it('folds insight into the breakthrough odds without breaking the 95% ceiling', () => {
    const world = { breakthroughChanceMultiplier: 1 };
    const stageIndex = 3;
    const base = BREAKTHROUGH_BASE_CHANCE[realmOf(stageIndex)]!;

    const params = {
      talent: 1,
      diligence: 1,
      insight: 0.15,
      aggression: 0,
      activeHours: [0, 24] as [number, number],
      explorePref: 'cultivate' as const,
    };
    const adjusted = insightWorld(world, params, stageIndex);
    expect(breakthroughChance(stageIndex, 0, adjusted)).toBeCloseTo(base + 0.15, 6);

    const huge = insightWorld(world, { ...params, insight: 0.5 }, stageIndex);
    expect(breakthroughChance(stageIndex, 0, huge)).toBeLessThanOrEqual(0.95);

    // No insight leaves the world settings untouched.
    expect(insightWorld(world, { ...params, insight: 0 }, stageIndex)).toBe(world);
  });

  it('records arena fights, moves both ratings and notifies a human defender', async () => {
    const challenged: unknown[] = [];
    const player = await makePlayer(h);
    h.ctx.presence.join(player.characterId);
    h.ctx.realtime.attach({
      to: () => ({
        emit: (event: string, payload: unknown) => {
          if (event === 'arena:challenged') challenged.push(payload);
        },
      }),
    } as never);

    // A world of 魔修 (aggression 0.8) guarantees challenges get thrown.
    h.ctx.settings.patch({ botCount: 0 });
    generateBots(
      h.ctx,
      { count: 20, archetypeId: 'bot-moxiu', minStageIndex: 0, maxStageIndex: 1, seed: 3 },
      h.clock.now(),
    );

    let fought = 0;
    for (let i = 0; i < 8; i += 1) {
      h.clock.advance(60_000);
      fought += h.ctx.bots.tick(h.clock.now()).battles;
    }

    expect(fought).toBeGreaterThan(0);
    expect(h.ctx.battles.countSince(0, 'arena')).toBe(fought);

    const ratings = h.ctx.characters.allBots().map((b) => b.arenaRating);
    expect(new Set(ratings).size).toBeGreaterThan(1);
    expect(challenged.length).toBeGreaterThan(0);
  });

  it('rates an upset heavier than an expected win', () => {
    expect(eloDelta(1000, 1000, 1)).toBe(16);
    expect(eloDelta(1000, 1400, 1)).toBeGreaterThan(eloDelta(1400, 1000, 1));
    expect(eloDelta(1000, 1000, 0)).toBe(-16);
    expect(eloDelta(1000, 1000, 0.5)).toBe(0);
  });

  it('speaks in world chat within the per-bot cooldown and per-tick ceiling', () => {
    h.ctx.settings.patch({ botCount: 120 });
    // The seeding tick can already produce lines, so it counts too.
    let chats = h.ctx.bots.tick(h.clock.now()).chats;

    for (let i = 0; i < 10; i += 1) {
      h.clock.advance(60_000);
      const stats = h.ctx.bots.tick(h.clock.now());
      expect(stats.chats).toBeLessThanOrEqual(3);
      chats += stats.chats;
    }
    expect(chats).toBeGreaterThan(0);
    expect(h.ctx.chat.history('world', 200).length).toBe(chats);
  });

  it('renders every chat template without leaving a placeholder behind', () => {
    const bot = {
      name: '李清子',
      stageIndex: 9,
    } as CharacterState;
    for (const template of BOT_CHAT_TEMPLATES) {
      const line = renderBotLine(template, bot);
      expect(line).not.toContain('{');
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('heals a raided bot back over raidRecoverMinutes', () => {
    const now = h.clock.now();
    const [bot] = generateBots(
      h.ctx,
      { count: 1, archetypeId: 'bot-yinshi', minStageIndex: 2, maxStageIndex: 2, seed: 11 },
      now,
    );
    h.ctx.characters.save({ ...bot!, hpPercent: 0, lastSettledAt: now });
    h.ctx.settings.patch({ botCount: 1, raidRecoverMinutes: 30 });

    h.clock.advance(15 * 60_000);
    h.ctx.bots.tick(h.clock.now());
    const half = h.ctx.characters.byId(bot!.id)!.hpPercent;
    expect(half).toBeCloseTo(0.5, 2);

    h.clock.advance(20 * 60_000);
    h.ctx.bots.tick(h.clock.now());
    expect(h.ctx.characters.byId(bot!.id)!.hpPercent).toBe(1);
  });

  /** A world of one archetype, low enough that 青云山 is the only map for it. */
  const seedCohort = (
    zones: FakeZoneService,
    archetypeId: string,
    count: number,
  ): CharacterState[] => {
    h.ctx.zones = zones;
    h.ctx.settings.patch({ botCount: 0 });
    return generateBots(
      h.ctx,
      { count, archetypeId, minStageIndex: 0, maxStageIndex: 1, seed: 17 },
      h.clock.now(),
    );
  };

  /** A world of 散修, awake 06:00-22:00 UTC. */
  const seedWanderers = (zones: FakeZoneService, count = 20): CharacterState[] =>
    seedCohort(zones, 'bot-sanxiu', count);

  it('sends 散修 out to the 战斗大地图 their 境界 belongs on', () => {
    const zones = new FakeZoneService();
    seedWanderers(zones);
    // Noon UTC is inside 散修's 06:00-22:00 window.
    expect(new Date(h.clock.now()).getUTCHours()).toBe(12);

    for (let i = 0; i < 4; i += 1) {
      h.clock.advance(60_000);
      h.ctx.bots.tick(h.clock.now());
    }

    expect(zones.botEnters.length).toBeGreaterThan(0);
    for (const entry of zones.botEnters) {
      expect(entry.zoneId).toBe(zoneFor(entry.stageIndex).id);
      expect(entry.zoneId).toBe('map-qingyun-mountain');
    }
    // Nobody standing on a field is sent to one again.
    const ids = zones.botEnters.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('calls every bot home once its active window closes', () => {
    const zones = new FakeZoneService();
    const wanderers = seedWanderers(zones, 6);
    for (const bot of wanderers) zones.standing.set(bot.id, 'map-qingyun-mountain');

    // 03:00 UTC is outside 散修's window, so the map empties whatever they roll.
    h.clock.set(Date.UTC(2026, 0, 2, 3, 0, 0));
    h.ctx.bots.tick(h.clock.now());

    expect(zones.botRetreats.map((r) => r.id).sort()).toEqual(wanderers.map((b) => b.id).sort());
    expect(zones.standing.size).toBe(0);
    expect(zones.botEnters).toHaveLength(0);
  });

  it('fills a map at an hour when nobody would ever roll 历练', () => {
    const zones = new FakeZoneService();
    // 02:00 UTC: 散修 and 隐士 are asleep, and every archetype still awake has
    // an `explorePref` of 'cultivate' or 'arena'. Gating 进图 on the 历练
    // action left the maps empty from 22:00 to 06:00 UTC on a cold world.
    h.clock.set(Date.UTC(2026, 0, 2, 2, 0, 0));
    const bots = seedCohort(zones, 'bot-kuxiu', 120);

    h.clock.advance(30_000);
    h.ctx.bots.tick(h.clock.now());

    // One tick, so nobody has had a chance to roll twice.
    expect(zones.botEnters.length).toBeGreaterThan(bots.length * (ZONE_ENTER_CHANCE - 0.15));
    expect(zones.botEnters.length).toBeLessThan(bots.length * (ZONE_ENTER_CHANCE + 0.15));
    for (const entry of zones.botEnters) expect(entry.zoneId).toBe('map-qingyun-mountain');
  });

  it('still leaves the map alone while a bot is off-hours', () => {
    const zones = new FakeZoneService();
    // 隐士 keeps a 04:00-10:00 UTC window, so at 02:00 the flat 进图 roll never
    // gets asked.
    h.clock.set(Date.UTC(2026, 0, 2, 2, 0, 0));
    seedCohort(zones, 'bot-yinshi', 60);

    for (let i = 0; i < 3; i += 1) {
      h.clock.advance(30_000);
      h.ctx.bots.tick(h.clock.now());
    }
    expect(zones.botEnters).toHaveLength(0);
  });

  it('leaves a bot on the field until it has put its ten minutes in', () => {
    const zones = new FakeZoneService();
    seedWanderers(zones);

    h.clock.advance(60_000);
    h.ctx.bots.tick(h.clock.now());
    expect(zones.botEnters.length).toBeGreaterThan(0);

    // Three more minutes, well inside ZONE_BOT_MIN_STAY_MS: nobody goes home.
    for (let i = 0; i < 3; i += 1) {
      h.clock.advance(60_000);
      h.ctx.bots.tick(h.clock.now());
    }
    expect(zones.botRetreats).toHaveLength(0);

    // Past the floor, the ones that settle down to cultivate start drifting off.
    let rounds = 0;
    while (zones.botRetreats.length === 0 && rounds < 4) {
      h.clock.advance(ZONE_BOT_MIN_STAY_MS);
      h.ctx.bots.tick(h.clock.now());
      rounds += 1;
    }
    expect(zones.botRetreats.length).toBeGreaterThan(0);
  });

  it('runs a 200-bot round in well under 200ms', () => {
    h.ctx.settings.patch({ botCount: 200 });
    h.ctx.bots.tick(h.clock.now());
    expect(h.ctx.characters.countBots()).toBe(200);

    const durations: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(30_000);
      durations.push(h.ctx.bots.tick(h.clock.now()).durationMs);
    }

    const worst = Math.max(...durations);
    // Logged so a regression shows the real number rather than just a failure.
    console.log(`200-bot tick durations (ms): ${durations.join(', ')}`);
    expect(worst).toBeLessThan(200);
  });

  it('re-times the loop when botTickSeconds changes', () => {
    h.ctx.settings.patch({ botCount: 1, botTickSeconds: 3600 });
    h.ctx.bots.start();
    h.ctx.settings.patch({ botTickSeconds: 5 });
    // The engine reschedules on the settings event; stopping must be clean.
    h.ctx.bots.stop();
    expect(h.ctx.bots.lastTick).toBeNull();
  });
});
