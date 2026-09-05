import { create } from 'zustand';
import type { RankingBoard, RankingEntry } from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { toast } from './ui';

const PAGE_SIZE = 20;

interface RankingsState {
  board: RankingBoard;
  entries: RankingEntry[];
  page: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  setBoard: (board: RankingBoard) => Promise<void>;
  load: (page?: number) => Promise<void>;
}

export const useRankingsStore = create<RankingsState>((set, get) => ({
  board: 'realm',
  entries: [],
  page: 1,
  total: 0,
  hasMore: false,
  loading: false,

  async setBoard(board) {
    if (board === get().board && get().entries.length) return;
    set({ board, entries: [], page: 1 });
    await get().load(1);
  },

  async load(page = 1) {
    set({ loading: true });
    try {
      const result = await api.rankings({ board: get().board, page, pageSize: PAGE_SIZE });
      set({
        entries: page === 1 ? result.items : [...get().entries, ...result.items],
        page: result.page,
        total: result.total,
        hasMore: result.hasMore,
        loading: false,
      });
    } catch (error) {
      set({ loading: false });
      toast(errorMessage(error), 'warn');
    }
  },
}));
