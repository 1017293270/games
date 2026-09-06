import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoneFrame, ZoneJoined, ZoneLoot, ZoneRosterEntry } from '@xianxia/shared';
import { ZONE_FLAGS } from '@xianxia/shared';
import type { GameSocket } from '../api/socket';
import * as socketStore from './socket';
import { useZoneStore, zoneFrames } from './zone';

const ZONE = 'map-qingyun-mountain';

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
