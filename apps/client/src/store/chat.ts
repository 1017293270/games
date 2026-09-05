import { create } from 'zustand';
import type { ChatMessage, SystemNotice } from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { getSocket } from './socket';
import { toast } from './ui';

/** How many rows the world channel keeps in memory. */
const SCROLLBACK = 120;

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  loaded: boolean;
  loadHistory: () => Promise<void>;
  push: (message: ChatMessage) => void;
  pushNotice: (notice: SystemNotice) => void;
  send: (text: string) => void;
}

let noticeSeq = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  loaded: false,

  async loadHistory() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const result = await api.chatHistory({ channel: 'world', limit: 50 });
      set({ messages: result.messages, loading: false, loaded: true });
    } catch (error) {
      set({ loading: false });
      toast(errorMessage(error), 'warn');
    }
  },

  push(message) {
    set((state) => {
      if (state.messages.some((m) => m.id === message.id)) return state;
      return { messages: [...state.messages, message].slice(-SCROLLBACK) };
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
    socket.emit('chat:send', { channel: 'world', text: trimmed });
  },
}));
