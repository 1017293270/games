import { connectSocket, type GameSocket } from '../api/socket';
import { useArenaStore } from './arena';
import { useCharacterStore } from './character';
import { useChatStore } from './chat';
import { useFriendsStore } from './friends';
import { usePartyStore } from './party';
import { useUiStore } from './ui';
import { useZoneStore } from './zone';

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

  // 战斗大地图. The character may already be on a field from a previous session,
  // so the socket asks the server to restore it as soon as it opens; a `null`
  // zone is answered with nothing when there is no field to come back to.
  next.on('zone:joined', (payload) => {
    useZoneStore.getState().applyJoined(payload);
  });

  next.on('zone:frame', (frame) => {
    useZoneStore.getState().applyFrame(frame);
  });

  next.on('zone:left', (payload) => {
    useZoneStore.getState().applyLeft(payload);
  });

  next.on('zone:loot', (payload) => {
    useZoneStore.getState().applyLoot(payload);
  });

  next.on('zone:death', (payload) => {
    useZoneStore.getState().applyDeath(payload);
  });

  next.on('zone:error', (payload) => {
    useZoneStore.getState().applyError(payload);
  });

  useZoneStore.getState().resync();
}

export function closeSocket(): void {
  useZoneStore.getState().reset();
  socket?.disconnect();
  socket = null;
  openedFor = null;
}
