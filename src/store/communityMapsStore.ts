import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { CommunityMapDef } from '../types/map';

interface CommunityMapsState {
  maps: CommunityMapDef[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (maps: CommunityMapDef[]) => Promise<void>;
  addMap: (map: CommunityMapDef) => Promise<void>;
  removeMap: (id: string) => Promise<void>;
}

export const useCommunityMapsStore = create<CommunityMapsState>((set, get) => ({
  maps: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const maps = await invoke<CommunityMapDef[]>('load_community_maps');
      set({ maps, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: async (maps) => {
    await invoke('save_community_maps', { maps });
    set({ maps });
  },

  addMap: async (map) => {
    const next = [...get().maps.filter(m => m.id !== map.id), map];
    await get().save(next);
  },

  removeMap: async (id) => {
    const next = get().maps.filter(m => m.id !== id);
    await get().save(next);
  },
}));
