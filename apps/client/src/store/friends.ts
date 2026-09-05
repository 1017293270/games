import { create } from 'zustand';
import type { Friend, FriendRequestEvent } from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { toast } from './ui';

/** Accepted first, then requests waiting on you, then the ones you sent. */
const ORDER: Record<Friend['state'], number> = { pending_in: 0, accepted: 1, pending_out: 2 };

function sortFriends(friends: Friend[]): Friend[] {
  return [...friends].sort(
    (a, b) =>
      ORDER[a.state] - ORDER[b.state] ||
      Number(b.online) - Number(a.online) ||
      b.powerScore - a.powerScore,
  );
}

interface FriendsState {
  friends: Friend[];
  loading: boolean;
  loaded: boolean;
  busyId: string | null;
  load: () => Promise<void>;
  request: (characterId: string) => Promise<boolean>;
  accept: (characterId: string) => Promise<void>;
  remove: (characterId: string) => Promise<void>;
  /** A `friend:request` arrived; refresh so the new row carries a real profile. */
  receiveRequest: (event: FriendRequestEvent) => void;
  reset: () => void;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  loading: false,
  loaded: false,
  busyId: null,

  async load() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const result = await api.friends();
      set({ friends: sortFriends(result.friends), loading: false, loaded: true });
    } catch (error) {
      set({ loading: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async request(characterId) {
    set({ busyId: characterId });
    try {
      await api.friendRequest(characterId);
      set({ busyId: null });
      toast('已递上名帖，静候回音', 'gain');
      await get().load();
      return true;
    } catch (error) {
      set({ busyId: null });
      toast(errorMessage(error), 'warn');
      return false;
    }
  },

  async accept(characterId) {
    set({ busyId: characterId });
    try {
      const result = await api.friendAccept(characterId);
      set({ friends: sortFriends(result.friends), busyId: null });
      toast('自此互为道友', 'gain');
    } catch (error) {
      set({ busyId: null });
      toast(errorMessage(error), 'warn');
    }
  },

  async remove(characterId) {
    set({ busyId: characterId });
    try {
      const result = await api.friendRemove(characterId);
      set({ friends: sortFriends(result.friends), busyId: null });
    } catch (error) {
      set({ busyId: null });
      toast(errorMessage(error), 'warn');
    }
  },

  receiveRequest(event) {
    toast(`${event.fromName}（${event.fromStageName}）想结为道友`, 'info');
    void get().load();
  },

  reset() {
    set({ friends: [], loaded: false, loading: false, busyId: null });
  },
}));
