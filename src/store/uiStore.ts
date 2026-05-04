import { create } from 'zustand';
import type { MapId } from '../types/map';

export type ActiveTab = 'map' | 'types' | 'events' | 'spawns' | 'playerSpawns' | 'spawnableTypes' | 'economy';

interface UiState {
  activeTab: ActiveTab;
  activeMap: MapId;
  selectedEventName: string | null;
  typeFilter: string;
  categoryFilter: string;
  eventFilter: string;
  mapImagePaths: Record<string, string>;  // mapId → convertFileSrc url
  mapImageSizes: Record<string, { w: number; h: number }>;  // mapId → pixel dims
  customMapUrl: string;
  customMapWidth: number;
  customMapHeight: number;
  isLoading: boolean;
  loadError: string | null;
  loadWarnings: string[];
  hiddenTiers: string[];
  hiddenUsages: string[];
  hiddenEvents: string[];
  mapEventFilter: string;
  showBuildings: boolean;
  buildingItemFilter: string;
  buildingNameFilter: string;
  buildingMinLootmax: number;
  tierZonesLoaded: boolean;
  showPlayerSpawns: boolean;

  setActiveTab: (tab: ActiveTab) => void;
  setActiveMap: (map: MapId) => void;
  setSelectedEvent: (name: string | null) => void;
  setTypeFilter: (v: string) => void;
  setCategoryFilter: (v: string) => void;
  setEventFilter: (v: string) => void;
  setMapImagePath: (mapId: string, url: string) => void;
  setMapImageSize: (mapId: string, w: number, h: number) => void;
  setCustomMap: (url: string, width: number, height: number) => void;
  setLoading: (v: boolean) => void;
  setLoadError: (v: string | null) => void;
  setLoadWarnings: (v: string[]) => void;
  toggleTier: (tier: string) => void;
  toggleUsage: (usage: string) => void;
  setHiddenTiers: (tiers: string[]) => void;
  setHiddenUsages: (usages: string[]) => void;
  toggleEvent: (name: string) => void;
  setMapEventFilter: (v: string) => void;
  toggleBuildings: () => void;
  setBuildingItemFilter: (v: string) => void;
  setBuildingNameFilter: (v: string) => void;
  setBuildingMinLootmax: (v: number) => void;
  setTierZonesLoaded: (v: boolean) => void;
  togglePlayerSpawns: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'map',
  activeMap: 'namalsk',
  selectedEventName: null,
  typeFilter: '',
  categoryFilter: '',
  eventFilter: '',
  mapImagePaths: (() => {
    const raw: Record<string, string> = JSON.parse(localStorage.getItem('mapImagePaths') ?? '{}');
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v.startsWith('asset://')));
  })(),
  mapImageSizes: JSON.parse(localStorage.getItem('mapImageSizes') ?? '{}'),
  customMapUrl: '',
  customMapWidth: 10000,
  customMapHeight: 10000,
  isLoading: false,
  loadError: null,
  loadWarnings: [],

  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveMap: (map) => set({ activeMap: map }),
  setSelectedEvent: (name) => set({ selectedEventName: name }),
  setTypeFilter: (v) => set({ typeFilter: v }),
  setCategoryFilter: (v) => set({ categoryFilter: v }),
  setEventFilter: (v) => set({ eventFilter: v }),
  setMapImagePath: (mapId, url) => set(s => {
    const next = { ...s.mapImagePaths, [mapId]: url };
    localStorage.setItem('mapImagePaths', JSON.stringify(next));
    return { mapImagePaths: next };
  }),
  setMapImageSize: (mapId, w, h) => set(s => {
    const next = { ...s.mapImageSizes, [mapId]: { w, h } };
    localStorage.setItem('mapImageSizes', JSON.stringify(next));
    return { mapImageSizes: next };
  }),
  setCustomMap: (url, width, height) => set({ customMapUrl: url, customMapWidth: width, customMapHeight: height }),
  setLoading: (v) => set({ isLoading: v }),
  setLoadError: (v) => set({ loadError: v }),
  setLoadWarnings: (v) => set({ loadWarnings: v }),
  hiddenTiers: [],
  hiddenUsages: [],
  hiddenEvents: [],
  mapEventFilter: '',
  showBuildings: true,
  buildingItemFilter: '',
  buildingNameFilter: '',
  buildingMinLootmax: 0,
  tierZonesLoaded: false,
  showPlayerSpawns: true,
  toggleTier: (tier) => set(s => ({
    hiddenTiers: s.hiddenTiers.includes(tier)
      ? s.hiddenTiers.filter(t => t !== tier)
      : [...s.hiddenTiers, tier],
  })),
  toggleUsage: (usage) => set(s => ({
    hiddenUsages: s.hiddenUsages.includes(usage)
      ? s.hiddenUsages.filter(u => u !== usage)
      : [...s.hiddenUsages, usage],
  })),
  setHiddenTiers: (tiers) => set({ hiddenTiers: tiers }),
  setHiddenUsages: (usages) => set({ hiddenUsages: usages }),
  toggleEvent: (name) => set(s => ({
    hiddenEvents: s.hiddenEvents.includes(name)
      ? s.hiddenEvents.filter(e => e !== name)
      : [...s.hiddenEvents, name],
  })),
  setMapEventFilter: (v) => set({ mapEventFilter: v }),
  toggleBuildings: () => set(s => ({ showBuildings: !s.showBuildings })),
  setBuildingItemFilter: (v) => set({ buildingItemFilter: v }),
  setBuildingNameFilter: (v) => set({ buildingNameFilter: v }),
  setBuildingMinLootmax: (v) => set({ buildingMinLootmax: v }),
  setTierZonesLoaded: (v) => set({ tierZonesLoaded: v }),
  togglePlayerSpawns: () => set(s => ({ showPlayerSpawns: !s.showPlayerSpawns })),
}));
