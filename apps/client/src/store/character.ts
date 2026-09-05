import { create } from 'zustand';
import type {
  BreakthroughResponse,
  CharacterUpdate,
  CharacterView,
  SettleResponse,
} from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { toast } from './ui';

interface CharacterStoreState {
  view: CharacterView | null;
  /** `Date.now()` when `view` was captured; the base for local interpolation. */
  viewAt: number;
  loading: boolean;
  error: string | null;
  /** Result of the most recent settle, held for the 闭关归来 summary. */
  lastSettle: SettleResponse | null;
  load: () => Promise<void>;
  settle: (options?: { silent?: boolean }) => Promise<SettleResponse | null>;
  breakthrough: (pills: number) => Promise<BreakthroughResponse | null>;
  setView: (view: CharacterView) => void;
  applyPatch: (patch: CharacterUpdate) => void;
  clearSettle: () => void;
  reset: () => void;
}

export const useCharacterStore = create<CharacterStoreState>((set, get) => ({
  view: null,
  viewAt: 0,
  loading: false,
  error: null,
  lastSettle: null,

  setView(view) {
    set({ view, viewAt: Date.now(), error: null });
  },

  async load() {
    set({ loading: true });
    try {
      const view = await api.getCharacter();
      set({ view, viewAt: Date.now(), loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  async settle(options) {
    try {
      const result = await api.settle();
      set({ view: result.view, viewAt: Date.now(), lastSettle: result });
      return result;
    } catch (error) {
      if (!options?.silent) toast(errorMessage(error), 'warn');
      return null;
    }
  },

  async breakthrough(pills) {
    try {
      const result = await api.breakthrough(pills);
      set({ view: result.view, viewAt: Date.now() });
      return result;
    } catch (error) {
      toast(errorMessage(error), 'warn');
      return null;
    }
  },

  /**
   * Merges an incremental `character:update` from the socket. Only the fields
   * the server actually sent are touched, so a patch never blanks the rest.
   */
  applyPatch(patch) {
    const current = get().view;
    if (!current || current.character.id !== patch.id) return;
    const { id: _id, stageName: patchedStageName, ...fields } = patch;
    set({
      view: {
        ...current,
        character: { ...current.character, ...fields },
        stageName: patchedStageName ?? current.stageName,
      },
      viewAt: Date.now(),
    });
  },

  clearSettle() {
    set({ lastSettle: null });
  },

  reset() {
    set({ view: null, viewAt: 0, lastSettle: null, error: null, loading: false });
  },
}));
