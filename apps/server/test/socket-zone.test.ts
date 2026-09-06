import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  ZoneJoinedSchema,
  type CharacterState,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type ZoneErrorCode,
  type ZoneFrame,
  type ZoneJoined,
  type ZoneLeft,
} from '@xianxia/shared';
import type { ZoneEnterResult, ZoneService, ZoneStats } from '../src/engine/zone/api.js';
import { attachSocketIo } from '../src/socket.js';
import { createHarness, makePlayer, type Harness } from './helpers.js';

/**
 * 战斗大地图 socket surface.
 *
 * The simulation itself is stubbed: what is under test here is the room dance —
 * whose tabs see which field, what a 退出 does that a 收起 does not, and that a
 * refused 进图 comes back as an error rather than silence.
 */

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const QINGYUN = 'map-qingyun-mountain';
const LUOSHUI = 'map-luoshui-city';

function frameOf(zoneId: string, at: number, seq = 0): ZoneFrame {
  return {
    zoneId,
    seq,
    at,
    full: true,
    add: [
      {
        i: 0,
        id: 'self',
        kind: 'player',
        name: '林素',
        art: 'avatar/m01',
        stageIndex: 0,
        maxHp: 120,
      },
    ],
    remove: [],
    ents: [[0, 300, 840, 120, 0, -1, -1]],
    events: [],
    boss: { alive: false, nextAt: at + 600_000 },
  };
}

/** A `ZoneService` that records what it was asked and answers a legal frame. */
class FakeZoneService implements ZoneService {
  readonly enters: { characterId: string; zoneId: string; now: number }[] = [];
  readonly resumes: { characterId: string; now: number }[] = [];
  readonly retreats: { characterId: string; now: number }[] = [];
  /** characterId -> the field it stands on. */
  readonly standing = new Map<string, string>();
  /** Forced refusal for the next `enter`, for the error paths. */
  fail: { code: ZoneErrorCode; message: string } | null = null;
  private seq = 0;

  enter(characterId: string, zoneId: string, now: number): ZoneEnterResult {
    this.enters.push({ characterId, zoneId, now });
    if (this.fail) return { ok: false, code: this.fail.code, message: this.fail.message };
    this.standing.set(characterId, zoneId);
    return this.joined(zoneId, now);
  }

  resume(characterId: string, now: number): ZoneEnterResult | null {
    this.resumes.push({ characterId, now });
    const zoneId = this.standing.get(characterId);
    return zoneId === undefined ? null : this.joined(zoneId, now);
  }

  retreat(characterId: string, now: number): boolean {
    this.retreats.push({ characterId, now });
    return this.standing.delete(characterId);
  }

  enterBot(state: CharacterState, zoneId: string, _now: number): boolean {
    this.standing.set(state.id, zoneId);
    return true;
  }

  retreatBot(characterId: string, _now: number): boolean {
    return this.standing.delete(characterId);
  }

  zoneOf(characterId: string): string | null {
    return this.standing.get(characterId) ?? null;
  }

  step(_now: number): void {}
  flush(_now: number): void {}
  start(): void {}
  stop(): void {}
  stats(): ZoneStats[] {
    return [];
  }

  private joined(zoneId: string, now: number): ZoneEnterResult {
    this.seq += 1;
    return { ok: true, zoneId, self: 0, enteredAt: now, frame: frameOf(zoneId, now, this.seq) };
  }
}

function once<T>(socket: ClientSocket, event: keyof ServerToClientEvents, ms = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event as never, ((payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

function connected(socket: ClientSocket, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out connecting')), ms);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Long enough for the server to have processed a fire-and-forget frame. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 250));

describe('socket 战斗大地图', () => {
  let h: Harness;
  let zones: FakeZoneService;
  let url: string;
  const open: ClientSocket[] = [];

  beforeEach(async () => {
    h = createHarness();
    zones = new FakeZoneService();
    h.ctx.zones = zones;
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    await h.app.ready();
    attachSocketIo(h.app, h.ctx);
    const address = h.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of open.splice(0)) socket.disconnect();
    await h.close();
  });

  const openSocket = async (token: string): Promise<ClientSocket> => {
    const socket: ClientSocket = connect(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    open.push(socket);
    await connected(socket);
    return socket;
  };

  it('answers zone:enter with a full frame on every tab the player has open', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const tabA = await openSocket(alice.token);
    const tabB = await openSocket(alice.token);

    const onA = once<ZoneJoined>(tabA, 'zone:joined');
    const onB = once<ZoneJoined>(tabB, 'zone:joined');
    tabA.emit('zone:enter', { zoneId: QINGYUN });

    const [fromA, fromB] = await Promise.all([onA, onB]);
    expect(fromA.zoneId).toBe(QINGYUN);
    expect(fromA.self).toBe(0);
    expect(fromA.frame.full).toBe(true);
    expect(fromA.frame.add).toHaveLength(1);
    expect(fromB.zoneId).toBe(QINGYUN);
    // The payload on the wire is exactly what the client contract promises.
    expect(() => ZoneJoinedSchema.parse(fromA)).not.toThrow();

    expect(zones.enters).toHaveLength(1);
    expect(zones.enters[0]!.characterId).toBe(alice.characterId);
    expect(zones.enters[0]!.zoneId).toBe(QINGYUN);
  });

  it('keeps one field’s frames out of another field’s room', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const bob = await makePlayer(h, { name: '陈墨' });
    const hers = await openSocket(alice.token);
    const his = await openSocket(bob.token);

    const herJoin = once<ZoneJoined>(hers, 'zone:joined');
    hers.emit('zone:enter', { zoneId: QINGYUN });
    await herJoin;

    const hisJoin = once<ZoneJoined>(his, 'zone:joined');
    his.emit('zone:enter', { zoneId: LUOSHUI });
    await hisJoin;

    let leaked = false;
    hers.on('zone:frame', () => {
      leaked = true;
    });

    const frame = once<ZoneFrame>(his, 'zone:frame');
    h.ctx.realtime.toZone(LUOSHUI, 'zone:frame', frameOf(LUOSHUI, h.clock.now(), 9));
    expect((await frame).zoneId).toBe(LUOSHUI);
    await settle();
    expect(leaked).toBe(false);
  });

  it('zone:leave stops this tab only and leaves the cultivator on the field', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const tabA = await openSocket(alice.token);
    const tabB = await openSocket(alice.token);

    const joined = Promise.all([
      once<ZoneJoined>(tabA, 'zone:joined'),
      once<ZoneJoined>(tabB, 'zone:joined'),
    ]);
    tabA.emit('zone:enter', { zoneId: QINGYUN });
    await joined;

    let onA = false;
    tabA.on('zone:frame', () => {
      onA = true;
    });
    tabA.emit('zone:leave');
    await settle();

    const onB = once<ZoneFrame>(tabB, 'zone:frame');
    h.ctx.realtime.toZone(QINGYUN, 'zone:frame', frameOf(QINGYUN, h.clock.now(), 4));
    expect((await onB).seq).toBe(4);
    await settle();

    expect(onA).toBe(false);
    // 收起 is a viewport change: nothing was taken off the map.
    expect(zones.retreats).toHaveLength(0);
    expect(zones.zoneOf(alice.characterId)).toBe(QINGYUN);
  });

  it('zone:retreat empties every tab out of the room and reports the reason', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const tabA = await openSocket(alice.token);
    const tabB = await openSocket(alice.token);

    const joined = Promise.all([
      once<ZoneJoined>(tabA, 'zone:joined'),
      once<ZoneJoined>(tabB, 'zone:joined'),
    ]);
    tabA.emit('zone:enter', { zoneId: QINGYUN });
    await joined;

    // Both tabs are demonstrably in the room before the retreat.
    const watching = Promise.all([
      once<ZoneFrame>(tabA, 'zone:frame'),
      once<ZoneFrame>(tabB, 'zone:frame'),
    ]);
    h.ctx.realtime.toZone(QINGYUN, 'zone:frame', frameOf(QINGYUN, h.clock.now(), 3));
    await watching;

    const leftA = once<ZoneLeft>(tabA, 'zone:left');
    const leftB = once<ZoneLeft>(tabB, 'zone:left');
    tabA.emit('zone:retreat');
    expect((await leftA).reason).toBe('retreat');
    expect((await leftB).reason).toBe('retreat');

    expect(zones.retreats).toHaveLength(1);
    expect(zones.retreats[0]!.characterId).toBe(alice.characterId);
    expect(zones.zoneOf(alice.characterId)).toBeNull();

    let frames = 0;
    for (const tab of [tabA, tabB]) {
      tab.on('zone:frame', () => {
        frames += 1;
      });
    }
    h.ctx.realtime.toZone(QINGYUN, 'zone:frame', frameOf(QINGYUN, h.clock.now(), 5));
    await settle();
    expect(frames).toBe(0);
  });

  it('passes a refused 进图 back as zone:error', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const socket = await openSocket(alice.token);

    zones.fail = { code: 'MAP_LOCKED', message: '此地尚未对你开放' };
    const pending = once<{ code: string; message: string }>(socket, 'zone:error');
    socket.emit('zone:enter', { zoneId: LUOSHUI });
    const locked = await pending;
    expect(locked.code).toBe('MAP_LOCKED');
    expect(locked.message).toBe('此地尚未对你开放');

    h.clock.advance(1000);
    zones.fail = { code: 'ZONE_FULL', message: '此图人满为患' };
    const full = once<{ code: string }>(socket, 'zone:error');
    socket.emit('zone:enter', { zoneId: LUOSHUI });
    expect((await full).code).toBe('ZONE_FULL');
  });

  it('throttles zone:enter to one attempt a second', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const socket = await openSocket(alice.token);

    const joined = once<ZoneJoined>(socket, 'zone:joined');
    socket.emit('zone:enter', { zoneId: QINGYUN });
    await joined;

    const limited = once<{ code: string }>(socket, 'zone:error');
    socket.emit('zone:enter', { zoneId: LUOSHUI });
    expect((await limited).code).toBe('RATE_LIMITED');
    expect(zones.enters).toHaveLength(1);

    // The clock is hand-cranked, so a second later the same frame is accepted.
    h.clock.advance(1000);
    const again = once<ZoneJoined>(socket, 'zone:joined');
    socket.emit('zone:enter', { zoneId: LUOSHUI });
    expect((await again).zoneId).toBe(LUOSHUI);
    expect(zones.enters).toHaveLength(2);
  });

  it('restores the current field when zoneId is null, and says so when there is none', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const socket = await openSocket(alice.token);

    const missing = once<{ code: string }>(socket, 'zone:error');
    socket.emit('zone:enter', { zoneId: null });
    expect((await missing).code).toBe('NOT_FOUND');
    expect(zones.resumes).toHaveLength(1);

    h.clock.advance(1000);
    const joined = once<ZoneJoined>(socket, 'zone:joined');
    socket.emit('zone:enter', { zoneId: QINGYUN });
    await joined;

    // A reconnecting tab asks for whatever it was on.
    h.clock.advance(1000);
    const resumed = once<ZoneJoined>(socket, 'zone:joined');
    socket.emit('zone:enter', { zoneId: null });
    expect((await resumed).zoneId).toBe(QINGYUN);
    expect(zones.resumes).toHaveLength(2);
  });

  it('drops a malformed zone:enter without answering', async () => {
    const alice = await makePlayer(h, { name: '林素' });
    const socket = await openSocket(alice.token);

    let answered = 0;
    socket.on('zone:error', () => {
      answered += 1;
    });
    socket.on('zone:joined', () => {
      answered += 1;
    });

    socket.emit('zone:enter', {} as never);
    socket.emit('zone:enter', { zoneId: 7 } as never);
    socket.emit('zone:enter', { zoneId: '' } as never);
    socket.emit('zone:enter', '进图' as never);
    await settle();

    expect(answered).toBe(0);
    expect(zones.enters).toHaveLength(0);
    expect(zones.resumes).toHaveLength(0);
  });
});
