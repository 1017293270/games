import { connectSocket, type GameSocket } from '../api/socket';
import { useCharacterStore } from './character';
import { useChatStore } from './chat';
import { useUiStore } from './ui';

/**
 * One socket per session, opened after login and torn down on logout. Inbound
 * events are fanned out to the stores that own each slice of state.
 */
let socket: GameSocket | null = null;
let openedFor: string | null = null;

export function getSocket(): GameSocket | null {
  return socket;
}

export function openSocket(token: string): void {
  if (socket && openedFor === token) return;
  closeSocket();

  const next = connectSocket(token);
  socket = next;
  openedFor = token;

  next.on('chat:message', (message) => {
    useChatStore.getState().push(message);
  });

  next.on('system:notice', (notice) => {
    useChatStore.getState().pushNotice(notice);
  });

  next.on('character:update', (patch) => {
    useCharacterStore.getState().applyPatch(patch);
  });

  next.on('presence:update', (presence) => {
    useUiStore.getState().setOnlineCount(presence.onlineCount);
  });
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
  openedFor = null;
}
