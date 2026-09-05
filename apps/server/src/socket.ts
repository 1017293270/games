import { Server } from 'socket.io';
import {
  CLIENT_EVENT_SCHEMAS,
  HandshakeAuthSchema,
  ROOMS,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@xianxia/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';
import type { GameServer } from './realtime.js';
import { CHAT_MIN_INTERVAL_MS, recordMessage } from './modules/social/service.js';

/**
 * Socket.IO wiring.
 *
 * The handshake carries the same token `POST /api/auth/login` returned; a
 * socket that cannot present a live session is disconnected before it joins any
 * room. Every inbound payload is re-validated with `CLIENT_EVENT_SCHEMAS` —
 * socket frames are exactly as untrusted as request bodies.
 */

/** Last accepted chat line per character, for the one-a-second throttle. */
const lastChatAt = new Map<string, number>();

export function attachSocketIo(app: FastifyInstance, ctx: AppContext): GameServer {
  const io: GameServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(app.server, {
    cors: { origin: true, credentials: true },
    // The client reconnects on its own; a short window keeps presence honest.
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    const parsed = HandshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    const now = ctx.now();
    const session = ctx.sessions.find(parsed.data.token, now);
    if (!session) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    const user = ctx.users.byId(session.userId);
    if (!user || user.banned) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    const character = ctx.characters.byUserId(user.id);
    if (!character) {
      next(new Error('CHARACTER_NOT_FOUND'));
      return;
    }

    socket.data.userId = user.id;
    socket.data.characterId = character.id;
    socket.data.isAdmin = user.isAdmin;
    socket.data.partyId = null;
    next();
  });

  io.on('connection', (socket) => {
    const { characterId } = socket.data;
    const now = ctx.now();

    void socket.join(ROOMS.world());
    void socket.join(ROOMS.character(characterId));

    const character = ctx.characters.byId(characterId);
    const name = character?.name ?? '无名修士';
    if (character) ctx.characters.touchSeen(characterId, now);

    if (ctx.presence.join(characterId)) {
      ctx.realtime.presenceUpdate(characterId, name, true);
    } else {
      // A second tab: tell just this socket the current headcount.
      socket.emit('presence:update', {
        characterId,
        name,
        online: true,
        onlineCount: ctx.presence.count,
      });
    }

    socket.on('presence:ping', () => {
      ctx.characters.touchSeen(characterId, ctx.now());
    });

    socket.on('chat:send', (payload: unknown) => {
      const parsed = CLIENT_EVENT_SCHEMAS['chat:send'].safeParse(payload);
      if (!parsed.success) return;

      const at = ctx.now();
      const previous = lastChatAt.get(characterId) ?? 0;
      if (at - previous < CHAT_MIN_INTERVAL_MS) return;

      const speaker = ctx.characters.byId(characterId);
      if (!speaker) return;
      lastChatAt.set(characterId, at);

      // 队伍频道 needs a party to route to; that arrives with the party module,
      // so until then every line lands in 世界频道.
      const message = recordMessage(
        ctx,
        {
          channel: 'world',
          senderId: speaker.id,
          senderName: speaker.name,
          stageIndex: speaker.stageIndex,
          text: parsed.data.text,
        },
        ctx.settings.get(),
        at,
      );
      ctx.realtime.chat(message);
    });

    socket.on('disconnect', () => {
      if (ctx.presence.leave(characterId)) {
        ctx.characters.touchSeen(characterId, ctx.now());
        ctx.realtime.presenceUpdate(characterId, name, false);
      }
    });
  });

  ctx.realtime.attach(io);
  return io;
}
