import { create } from 'zustand';
import type { ChatMessage, SystemNotice } from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { getSocket } from './socket';
import { toast } from './ui';

/** How many rows a channel keeps in memory. */
const SCROLLBACK = 120;

/**
 * Chat, in two transcripts.
 *
 * 世界 and 队伍 are separate scrollbacks kept side by side rather than one list
 * filtered on read, so switching tabs does not lose the other channel's place.
 * System broadcasts are world-wide and ride in the 世界 transcript.
 *
 * 队伍 scrollback belongs to a party, not to the player: `partyId` records
 * whose it is, and joining a different party drops it rather than showing the
 * last party's talk to the new one.
 */
export type ReadableChannel = 'world' | 'party';

interface ChatState {
  /** Which transcript the panel is showing. */
  channel: ReadableChannel;
  messages: Record<ReadableChannel, ChatMessage[]>;
  loaded: Record<ReadableChannel, boolean>;
  loading: boolean;
  /** The party the 队伍 transcript belongs to; null when out of a party. */
  partyId: string | null;

  setChannel: (channel: ReadableChannel) => void;
  /** Drops the 队伍 transcript when the party changes or ends. */
  syncParty: (partyId: string | null) => void;
  loadHistory: (channel: ReadableChannel) => Promise<void>;
  push: (message: ChatMessage) => void;
  pushNotice: (notice: SystemNotice) => void;
  send: (text: string) => void;
  reset: () => void;
}

let noticeSeq = 0;

const EMPTY: Record<ReadableChannel, ChatMessage[]> = { world: [], party: [] };
const UNLOADED: Record<ReadableChannel, boolean> = { world: false, party: false };

export const useChatStore = create<ChatState>((set, get) => ({
  channel: 'world',
  messages: EMPTY,
  loaded: UNLOADED,
  loading: false,
  partyId: null,

  setChannel(channel) {
    set({ channel });
  },

  syncParty(partyId) {
    const state = get();
    if (state.partyId === partyId) return;
    set({
      partyId,
      messages: { ...state.messages, party: [] },
      loaded: { ...state.loaded, party: false },
      // Nothing to show on a channel you are no longer on.
      channel: partyId === null && state.channel === 'party' ? 'world' : state.channel,
    });
  },

  async loadHistory(channel) {
    const state = get();
    if (state.loading) return;
    // 队伍频道 scrollback is asked for by party; without one there is nothing
    // to ask for, and the server would refuse anyway.
    const partyId = state.partyId;
    if (channel === 'party' && partyId === null) return;

    set({ loading: true });
    try {
      const result = await api.chatHistory({
        channel,
        limit: 50,
        ...(channel === 'party' && partyId !== null ? { partyId } : {}),
      });
      set((current) => ({
        messages: { ...current.messages, [channel]: result.messages },
        loaded: { ...current.loaded, [channel]: true },
        loading: false,
      }));
    } catch (error) {
      set({ loading: false });
      toast(errorMessage(error), 'warn');
    }
  },

  push(message) {
    // System broadcasts are world news, so they land in the 世界 transcript.
    const into: ReadableChannel = message.channel === 'party' ? 'party' : 'world';
    set((state) => {
      const held = state.messages[into];
      if (held.some((m) => m.id === message.id)) return state;
      return { messages: { ...state.messages, [into]: [...held, message].slice(-SCROLLBACK) } };
    });
  },

  /** System broadcasts share the transcript, rendered as a rule-set line. */
  pushNotice(notice) {
    noticeSeq += 1;
    get().push({
      id: `notice-${noticeSeq}-${notice.at}`,
      channel: 'system',
      senderId: notice.characterId,
      senderName: '',
      senderStageName: null,
      text: notice.text,
      sentAt: notice.at,
    });
  },

  send(text) {
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;
    const socket = getSocket();
    if (!socket) {
      toast('尚未连上世界频道', 'warn');
      return;
    }
    socket.emit('chat:send', { channel: get().channel, text: trimmed });
  },

  reset() {
    set({
      channel: 'world',
      messages: EMPTY,
      loaded: UNLOADED,
      loading: false,
      partyId: null,
    });
  },
}));
