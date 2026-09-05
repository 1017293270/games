import { io } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@xianxia/shared';

/**
 * The slice of Socket.IO the game actually uses. Keeping it explicit lets the
 * mock world provide the same surface without pretending to be a real socket.
 */
export interface GameSocket {
  on<K extends keyof ServerToClientEvents>(event: K, fn: ServerToClientEvents[K]): void;
  off<K extends keyof ServerToClientEvents>(event: K, fn?: ServerToClientEvents[K]): void;
  emit<K extends keyof ClientToServerEvents>(
    event: K,
    ...args: Parameters<ClientToServerEvents[K]>
  ): void;
  disconnect(): void;
}

export type SocketFactory = (token: string) => GameSocket;

const realFactory: SocketFactory = (token) => {
  // socket.io-client 4.8.3 ships a non-generic `io()`, so the event maps are
  // applied at this boundary instead: `GameSocket` listens to S2C and emits
  // C2S, the mirror of the server's `Server<C2S, S2C>`.
  const socket = io(window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 8_000,
  });
  return socket as unknown as GameSocket;
};

let factory: SocketFactory = realFactory;

/** `src/api/mock` swaps in a timer-driven shim here. */
export function setSocketFactory(next: SocketFactory | null): void {
  factory = next ?? realFactory;
}

export function connectSocket(token: string): GameSocket {
  return factory(token);
}
