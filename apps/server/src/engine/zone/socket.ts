import {
  CLIENT_EVENT_SCHEMAS,
  ROOMS,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@xianxia/shared';
import type { Socket } from 'socket.io';
import type { AppContext } from '../../context.js';
import type { GameServer } from '../../realtime.js';

/**
 * 战斗大地图 socket handlers.
 *
 * Kept out of `socket.ts` because the zone channel has three events, a room
 * dance and a throttle of its own; `socket.ts` only calls
 * `registerZoneSocketHandlers` once per connection.
 *
 * Two things are deliberately distinct here:
 *
 *   *standing on the field* — `ZoneService` owns it, survives a disconnect, and
 *   keeps earning 修为 with nobody watching;
 *   *watching the field* — the zone room, which is per socket.
 *
 * So `zone:leave` closes one tab's viewport and nothing else, while
 * `zone:retreat` is the only event that takes the cultivator off the map. Room
 * membership is driven through `ROOMS.character`, the same handle
 * `modules/party/service.ts` uses, so every tab a player has open follows the
 * one cultivator they share.
 */

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** One 进图 attempt a second per cultivator, matching the chat throttle's shape. */
export const ZONE_ENTER_MIN_INTERVAL_MS = 1000;

/** Last accepted `zone:enter` per character. */
const lastEnterAt = new Map<string, number>();

export function registerZoneSocketHandlers(
  io: GameServer,
  socket: GameSocket,
  ctx: AppContext,
): void {
  const { characterId } = socket.data;

  socket.on('zone:enter', (payload: unknown) => {
    const parsed = CLIENT_EVENT_SCHEMAS['zone:enter'].safeParse(payload);
    if (!parsed.success) return;

    const now = ctx.now();
    const previousAttempt = lastEnterAt.get(characterId) ?? 0;
    if (now - previousAttempt < ZONE_ENTER_MIN_INTERVAL_MS) {
      socket.emit('zone:error', { code: 'RATE_LIMITED', message: '走得太急了，缓一口气再进图' });
      return;
    }
    lastEnterAt.set(characterId, now);

    // Where the cultivator stands *before* the call: an `enter` that moves it to
    // another field has to take the old room's frames away with it.
    const standing = ctx.zones.zoneOf(characterId);
    const requested = parsed.data.zoneId;
    const result =
      requested === null
        ? ctx.zones.resume(characterId, now)
        : ctx.zones.enter(characterId, requested, now);

    // `resume` answers null when the cultivator is on no field at all — there is
    // nothing to restore, which is the ordinary answer for a client that asks on
    // every reconnect. So it is reported as a 离场 that already happened rather
    // than an error: `none` is the leave reason the contract keeps for it, and a
    // client that is not on a map has nothing to be warned about. An explicit
    // `zone:enter` for a field that does not exist still comes back as an error,
    // because that one is a request that failed.
    if (result === null) {
      socket.emit('zone:left', { reason: 'none' });
      return;
    }
    if (!result.ok) {
      socket.emit('zone:error', { code: result.code, message: result.message });
      return;
    }

    joinZoneRoom(io, characterId, result.zoneId, [standing, socket.data.zoneId]);
    socket.data.zoneId = result.zoneId;

    // To the character room, not this socket: a second tab that was already
    // watching must see the same field, and the frame it needs to draw it.
    ctx.realtime.toCharacter(characterId, 'zone:joined', {
      zoneId: result.zoneId,
      self: result.self,
      enteredAt: result.enteredAt,
      frame: result.frame,
    });
  });

  // `zone:leave` and `zone:retreat` carry no payload — their entries in
  // `CLIENT_EVENT_SCHEMAS` are `z.void()`, so there is nothing to validate and
  // the typed contract gives the listener no argument to take.

  socket.on('zone:leave', () => {
    // Only this tab stops watching. The cultivator stays on the field and keeps
    // farming, which is the whole point of the 挂机 map.
    const watching = socket.data.zoneId;
    if (watching) void socket.leave(ROOMS.zone(watching));
    socket.data.zoneId = null;
  });

  socket.on('zone:retreat', () => {
    const now = ctx.now();
    const standing = ctx.zones.zoneOf(characterId);
    ctx.zones.retreat(characterId, now);

    // Emitted whether or not the cultivator was still standing there: a client
    // that retreats twice, or retreats after being swept off the field, has to
    // see its 退出 resolve either way.
    leaveZoneRoom(io, characterId, [standing, socket.data.zoneId]);
    socket.data.zoneId = null;
    ctx.realtime.toCharacter(characterId, 'zone:left', { reason: 'retreat' });
  });

  // Disconnect needs no handler: Socket.IO drops the socket from every room on
  // its own, and the cultivator is meant to stay on the field.
}

/** Moves every tab the character has open into `zoneId`, out of `previous`. */
function joinZoneRoom(
  io: GameServer,
  characterId: string,
  zoneId: string,
  previous: readonly (string | null)[],
): void {
  const room = ROOMS.character(characterId);
  for (const old of new Set(previous)) {
    if (old && old !== zoneId) io.in(room).socketsLeave(ROOMS.zone(old));
  }
  io.in(room).socketsJoin(ROOMS.zone(zoneId));
  stampZoneId(io, characterId, zoneId);
}

/** Takes every tab out of whichever zone rooms the character was watching. */
function leaveZoneRoom(
  io: GameServer,
  characterId: string,
  zones: readonly (string | null)[],
): void {
  const room = ROOMS.character(characterId);
  for (const zoneId of new Set(zones)) {
    if (zoneId) io.in(room).socketsLeave(ROOMS.zone(zoneId));
  }
  stampZoneId(io, characterId, null);
}

/**
 * Keeps `SocketData.zoneId` honest on the character's other tabs.
 *
 * Best effort, exactly as `stampPartyId` is: the room membership above is what
 * actually routes frames, and this socket's own field is set synchronously by
 * the caller.
 */
function stampZoneId(io: GameServer, characterId: string, zoneId: string | null): void {
  void io
    .in(ROOMS.character(characterId))
    .fetchSockets()
    .then((sockets) => {
      for (const socket of sockets) socket.data.zoneId = zoneId;
    })
    .catch(() => {
      // The authoritative answer is `ZoneService.zoneOf`; this field is only the
      // handle for leaving a room later, and a stale one leaves a room the
      // socket is not in, which is a no-op.
    });
}
