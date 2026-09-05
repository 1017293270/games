import type { Server as IoServer } from 'socket.io';
import {
  ROOMS,
  stageName,
  type CharacterState,
  type CharacterUpdate,
  type ChatMessage,
  type ClientToServerEvents,
  type InterServerEvents,
  type PresenceUpdate,
  type ServerToClientEvents,
  type SocketData,
  type SystemNotice,
} from '@xianxia/shared';
import type { PresenceTracker } from './game/presence.js';

export type GameServer = IoServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * The push side of the game.
 *
 * Modules call these helpers instead of reaching for `io` directly, which keeps
 * room naming in one place and lets the whole server run under `app.inject()`
 * with no Socket.IO attached at all — every emit becomes a no-op.
 */
export class Realtime {
  private io: GameServer | null = null;

  constructor(private readonly presence: PresenceTracker) {}

  attach(io: GameServer): void {
    this.io = io;
  }

  detach(): void {
    this.io = null;
  }

  get server(): GameServer | null {
    return this.io;
  }

  /** Pushes to every socket the character has open. */
  toCharacter<E extends keyof ServerToClientEvents>(
    characterId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.io?.to(ROOMS.character(characterId)).emit(event, ...args);
  }

  /** Pushes to everyone in the world room. */
  toWorld<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.io?.to(ROOMS.world()).emit(event, ...args);
  }

  toParty<E extends keyof ServerToClientEvents>(
    partyId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.io?.to(ROOMS.party(partyId)).emit(event, ...args);
  }

  chat(message: ChatMessage, partyId: string | null = null): void {
    if (message.channel === 'party' && partyId) this.toParty(partyId, 'chat:message', message);
    else this.toWorld('chat:message', message);
  }

  notice(notice: SystemNotice): void {
    this.toWorld('system:notice', notice);
  }

  presenceUpdate(characterId: string, name: string, online: boolean): void {
    const payload: PresenceUpdate = {
      characterId,
      name,
      online,
      onlineCount: this.presence.count,
    };
    this.toWorld('presence:update', payload);
  }

  /**
   * Sends the fields that just changed on a character.
   * Called after every settle, breakthrough and gear change.
   */
  characterUpdate(state: CharacterState, extra: Partial<CharacterUpdate> = {}): void {
    const payload: CharacterUpdate = {
      id: state.id,
      stageIndex: state.stageIndex,
      exp: state.exp,
      spiritStones: state.spiritStones,
      powerScore: state.powerScore,
      stageName: stageName(state.stageIndex),
      lastSettledAt: state.lastSettledAt,
      ...extra,
    };
    this.toCharacter(state.id, 'character:update', payload);
  }
}
