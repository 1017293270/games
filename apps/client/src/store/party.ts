import { create } from 'zustand';
import type {
  DungeonResultEvent,
  DungeonStartEvent,
  Party,
  PartyUpdate,
} from '@xianxia/shared';
import { api } from '../api/endpoints';
import { ApiError, errorMessage } from '../api/http';
import { toast } from './ui';

/** Wording for each reason the server may attach to a `party:update`. */
const REASON_TEXT: Record<PartyUpdate['reason'], (who: string) => string> = {
  joined: (who) => `${who} 入队`,
  left: (who) => `${who} 离队`,
  kicked: (who) => `${who} 被请出队伍`,
  disbanded: () => '队伍已散',
  leader_changed: (who) => `${who} 接任队长`,
  sync: () => '',
};

interface PartyState {
  party: Party | null;
  loading: boolean;
  busy: boolean;
  /**
   * True while this client is the one that called `dungeon/start`. The server
   * broadcasts `dungeon:result` to the whole party room, initiator included,
   * so the caller must not play the run twice.
   */
  selfRun: boolean;
  /** A party run someone else started, waiting to be played. */
  incomingRun: DungeonResultEvent | null;

  load: () => Promise<void>;
  create: () => Promise<void>;
  join: (code: string) => Promise<boolean>;
  leave: () => Promise<void>;
  kick: (characterId: string) => Promise<void>;

  applyUpdate: (update: PartyUpdate) => void;
  markSelfRun: () => void;
  receiveDungeonStart: (event: DungeonStartEvent) => void;
  receiveDungeonResult: (event: DungeonResultEvent) => void;
  clearIncomingRun: () => void;
  reset: () => void;
}

export const usePartyStore = create<PartyState>((set, get) => ({
  party: null,
  loading: false,
  busy: false,
  selfRun: false,
  incomingRun: null,

  async load() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const result = await api.party();
      set({ party: result.party, loading: false });
    } catch (error) {
      set({ loading: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async create() {
    if (get().busy) return;
    set({ busy: true });
    try {
      set({ party: await api.createParty(), busy: false });
    } catch (error) {
      set({ busy: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async join(code) {
    if (get().busy) return false;
    set({ busy: true });
    try {
      const party = await api.joinParty(code.trim().toUpperCase());
      set({ party, busy: false });
      toast(`已入 ${party.members.find((m) => m.isLeader)?.name ?? '队伍'} 的队`, 'gain');
      return true;
    } catch (error) {
      set({ busy: false });
      // A wrong code is the common case here, so it reads as a hint, not a fault.
      const code404 = error instanceof ApiError && error.code === 'PARTY_NOT_FOUND';
      toast(code404 ? '这个邀请码下没有队伍' : errorMessage(error), 'warn');
      return false;
    }
  },

  async leave() {
    if (get().busy) return;
    set({ busy: true });
    try {
      await api.leaveParty();
      set({ party: null, busy: false });
    } catch (error) {
      set({ busy: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async kick(characterId) {
    if (get().busy) return;
    set({ busy: true });
    try {
      set({ party: await api.kickPartyMember(characterId), busy: false });
    } catch (error) {
      set({ busy: false });
      toast(errorMessage(error), 'warn');
    }
  },

  applyUpdate(update) {
    set({ party: update.party });
    const line = REASON_TEXT[update.reason](update.actorName ?? '有人');
    if (line) toast(line, update.reason === 'joined' ? 'gain' : 'info');
  },

  markSelfRun() {
    set({ selfRun: true });
  },

  receiveDungeonStart(event) {
    if (get().selfRun) return;
    toast(`队伍已入 ${event.dungeonName}`, 'info');
  },

  receiveDungeonResult(event) {
    if (get().selfRun) {
      set({ selfRun: false });
      return;
    }
    set({ incomingRun: event });
  },

  clearIncomingRun() {
    set({ incomingRun: null });
  },

  reset() {
    set({ party: null, selfRun: false, incomingRun: null, busy: false, loading: false });
  },
}));
