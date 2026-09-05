import { beforeAll, describe, expect, it } from 'vitest';
import { API, DUNGEON_BY_ID, type Endpoint } from '@xianxia/shared';
import { setTokenSource } from '../http';
import { api } from '../endpoints';
import { findHandler } from './handlers';
import { DEMO_PASSWORD, DEMO_USERNAME } from './index';

/**
 * W3 mock coverage: 组队 / 秘境 / 论道 / 围攻 / 好友.
 *
 * `call()` already runs `endpoint.response.parse` on everything it hands back,
 * so every request below is a contract check; the assertions afterwards exist
 * to name the failure when a payload is legal but wrong.
 */

let token: string | null = null;

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
  token = session.token;
});

describe('mock 多人接口覆盖', () => {
  it('implements every endpoint the W3 client calls', () => {
    const used: Endpoint[] = [
      API.party.get,
      API.party.create,
      API.party.join,
      API.party.leave,
      API.party.kick,
      API.explore.startDungeon,
      API.arena.opponents,
      API.arena.challenge,
      API.arena.records,
      API.raid.targets,
      API.raid.attack,
      API.social.friends,
      API.social.friendRequest,
      API.social.friendAccept,
      API.social.friendRemove,
    ];
    const missing = used.filter((endpoint) => !findHandler(endpoint));
    expect(missing.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });
});

describe('组队', () => {
  it('starts solo, opens a party with a six-character code, then disbands', async () => {
    const before = await api.party();
    expectShape(API.party.get, before);
    expect(before.party).toBeNull();

    const party = await api.createParty();
    expectShape(API.party.create, party);
    expect(party.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(party.leaderId).toBe(party.members[0]?.characterId);
    expect(party.members).toHaveLength(1);
    expect(party.maxSize).toBeGreaterThanOrEqual(2);

    await expect(api.createParty()).rejects.toMatchObject({ code: 'ALREADY_IN_PARTY' });

    const empty = await api.leaveParty();
    expectShape(API.party.leave, empty);
    expect((await api.party()).party).toBeNull();
  });

  it('joins by code and lets the leader kick, then rejects a malformed code', async () => {
    const joined = await api.joinParty('QY7K2M');
    expectShape(API.party.join, joined);
    expect(joined.members.length).toBeGreaterThanOrEqual(2);
    expect(joined.members.some((m) => m.isLeader)).toBe(true);

    // Joined someone else's party, so kicking is not this cultivator's to do.
    const other = joined.members.find((m) => !m.isLeader);
    expect(other).toBeDefined();
    if (other) {
      await expect(api.kickPartyMember(other.characterId)).rejects.toMatchObject({
        code: 'NOT_PARTY_LEADER',
      });
    }
    await api.leaveParty();

    await expect(api.joinParty('!!')).rejects.toMatchObject({ code: 'INVALID_PARTY_CODE' });
  });

  it('lets the leader kick a member out of their own party', async () => {
    await api.joinParty('LEADME');
    await api.leaveParty();
    const mine = await api.createParty();
    await expect(api.kickPartyMember(mine.leaderId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await api.leaveParty();
  });
});

describe('秘境副本', () => {
  it('runs every wave plus the boss and spends a daily entry', async () => {
    const listed = await api.dungeons();
    expectShape(API.explore.dungeons, listed);
    const entry = listed.dungeons.find((d) => d.id === 'dungeon-qingyun');
    expect(entry?.unlocked).toBe(true);

    const runsBefore = entry?.runsToday ?? 0;
    const run = await api.startDungeon({ dungeonId: 'dungeon-qingyun', withParty: false });
    expectShape(API.explore.startDungeon, run);

    const waves = DUNGEON_BY_ID.get('dungeon-qingyun')?.waves.length ?? 0;
    expect(run.battles.length).toBeGreaterThan(0);
    expect(run.battles.length).toBeLessThanOrEqual(waves + 1);
    expect(run.battles[0]?.log.at(-1)?.type).toBe('battle_end');
    expect(run.participantIds).toContain(run.view.character.id);
    if (run.cleared) {
      expect(run.battles).toHaveLength(waves + 1);
      expect(run.reward.exp).toBeGreaterThan(0);
    }

    const after = await api.dungeons();
    expect(after.dungeons.find((d) => d.id === 'dungeon-qingyun')?.runsToday).toBe(runsBefore + 1);
  });

  it('refuses a realm above the cultivator and a party run with nobody in it', async () => {
    await expect(
      api.startDungeon({ dungeonId: 'dungeon-kunlun', withParty: false }),
    ).rejects.toMatchObject({ code: 'DUNGEON_LOCKED' });

    await expect(
      api.startDungeon({ dungeonId: 'dungeon-qingyun', withParty: true }),
    ).rejects.toMatchObject({ code: 'NOT_IN_PARTY' });
  });

  it('runs with a party and shares the waves with everyone present', async () => {
    const party = await api.joinParty('TEAM42');
    const run = await api.startDungeon({ dungeonId: 'dungeon-qingyun', withParty: true });
    expectShape(API.explore.startDungeon, run);
    expect(run.participantIds).toHaveLength(party.members.length);
    // Team A carries between waves, so every wave logs the same cast on the left.
    for (const id of run.participantIds) {
      expect(Object.keys(run.battles[0]?.finalHp ?? {})).toContain(id);
    }
    await api.leaveParty();
  });

  it('stops at the daily limit', async () => {
    const listed = await api.dungeons();
    const entry = listed.dungeons.find((d) => d.id === 'dungeon-qingyun');
    const left = Math.max(0, (entry?.dailyLimit ?? 0) - (entry?.runsToday ?? 0));
    for (let i = 0; i < left; i += 1) {
      await api.startDungeon({ dungeonId: 'dungeon-qingyun', withParty: false });
    }
    await expect(
      api.startDungeon({ dungeonId: 'dungeon-qingyun', withParty: false }),
    ).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' });
  });
});

describe('论道', () => {
  it('offers a board of near-equal opponents with a win hint', async () => {
    const board = await api.arenaOpponents();
    expectShape(API.arena.opponents, board);
    expect(board.opponents).toHaveLength(20);
    expect(board.rating).toBeGreaterThan(0);
    expect(board.dailyLimit).toBeGreaterThan(0);
    for (const opponent of board.opponents) {
      expect(opponent.winHint).toBeGreaterThan(0);
      expect(opponent.winHint).toBeLessThan(1);
    }
  });

  it('fights a real bout, moves the ladder, and files the replay', async () => {
    const board = await api.arenaOpponents();
    const target = board.opponents[0];
    expect(target).toBeDefined();
    if (!target) return;

    const bout = await api.arenaChallenge(target.id);
    expectShape(API.arena.challenge, bout);
    expect(bout.opponent.id).toBe(target.id);
    expect(bout.battle.log.at(-1)?.type).toBe('battle_end');
    expect(bout.won).toBe(bout.battle.winner === 'A');
    expect(bout.ratingAfter).not.toBe(bout.ratingBefore);

    const records = await api.arenaRecords({ page: 1, pageSize: 10 });
    expectShape(API.arena.records, records);
    expect(records.items[0]?.defenderId).toBe(target.id);
    expect(records.items[0]?.battle).not.toBeNull();
    expect(records.total).toBeGreaterThan(1);
  });

  it('will not let a cultivator challenge themselves', async () => {
    const me = await api.getCharacter();
    await expect(api.arenaChallenge(me.character.id)).rejects.toMatchObject({
      code: 'SELF_CHALLENGE',
    });
  });
});

describe('围攻', () => {
  it('lists bots with a blood pool, a bounty and a recovery window', async () => {
    const board = await api.raidTargets();
    expectShape(API.raid.targets, board);
    expect(board.targets).toHaveLength(10);
    expect(board.targets.every((t) => t.isBot)).toBe(true);
    expect(board.targets.every((t) => t.bounty > 0)).toBe(true);
    expect(board.targets.some((t) => t.protectedUntil > Date.now())).toBe(true);
  });

  it('drains the pool it attacks and refuses one still recovering', async () => {
    const board = await api.raidTargets();
    const open = board.targets.find((t) => t.protectedUntil <= Date.now() && t.hpPercent > 0);
    expect(open).toBeDefined();
    if (!open) return;

    const result = await api.raidAttack({ botId: open.id, withParty: false });
    expectShape(API.raid.attack, result);
    expect(result.remainingHpPercent).toBeLessThanOrEqual(open.hpPercent);
    expect(result.target.id).toBe(open.id);
    expect(result.participantIds).toHaveLength(1);
    expect(result.defeated).toBe(result.remainingHpPercent === 0);

    const shielded = board.targets.find((t) => t.protectedUntil > Date.now());
    if (shielded) {
      await expect(api.raidAttack({ botId: shielded.id, withParty: false })).rejects.toMatchObject({
        code: 'TARGET_PROTECTED',
      });
    }
  });
});

describe('好友', () => {
  it('seeds a roster split across the three states', async () => {
    const list = await api.friends();
    expectShape(API.social.friends, list);
    expect(list.friends.length).toBeGreaterThanOrEqual(6);
    expect(list.friends.some((f) => f.state === 'accepted')).toBe(true);
    expect(list.friends.some((f) => f.state === 'pending_in')).toBe(true);
    expect(list.friends.some((f) => f.state === 'pending_out')).toBe(true);
  });

  it('accepts a waiting request and then drops it again', async () => {
    const before = await api.friends();
    const waiting = before.friends.find((f) => f.state === 'pending_in');
    expect(waiting).toBeDefined();
    if (!waiting) return;

    const accepted = await api.friendAccept(waiting.characterId);
    expectShape(API.social.friendAccept, accepted);
    expect(accepted.friends.find((f) => f.characterId === waiting.characterId)?.state).toBe(
      'accepted',
    );

    await expect(api.friendRequest(waiting.characterId)).rejects.toMatchObject({
      code: 'ALREADY_FRIENDS',
    });

    const removed = await api.friendRemove(waiting.characterId);
    expectShape(API.social.friendRemove, removed);
    expect(removed.friends.some((f) => f.characterId === waiting.characterId)).toBe(false);
  });

  it('sends a fresh request and refuses a duplicate', async () => {
    const board = await api.arenaOpponents();
    const known = new Set((await api.friends()).friends.map((f) => f.characterId));
    const stranger = board.opponents.find((o) => !known.has(o.id));
    expect(stranger).toBeDefined();
    if (!stranger) return;

    const sent = await api.friendRequest(stranger.id);
    expectShape(API.social.friendRequest, sent);
    const list = await api.friends();
    expect(list.friends.find((f) => f.characterId === stranger.id)?.state).toBe('pending_out');

    await expect(api.friendRequest(stranger.id)).rejects.toMatchObject({
      code: 'FRIEND_REQUEST_EXISTS',
    });
  });
});
