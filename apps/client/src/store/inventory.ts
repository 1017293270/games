import { create } from 'zustand';
import type { EquipSlot, InventoryListResponse } from '@xianxia/shared';
import { api } from '../api/endpoints';
import { errorMessage } from '../api/http';
import { useCharacterStore } from './character';
import { toast } from './ui';

interface InventoryState {
  data: InventoryListResponse | null;
  loading: boolean;
  load: () => Promise<void>;
  use: (uid: string, qty?: number) => Promise<void>;
  equip: (uid: string) => Promise<void>;
  unequip: (slot: EquipSlot) => Promise<void>;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  data: null,
  loading: false,

  async load() {
    set({ loading: true });
    try {
      set({ data: await api.inventory(), loading: false });
    } catch (error) {
      set({ loading: false });
      toast(errorMessage(error), 'warn');
    }
  },

  async use(uid, qty = 1) {
    try {
      const result = await api.useItem(uid, qty);
      useCharacterStore.getState().setView(result.view);
      toast(result.message, 'gain');
      await get().load();
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  },

  async equip(uid) {
    try {
      useCharacterStore.getState().setView(await api.equipItem(uid));
      await get().load();
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  },

  async unequip(slot) {
    try {
      useCharacterStore.getState().setView(await api.unequipItem(slot));
      await get().load();
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  },
}));
