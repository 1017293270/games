import { create } from 'zustand';
import type { User } from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage, setTokenSource } from '../api/http';

const TOKEN_KEY = 'xianxia.token';

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing or blocked storage: the session simply won't survive a
    // reload, which is a degradation rather than a failure.
  }
}

interface SessionState {
  token: string | null;
  user: User | null;
  /** `serverTime - Date.now()` at the last `GET /auth/me`. */
  clockOffsetMs: number;
  status: 'boot' | 'anon' | 'ready';
  busy: boolean;
  error: string | null;
  restore: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, inviteCode?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  markCharacterCreated: (characterId: string) => void;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: readStoredToken(),
  user: null,
  clockOffsetMs: 0,
  status: 'boot',
  busy: false,
  error: null,

  async restore() {
    const token = get().token;
    if (!token) {
      set({ status: 'anon' });
      return;
    }
    try {
      const me = await api.me();
      set({
        user: me.user,
        clockOffsetMs: me.serverTime - Date.now(),
        status: 'ready',
      });
    } catch {
      writeStoredToken(null);
      set({ token: null, user: null, status: 'anon' });
    }
  },

  async login(username, password) {
    set({ busy: true, error: null });
    try {
      const session = await api.login({ username, password });
      writeStoredToken(session.token);
      set({ token: session.token, user: session.user, status: 'ready', busy: false });
      return true;
    } catch (error) {
      set({ busy: false, error: errorMessage(error) });
      return false;
    }
  },

  async register(username, password, inviteCode) {
    set({ busy: true, error: null });
    try {
      const session = await api.register(
        inviteCode ? { username, password, inviteCode } : { username, password },
      );
      writeStoredToken(session.token);
      set({ token: session.token, user: session.user, status: 'ready', busy: false });
      return true;
    } catch (error) {
      set({ busy: false, error: errorMessage(error) });
      return false;
    }
  },

  async logout() {
    try {
      await api.logout();
    } catch {
      // Losing the server-side session is fine; the local one goes regardless.
    }
    writeStoredToken(null);
    set({ token: null, user: null, status: 'anon', error: null });
  },

  markCharacterCreated(characterId) {
    const user = get().user;
    if (user) set({ user: { ...user, characterId } });
  },

  clearError() {
    set({ error: null });
  },
}));

setTokenSource(() => useSessionStore.getState().token);

/** Wall clock corrected by the offset reported by `GET /api/auth/me`. */
export function serverNow(): number {
  return Date.now() + useSessionStore.getState().clockOffsetMs;
}
