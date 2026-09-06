import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  API,
  API_ERROR_CODES,
  API_ERROR_STATUS,
  API_PREFIX,
  ApiErrorCodeSchema,
  ApiFailureSchema,
  allEndpoints,
  apiResponse,
  buildPath,
  fail,
  ok,
  paginated,
} from '../src/protocol/index.js';
import {
  CLIENT_EVENT_SCHEMAS,
  CLIENT_TO_SERVER_EVENTS,
  ChatSendSchema,
  HandshakeAuthSchema,
  ROOMS,
  SERVER_TO_CLIENT_EVENTS,
  SystemNoticeSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../src/protocol/events.js';
import {
  BreakthroughRequestSchema,
  CreateCharacterRequestSchema,
} from '../src/protocol/character.js';
import { RegisterRequestSchema } from '../src/protocol/auth.js';
import { BotGenerateRequestSchema } from '../src/protocol/admin.js';
import { CharacterStateSchema, PublicProfileSchema } from '../src/domain/character.js';
import {
  DEFAULT_WORLD_SETTINGS,
  WorldSettingsPatchSchema,
  WorldSettingsSchema,
  applyWorldSettingsPatch,
  hydrateWorldSettings,
} from '../src/domain/world.js';
import { BattleResultSchema } from '../src/combat/types.js';
import { simulateBattle } from '../src/combat/engine.js';
import { baseStatsForStage, powerScore } from '../src/cultivation/attributes.js';
import { stageName } from '../src/cultivation/realms.js';

const T0 = 1_700_000_000_000;

describe('endpoint registry', () => {
  const endpoints = allEndpoints();

  it('declares every documented group', () => {
    expect(Object.keys(API).sort()).toEqual(
      [
        'admin',
        'arena',
        'character',
        'explore',
        'inventory',
        'auth',
        'npc',
        'party',
        'quests',
        'raid',
        'shop',
        'social',
      ].sort(),
    );
  });

  it('registers a substantial surface', () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(50);
  });

  it('prefixes every path with /api', () => {
    for (const { endpoint } of endpoints) {
      expect(endpoint.path.startsWith(API_PREFIX)).toBe(true);
    }
  });

  it('has no duplicate method+path pairs', () => {
    const seen = new Set<string>();
    for (const { endpoint, group, name } of endpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      expect(seen.has(key), `duplicate route ${key} at ${group}.${name}`).toBe(false);
      seen.add(key);
    }
  });

  it('gives every endpoint a zod request and response schema', () => {
    for (const { endpoint, group, name } of endpoints) {
      expect(endpoint.request, `${group}.${name}`).toBeInstanceOf(z.ZodType);
      expect(endpoint.response, `${group}.${name}`).toBeInstanceOf(z.ZodType);
      expect(endpoint.summary.length).toBeGreaterThan(0);
    }
  });

  it('only lists known error codes', () => {
    for (const { endpoint } of endpoints) {
      for (const code of endpoint.errors) {
        expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true);
      }
    }
  });

  it('guards every admin route behind admin auth', () => {
    for (const [name, def] of Object.entries(API.admin)) {
      if (name === 'login') continue;
      expect(def.auth, name).toBe('admin');
      expect(def.path.startsWith(`${API_PREFIX}/admin`)).toBe(true);
    }
  });

  it('leaves only registration, login and admin login unauthenticated', () => {
    const open = endpoints.filter((e) => e.endpoint.auth === 'none').map((e) => e.endpoint.path);
    expect(open.sort()).toEqual(
      [`${API_PREFIX}/auth/register`, `${API_PREFIX}/auth/login`, `${API_PREFIX}/admin/login`].sort(),
    );
  });

  it('maps every error code to an HTTP status', () => {
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(API_ERROR_STATUS[code]).toBeLessThan(600);
    }
  });
});

describe('response envelope', () => {
  it('accepts a success payload', () => {
    const schema = apiResponse(z.object({ n: z.number() }));
    expect(schema.parse(ok({ n: 1 }))).toEqual({ ok: true, data: { n: 1 } });
  });

  it('accepts a failure payload', () => {
    const schema = apiResponse(z.object({ n: z.number() }));
    const parsed = schema.parse(fail('NOT_FOUND', '未找到'));
    expect(parsed).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: '未找到' } });
  });

  it('carries validation details when supplied', () => {
    const failure = fail('VALIDATION_ERROR', '参数错误', { field: 'name' });
    expect(ApiFailureSchema.parse(failure).error.details).toEqual({ field: 'name' });
  });

  it('rejects an unknown error code', () => {
    expect(ApiFailureSchema.safeParse({ ok: false, error: { code: 'NOPE', message: 'x' } }).success)
      .toBe(false);
  });

  it('rejects a success payload whose data does not match', () => {
    const schema = apiResponse(z.object({ n: z.number() }));
    expect(schema.safeParse({ ok: true, data: { n: 'not a number' } }).success).toBe(false);
  });

  it('builds a page envelope', () => {
    const schema = paginated(z.object({ id: z.string() }));
    expect(
      schema.parse({ items: [{ id: 'a' }], page: 1, pageSize: 20, total: 1, hasMore: false }),
    ).toMatchObject({ total: 1 });
  });
});

describe('path building', () => {
  it('substitutes params', () => {
    expect(buildPath(`${API_PREFIX}/cultivators/:id`, { id: 'abc' })).toBe('/api/cultivators/abc');
    expect(buildPath(`${API_PREFIX}/shop/:shopId`, { shopId: 'shop-yaowang' })).toBe(
      '/api/shop/shop-yaowang',
    );
  });

  it('url-encodes values', () => {
    expect(buildPath('/api/x/:v', { v: 'a b/c' })).toBe('/api/x/a%20b%2Fc');
  });

  it('throws on a missing param', () => {
    expect(() => buildPath('/api/x/:id')).toThrow(/missing param/);
  });

  it('leaves param-free paths alone', () => {
    expect(buildPath(`${API_PREFIX}/character`)).toBe('/api/character');
  });
});

describe('request schemas parse realistic payloads', () => {
  it('accepts a registration with an invite code', () => {
    expect(
      RegisterRequestSchema.parse({
        username: 'daoyou_01',
        password: 'hunter2hunter',
        inviteCode: 'QINGYUN-2026',
      }).username,
    ).toBe('daoyou_01');
  });

  it('rejects a bad username', () => {
    expect(RegisterRequestSchema.safeParse({ username: 'a', password: 'longenough' }).success)
      .toBe(false);
    expect(
      RegisterRequestSchema.safeParse({ username: 'has spaces', password: 'longenough' }).success,
    ).toBe(false);
  });

  it('accepts a Chinese character name', () => {
    const parsed = CreateCharacterRequestSchema.parse({
      name: '李清子',
      avatarArt: 'avatar/m01',
      gender: 'male',
    });
    expect(parsed.name).toBe('李清子');
  });

  it('rejects an unknown avatar', () => {
    expect(
      CreateCharacterRequestSchema.safeParse({
        name: '李清子',
        avatarArt: 'avatar/zz99',
        gender: 'male',
      }).success,
    ).toBe(false);
  });

  it('defaults breakthrough pills to zero and caps them', () => {
    expect(BreakthroughRequestSchema.parse({}).pills).toBe(0);
    expect(BreakthroughRequestSchema.safeParse({ pills: 5 }).success).toBe(false);
  });

  it('applies bot generation defaults', () => {
    const parsed = BotGenerateRequestSchema.parse({ count: 50 });
    expect(parsed.minStageIndex).toBe(0);
    expect(parsed.maxStageIndex).toBe(11);
  });
});

describe('domain payloads round-trip', () => {
  const character = {
    id: 'char-1',
    userId: 'user-1',
    name: '李清子',
    gender: 'male',
    avatarArt: 'avatar/m01',
    isBot: false,
    botArchetypeId: null,
    botParams: null,
    spiritRoot: { element: 'fire', quality: 'heaven' },
    stageIndex: 7,
    exp: 1234.5,
    spiritStones: 5000,
    skillSlots: ['skill-fire-1', 'skill-earth-1', null, null],
    learnedSkillIds: ['skill-fire-1', 'skill-earth-1'],
    techniqueId: 'tech-qingyun',
    learnedTechniqueIds: ['tech-qingyun'],
    equipment: { treasure: 'inv-1', robe: null, accessory: null, pet: null },
    buffs: [{ id: 'b1', itemId: 'pill-qi', bonus: 0.3, expiresAt: T0 + 3600_000 }],
    hpPercent: 0.8,
    protectedUntil: 0,
    chapter: 2,
    quests: [
      {
        questId: 'quest-c1-01',
        state: 'claimed',
        counters: [1],
        acceptedAt: T0,
        claimedAt: T0 + 1000,
      },
    ],
    flags: { 'met-zhenshou': true },
    lastSettledAt: T0,
    lastSeenAt: T0,
    createdAt: T0 - 86400_000,
    dailyCounters: { date: '2023-11-14', dungeon: 1, arena: 3, gatherAt: { 'map-qingyun-mountain': T0 } },
    arenaRating: 1180,
    arenaWins: 12,
    arenaLosses: 4,
    powerScore: 4210,
  };

  it('parses a full CharacterState', () => {
    const parsed = CharacterStateSchema.parse(character);
    expect(parsed.name).toBe('李清子');
    expect(parsed.skillSlots).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(CharacterStateSchema.parse(parsed)))).toEqual(parsed);
  });

  it('rejects an out-of-range stage index', () => {
    expect(CharacterStateSchema.safeParse({ ...character, stageIndex: 36 }).success).toBe(false);
    expect(CharacterStateSchema.safeParse({ ...character, stageIndex: -1 }).success).toBe(false);
  });

  it('rejects the wrong number of skill slots', () => {
    expect(CharacterStateSchema.safeParse({ ...character, skillSlots: [null, null] }).success)
      .toBe(false);
  });

  it('parses a PublicProfile', () => {
    const stats = baseStatsForStage(7);
    const profile = {
      id: 'char-1',
      name: '李清子',
      gender: 'male',
      avatarArt: 'avatar/m01',
      isBot: false,
      stageIndex: 7,
      stageName: stageName(7),
      spiritRoot: { element: 'fire', quality: 'heaven' },
      powerScore: powerScore(stats),
      stats,
      techniqueName: '青云诀',
      skillIds: ['skill-fire-1'],
      equipmentItemIds: ['treasure-sword'],
      equipment: [
        {
          slot: 'treasure',
          itemId: 'treasure-sword',
          name: '青锋剑',
          grade: 'mortal',
          art: 'item/treasure-sword',
        },
      ],
      arenaRating: 1180,
      arenaWins: 12,
      arenaLosses: 4,
      online: true,
      lastSeenAt: T0,
      protectedUntil: 0,
    };
    expect(PublicProfileSchema.parse(profile).stageName).toBe('筑基·圆满');
  });

  it('parses the default world settings and a partial patch', () => {
    expect(WorldSettingsSchema.parse(DEFAULT_WORLD_SETTINGS)).toEqual(DEFAULT_WORLD_SETTINGS);
    expect(DEFAULT_WORLD_SETTINGS.offlineCapHours).toBe(12);
    expect(DEFAULT_WORLD_SETTINGS.botTickSeconds).toBe(30);
    expect(DEFAULT_WORLD_SETTINGS.botCount).toBe(200);
    expect(DEFAULT_WORLD_SETTINGS.inviteRequired).toBe(true);
  });

  it('treats a settings patch as a true partial', () => {
    // A patch must never carry keys the caller did not send, or a partial PUT
    // would silently reset every other knob to its default.
    expect(WorldSettingsPatchSchema.parse({ botCount: 500 })).toEqual({ botCount: 500 });
    expect(WorldSettingsPatchSchema.parse({})).toEqual({});

    const patched = applyWorldSettingsPatch(DEFAULT_WORLD_SETTINGS, { botCount: 500 });
    expect(patched.botCount).toBe(500);
    expect(patched.offlineCapHours).toBe(DEFAULT_WORLD_SETTINGS.offlineCapHours);
    expect(patched.inviteRequired).toBe(DEFAULT_WORLD_SETTINGS.inviteRequired);
  });

  it('hydrates a partially stored config from the defaults', () => {
    expect(hydrateWorldSettings({ botCount: 7 })).toEqual({
      ...DEFAULT_WORLD_SETTINGS,
      botCount: 7,
    });
    expect(hydrateWorldSettings({})).toEqual(DEFAULT_WORLD_SETTINGS);
    expect(hydrateWorldSettings(null)).toEqual(DEFAULT_WORLD_SETTINGS);
  });

  it('rejects settings outside their guard rails', () => {
    expect(WorldSettingsSchema.safeParse({ ...DEFAULT_WORLD_SETTINGS, botCount: -1 }).success)
      .toBe(false);
    expect(
      WorldSettingsSchema.safeParse({ ...DEFAULT_WORLD_SETTINGS, offlineCapHours: 10_000 }).success,
    ).toBe(false);
  });

  it('parses a real BattleResult produced by the engine', () => {
    const result = simulateBattle({
      seed: 4242,
      teamA: [{ id: 'a', name: '李清子', stats: baseStatsForStage(6), skills: ['skill-fire-1'] }],
      teamB: [{ id: 'b', name: '青云狼', stats: baseStatsForStage(5), skills: ['skill-metal-1'] }],
    });
    const parsed = BattleResultSchema.parse(result);
    expect(parsed.log.length).toBeGreaterThan(0);
    // JSON round-trip must be lossless, since replays travel over the wire.
    expect(BattleResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
});

describe('socket contract', () => {
  it('lists both event maps', () => {
    expect(CLIENT_TO_SERVER_EVENTS).toEqual([
      'chat:send',
      'presence:ping',
      'zone:enter',
      'zone:leave',
      'zone:retreat',
    ]);
    expect(SERVER_TO_CLIENT_EVENTS).toContain('chat:message');
    expect(SERVER_TO_CLIENT_EVENTS).toContain('character:update');
    expect(SERVER_TO_CLIENT_EVENTS).toContain('dungeon:result');
    expect(SERVER_TO_CLIENT_EVENTS).toContain('system:notice');
    expect(SERVER_TO_CLIENT_EVENTS).toContain('friend:request');
    expect(SERVER_TO_CLIENT_EVENTS).toContain('zone:frame');
    expect(SERVER_TO_CLIENT_EVENTS).toHaveLength(16);
  });

  it('keeps the event name lists in step with the typed interfaces', () => {
    // The interfaces are compile-time only; these assignments fail to compile
    // if a name in the runtime list is not a key of its interface.
    const c2s: Record<(typeof CLIENT_TO_SERVER_EVENTS)[number], keyof ClientToServerEvents> = {
      'chat:send': 'chat:send',
      'presence:ping': 'presence:ping',
      'zone:enter': 'zone:enter',
      'zone:leave': 'zone:leave',
      'zone:retreat': 'zone:retreat',
    };
    const s2c: Record<(typeof SERVER_TO_CLIENT_EVENTS)[number], keyof ServerToClientEvents> = {
      'chat:message': 'chat:message',
      'presence:update': 'presence:update',
      'character:update': 'character:update',
      'party:update': 'party:update',
      'dungeon:start': 'dungeon:start',
      'dungeon:result': 'dungeon:result',
      'arena:challenged': 'arena:challenged',
      'raid:update': 'raid:update',
      'system:notice': 'system:notice',
      'friend:request': 'friend:request',
      'zone:joined': 'zone:joined',
      'zone:frame': 'zone:frame',
      'zone:left': 'zone:left',
      'zone:loot': 'zone:loot',
      'zone:death': 'zone:death',
      'zone:error': 'zone:error',
    };
    expect(Object.keys(c2s)).toHaveLength(5);
    expect(Object.keys(s2c)).toHaveLength(16);
  });

  it('validates the handshake payload', () => {
    expect(HandshakeAuthSchema.parse({ token: 'abc' }).token).toBe('abc');
    expect(HandshakeAuthSchema.safeParse({}).success).toBe(false);
    expect(HandshakeAuthSchema.safeParse({ token: '' }).success).toBe(false);
  });

  it('validates inbound chat', () => {
    expect(ChatSendSchema.parse({ channel: 'world', text: '有道友在么' }).channel).toBe('world');
    expect(ChatSendSchema.safeParse({ channel: 'system', text: 'x' }).success).toBe(false);
    expect(ChatSendSchema.safeParse({ channel: 'world', text: '' }).success).toBe(false);
    expect(ChatSendSchema.safeParse({ channel: 'world', text: 'x'.repeat(201) }).success).toBe(false);
  });

  it('exposes a runtime validator for every client event', () => {
    for (const name of CLIENT_TO_SERVER_EVENTS) {
      expect(CLIENT_EVENT_SCHEMAS[name]).toBeInstanceOf(z.ZodType);
    }
  });

  it('parses a system breakthrough notice', () => {
    const notice = SystemNoticeSchema.parse({
      kind: 'breakthrough',
      text: '恭喜「李清子」突破至 金丹·前期',
      characterId: 'char-1',
      at: T0,
    });
    expect(notice.kind).toBe('breakthrough');
  });

  it('derives stable room names', () => {
    expect(ROOMS.world()).toBe('world');
    expect(ROOMS.party('p1')).toBe('party:p1');
    expect(ROOMS.character('c1')).toBe('char:c1');
  });
});
