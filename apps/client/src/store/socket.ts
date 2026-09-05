import { connectSocket, type GameSocket } from '../api/socket';
import { useArenaStore } from './arena';
import { useCharacterStore } from './character';
import { useChatStore } from './chat';
import { useFriendsStore } from './friends';
import { usePartyStore } from './party';
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

  next.on('party:update', (update) => {
    usePartyStore.getState().applyUpdate(update);
  });

  // A party run is broadcast to the whole room, initiator included; the party
  // store drops the copy belonging to whoever pressed the button.
  next.on('dungeon:start', (event) => {
    usePartyStore.getState().receiveDungeonStart(event);
  });

  next.on('dungeon:result', (event) => {
    usePartyStore.getState().receiveDungeonResult(event);
  });

  next.on('arena:challenged', (event) => {
    useArenaStore.getState().receiveChallenge(event);
  });

  next.on('raid:update', (event) => {
    useArenaStore.getState().applyRaidUpdate(event);
  });

  next.on('friend:request', (event) => {
    useFriendsStore.getState().receiveRequest(event);
  });
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
  openedFor = null;
}
