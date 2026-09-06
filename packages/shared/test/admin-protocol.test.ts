import { describe, expect, it } from 'vitest';
import {
  AdminStatsSchema,
  BotGenerateRequestSchema,
  BotTickStatsSchema,
  INVITE_MAX_USES_LIMIT,
  InviteCreateRequestSchema,
  InviteSchema,
  REALM_COUNT,
  STAGE_COUNT,
} from '../src/index.js';

/**
 * The 后台 wire shapes.
 *
 * These four carry numbers the panel *displays* rather than sends, so the risk
 * is not a rejected request but a silently trimmed field: zod strips whatever
 * the schema does not declare, and a stat the operator cannot see is a stat
 * that does not exist.
 */

const TICK = {
  at: 1_700_000_000_000,
  bots: 200,
  created: 3,
  breakthroughs: 7,
  tribulations: 1,
  battles: 12,
  chats: 4,
  durationMs: 9,
};

function statsFixture() {
  return {
    players: { total: 2, online: 1, banned: 0, newToday: 2 },
    bots: {
      total: 3,
      byArchetype: { 'bot-sanxiu': 3 },
      byRealm: new Array<number>(REALM_COUNT).fill(0),
      byStage: new Array<number>(STAGE_COUNT).fill(0),
      atPerfection: 0,
    },
    activity: {
      battlesToday: 0,
      dungeonRunsToday: 0,
      arenaMatchesToday: 0,
      breakthroughsToday: 0,
      chatMessagesToday: 0,
    },
    server: {
      startedAt: 1,
      uptimeSec: 60,
      serverTime: 61_000,
      lastBotTickAt: 60_000,
      version: '0.1.0',
    },
  };
}

describe('邀请码 carries its own redemption count', () => {
  const base = {
    code: 'BCDFGH',
    createdAt: 1,
    createdBy: 'admin',
    usedBy: null,
    usedAt: null,
    expiresAt: null,
    note: '',
  };

  it('keeps maxUses and uses on the wire', () => {
    const parsed = InviteSchema.parse({ ...base, maxUses: 3, uses: 1 });
    expect(parsed.maxUses).toBe(3);
    expect(parsed.uses).toBe(1);
  });

  it('accepts -1 as the unlimited code the INVITE_CODE bootstrap mints', () => {
    expect(InviteSchema.parse({ ...base, maxUses: -1, uses: 42 }).maxUses).toBe(-1);
  });

  it('rejects an invite that answers without the counters', () => {
    expect(InviteSchema.safeParse(base).success).toBe(false);
  });

  it('mints single-use codes unless asked otherwise', () => {
    expect(InviteCreateRequestSchema.parse({}).maxUses).toBe(1);
    expect(InviteCreateRequestSchema.parse({ maxUses: 3 }).maxUses).toBe(3);
    expect(InviteCreateRequestSchema.parse({ maxUses: -1 }).maxUses).toBe(-1);
  });

  it('refuses a zero, a fractional and an over-the-ceiling use count', () => {
    expect(InviteCreateRequestSchema.safeParse({ maxUses: 0 }).success).toBe(false);
    expect(InviteCreateRequestSchema.safeParse({ maxUses: -2 }).success).toBe(false);
    expect(InviteCreateRequestSchema.safeParse({ maxUses: 1.5 }).success).toBe(false);
    expect(
      InviteCreateRequestSchema.safeParse({ maxUses: INVITE_MAX_USES_LIMIT + 1 }).success,
    ).toBe(false);
    expect(InviteCreateRequestSchema.safeParse({ maxUses: INVITE_MAX_USES_LIMIT }).success).toBe(
      true,
    );
  });
});

describe('批量生成 takes per-cohort archetype weights', () => {
  it('accepts a weight map and leaves it out when not sent', () => {
    const weighted = BotGenerateRequestSchema.parse({
      count: 20,
      archetypeWeights: { 'bot-sanxiu': 60, 'bot-moxiu': 40 },
    });
    expect(weighted.archetypeWeights).toEqual({ 'bot-sanxiu': 60, 'bot-moxiu': 40 });
    expect(BotGenerateRequestSchema.parse({ count: 20 }).archetypeWeights).toBeUndefined();
  });

  it('allows a zero weight — that is how an archetype is excluded', () => {
    const parsed = BotGenerateRequestSchema.parse({
      count: 5,
      archetypeWeights: { 'bot-sanxiu': 1, 'bot-tianjiao': 0 },
    });
    expect(parsed.archetypeWeights?.['bot-tianjiao']).toBe(0);
  });

  it('rejects a negative weight', () => {
    expect(
      BotGenerateRequestSchema.safeParse({ count: 5, archetypeWeights: { a: -1 } }).success,
    ).toBe(false);
  });

  it('still applies the stage defaults alongside a weight map', () => {
    const parsed = BotGenerateRequestSchema.parse({ count: 5, archetypeWeights: { a: 1 } });
    expect(parsed.minStageIndex).toBe(0);
    expect(parsed.maxStageIndex).toBe(11);
  });
});

describe('后台统计', () => {
  it('carries a 36-stage histogram beside the nine realms', () => {
    const fixture = statsFixture();
    fixture.bots.byStage[3] = 2;
    fixture.bots.byStage[0] = 1;
    fixture.bots.byRealm[0] = 3;
    fixture.bots.atPerfection = 2;

    const parsed = AdminStatsSchema.parse(fixture);
    expect(parsed.bots.byStage).toHaveLength(STAGE_COUNT);
    expect(parsed.bots.byRealm).toHaveLength(REALM_COUNT);
    expect(parsed.bots.atPerfection).toBe(2);
  });

  it('rejects a stats payload that omits the stage histogram', () => {
    const fixture = statsFixture();
    const bots: Record<string, unknown> = { ...fixture.bots };
    delete bots.byStage;
    expect(AdminStatsSchema.safeParse({ ...fixture, bots }).success).toBe(false);
  });

  it('reports the last tick in full, and omits it before the loop has run', () => {
    const fixture = statsFixture();
    const withTick = AdminStatsSchema.parse({
      ...fixture,
      server: { ...fixture.server, lastTick: TICK },
    });
    expect(withTick.server.lastTick).toEqual(TICK);
    expect(AdminStatsSchema.parse(fixture).server.lastTick).toBeUndefined();
  });

  it('validates the tick block on its own', () => {
    expect(BotTickStatsSchema.parse(TICK)).toEqual(TICK);
    const { durationMs: _dropped, ...missing } = TICK;
    expect(BotTickStatsSchema.safeParse(missing).success).toBe(false);
  });
});
