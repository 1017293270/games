import { create } from 'zustand';
import type {
  ZoneDeath,
  ZoneError,
  ZoneFrame,
  ZoneJoined,
  ZoneLeft,
  ZoneLoot,
  ZonePose,
  ZoneRosterEntry,
} from '@xianxia/shared';
import { useInventoryStore } from './inventory';
import { getSocket } from './socket';
import { toast } from './ui';

/**
 * 战斗大地图 client state.
 *
 * Two halves, deliberately kept apart:
 *
 *   `useZoneStore` holds what React renders — the roster, the BOSS clock, the
 *   loot tally — and only changes when one of those actually changes.
 *
 *   `zoneFrames` holds what the renderer draws. Positions arrive at
 *   `zoneSnapshotHz` (4 Hz) and are drawn at 60 fps, so every slot keeps the
 *   pose it had and the pose it has, and the canvas eases between them. Pushing
 *   a few hundred coordinates through zustand four times a second would re-run
 *   every subscriber for numbers no component reads, so this is a plain mutable
 *   `Map` that the renderer reads directly on its own frame loop.
 */

/**
 * One slot's interpolation track.
 *
 * `prev`/`next` are the two most recent samples. `targetI` and `skillSlot`
 * ride along because they arrive in the same tuple and belong to the same
 * instant — `ZonePose` is a frozen protocol type and cannot carry them.
 */
export interface ZoneTrack {
  shield?: number;
  prev: ZonePose;
  next: ZonePose;
  /** Slot this entity is fighting, or -1. */
  targetI: number;
  /** 神通 slot cast in this frame's window; -1 for 普攻 or no action. */
  skillSlot: number;
}

/** Live poses by slot. Mutated in place; never replaced. */
export const zoneFrames = new Map<number, ZoneTrack>();

export interface ZoneState {
  status: 'out' | 'joining' | 'in';
  zoneId: string | null;
  /** The viewer's own slot. */
  self: number | null;
  enteredAt: number | null;
  roster: Record<number, ZoneRosterEntry>;
  boss: { alive: boolean; nextAt: number | null };
  lastSeq: number;
  /** Everything banked since the character walked in, several `zone:loot` deep. */
  loot: ZoneLoot | null;
  death: ZoneDeath | null;
  error: ZoneError | null;

  enter: (zoneId: string) => void;
  leave: () => void;
  retreat: () => void;
  resync: () => void;

  applyJoined: (payload: ZoneJoined) => void;
  applyFrame: (frame: ZoneFrame) => void;
  applyLeft: (payload: ZoneLeft) => void;
  applyLoot: (payload: ZoneLoot) => void;
  applyDeath: (payload: ZoneDeath) => void;
  applyError: (payload: ZoneError) => void;
  reset: () => void;
}

const LEFT_TEXT: Record<ZoneLeft['reason'], string> = {
  retreat: '已离场，所获尽入囊中。',
  offline_cap: '挂机时辰已尽，自行离场。',
  none: '已离开此地。',
  removed: '此地已闭，被送出山门。',
};

function poseOf(x10: number, y10: number, hp: number, flags: number, at: number): ZonePose {
  return { x: x10 / 10, y: y10 / 10, hp, flags, at };
}

function clearFrames(): void {
  zoneFrames.clear();
}

/** Merges a `zone:loot` push into the running tally. */
function mergeLoot(current: ZoneLoot | null, next: ZoneLoot): ZoneLoot {
  if (!current) return { ...next, items: next.items.map((row) => ({ ...row })) };
  const items = current.items.map((row) => ({ ...row }));
  for (const row of next.items) {
    const held = items.find((item) => item.itemId === row.itemId);
    if (held) held.qty += row.qty;
    else items.push({ ...row });
  }
  return {
    exp: current.exp + next.exp,
    spiritStones: current.spiritStones + next.spiritStones,
    items,
    kills: current.kills + next.kills,
    bossKills: current.bossKills + next.bossKills,
    since: Math.min(current.since, next.since),
  };
}

/** Timer that clears `death` the moment the respawn is due. */
let respawnTimer: ReturnType<typeof setTimeout> | null = null;

function cancelRespawnTimer(): void {
  if (respawnTimer === null) return;
  clearTimeout(respawnTimer);
  respawnTimer = null;
}

/**
 * Shortest gap between two `zone:enter` sends.
 *
 * The server takes one 进图 a second per cultivator and answers anything closer
 * with `RATE_LIMITED` (`apps/server/src/engine/zone/socket.ts`). Two callers ask
 * on schedules of their own — `store/socket.ts` resyncs whenever the socket
 * opens, `shell/AppShell.tsx` re-enters when the tab becomes visible — and an
 * Android browser returning to the foreground trips both at once. The 100ms
 * over the server's second is slack for the jitter between two arrivals.
 */
const ENTER_MIN_GAP_MS = 1100;

/** Runs while the gap is unspent; a send made inside it waits for the flush. */
let enterGateTimer: ReturnType<typeof setTimeout> | null = null;

/** The last zone asked for during the wait; `null` asks the server to restore. */
let queuedEnter: { zoneId: string | null } | null = null;

/** Whether the running streak of `RATE_LIMITED` has had its silent retry. */
let enterRetried = false;

function openEnterGate(): void {
  enterGateTimer = setTimeout(() => {
    enterGateTimer = null;
    const queued = queuedEnter;
    queuedEnter = null;
    if (queued) sendEnter(queued.zoneId);
  }, ENTER_MIN_GAP_MS);
}

/**
 * Sends one `zone:enter`, or holds it until the gap runs out.
 *
 * Only the newest zone survives the wait: an enter and a resync inside one
 * window are the same question asked twice. `defer` holds a send back even with
 * the gap spent — a refused 进图 is worth repeating only once the server's own
 * second has run out.
 */
function sendEnter(zoneId: string | null, defer = false): void {
  if (enterGateTimer === null && !defer) {
    getSocket()?.emit('zone:enter', { zoneId });
    openEnterGate();
    return;
  }
  queuedEnter = { zoneId };
  if (enterGateTimer === null) openEnterGate();
}

function clearEnterQueue(): void {
  if (enterGateTimer !== null) clearTimeout(enterGateTimer);
  enterGateTimer = null;
  queuedEnter = null;
  enterRetried = false;
}

const EMPTY_BOSS = { alive: false, nextAt: null } as const;

export const useZoneStore = create<ZoneState>((set, get) => ({
  status: 'out',
  zoneId: null,
  self: null,
  enteredAt: null,
  roster: {},
  boss: EMPTY_BOSS,
  lastSeq: 0,
  loot: null,
  death: null,
  error: null,

  enter(zoneId) {
    const state = get();
    // Re-subscribing to the zone already on screen (waking the tab, resyncing)
    // must not blank it back to the skeleton.
    const watching = state.status === 'in' && state.zoneId === zoneId;
    set({ zoneId, status: watching ? 'in' : 'joining', error: null });
    sendEnter(zoneId);
  },

  /**
   * Stops the frames without leaving the field: the character keeps fighting
   * offline. Local state is kept as it was — the full frame that answers the
   * next `enter` replaces it wholesale.
   */
  leave() {
    getSocket()?.emit('zone:leave');
  },

  retreat() {
    getSocket()?.emit('zone:retreat');
    // The server answers with `zone:left`; going 'out' now keeps the button
    // honest even when the socket is asleep. The tally survives, so the 战果
    // card can still be read after walking out.
    cancelRespawnTimer();
    clearFrames();
    // A queued 进图 would walk straight back onto the field just left.
    queuedEnter = null;
    set({
      status: 'out',
      zoneId: null,
      self: null,
      enteredAt: null,
      roster: {},
      boss: EMPTY_BOSS,
      lastSeq: 0,
      death: null,
    });
  },

  /** Asks for a fresh full frame; `null` lets the server restore the zone. */
  resync() {
    sendEnter(get().zoneId);
  },

  applyJoined(payload) {
    const fresh = get().enteredAt !== payload.enteredAt || get().zoneId !== payload.zoneId;
    clearFrames();
    cancelRespawnTimer();
    enterRetried = false;
    set({
      status: 'in',
      zoneId: payload.zoneId,
      self: payload.self,
      enteredAt: payload.enteredAt,
      roster: {},
      lastSeq: 0,
      error: null,
      death: null,
      // A resync returns the same `enteredAt`, so the running tally survives it.
      ...(fresh ? { loot: null } : {}),
    });
    get().applyFrame(payload.frame);
  },

  applyFrame(frame) {
    const state = get();
    if (state.status === 'out') return;
    if (state.zoneId !== null && frame.zoneId !== state.zoneId) return;

    if (!frame.full) {
      // Delta frames are volatile: a gap means rows we will never see. Take the
      // frame's seq anyway so one lost packet asks for one resync, not a storm.
      if (frame.seq <= state.lastSeq) return;
      if (state.lastSeq > 0 && frame.seq > state.lastSeq + 1) {
        set({ lastSeq: frame.seq });
        get().resync();
        return;
      }
    }

    // Rows only churn when somebody arrives or leaves. Coordinates change every
    // frame and live in `zoneFrames`, so holding the roster's identity keeps a
    // 4 Hz stream from re-rendering the panels that only read who is here.
    const structural = frame.full || frame.add.length > 0 || frame.remove.length > 0;
    const roster: Record<number, ZoneRosterEntry> = frame.full ? {} : { ...state.roster };

    if (frame.full) {
      const kept = new Set(frame.add.map((entry) => entry.i));
      for (const slot of zoneFrames.keys()) if (!kept.has(slot)) zoneFrames.delete(slot);
    }

    for (const entry of frame.add) {
      // A slot is not an identity: the same one carrying a different occupant
      // starts a new track rather than easing out of the old one's position.
      if (roster[entry.i]?.id !== entry.id) zoneFrames.delete(entry.i);
      roster[entry.i] = entry;
      if (!entry.mainTreasure) {
        const track = zoneFrames.get(entry.i);
        if (track) track.shield = 0;
      }
    }

    for (const slot of frame.remove) {
      delete roster[slot];
      zoneFrames.delete(slot);
    }

    for (const [i, x10, y10, hp, flags, targetI, skillSlot] of frame.ents) {
      const track = zoneFrames.get(i);
      const pose = poseOf(x10, y10, hp, flags, frame.at);
      if (track) {
        track.prev = track.next;
        track.next = pose;
        track.targetI = targetI;
        track.skillSlot = skillSlot;
      } else {
        zoneFrames.set(i, { prev: { ...pose }, next: pose, targetI, skillSlot });
      }
    }

    if (frame.full) for (const track of zoneFrames.values()) track.shield = 0;
    for (const treasure of frame.treasureStates ?? []) {
      const track = zoneFrames.get(treasure.i);
      if (track && roster[treasure.i]?.mainTreasure) track.shield = treasure.shield;
    }

    const boss =
      state.boss.alive === frame.boss.alive && state.boss.nextAt === frame.boss.nextAt
        ? state.boss
        : frame.boss;

    set({
      ...(structural ? { roster } : {}),
      lastSeq: frame.seq,
      boss,
      ...(frame.full ? { status: 'in' as const } : {}),
    });
  },

  applyLeft(payload) {
    // `none` answers the restore the socket asks for on every connect: there was
    // no field to come back to. Somebody who was already 场外 never asked to
    // leave anything, so that pairing is a plain reset with nothing said. The
    // same reason reaching a tab that believed it was on a field is news, and
    // `LEFT_TEXT.none` is what it reads.
    const silent = payload.reason === 'none' && get().status === 'out';
    cancelRespawnTimer();
    clearFrames();
    set({
      status: 'out',
      zoneId: null,
      self: null,
      enteredAt: null,
      roster: {},
      boss: EMPTY_BOSS,
      lastSeq: 0,
      death: null,
    });
    if (silent) return;
    toast(LEFT_TEXT[payload.reason], payload.reason === 'retreat' ? 'gain' : 'info');
  },

  applyLoot(payload) {
    set({ loot: mergeLoot(get().loot, payload) });
    // 掉落 goes straight into the bag server-side, so the panel is stale now.
    if (payload.items.length > 0) void useInventoryStore.getState().load();
  },

  applyDeath(payload) {
    cancelRespawnTimer();
    set({ death: payload });
    const wait = Math.max(0, payload.respawnAt - Date.now());
    respawnTimer = setTimeout(() => {
      respawnTimer = null;
      if (get().death?.respawnAt === payload.respawnAt) set({ death: null });
    }, wait);
  },

  applyError(payload) {
    const state = get();
    // 走得太急了: the tab waking and the socket reconnecting both ask to enter,
    // and the server's gate refuses whichever lands second. The field is still
    // where it was, so the first refusal is answered by asking again once the
    // gate has reopened, with nothing said to the player and the screen left
    // alone. A second refusal in a row is a real one.
    if (payload.code === 'RATE_LIMITED' && state.zoneId !== null && !enterRetried) {
      enterRetried = true;
      sendEnter(state.zoneId, true);
      return;
    }
    // A restore — `zoneId: null`, sent whenever the socket opens — against a
    // server old enough to answer 「你此刻不在任何大地图上」 as an error. Nobody
    // asked for a field, so nothing is warned about; a NOT_FOUND for a zone the
    // player actually picked still is.
    if (payload.code === 'NOT_FOUND' && state.zoneId === null) {
      enterRetried = false;
      return;
    }
    enterRetried = false;
    set({ error: payload, ...(state.status === 'joining' ? { status: 'out' as const } : {}) });
    toast(payload.message, 'warn');
  },

  reset() {
    cancelRespawnTimer();
    clearEnterQueue();
    clearFrames();
    set({
      status: 'out',
      zoneId: null,
      self: null,
      enteredAt: null,
      roster: {},
      boss: EMPTY_BOSS,
      lastSeq: 0,
      loot: null,
      death: null,
      error: null,
    });
  },
}));

/** Session-sticky `?canvas=off` / `?canvas=on`, mirroring `?art=off`. */
const CANVAS_KEY = 'xianxia.zoneCanvas';

/**
 * Latches the query into the tab, at import time.
 *
 * Read at module load, as `store/art.ts` does, because by the time the 山河图
 * mounts the router has long since rewritten the URL — a switch that only
 * worked when it was typed on `/explore` itself would be a trap.
 */
function latchCanvasSwitch(): void {
  try {
    const asked = new URLSearchParams(window.location.search).get('canvas');
    if (asked === 'off') sessionStorage.setItem(CANVAS_KEY, 'off');
    if (asked === 'on') sessionStorage.removeItem(CANVAS_KEY);
  } catch {
    // No storage (private mode, a stripped-down webview): the canvas stays on.
  }
}

latchCanvasSwitch();

function canvasWanted(): boolean {
  try {
    return sessionStorage.getItem(CANVAS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Whether this browser can be handed the PixiJS field at all.
 *
 * jsdom and a WebGL-less browser get the DOM roster instead, and so does anyone
 * who asked for reduced motion — a screen full of easing sprites is exactly
 * what that setting is about. `?canvas=off` forces the same path deliberately,
 * which is how the fallback gets looked at; it is kept separate from `?art=off`
 * so bitmaps can still be compared against placeholders on the painted field.
 */
export function canUseZoneCanvas(): boolean {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return false;
  if (navigator.userAgent.includes('jsdom')) return false;
  if (!canvasWanted()) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
