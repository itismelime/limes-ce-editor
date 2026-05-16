import { create } from 'zustand';
import type { MapId } from '../types/map';
import { registerCustomUsageColor, unregisterCustomUsageColor } from '../types/map';

export type ActiveTab = 'map' | 'types' | 'events' | 'spawns' | 'playerSpawns' | 'spawnableTypes' | 'economy' | 'weather' | 'gameplay' | 'settings';
export type ThemeId = 'dark' | 'light';

export interface BuildingLootOverride {
  blockItems: string[];
  blockCategories: string[];
  addItems: string[];
  addCategories: string[];
}

interface UiState {
  activeTab: ActiveTab;
  activeMap: string;
  theme: ThemeId;
  showSaveReview: boolean;
  selectedEventName: string | null;
  selectedBuildingType: string | null;
  selectedBuildingSeq: number;
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
  mapClusterZoomThreshold: number;
  buildingItemFilter: string;
  buildingNameFilter: string;
  buildingMinLootmax: number;
  tierZonesLoaded: boolean;
  showPlayerSpawns: boolean;
  categoryOverrides: Record<string, string>;
  buildingLootOverrides: Record<string, BuildingLootOverride>;
  recentFolders: string[];
  rememberLastFolder: boolean;
  customUsageColors: Record<string, string>;

  setActiveTab: (tab: ActiveTab) => void;
  setActiveMap: (map: string) => void;
  setTheme: (theme: ThemeId) => void;
  setShowSaveReview: (v: boolean) => void;
  setSelectedBuilding: (type: string | null) => void;
  setSelectedEvent: (name: string | null) => void;
  setTypeFilter: (v: string) => void;
  setCategoryFilter: (v: string) => void;
  setEventFilter: (v: string) => void;
  setMapImagePath: (mapId: string, url: string) => void;
  clearMapImagePath: (mapId: string) => void;
  setMapImageSize: (mapId: string, w: number, h: number) => void;
  setCustomMap: (url: string, width: number, height: number) => void;
  setLoading: (v: boolean) => void;
  setLoadError: (v: string | null) => void;
  setLoadWarnings: (v: string[]) => void;
  toggleTier: (tier: string) => void;
  toggleUsage: (usage: string) => void;
  setHiddenTiers: (tiers: string[]) => void;
  setHiddenUsages: (usages: string[]) => void;
  setHiddenEvents: (events: string[]) => void;
  toggleEvent: (name: string) => void;
  setMapEventFilter: (v: string) => void;
  toggleBuildings: () => void;
  setMapClusterZoomThreshold: (v: number) => void;
  setBuildingItemFilter: (v: string) => void;
  setBuildingNameFilter: (v: string) => void;
  setBuildingMinLootmax: (v: number) => void;
  setTierZonesLoaded: (v: boolean) => void;
  togglePlayerSpawns: () => void;
  setCategoryOverride: (typeName: string, category: string) => void;
  clearCategoryOverride: (typeName: string) => void;
  importCategoryOverrides: (overrides: Record<string, string>) => void;
  clearCategoryOverrides: () => void;
  toggleBuildingBlockedItem: (buildingType: string, itemName: string) => void;
  toggleBuildingBlockedCategory: (buildingType: string, category: string) => void;
  toggleBuildingAddedItem: (buildingType: string, itemName: string) => void;
  toggleBuildingAddedCategory: (buildingType: string, category: string) => void;
  clearBuildingLootOverride: (buildingType: string) => void;
  addRecentFolder: (path: string) => void;
  setRememberLastFolder: (v: boolean) => void;
  setCustomUsageColor: (usage: string, color: string) => void;
  removeCustomUsageColor: (usage: string) => void;
}

const CATEGORY_OVERRIDES_KEY = 'categoryOverrides';
const BUILDING_LOOT_OVERRIDES_KEY = 'buildingLootOverrides';
const CUSTOM_USAGE_COLORS_KEY = 'customUsageColors';

function readCustomUsageColors(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_USAGE_COLORS_KEY) ?? '{}') as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
        result[k.trim().toLowerCase()] = v;
        registerCustomUsageColor(k, v);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readCategoryOverrides(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATEGORY_OVERRIDES_KEY) ?? '{}') as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) result[k.toLowerCase()] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(v => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter(Boolean))];
}

function readBuildingLootOverrides(): Record<string, BuildingLootOverride> {
  try {
    const parsed = JSON.parse(localStorage.getItem(BUILDING_LOOT_OVERRIDES_KEY) ?? '{}') as Record<string, unknown>;
    const result: Record<string, BuildingLootOverride> = {};
    for (const [keyRaw, value] of Object.entries(parsed)) {
      const key = keyRaw.trim().toLowerCase();
      if (!key || typeof value !== 'object' || value === null) continue;
      const record = value as Record<string, unknown>;
      result[key] = {
        blockItems: normalizeList(record.blockItems),
        blockCategories: normalizeList(record.blockCategories),
        addItems: normalizeList(record.addItems),
        addCategories: normalizeList(record.addCategories),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'map',
  activeMap: 'namalsk',
  theme: (() => {
    try {
      const raw = localStorage.getItem('theme');
      return raw === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  })(),
  showSaveReview: false,
  selectedEventName: null,
  selectedBuildingType: null,
  selectedBuildingSeq: 0,
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
  setTheme: (theme) => set(() => {
    localStorage.setItem('theme', theme);
    return { theme };
  }),
  setShowSaveReview: (v) => set({ showSaveReview: v }),
  setSelectedEvent: (name) => set({ selectedEventName: name }),
  setSelectedBuilding: (type) => set(s => ({ selectedBuildingType: type, selectedBuildingSeq: s.selectedBuildingSeq + 1 })),
  setTypeFilter: (v) => set({ typeFilter: v }),
  setCategoryFilter: (v) => set({ categoryFilter: v }),
  setEventFilter: (v) => set({ eventFilter: v }),
  setMapImagePath: (mapId, url) => set(s => {
    const next = { ...s.mapImagePaths, [mapId]: url };
    localStorage.setItem('mapImagePaths', JSON.stringify(next));
    return { mapImagePaths: next };
  }),
  clearMapImagePath: (mapId) => set(s => {
    const next = { ...s.mapImagePaths };
    delete next[mapId];
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
  mapClusterZoomThreshold: -1,
  buildingItemFilter: '',
  buildingNameFilter: '',
  buildingMinLootmax: 0,
  tierZonesLoaded: false,
  showPlayerSpawns: false,
  categoryOverrides: readCategoryOverrides(),
  buildingLootOverrides: readBuildingLootOverrides(),
  recentFolders: (() => {
    try { return JSON.parse(localStorage.getItem('recentFolders') ?? '[]') as string[]; }
    catch { return []; }
  })(),
  rememberLastFolder: (() => {
    try { return JSON.parse(localStorage.getItem('rememberLastFolder') ?? 'false') as boolean; }
    catch { return false; }
  })(),
  customUsageColors: readCustomUsageColors(),
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
  setHiddenEvents: (events) => set({ hiddenEvents: events }),
  toggleEvent: (name) => set(s => ({
    hiddenEvents: s.hiddenEvents.includes(name)
      ? s.hiddenEvents.filter(e => e !== name)
      : [...s.hiddenEvents, name],
  })),
  setMapEventFilter: (v) => set({ mapEventFilter: v }),
  toggleBuildings: () => set(s => ({ showBuildings: !s.showBuildings })),
  setMapClusterZoomThreshold: (v) => set({ mapClusterZoomThreshold: Math.min(1, Math.max(-3, Math.round(v))) }),
  setBuildingItemFilter: (v) => set({ buildingItemFilter: v }),
  setBuildingNameFilter: (v) => set({ buildingNameFilter: v }),
  setBuildingMinLootmax: (v) => set({ buildingMinLootmax: v }),
  setTierZonesLoaded: (v) => set({ tierZonesLoaded: v }),
  togglePlayerSpawns: () => set(s => ({ showPlayerSpawns: !s.showPlayerSpawns })),
  setCategoryOverride: (typeName, category) => set(s => {
    const key = typeName.trim().toLowerCase();
    if (!key) return {};
    const next = { ...s.categoryOverrides, [key]: category };
    localStorage.setItem(CATEGORY_OVERRIDES_KEY, JSON.stringify(next));
    return { categoryOverrides: next };
  }),
  clearCategoryOverride: (typeName) => set(s => {
    const key = typeName.trim().toLowerCase();
    if (!key || !(key in s.categoryOverrides)) return {};
    const next = { ...s.categoryOverrides };
    delete next[key];
    localStorage.setItem(CATEGORY_OVERRIDES_KEY, JSON.stringify(next));
    return { categoryOverrides: next };
  }),
  importCategoryOverrides: (overrides) => set(() => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === 'string' && v.trim()) next[k.toLowerCase()] = v;
    }
    localStorage.setItem(CATEGORY_OVERRIDES_KEY, JSON.stringify(next));
    return { categoryOverrides: next };
  }),
  clearCategoryOverrides: () => set(() => {
    localStorage.setItem(CATEGORY_OVERRIDES_KEY, JSON.stringify({}));
    return { categoryOverrides: {} };
  }),
  toggleBuildingBlockedItem: (buildingType, itemName) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const value = itemName.trim().toLowerCase();
    if (!key || !value) return {};
    const prev = s.buildingLootOverrides[key] ?? { blockItems: [], blockCategories: [], addItems: [], addCategories: [] };
    const blockItems = prev.blockItems.includes(value)
      ? prev.blockItems.filter(v => v !== value)
      : [...prev.blockItems, value];
    const addItems = prev.addItems.filter(v => v !== value);
    const nextEntry: BuildingLootOverride = { ...prev, blockItems, addItems };
    const next = { ...s.buildingLootOverrides, [key]: nextEntry };
    localStorage.setItem(BUILDING_LOOT_OVERRIDES_KEY, JSON.stringify(next));
    return { buildingLootOverrides: next };
  }),
  toggleBuildingBlockedCategory: (buildingType, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const value = category.trim().toLowerCase();
    if (!key || !value) return {};
    const prev = s.buildingLootOverrides[key] ?? { blockItems: [], blockCategories: [], addItems: [], addCategories: [] };
    const blockCategories = prev.blockCategories.includes(value)
      ? prev.blockCategories.filter(v => v !== value)
      : [...prev.blockCategories, value];
    const addCategories = prev.addCategories.filter(v => v !== value);
    const nextEntry: BuildingLootOverride = { ...prev, blockCategories, addCategories };
    const next = { ...s.buildingLootOverrides, [key]: nextEntry };
    localStorage.setItem(BUILDING_LOOT_OVERRIDES_KEY, JSON.stringify(next));
    return { buildingLootOverrides: next };
  }),
  toggleBuildingAddedItem: (buildingType, itemName) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const value = itemName.trim().toLowerCase();
    if (!key || !value) return {};
    const prev = s.buildingLootOverrides[key] ?? { blockItems: [], blockCategories: [], addItems: [], addCategories: [] };
    const addItems = prev.addItems.includes(value)
      ? prev.addItems.filter(v => v !== value)
      : [...prev.addItems, value];
    const blockItems = prev.blockItems.filter(v => v !== value);
    const nextEntry: BuildingLootOverride = { ...prev, addItems, blockItems };
    const next = { ...s.buildingLootOverrides, [key]: nextEntry };
    localStorage.setItem(BUILDING_LOOT_OVERRIDES_KEY, JSON.stringify(next));
    return { buildingLootOverrides: next };
  }),
  toggleBuildingAddedCategory: (buildingType, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const value = category.trim().toLowerCase();
    if (!key || !value) return {};
    const prev = s.buildingLootOverrides[key] ?? { blockItems: [], blockCategories: [], addItems: [], addCategories: [] };
    const addCategories = prev.addCategories.includes(value)
      ? prev.addCategories.filter(v => v !== value)
      : [...prev.addCategories, value];
    const blockCategories = prev.blockCategories.filter(v => v !== value);
    const nextEntry: BuildingLootOverride = { ...prev, addCategories, blockCategories };
    const next = { ...s.buildingLootOverrides, [key]: nextEntry };
    localStorage.setItem(BUILDING_LOOT_OVERRIDES_KEY, JSON.stringify(next));
    return { buildingLootOverrides: next };
  }),
  addRecentFolder: (path) => set(s => {
    const next = [path, ...s.recentFolders.filter(p => p !== path)].slice(0, 8);
    localStorage.setItem('recentFolders', JSON.stringify(next));
    return { recentFolders: next };
  }),
  setRememberLastFolder: (v) => set(() => {
    localStorage.setItem('rememberLastFolder', JSON.stringify(v));
    return { rememberLastFolder: v };
  }),
  setCustomUsageColor: (usage, color) => set(s => {
    const key = usage.trim().toLowerCase();
    const next = { ...s.customUsageColors, [key]: color };
    localStorage.setItem(CUSTOM_USAGE_COLORS_KEY, JSON.stringify(next));
    registerCustomUsageColor(usage, color);
    return { customUsageColors: next };
  }),
  removeCustomUsageColor: (usage) => set(s => {
    const key = usage.trim().toLowerCase();
    const next = { ...s.customUsageColors };
    delete next[key];
    localStorage.setItem(CUSTOM_USAGE_COLORS_KEY, JSON.stringify(next));
    unregisterCustomUsageColor(usage);
    return { customUsageColors: next };
  }),
  clearBuildingLootOverride: (buildingType) => set(s => {
    const key = buildingType.trim().toLowerCase();
    if (!key || !(key in s.buildingLootOverrides)) return {};
    const next = { ...s.buildingLootOverrides };
    delete next[key];
    localStorage.setItem(BUILDING_LOOT_OVERRIDES_KEY, JSON.stringify(next));
    return { buildingLootOverrides: next };
  }),
}));
