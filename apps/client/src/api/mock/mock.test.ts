import { beforeAll, describe, expect, it } from 'vitest';
import { API, ENCOUNTERS, getStage, type Endpoint } from '@xianxia/shared';
import { call, setTokenSource } from '../http';
import { api } from '../endpoints';
import { findHandler } from './handlers';
import { DEMO_PASSWORD, DEMO_USERNAME, getWorld } from './index';

/**
 * The mock exists to let the whole client run with no server, so its job is to
 * answer in exactly the shape the contract declares. `call()` already runs
 * `endpoint.response.parse` on everything it returns — these tests exercise
 * every endpoint the M1 client touches so that parse actually happens, and
 * assert the payloads a second time for a legible failure message.
 */

let token: string | null = null;

/** Parses a payload against an endpoint's declared response schema. */
function expectShape<E extends Endpoint>(endpoint: E, data: unknown): void {
  const result = endpoint.response.safeParse(data);
  if (!result.success) {
    throw new Error(
      `${endpoint.method} ${endpoint.path} 响应不合契约: ${JSON.stringify(result.error.issues)}`,
    );
  }
}

beforeAll(async () => {
  setTokenSource(() => token);
  const session = await api.login({ username: DEMO_USERNAME, password: DEMO_PASSWORD });
  expectShape(API.auth.login, session);
  token = session.token;
});

describe('mock endpoint coverage', () => {
  const used: Endpoint[] = [
    API.auth.register,
    API.auth.login,
    API.auth.logout,
    API.auth.me,
    API.character.create,
    API.character.get,
    API.character.settle,
    API.character.breakthrough,
    API.character.equipSkills,
    API.character.learnSkill,
    API.character.setTechnique,
    API.character.learnTechnique,
    API.character.publicProfile,
    API.character.cultivators,
    API.character.rankings,
    API.inventory.list,
    API.inventory.use,
    API.inventory.equip,
    API.inventory.unequip,
    API.explore.maps,
    API.explore.battle,
    API.explore.gather,
    API.explore.chooseEvent,
    API.explore.dungeons,
    API.social.chatHistory,
    API.social.friends,
  ];

  it('implements every endpoint the M1 client calls', () => {
    const missing = used.filter((endpoint) => !findHandler(endpoint));
    expect(missing.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });
});

describe('auth and character', () => {
  it('returns the account with a server clock', async () => {
    const me = await api.me();
    expectShape(API.auth.me, me);
    expect(me.user.username).toBe(DEMO_USERNAME);
    expect(me.serverTime).toBeGreaterThan(0);
  });

  it('settles cultivation lazily and reports the window', async () => {
    const result = await api.settle();
    expectShape(API.character.settle, result);
    expect(result.creditedSec).toBeGreaterThan(0);
    expect(result.creditedSec).toBeLessThanOrEqual(result.elapsedSec);
    expect(result.gainedExp).toBeGreaterThan(0);
  });

  it('serves a character view whose stage name matches the stage index', async () => {
    const view = await api.getCharacter();
    expectShape(API.character.get, view);
    expect(view.stageName).toBe(getStage(view.character.stageIndex).name);
    expect(view.ratePerSec).toBeGreaterThan(0);
  });

  it('registers a new account and creates a cultivator', async () => {
    const previous = token;
    const session = await api.register({ username: 'newcomer', password: 'secret123' });
    expectShape(API.auth.register, session);
    token = session.token;

    const view = await api.createCharacter({
      name: '试剑',
      avatarArt: 'avatar/f03',
      gender: 'female',
    });
    expectShape(API.character.create, view);
    expect(view.character.stageIndex).toBe(0);
    expect(view.character.skillSlots.filter(Boolean)).toHaveLength(4);
    token = previous;
  });

  it('breaks through once the stage is full', async () => {
    const world = getWorld();
    const character = world.characters.get('char-demo');
    expect(character).toBeDefined();
    if (!character) return;
    // Park the demo cultivator at 圆满 so the attempt is legal.
    const parked = { ...character, stageIndex: 11, exp: getStage(11).expRequired };
    world.characters.set(parked.id, parked);

    const result = await api.breakthrough(1);
    expectShape(API.character.breakthrough, result);
    expect(result.fromStageIndex).toBe(11);
    expect(result.chance).toBeGreaterThan(0);
    expect(result.tribulation).toBeNull();
    if (result.success) expect(result.toStageIndex).toBe(12);
    else expect(result.expLost).toBeGreaterThan(0);
  });

  it('equips skills and switches techniques', async () => {
    const before = await api.getCharacter();
    const slots = [...before.character.skillSlots];
    const view = await api.equipSkills([slots[1] ?? null, slots[0] ?? null, slots[2] ?? null, null]);
    expectShape(API.character.equipSkills, view);
    expect(view.character.skillSlots[3]).toBeNull();

    const technique = await api.setTechnique('tech-qingyun');
    expectShape(API.character.setTechnique, technique);
    expect(technique.character.techniqueId).toBe('tech-qingyun');
  });
});

describe('inventory', () => {
  it('lists the bag with derived stats', async () => {
    const bag = await api.inventory();
    expectShape(API.inventory.list, bag);
    expect(bag.items.length).toBeGreaterThan(0);
    expect(bag.powerScore).toBeGreaterThan(0);
  });

  it('unequips and re-equips a treasure', async () => {
    const off = await api.unequipItem('treasure');
    expectShape(API.inventory.unequip, off);
    expect(off.character.equipment.treasure).toBeNull();

    const on = await api.equipItem('inv-d5');
    expectShape(API.inventory.equip, on);
    expect(on.character.equipment.treasure).toBe('inv-d5');
  });

  it('consumes a pill and reports what it did', async () => {
    const result = await api.useItem('inv-d2', 1);
    expectShape(API.inventory.use, result);
    expect(result.message).toContain('聚气丹');
    expect(result.view.character.buffs.length).toBeGreaterThan(0);
  });
});

describe('explore', () => {
  it('lists maps with unlock state and gather cooldowns', async () => {
    const result = await api.exploreMaps();
    expectShape(API.explore.maps, result);
    expect(result.maps).toHaveLength(4);
    expect(result.maps[0]?.monsters).toHaveLength(2);
  });

  it('runs a real battle through the shared engine', async () => {
    const result = await api.exploreBattle({
      mapId: 'map-qingyun-mountain',
      monsterId: 'monster-qingyun-wolf',
    });
    expectShape(API.explore.battle, result);
    expect(result.kind).toBe('battle');
    if (result.kind !== 'battle') return;
    expect(result.battle.log.length).toBeGreaterThan(2);
    expect(result.battle.log.at(-1)?.type).toBe('battle_end');
    expect(Object.keys(result.battle.finalHp)).toContain(result.monsterId);
  });

  it('gathers herbs and starts the cooldown', async () => {
    const result = await api.gather('map-qingyun-mountain');
    expectShape(API.explore.gather, result);
    expect(result.nextGatherAt).toBeGreaterThan(Date.now());
  });

  it('resolves an 奇遇 choice into a reward', async () => {
    const world = getWorld();
    const encounter = ENCOUNTERS[0];
    expect(encounter).toBeDefined();
    if (!encounter) return;
    world.encounters.set('enc-test', {
      token: 'enc-test',
      encounterId: encounter.id,
      mapId: 'map-qingyun-mountain',
    });
    const option = encounter.options[0];
    expect(option).toBeDefined();
    if (!option) return;

    const result = await api.chooseEncounter({
      encounterToken: 'enc-test',
      optionId: option.id,
    });
    expectShape(API.explore.chooseEvent, result);
    expect(result.outcomeText).toBe(option.outcomeText);
  });

  it('lists the secret realms', async () => {
    const result = await api.dungeons();
    expectShape(API.explore.dungeons, result);
    expect(result.dungeons).toHaveLength(4);
    expect(result.dungeons.every((d) => d.boss.isBoss)).toBe(true);
  });
});

describe('social', () => {
  it('ranks a populated world on all three boards', async () => {
    for (const board of ['realm', 'power', 'arena'] as const) {
      const page = await api.rankings({ board, page: 1, pageSize: 20 });
      expectShape(API.character.rankings, page);
      expect(page.board).toBe(board);
      expect(page.total).toBeGreaterThan(180);
      expect(page.items[0]?.rank).toBe(1);
      expect(page.items.some((entry) => entry.isBot)).toBe(true);
    }
  });

  it('serves a public dossier for a bot', async () => {
    const ranks = await api.rankings({ board: 'power', page: 1, pageSize: 5 });
    const first = ranks.items[0];
    expect(first).toBeDefined();
    if (!first) return;
    const profile = await api.publicProfile(first.characterId);
    expectShape(API.character.publicProfile, profile);
    expect(profile.name).toBe(first.name);
  });

  it('returns chat scrollback and the friends placeholder', async () => {
    const history = await api.chatHistory({ channel: 'world', limit: 50 });
    expectShape(API.social.chatHistory, history);
    expect(history.messages.length).toBeGreaterThan(0);

    const friends = await api.friends();
    expectShape(API.social.friends, friends);
  });
});

describe('failure envelopes', () => {
  it('rejects a bad password with INVALID_CREDENTIALS', async () => {
    await expect(call(API.auth.login, { username: DEMO_USERNAME, password: 'wrong!' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('refuses a map the cultivator has not unlocked', async () => {
    const previous = token;
    const session = await api.register({ username: 'greenhorn', password: 'secret123' });
    token = session.token;
    await api.createCharacter({ name: '初学', avatarArt: 'avatar/m02', gender: 'male' });

    await expect(api.exploreBattle({ mapId: 'map-kunlun-ruins' })).rejects.toMatchObject({
      code: 'MAP_LOCKED',
    });
    token = previous;
  });

  it('reports a missing cultivator and a missing item', async () => {
    await expect(api.publicProfile('char-nobody')).rejects.toMatchObject({
      code: 'CHARACTER_NOT_FOUND',
    });
    await expect(api.useItem('inv-nothing')).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    });
  });
});
