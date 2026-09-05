import { create } from 'zustand';

export type ToastTone = 'info' | 'warn' | 'gain';

export interface Toast {
  id: string;
  text: string;
  tone: ToastTone;
}

interface UiState {
  toasts: Toast[];
  /** Character id whose public profile drawer is open. */
  profileId: string | null;
  onlineCount: number;
  /**
   * How many layers are stacked over the page right now — modals, sheets,
   * replays, toasts. `Overlay` keeps the count; anything that must not pile on
   * top of what the player is already watching waits for it to reach zero.
   */
  overlayDepth: number;
  pushToast: (text: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
  openProfile: (characterId: string) => void;
  closeProfile: () => void;
  setOnlineCount: (count: number) => void;
  openOverlay: () => void;
  closeOverlay: () => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  profileId: null,
  onlineCount: 0,
  overlayDepth: 0,

  pushToast(text, tone = 'info') {
    toastSeq += 1;
    const id = `toast-${toastSeq}`;
    set((state) => ({ toasts: [...state.toasts, { id, text, tone }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3600);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  openProfile(characterId) {
    set({ profileId: characterId });
  },

  closeProfile() {
    set({ profileId: null });
  },

  setOnlineCount(count) {
    set({ onlineCount: count });
  },

  openOverlay() {
    set((state) => ({ overlayDepth: state.overlayDepth + 1 }));
  },

  closeOverlay() {
    set((state) => ({ overlayDepth: Math.max(0, state.overlayDepth - 1) }));
  },
}));

/** Imperative toast for non-React callers (api errors, socket handlers). */
export function toast(text: string, tone: ToastTone = 'info'): void {
  useUiStore.getState().pushToast(text, tone);
}
