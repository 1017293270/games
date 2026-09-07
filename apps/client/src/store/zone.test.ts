import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoneFrame, ZoneJoined, ZoneLoot, ZoneRosterEntry } from '@xianxia/shared';
import { ZONE_FLAGS } from '@xianxia/shared';
import type { GameSocket } from '../api/socket';
import * as socketStore from './socket';
import { useUiStore } from './ui';
import { useZoneStore, zoneFrames } from './zone';

const ZONE = 'map-qingyun-mountain';
const FAR_ZONE = 'map-kunlun-ruins';
/** The store's own send gap, a hair over the server's one-a-second 进图 cap. */
const GAP_MS = 1100;
const RATE_LIMITED = { code: 'RATE_LIMITED', message: '走得太急了，缓一口气再进图' } as const;

const emit = vi.fn();

/** Just enough socket for the store to talk into. */
function fakeSocket(): GameSocket {
  return {
    on: () => {},
    off: () => {},
    emit: emit as unknown as GameSocket['emit'],
    disconnect: () => {},
  };
}

function roster(i: number, over: Partial<ZoneRosterEntry> = {}): ZoneRosterEntry {
  return {
    i,
    id: `m:${i}`,
    kind: 'monster',
    name: `妖兽${i}`,
    art: null,
    stageIndex: 3,
    maxHp: 100,
    ...over,
  };
}

function frame(over: Partial<ZoneFrame> = {}): ZoneFrame {
  return {
    zoneId: ZONE,
    seq: 1,
    at: 1_000,
    full: false,
    add: [],
    remove: [],
    ents: [],
    events: [],
    boss: { alive: false, nextAt: 60_000 },
    ...over,
  };
}

function joined(over: Partial<ZoneJoined> = {}): ZoneJoined {
  return {
    zoneId: ZONE,
    self: 0,
    enteredAt: 500,
    frame: frame({
      seq: 1,
      full: true,
      add: [roster(0, { kind: 'player', id: 'char-demo', name: '演示', maxHp: 200 }), roster(1)],
      ents: [
        [0, 300, 840, 200, 0, 1, -1],
        [1, 305, 830, 100, ZONE_FLAGS.MOVING, 0, -1],
      ],
    }),
    ...over,
  };
}

function loot(over: Partial<ZoneLoot> = {}): ZoneLoot {
  return { exp: 0, spiritStones: 0, items: [], kills: 0, bossKills: 0, since: 1_000, ...over };
}

beforeEach(() => {
  emit.mockClear();
  vi.spyOn(socketStore, 'getSocket').mockReturnValue(fakeSocket());
  useZoneStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('zone store · 入场', () => {
  it('takes the roster and the poses off the joining frame', () => {
    useZoneStore.getState().applyJoined(joined());

    const state = useZoneStore.getState();
    expect(state.status).toBe('in');
    expect(state.zoneId).toBe(ZONE);
    expect(state.self).toBe(0);
    expect(Object.keys(state.roster)).toEqual(['0', '1']);
    expect(zoneFrames.get(0)?.next).toEqual({ x: 30, y: 84, hp: 200, flags: 0, at: 1_000 });
    // The first sample seeds both ends, so nothing eases in from the origin.
    expect(zoneFrames.get(0)?.prev).toEqual(zoneFrames.get(0)?.next);
    expect(zoneFrames.get(1)?.targetI).toBe(0);
  });

  it('asks the server for the zone and does not blank one already on screen', () => {
    useZoneStore.getState().enter(ZONE);
    expect(useZoneStore.getState().status).toBe('joining');
    expect(emit).toHaveBeenCalledWith('zone:enter', { zoneId: ZONE });

    useZoneStore.getState().applyJoined(joined());
    useZoneStore.getState().enter(ZONE);
    expect(useZoneStore.getState().status).toBe('in');
  });
});

describe('zone store · 增量帧', () => {
  beforeEach(() => {
    useZoneStore.getState().applyJoined(joined());
  });

  it('rolls the poses forward, keeping the previous sample to ease from', () => {
    useZoneStore
      .getState()
      .applyFrame(frame({ seq: 2, at: 1_250, ents: [[1, 325, 810, 80, 0, 0, 2]] }));

    const track = zoneFrames.get(1);
    expect(track?.prev).toEqual({ x: 30.5, y: 83, hp: 100, flags: ZONE_FLAGS.MOVING, at: 1_000 });
    expect(track?.next).toEqual({ x: 32.5, y: 81, hp: 80, flags: 0, at: 1_250 });
    expect(track?.skillSlot).toBe(2);
    expect(useZoneStore.getState().lastSeq).toBe(2);
  });

  it('overwrites a slot handed to somebody else instead of easing across the map', () => {
    useZoneStore.getState().applyFrame(
      frame({
        seq: 2,
        at: 1_250,
        add: [roster(1, { id: 'm:9', name: '灵猿', maxHp: 400 })],
        ents: [[1, 100, 200, 400, 0, -1, -1]],
      }),
    );

    expect(useZoneStore.getState().roster[1]?.name).toBe('灵猿');
    // A fresh track: prev is the new pose, not the old occupant's.
    expect(zoneFrames.get(1)?.prev.x).toBe(10);
  });

  it('drops the cached pose along with the row when a slot is recycled', () => {
    useZoneStore.getState().applyFrame(frame({ seq: 2, remove: [1] }));

    expect(useZoneStore.getState().roster[1]).toBeUndefined();
    expect(zoneFrames.has(1)).toBe(false);
  });

  it('ignores a frame that arrives after a newer one', () => {
    useZoneStore
      .getState()
      .applyFrame(frame({ seq: 2, at: 1_250, ents: [[1, 325, 810, 80, 0, 0, -1]] }));
    useZoneStore
      .getState()
      .applyFrame(frame({ seq: 2, at: 9_999, ents: [[1, 10, 10, 1, 0, 0, -1]] }));

    expect(zoneFrames.get(1)?.next.at).toBe(1_250);
  });

  it('asks for a resync on a gap, and asks exactly once', () => {
    useZoneStore.getState().applyFrame(frame({ seq: 5, ents: [[1, 325, 810, 80, 0, 0, -1]] }));

    expect(emit).toHaveBeenCalledWith('zone:enter', { zoneId: ZONE });
    // The dropped rows are gone for good, so the stale delta is not merged.
    expect(zoneFrames.get(1)?.next.hp).toBe(100);

    emit.mockClear();
    useZoneStore.getState().applyFrame(frame({ seq: 6, ents: [[1, 325, 810, 80, 0, 0, -1]] }));
    expect(emit).not.toHaveBeenCalled();
  });

  it('drops entities the resynced full frame no longer lists', () => {
    useZoneStore.getState().applyFrame(
      frame({
        seq: 9,
        full: true,
        add: [roster(0, { kind: 'player', id: 'char-demo' })],
        ents: [[0, 300, 840, 200, 0, -1, -1]],
      }),
    );

    expect(Object.keys(useZoneStore.getState().roster)).toEqual(['0']);
    expect(zoneFrames.has(1)).toBe(false);
  });
});

describe('zone store · 战果与身死', () => {
  beforeEach(() => {
    useZoneStore.getState().applyJoined(joined());
  });

  it('adds each push to the running tally and keeps the earliest window', () => {
    useZoneStore.getState().applyLoot(
      loot({
        exp: 120,
        spiritStones: 8,
        kills: 3,
        since: 5_000,
        items: [{ itemId: 'item-herb', qty: 1, name: '灵草' }],
      }),
    );
    useZoneStore.getState().applyLoot(
      loot({
        exp: 80,
        spiritStones: 4,
        kills: 2,
        bossKills: 1,
        since: 10_000,
        items: [{ itemId: 'item-herb', qty: 2, name: '灵草' }],
      }),
    );

    expect(useZoneStore.getState().loot).toEqual({
      exp: 200,
      spiritStones: 12,
      kills: 5,
      bossKills: 1,
      items: [{ itemId: 'item-herb', qty: 3, name: '灵草' }],
      since: 5_000,
    });
  });

  it('keeps the tally across a resync but starts a new one on a new stint', () => {
    useZoneStore.getState().applyLoot(loot({ exp: 120, kills: 3 }));

    useZoneStore.getState().applyJoined(joined());
    expect(useZoneStore.getState().loot?.exp).toBe(120);

    useZoneStore.getState().applyJoined(joined({ enteredAt: 90_000 }));
    expect(useZoneStore.getState().loot).toBeNull();
  });

  it('clears the death notice once the respawn is due', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useZoneStore.getState().applyDeath({ killerName: '青云狼', stonesLost: 12, respawnAt: 11_000 });
    expect(useZoneStore.getState().death?.killerName).toBe('青云狼');

    vi.advanceTimersByTime(9_999);
    expect(useZoneStore.getState().death).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(useZoneStore.getState().death).toBeNull();
  });
});

describe('zone store · 离场', () => {
  it('walks out on 撤离 and keeps the tally to read afterwards', () => {
    useZoneStore.getState().applyJoined(joined());
    useZoneStore.getState().applyLoot(loot({ exp: 42, kills: 1 }));

    useZoneStore.getState().retreat();

    expect(emit).toHaveBeenCalledWith('zone:retreat');
    const state = useZoneStore.getState();
    expect(state.status).toBe('out');
    expect(state.zoneId).toBeNull();
    expect(zoneFrames.size).toBe(0);
    expect(state.loot?.exp).toBe(42);
  });

  it('stops the frames without giving up the field', () => {
    useZoneStore.getState().applyJoined(joined());
    useZoneStore.getState().leave();

    expect(emit).toHaveBeenCalledWith('zone:leave');
    expect(useZoneStore.getState().zoneId).toBe(ZONE);
  });

  it('lets the server restore the field when it does not know which one', () => {
    useZoneStore.getState().resync();
    expect(emit).toHaveBeenCalledWith('zone:enter', { zoneId: null });
  });

  it('sends a locked map back to the list with the reason', () => {
    useZoneStore.getState().enter('map-kunlun-ruins');
    useZoneStore
      .getState()
      .applyError({ code: 'MAP_LOCKED', message: '需 金丹·前期 方可前往此地' });

    expect(useZoneStore.getState().status).toBe('out');
    expect(useZoneStore.getState().error?.code).toBe('MAP_LOCKED');
  });
});

/**
 * The socket asks the server to restore a field the moment it opens, on every
 * connect, whether or not the player is on one. The answer to «you are on none»
 * is `zone:left {reason:'none'}`, and for anyone who was never on a field it is
 * not news — it must pass without a word on screen.
 */
describe('zone store · 恢复留场', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ toasts: [] });
  });

  it('says nothing when the restore finds no field to come back to', () => {
    useZoneStore.getState().resync();
    expect(emit).toHaveBeenLastCalledWith('zone:enter', { zoneId: null });

    useZoneStore.getState().applyLeft({ reason: 'none' });

    expect(useUiStore.getState().toasts).toHaveLength(0);
    const state = useZoneStore.getState();
    expect(state.status).toBe('out');
    expect(state.zoneId).toBeNull();
    expect(state.error).toBeNull();
  });

  it('speaks up when the field it believed it was on is gone', () => {
    useZoneStore.getState().applyJoined(joined());
    useZoneStore.getState().applyLeft({ reason: 'none' });

    expect(useUiStore.getState().toasts.map((row) => row.text)).toEqual(['已离开此地。']);
    expect(useZoneStore.getState().status).toBe('out');
    expect(zoneFrames.size).toBe(0);
  });

  it('swallows a NOT_FOUND from a server that answers the restore the old way', () => {
    useZoneStore.getState().resync();
    useZoneStore.getState().applyError({ code: 'NOT_FOUND', message: '你此刻不在任何大地图上' });

    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(useZoneStore.getState().error).toBeNull();
    expect(useZoneStore.getState().status).toBe('out');
  });

  it('still reports a NOT_FOUND for a field the player picked', () => {
    useZoneStore.getState().enter(FAR_ZONE);
    useZoneStore.getState().applyError({ code: 'NOT_FOUND', message: '没有这张战斗大地图' });

    expect(useUiStore.getState().toasts.map((row) => row.text)).toEqual(['没有这张战斗大地图']);
    expect(useZoneStore.getState().error?.code).toBe('NOT_FOUND');
    expect(useZoneStore.getState().status).toBe('out');
  });
});

/**
 * Waking an Android tab fires `enter` from the shell and `resync` from the
 * reconnecting socket at practically the same instant, and the server's
 * one-a-second gate refuses the second of them. None of that is the player's
 * business, so the store queues the sends and swallows the first refusal.
 */
describe('zone store · 进图节流', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ toasts: [] });
  });

  it('merges the sends inside one gap and follows up with the last zone asked for', () => {
    useZoneStore.getState().enter(ZONE);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith('zone:enter', { zoneId: ZONE });

    vi.advanceTimersByTime(300);
    useZoneStore.getState().resync();
    useZoneStore.getState().enter(FAR_ZONE);
    expect(emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(GAP_MS - 300);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith('zone:enter', { zoneId: FAR_ZONE });

    // Nothing is left ticking once the queue has drained.
    vi.advanceTimersByTime(10_000);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('answers a refusal by asking again in silence, leaving the screen alone', () => {
    useZoneStore.getState().enter(ZONE);
    useZoneStore.getState().applyError(RATE_LIMITED);

    expect(useZoneStore.getState().status).toBe('joining');
    expect(useZoneStore.getState().error).toBeNull();
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(GAP_MS);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith('zone:enter', { zoneId: ZONE });
    expect(useZoneStore.getState().status).toBe('joining');
  });

  it('keeps a field already on screen while the refused resync is retried', () => {
    useZoneStore.getState().applyJoined(joined());
    useZoneStore.getState().resync();
    useZoneStore.getState().applyError(RATE_LIMITED);

    expect(useZoneStore.getState().status).toBe('in');
    expect(useUiStore.getState().toasts).toHaveLength(0);

    vi.advanceTimersByTime(GAP_MS);
    expect(emit).toHaveBeenLastCalledWith('zone:enter', { zoneId: ZONE });
  });

  it('speaks up on the second refusal in a row', () => {
    useZoneStore.getState().enter(ZONE);
    useZoneStore.getState().applyError(RATE_LIMITED);
    vi.advanceTimersByTime(GAP_MS);
    useZoneStore.getState().applyError(RATE_LIMITED);

    expect(useZoneStore.getState().status).toBe('out');
    expect(useZoneStore.getState().error?.code).toBe('RATE_LIMITED');
    expect(useUiStore.getState().toasts.map((row) => row.text)).toEqual([RATE_LIMITED.message]);
  });

  it('has nothing to retry when it does not know which field it was', () => {
    useZoneStore.getState().resync();
    expect(emit).toHaveBeenLastCalledWith('zone:enter', { zoneId: null });

    useZoneStore.getState().applyError(RATE_LIMITED);
    expect(useUiStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('drops a queued 进图 when the socket closes', () => {
    useZoneStore.getState().enter(ZONE);
    useZoneStore.getState().resync();
    useZoneStore.getState().reset();

    vi.advanceTimersByTime(10_000);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('main treasure projections', () => {
  it('uses server shield values, clears on unequip and ignores projections without a treasure', () => {
    const store = useZoneStore.getState();
    store.applyJoined(joined());
    const entry = roster(0, {
      kind: 'player',
      id: 'char-demo',
      mainTreasure: {
        definitionId: 't-starter-bell',
        name: '清音铃',
        art: 'item/treasure-bell',
        form: 'bell',
        power: 1,
        intervalMs: 1000,
        awakened: false,
      },
    });
    store.applyFrame(frame({ seq: 2, add: [entry], treasureStates: [{ i: 0, shield: 25 }] }));
    expect(zoneFrames.get(0)?.shield).toBe(25);
    store.applyFrame(
      frame({
        seq: 3,
        add: [roster(0, { kind: 'player', id: 'char-demo' })],
        treasureStates: [{ i: 0, shield: 50 }],
      }),
    );
    expect(zoneFrames.get(0)?.shield).toBe(0);
    store.applyFrame(frame({ seq: 4, remove: [0] }));
    expect(zoneFrames.has(0)).toBe(false);
  });
});
