import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { MissionData, DayZType, DayZEvent, EventSpawnDef, SpawnableType, DirtyFlags, CeEntry, BuildingInstance, PlayerSpawnData, WeatherData, GameplayData, CeToolProject, LimitsDefinition, LimitsDefinitionUser } from '../types/dayz';
import type { FFSpawnSelectorSettings, FFSpawnPointsData } from '../types/ffSpawnSelector';
import {
  serializeTypesXml, serializeEventSpawnsXml,
  serializeEventsXml, serializeSpawnableTypesXml,
  serializeEconomyCoreXml, serializeMapGroupProtoXml,
  serializeWeatherXml, serializeGameplayJson,
  serializeLimitsDefinitionXml, serializeLimitsDefinitionUserXml,
} from '../lib/xmlParser';
import { serializeFFSettings, serializeFFSpawnPoints } from '../lib/ffSpawnSelector';
import { writeFile, readFile, createDir, readBinaryFile, writeBinaryFile, removeFile, backupIfNeeded, basename } from '../lib/fileDiscovery';
import { setCeToolBitmapSource, clearCeToolBitmapSource } from '../lib/tierZoneResolver';
import type { ContainerDef } from '../types/dayz';

export interface CeToolLayerMeta {
  name: string;
  usageFlags: number;
  valueFlags: number;
  isPaintable: boolean;
  usageName: string | null;
}

type TerritoryPaintDiff =
  | { type: 'paint'; layerName: string; diffs: Array<{ idx: number; prev: number }> }
  | { type: 'layerCreated'; layerName: string };

export interface TerritoryBitmapOverride {
  xmlContent: string;
  layerLoader: (name: string) => Promise<Uint8Array | null>;
  worldSize: number;
  layersDir: string | null; // null = bundled / read-only, disables paint
}

interface FilePaths {
  missionPath: string | null;
  typesPath: string | null;
  eventSpawnsPath: string | null;
  eventsPath: string | null;
  spawnableTypesPath: string | null;
  economyCorePath: string | null;
  mapGroupProtoPath: string | null;
  weatherPath: string | null;
  gameplayPath: string | null;
  limitsDefinitionPath: string | null;
  limitsDefinitionUserPath: string | null;
  ceToolXmlPath: string | null;
  ceToolLayersDir: string | null;
  // FF_SpawnSelector plugin config -- not mission-scoped (lives under the
  // server root's profiles/ folder), set once by the discovery hook and
  // preserved across mission switches by setPaths' merge semantics.
  ffSettingsPath: string | null;
  ffSpawnPointsPath: string | null;
}

type MapGroupProtoEntry = {
  rawName?: string;
  usages: string[];
  tiers: string[];
  valueUsers?: string[];
  lootmax: number;
  containers: ContainerDef[];
  orderIndex?: number;
};

type ZoneRemoveSnapshot = {
  usage: string;
  prevLimitsDefinition: LimitsDefinition | null;
  prevProtoEntries: Array<{ key: string; entry: MapGroupProtoEntry }>;
  prevTypes: Array<{ name: string; type: DayZType }>;
};

type SaveCheckpoint = {
  id: string;
  createdAt: number;
  label: string;
  typesBySource: Map<string, Map<string, DayZType>>;
  events: Map<string, DayZEvent> | null;
  eventSpawns: EventSpawnDef[] | null;
  spawnableTypes: Map<string, SpawnableType> | null;
  mapGroupProto: Map<string, MapGroupProtoEntry> | null;
};

interface ServerState {
  mission: MissionData | null;
  paths: FilePaths;
  dirty: DirtyFlags;
  saveError: string | null;
  saveStatus: 'idle' | 'saving' | 'success';
  economyCore: CeEntry[];
  buildingInstances: BuildingInstance[];
  mapGroupProto: Map<string, MapGroupProtoEntry>;
  playerSpawnData: PlayerSpawnData | null;
  ceToolProject: CeToolProject | null;
  serverRootPath: string | null;
  openServerFolder?: () => Promise<void>;
  ceToolFolderOverride: string | null; // actually stores the project XML path when user manually picks
  pickCeToolFolder?: () => Promise<void>;
  ceSources: Record<string, 'bundled' | 'user' | null>;
  reloadCeToolData?: () => Promise<void>;
  weather: WeatherData | null;
  gameplay: GameplayData | null;
  limitsDefinition: LimitsDefinition | null;
  limitsDefinitionUser: LimitsDefinitionUser | null;
  ffProfileName: string | null;
  ffSettings: FFSpawnSelectorSettings | null;
  ffSpawnPoints: FFSpawnPointsData | null;
  originalTypes: Map<string, DayZType>;
  originalEvents: Map<string, DayZEvent>;
  originalEventSpawns: EventSpawnDef[];
  originalSpawnableTypes: Map<string, SpawnableType>;
  originalMapGroupProto: Map<string, MapGroupProtoEntry>;
  originalWeather: WeatherData | null;
  originalGameplay: GameplayData | null;
  originalLimitsDefinition: LimitsDefinition | null;
  originalLimitsDefinitionUser: LimitsDefinitionUser | null;
  originalFfSettings: FFSpawnSelectorSettings | null;
  originalFfSpawnPoints: FFSpawnPointsData | null;
  saveCheckpoints: SaveCheckpoint[];
  typeHistory: { name: string; prev: DayZType }[];
  mapGroupProtoHistory: { key: string; prev: MapGroupProtoEntry }[];
  zoneRemoveHistory: ZoneRemoveSnapshot[];

  setMission: (mission: MissionData) => void;
  setPaths: (paths: Partial<FilePaths>) => void;
  setEconomyCore: (entries: CeEntry[]) => void;
  setBuildingInstances: (instances: BuildingInstance[]) => void;
  setMapGroupProto: (proto: Map<string, MapGroupProtoEntry>) => void;
  setPlayerSpawnData: (data: PlayerSpawnData | null) => void;
  setCeToolProject: (data: CeToolProject | null) => void;
  setServerRootPath: (path: string | null) => void;
  setOpenServerFolder: (fn: (() => Promise<void>) | undefined) => void;
  setCeToolFolderOverride: (path: string | null) => void;
  setPickCeToolFolder: (fn: (() => Promise<void>) | undefined) => void;
  setCeSource: (mapId: string, source: 'bundled' | 'user' | null) => void;
  setReloadCeToolData: (fn: (() => Promise<void>) | undefined) => void;
  setWeather: (data: WeatherData | null) => void;
  setGameplay: (data: GameplayData | null) => void;
  updateGameplay: (data: GameplayData) => void;
  updateWeather: (data: WeatherData) => void;
  setFfProfileName: (name: string | null) => void;
  setFfSettings: (data: FFSpawnSelectorSettings | null) => void;
  updateFfSettings: (data: FFSpawnSelectorSettings) => void;
  setFfSpawnPoints: (data: FFSpawnPointsData | null) => void;
  updateFfSpawnPoints: (data: FFSpawnPointsData) => void;
  setLimitsDefinition: (data: LimitsDefinition | null) => void;
  setLimitsDefinitionUser: (data: LimitsDefinitionUser | null) => void;
  updateLimitsDefinition: (data: LimitsDefinition) => void;
  updateLimitsDefinitionUser: (data: LimitsDefinitionUser) => void;
  clearSaveError: () => void;
  createSaveCheckpointFromDirty: (label?: string) => void;
  revertSaveCheckpoint: (id?: string) => void;
  clearSaveCheckpoints: () => void;

  updateType: (name: string, patch: Partial<DayZType>) => void;
  undoType: () => void;
  undoMapGroupProto: () => void;
  undoZoneRemove: () => void;
  revertTypesSource: (sourcePath: string) => void;
  revertEventSpawns: () => void;
  revertEvents: () => void;
  revertSpawnableTypes: () => void;
  revertMapGroupProto: () => void;
  revertWeather: () => void;
  revertGameplay: () => void;
  revertLimitsDefinition: () => void;
  revertLimitsDefinitionUser: () => void;
  revertFfSettings: () => void;
  revertFfSpawnPoints: () => void;
  updateEvent: (name: string, patch: Partial<DayZEvent>) => void;
  setEventSpawns: (spawns: EventSpawnDef[]) => void;
  updateSpawnableType: (name: string, patch: Partial<SpawnableType>) => void;
  addBuildingCategory: (buildingType: string, category: string) => void;
  removeBuildingCategory: (buildingType: string, category: string) => void;
  addBuildingUsage: (buildingType: string, usage: string) => void;
  removeBuildingUsage: (buildingType: string, usage: string) => void;
  addContainerTag: (buildingType: string, containerName: string, tag: string) => void;
  removeContainerTag: (buildingType: string, containerName: string, tag: string) => void;
  addContainerCategory: (buildingType: string, containerName: string, category: string) => void;
  removeContainerCategory: (buildingType: string, containerName: string, category: string) => void;
  updateContainerLootmax: (buildingType: string, containerName: string, lootmax: number) => void;
  removeLimitsUsage: (usage: string) => void;

  ceToolLayers: CeToolLayerMeta[];
  newCeToolLayerNames: string[];
  deletedCeToolLayerNames: string[];
  territoryBitmaps: Map<string, Uint8ClampedArray>;
  originalTerritoryBitmaps: Map<string, Uint8ClampedArray>;
  territoryPaintHistory: TerritoryPaintDiff[];
  territoryBitmapSize: { width: number; height: number } | null;
  ceToolWorldSize: number | null;

  clearTerritoryState: () => void;
  loadTerritoryBitmaps: (override?: TerritoryBitmapOverride) => Promise<void>;
  reloadTerritoryBitmaps?: () => Promise<void>;
  setReloadTerritoryBitmaps: (fn: (() => Promise<void>) | undefined) => void;
  addCeToolLayer: (usageName: string) => void;
  removeCeToolLayer: (layerName: string) => void;
  commitTerritoryPaint: (layerName: string, pixels: Uint8ClampedArray) => void;
  undoTerritoryPaint: () => void;
  saveTerritoryBitmaps: () => Promise<void>;
  revertTerritoryBitmaps: () => void;

  addCustomTypePack: (name: string, xmlContent: string) => Promise<void>;
  removeEconomyCoreEntry: (folder: string) => Promise<void>;
  saveTypesSource: (sourcePath: string) => Promise<void>;
  saveEventSpawns: () => Promise<void>;
  saveEvents: () => Promise<void>;
  saveSpawnableTypes: () => Promise<void>;
  saveMapGroupProto: () => Promise<void>;
  saveWeather: () => Promise<void>;
  saveGameplay: () => Promise<void>;
  saveLimitsDefinition: () => Promise<void>;
  saveLimitsDefinitionUser: () => Promise<void>;
  saveFfSettings: () => Promise<void>;
  saveFfSpawnPoints: () => Promise<void>;
}

async function decodeLayerImage(raw: Uint8Array): Promise<Uint8ClampedArray | null> {
  // PNG magic: 89 50 4E 47
  if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4E && raw[3] === 0x47) {
    try {
      const blob = new Blob([new Uint8Array(raw)], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out = new Uint8ClampedArray(data.length);
      for (let i = 0; i < data.length; i += 4) {
        const active = data[i] > 127 || data[i + 1] > 127 || data[i + 2] > 127 || data[i + 3] > 127;
        const v = active ? 255 : 0;
        out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = active ? 255 : 0;
      }
      return out;
    } catch { return null; }
  }
  try {
    return parseTgaLayer(raw).pixels;
  } catch { return null; }
}

function parseTgaLayer(bytes: Uint8Array): { pixels: Uint8ClampedArray; width: number; height: number } {
  const idLen = bytes[0];
  const imageType = bytes[2];
  const colorMapLen = bytes[5] | (bytes[6] << 8);
  const colorMapEntryBytes = Math.ceil(bytes[7] / 8);
  const dataOffset = 18 + idLen + colorMapLen * colorMapEntryBytes;
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  const bpp = bytes[16];
  const topDown = (bytes[17] & 0x20) !== 0;
  const pixels = new Uint8ClampedArray(width * height * 4);

  if (bpp === 8 && (imageType === 3 || imageType === 1)) {
    for (let row = 0; row < height; row++) {
      const srcRow = topDown ? row : (height - 1 - row);
      for (let col = 0; col < width; col++) {
        const g = bytes[dataOffset + srcRow * width + col] ?? 0;
        const pi = (row * width + col) * 4;
        pixels[pi] = g; pixels[pi + 1] = g; pixels[pi + 2] = g; pixels[pi + 3] = g > 127 ? 255 : 0;
      }
    }
  } else if (bpp === 8 && imageType === 11) {
    // RLE compressed grayscale
    const raw = new Uint8Array(width * height);
    let src = dataOffset; let dst = 0;
    while (dst < raw.length && src < bytes.length) {
      const hdr = bytes[src++];
      if (hdr & 0x80) { const val = bytes[src++]; const cnt = (hdr & 0x7f) + 1; for (let i = 0; i < cnt && dst < raw.length; i++) raw[dst++] = val; }
      else { const cnt = hdr + 1; for (let i = 0; i < cnt && dst < raw.length; i++) raw[dst++] = bytes[src++]; }
    }
    for (let row = 0; row < height; row++) {
      const srcRow = topDown ? row : (height - 1 - row);
      for (let col = 0; col < width; col++) {
        const g = raw[srcRow * width + col] ?? 0;
        const pi = (row * width + col) * 4;
        pixels[pi] = g; pixels[pi + 1] = g; pixels[pi + 2] = g; pixels[pi + 3] = g > 127 ? 255 : 0;
      }
    }
  } else if (imageType === 2 && (bpp === 24 || bpp === 32)) {
    // Uncompressed true-color (CE Tool may output 24bpp BGR)
    const Bpp = bpp / 8;
    for (let row = 0; row < height; row++) {
      const srcRow = topDown ? row : (height - 1 - row);
      for (let col = 0; col < width; col++) {
        const si = dataOffset + (srcRow * width + col) * Bpp;
        const active = (bytes[si] ?? 0) > 127 || (bytes[si + 1] ?? 0) > 127 || (bytes[si + 2] ?? 0) > 127;
        const v = active ? 255 : 0;
        const pi = (row * width + col) * 4;
        pixels[pi] = v; pixels[pi + 1] = v; pixels[pi + 2] = v; pixels[pi + 3] = active ? 255 : 0;
      }
    }
  } else if (imageType === 10 && (bpp === 24 || bpp === 32)) {
    // RLE true-color
    const Bpp = bpp / 8;
    const raw = new Uint8Array(width * height * Bpp);
    let src = dataOffset; let dst = 0;
    while (dst < raw.length && src < bytes.length) {
      const hdr = bytes[src++];
      if (hdr & 0x80) {
        const cnt = (hdr & 0x7f) + 1;
        for (let k = 0; k < Bpp; k++) raw[dst + k] = bytes[src + k] ?? 0;
        src += Bpp;
        for (let i = 1; i < cnt; i++) for (let k = 0; k < Bpp; k++) raw[dst + i * Bpp + k] = raw[dst + k];
        dst += cnt * Bpp;
      } else {
        const cnt = hdr + 1;
        for (let i = 0; i < cnt * Bpp; i++) raw[dst++] = bytes[src++] ?? 0;
      }
    }
    for (let row = 0; row < height; row++) {
      const srcRow = topDown ? row : (height - 1 - row);
      for (let col = 0; col < width; col++) {
        const si = (srcRow * width + col) * Bpp;
        const active = raw[si] > 127 || raw[si + 1] > 127 || raw[si + 2] > 127;
        const v = active ? 255 : 0;
        const pi = (row * width + col) * 4;
        pixels[pi] = v; pixels[pi + 1] = v; pixels[pi + 2] = v; pixels[pi + 3] = active ? 255 : 0;
      }
    }
  }

  return { pixels, width, height };
}

function encodeTgaLayer(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(18 + width * height);
  out[2] = 3; // uncompressed grayscale
  out[12] = width & 0xff; out[13] = (width >> 8) & 0xff;
  out[14] = height & 0xff; out[15] = (height >> 8) & 0xff;
  out[16] = 8; out[17] = 0x20; // 8bpp, top-left origin
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out[18 + y * width + x] = pixels[(y * width + x) * 4] > 127 ? 255 : 0;
  return out;
}

const emptyDirty: DirtyFlags = { typesSources: [], eventSpawns: false, events: false, spawnableTypes: false, mapGroupProto: false, weather: false, gameplay: false, limitsDefinition: false, limitsDefinitionUser: false, territoryBitmaps: false, ffSettings: false, ffSpawnPoints: false };

function cloneMapGroupProtoEntry(entry: MapGroupProtoEntry): MapGroupProtoEntry {
  return {
    rawName: entry.rawName,
    usages: [...entry.usages],
    tiers: [...entry.tiers],
    valueUsers: entry.valueUsers ? [...entry.valueUsers] : undefined,
    lootmax: entry.lootmax,
    containers: entry.containers.map(c => ({ ...c, categories: [...c.categories], tags: [...c.tags] })),
    orderIndex: entry.orderIndex,
  };
}

function mapGroupProtoEntryDirty(a: MapGroupProtoEntry, b: MapGroupProtoEntry): boolean {
  if (a.lootmax !== b.lootmax) return true;
  if (a.usages.length !== b.usages.length || a.usages.some((u, i) => u !== b.usages[i])) return true;
  if (a.tiers.length !== b.tiers.length || a.tiers.some((t, i) => t !== b.tiers[i])) return true;
  if (a.containers.length !== b.containers.length) return true;
  return a.containers.some((c, ci) => {
    const bc = b.containers[ci];
    return c.categories.length !== bc.categories.length || c.categories.some((cat, i) => cat !== bc.categories[i])
        || c.tags.length !== bc.tags.length || c.tags.some((tag, i) => tag !== bc.tags[i]);
  });
}

function isMapGroupProtoDirty(current: Map<string, MapGroupProtoEntry>, original: Map<string, MapGroupProtoEntry>): boolean {
  if (current.size !== original.size) return true;
  for (const [key, entry] of current) {
    const orig = original.get(key);
    if (!orig || mapGroupProtoEntryDirty(entry, orig)) return true;
  }
  return false;
}

function cloneMapGroupProto(proto: Map<string, MapGroupProtoEntry>): Map<string, MapGroupProtoEntry> {
  const next = new Map<string, MapGroupProtoEntry>();
  for (const [key, entry] of proto) next.set(key, cloneMapGroupProtoEntry(entry));
  return next;
}

export function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function markSuccess(set: (fn: (s: ServerState) => Partial<ServerState>) => void) {
  set(() => ({ saveStatus: 'success' }));
  setTimeout(() => set(s => s.saveStatus === 'success' ? { saveStatus: 'idle' } : {}), 3000);
}

export const useServerStore = create<ServerState>((set, get) => {
  async function trySave(fileName: string, operation: () => Promise<void>, pathsToBackup: string[] = []): Promise<void> {
    set({ saveStatus: 'saving' });
    try {
      await Promise.all(pathsToBackup.map(backupIfNeeded));
      await operation();
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save ${fileName}: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  }

  return {
  mission: null,
  paths: { missionPath: null, typesPath: null, eventSpawnsPath: null, eventsPath: null, spawnableTypesPath: null, economyCorePath: null, mapGroupProtoPath: null, weatherPath: null, gameplayPath: null, limitsDefinitionPath: null, limitsDefinitionUserPath: null, ceToolXmlPath: null, ceToolLayersDir: null, ffSettingsPath: null, ffSpawnPointsPath: null },
  dirty: emptyDirty,
  saveError: null,
  saveStatus: 'idle' as const,
  economyCore: [],
  buildingInstances: [],
  mapGroupProto: new Map(),
  playerSpawnData: null,
  serverRootPath: null,
  openServerFolder: undefined,
  ceToolProject: null,
  ceToolFolderOverride: null,
  pickCeToolFolder: undefined,
  ceSources: {},
  reloadCeToolData: undefined,
  reloadTerritoryBitmaps: undefined,
  weather: null,
  gameplay: null,
  limitsDefinition: null,
  limitsDefinitionUser: null,
  ffProfileName: null,
  ffSettings: null,
  ffSpawnPoints: null,
  originalTypes: new Map(),
  originalEvents: new Map(),
  originalEventSpawns: [],
  originalSpawnableTypes: new Map(),
  originalMapGroupProto: new Map(),
  originalWeather: null,
  originalGameplay: null,
  originalLimitsDefinition: null,
  originalLimitsDefinitionUser: null,
  originalFfSettings: null,
  originalFfSpawnPoints: null,
  saveCheckpoints: [],
  typeHistory: [],
  mapGroupProtoHistory: [],
  zoneRemoveHistory: [],
  ceToolLayers: [],
  newCeToolLayerNames: [],
  deletedCeToolLayerNames: [],
  territoryBitmaps: new Map(),
  originalTerritoryBitmaps: new Map(),
  territoryPaintHistory: [],
  territoryBitmapSize: null,
  ceToolWorldSize: null,

  setMission: (mission) => set(s => ({
    mission,
    // FF_SpawnSelector config isn't mission-scoped (profiles/ is a server-root
    // sibling of mpmissions/), so its dirty state must survive a mission
    // switch -- otherwise switching missions would silently hide unsaved FF
    // edits from the save-review panel.
    dirty: { ...emptyDirty, ffSettings: s.dirty.ffSettings, ffSpawnPoints: s.dirty.ffSpawnPoints },
    originalTypes: new Map(mission.types),
    originalEvents: new Map(mission.events),
    originalEventSpawns: [...mission.eventSpawns],
    originalSpawnableTypes: new Map(mission.spawnableTypes),
    typeHistory: [],
  })),
  setPaths: (paths) => set(s => ({ paths: { ...s.paths, ...paths } })),
  setEconomyCore: (entries) => set({ economyCore: entries }),
  setBuildingInstances: (instances) => set({ buildingInstances: instances }),
  setMapGroupProto: (proto) => set({ mapGroupProto: cloneMapGroupProto(proto), originalMapGroupProto: cloneMapGroupProto(proto), mapGroupProtoHistory: [] }),
  setPlayerSpawnData: (data) => set({ playerSpawnData: data }),
  setCeToolProject: (data) => set({ ceToolProject: data }),
  setServerRootPath: (path) => set({ serverRootPath: path }),
  setOpenServerFolder: (fn) => set({ openServerFolder: fn }),
  setCeToolFolderOverride: (path) => set({ ceToolFolderOverride: path }),
  setPickCeToolFolder: (fn) => set({ pickCeToolFolder: fn }),
  setCeSource: (mapId, source) => set(s => ({ ceSources: { ...s.ceSources, [mapId]: source } })),
  setReloadCeToolData: (fn) => set({ reloadCeToolData: fn }),
  setReloadTerritoryBitmaps: (fn) => set({ reloadTerritoryBitmaps: fn }),
  setWeather: (data) => set({ weather: data, originalWeather: data }),
  setGameplay: (data) => set({ gameplay: data, originalGameplay: data }),
  updateGameplay: (data) => set(s => ({ gameplay: data, dirty: { ...s.dirty, gameplay: true } })),
  updateWeather: (data) => set(s => ({ weather: data, dirty: { ...s.dirty, weather: true } })),
  setFfProfileName: (name) => set({ ffProfileName: name }),
  setFfSettings: (data) => set({ ffSettings: data, originalFfSettings: data }),
  updateFfSettings: (data) => set(s => ({ ffSettings: data, dirty: { ...s.dirty, ffSettings: true } })),
  setFfSpawnPoints: (data) => set({ ffSpawnPoints: data, originalFfSpawnPoints: data }),
  updateFfSpawnPoints: (data) => set(s => ({ ffSpawnPoints: data, dirty: { ...s.dirty, ffSpawnPoints: true } })),
  setLimitsDefinition: (data) => set({ limitsDefinition: data, originalLimitsDefinition: data }),
  setLimitsDefinitionUser: (data) => set({ limitsDefinitionUser: data, originalLimitsDefinitionUser: data }),
  updateLimitsDefinition: (data) => set(s => ({ limitsDefinition: data, dirty: { ...s.dirty, limitsDefinition: true } })),
  updateLimitsDefinitionUser: (data) => set(s => ({ limitsDefinitionUser: data, dirty: { ...s.dirty, limitsDefinitionUser: true } })),
  clearSaveError: () => set({ saveError: null }),

  createSaveCheckpointFromDirty: (label = 'Save') => set(s => {
    if (!s.mission) return s;
    const hasDirty = s.dirty.typesSources.length > 0 || s.dirty.eventSpawns || s.dirty.events || s.dirty.spawnableTypes || s.dirty.mapGroupProto;
    if (!hasDirty) return s;

    const typesBySource = new Map<string, Map<string, DayZType>>();
    for (const source of s.dirty.typesSources) {
      const sourceSnapshot = new Map<string, DayZType>();
      for (const [name, type] of s.originalTypes) {
        if (type.source === source) {
          sourceSnapshot.set(name, type);
        }
      }
      typesBySource.set(source, sourceSnapshot);
    }

    const checkpoint: SaveCheckpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      label,
      typesBySource,
      events: s.dirty.events ? new Map(s.originalEvents) : null,
      eventSpawns: s.dirty.eventSpawns ? [...s.originalEventSpawns] : null,
      spawnableTypes: s.dirty.spawnableTypes ? new Map(s.originalSpawnableTypes) : null,
      mapGroupProto: s.dirty.mapGroupProto ? cloneMapGroupProto(s.originalMapGroupProto) : null,
    };

    return { saveCheckpoints: [checkpoint, ...s.saveCheckpoints].slice(0, 30) };
  }),

  revertSaveCheckpoint: (id) => set(s => {
    if (!s.mission || s.saveCheckpoints.length === 0) return s;
    const checkpoint = id
      ? s.saveCheckpoints.find(cp => cp.id === id)
      : s.saveCheckpoints[0];
    if (!checkpoint) return s;

    const nextMission = { ...s.mission };
    const nextTypes = new Map(nextMission.types);
    const nextOriginalTypes = new Map(s.originalTypes);
    let nextTypeHistory = s.typeHistory;
    const nextDirtyTypes = [...s.dirty.typesSources];

    for (const [source, snapshot] of checkpoint.typesBySource) {
      for (const [name, current] of nextTypes) {
        if (current.source === source && !snapshot.has(name)) {
          nextTypes.delete(name);
          nextOriginalTypes.delete(name);
        }
      }
      for (const [name, prev] of snapshot) {
        nextTypes.set(name, prev);
        nextOriginalTypes.set(name, prev);
      }
      nextTypeHistory = nextTypeHistory.filter(h => snapshot.get(h.name)?.source !== source);
      if (!nextDirtyTypes.includes(source)) nextDirtyTypes.push(source);
    }

    nextMission.types = nextTypes;

    let nextOriginalEvents = s.originalEvents;
    let nextOriginalEventSpawns = s.originalEventSpawns;
    let nextOriginalSpawnableTypes = s.originalSpawnableTypes;
    if (checkpoint.events) {
      nextMission.events = new Map(checkpoint.events);
      nextOriginalEvents = new Map(checkpoint.events);
    }
    if (checkpoint.eventSpawns) {
      nextMission.eventSpawns = [...checkpoint.eventSpawns];
      nextOriginalEventSpawns = [...checkpoint.eventSpawns];
    }
    if (checkpoint.spawnableTypes) {
      nextMission.spawnableTypes = new Map(checkpoint.spawnableTypes);
      nextOriginalSpawnableTypes = new Map(checkpoint.spawnableTypes);
    }

    let nextMapGroupProto = s.mapGroupProto;
    const nextOriginalMapGroupProto = s.originalMapGroupProto;
    let nextBuildingInstances = s.buildingInstances;
    const nextDirty: DirtyFlags = {
      ...s.dirty,
      typesSources: nextDirtyTypes,
      events: checkpoint.events ? true : s.dirty.events,
      eventSpawns: checkpoint.eventSpawns ? true : s.dirty.eventSpawns,
      spawnableTypes: checkpoint.spawnableTypes ? true : s.dirty.spawnableTypes,
      mapGroupProto: checkpoint.mapGroupProto ? true : s.dirty.mapGroupProto,
    };

    if (checkpoint.mapGroupProto) {
      nextMapGroupProto = cloneMapGroupProto(checkpoint.mapGroupProto);
      nextBuildingInstances = s.buildingInstances.map(b => {
        const key = b.typeName.trim().toLowerCase();
        const entry = nextMapGroupProto.get(key);
        return entry ? { ...b, containers: entry.containers } : b;
      });
    }

    const saveCheckpoints = s.saveCheckpoints.filter(cp => cp.id !== checkpoint.id);
    return {
      mission: nextMission,
      originalTypes: nextOriginalTypes,
      originalEvents: nextOriginalEvents,
      originalEventSpawns: nextOriginalEventSpawns,
      originalSpawnableTypes: nextOriginalSpawnableTypes,
      originalMapGroupProto: nextOriginalMapGroupProto,
      typeHistory: nextTypeHistory,
      dirty: nextDirty,
      mapGroupProto: nextMapGroupProto,
      buildingInstances: nextBuildingInstances,
      saveCheckpoints,
    };
  }),

  clearSaveCheckpoints: () => set({ saveCheckpoints: [] }),

  updateType: (name, patch) => set(s => {
    if (!s.mission) return s;
    const next = new Map(s.mission.types);
    const existing = next.get(name);
    if (!existing) return s;
    const updated = { ...existing, ...patch };
    next.set(name, updated);
    const source = updated.source ?? '';
    const typesSources = s.dirty.typesSources.includes(source)
      ? s.dirty.typesSources
      : [...s.dirty.typesSources, source];
    const typeHistory = [{ name, prev: existing }, ...s.typeHistory].slice(0, 200);
    return { mission: { ...s.mission, types: next }, dirty: { ...s.dirty, typesSources }, typeHistory };
  }),

  undoType: () => set(s => {
    if (!s.mission || s.typeHistory.length === 0) return s;
    const [last, ...rest] = s.typeHistory;
    const next = new Map(s.mission.types);
    next.set(last.name, last.prev);
    const source = last.prev.source ?? '';
    const sourceStillDirty = [...next.values()].some(
      t => t.source === source && t !== s.originalTypes.get(t.name)
    );
    const typesSources = sourceStillDirty
      ? s.dirty.typesSources.includes(source) ? s.dirty.typesSources : [...s.dirty.typesSources, source]
      : s.dirty.typesSources.filter(p => p !== source);
    return { mission: { ...s.mission, types: next }, dirty: { ...s.dirty, typesSources }, typeHistory: rest };
  }),

  undoMapGroupProto: () => set(s => {
    if (s.mapGroupProtoHistory.length === 0) return s;
    const [last, ...rest] = s.mapGroupProtoHistory;
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(last.key, last.prev);
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === last.key
        ? { ...b, usages: last.prev.usages, containers: last.prev.containers }
        : b,
    );
    const dirty = isMapGroupProtoDirty(protoNext, s.originalMapGroupProto);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory: rest, dirty: { ...s.dirty, mapGroupProto: dirty } };
  }),

  revertTypesSource: (sourcePath) => set(s => {
    if (!s.mission) return s;
    const next = new Map(s.mission.types);
    for (const [name, orig] of s.originalTypes) {
      if (orig.source === sourcePath) next.set(name, orig);
    }
    const typeHistory = s.typeHistory.filter(h => s.originalTypes.get(h.name)?.source !== sourcePath);
    const typesSources = s.dirty.typesSources.filter(p => p !== sourcePath);
    return { mission: { ...s.mission, types: next }, dirty: { ...s.dirty, typesSources }, typeHistory };
  }),

  revertEventSpawns: () => set(s => {
    if (!s.mission) return s;
    return {
      mission: { ...s.mission, eventSpawns: [...s.originalEventSpawns] },
      dirty: { ...s.dirty, eventSpawns: false },
    };
  }),

  revertEvents: () => set(s => {
    if (!s.mission) return s;
    return {
      mission: { ...s.mission, events: new Map(s.originalEvents) },
      dirty: { ...s.dirty, events: false },
    };
  }),

  revertSpawnableTypes: () => set(s => {
    if (!s.mission) return s;
    return {
      mission: { ...s.mission, spawnableTypes: new Map(s.originalSpawnableTypes) },
      dirty: { ...s.dirty, spawnableTypes: false },
    };
  }),

  revertMapGroupProto: () => set(s => {
    const proto = cloneMapGroupProto(s.originalMapGroupProto);
    const buildingInstances = s.buildingInstances.map(b => {
      const key = b.typeName.trim().toLowerCase();
      const entry = proto.get(key);
      return entry ? { ...b, containers: entry.containers } : b;
    });
    return { mapGroupProto: proto, buildingInstances, dirty: { ...s.dirty, mapGroupProto: false }, mapGroupProtoHistory: [] };
  }),

  revertWeather: () => set(s => ({
    weather: s.originalWeather,
    dirty: { ...s.dirty, weather: false },
  })),

  revertGameplay: () => set(s => ({
    gameplay: s.originalGameplay,
    dirty: { ...s.dirty, gameplay: false },
  })),

  revertLimitsDefinition: () => set(s => ({
    limitsDefinition: s.originalLimitsDefinition,
    dirty: { ...s.dirty, limitsDefinition: false },
  })),

  revertLimitsDefinitionUser: () => set(s => ({
    limitsDefinitionUser: s.originalLimitsDefinitionUser,
    dirty: { ...s.dirty, limitsDefinitionUser: false },
  })),

  revertFfSettings: () => set(s => ({
    ffSettings: s.originalFfSettings,
    dirty: { ...s.dirty, ffSettings: false },
  })),

  revertFfSpawnPoints: () => set(s => ({
    ffSpawnPoints: s.originalFfSpawnPoints,
    dirty: { ...s.dirty, ffSpawnPoints: false },
  })),

  updateEvent: (name, patch) => set(s => {
    if (!s.mission) return s;
    const next = new Map(s.mission.events);
    const existing = next.get(name);
    if (existing) next.set(name, { ...existing, ...patch });
    return { mission: { ...s.mission, events: next }, dirty: { ...s.dirty, events: true } };
  }),

  setEventSpawns: (spawns) => set(s => {
    if (!s.mission) return s;
    return { mission: { ...s.mission, eventSpawns: spawns }, dirty: { ...s.dirty, eventSpawns: true } };
  }),

  updateSpawnableType: (name, patch) => set(s => {
    if (!s.mission) return s;
    const next = new Map(s.mission.spawnableTypes);
    const existing = next.get(name);
    if (existing) next.set(name, { ...existing, ...patch });
    return { mission: { ...s.mission, spawnableTypes: next }, dirty: { ...s.dirty, spawnableTypes: true } };
  }),

  addBuildingCategory: (buildingType, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cat = category.trim();
    const normalizedCat = cat.toLowerCase();
    if (!key || !normalizedCat || !s.mapGroupProto.has(key)) return s;

    const entry = s.mapGroupProto.get(key)!;
    const protoNext = new Map(s.mapGroupProto);
    const containers = entry.containers.map(c => {
      if (c.categories.some(existing => existing.trim().toLowerCase() === normalizedCat)) return c;
      return { ...c, categories: [...c.categories, cat] };
    });

    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  removeBuildingCategory: (buildingType, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cat = category.trim().toLowerCase();
    if (!key || !cat || !s.mapGroupProto.has(key)) return s;

    const entry = s.mapGroupProto.get(key)!;
    const protoNext = new Map(s.mapGroupProto);
    const containers = entry.containers.map(c => ({
      ...c,
      categories: c.categories.filter(existing => existing.trim().toLowerCase() !== cat),
    }));

    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  addBuildingUsage: (buildingType, usage) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const u = usage.trim();
    if (!key || !u || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    if (entry.usages.some(existing => existing.trim().toLowerCase() === u.toLowerCase())) return s;
    const containers = entry.containers.length > 0
      ? entry.containers.map(c => ({ ...c, tags: [...c.tags, u] }))
      : entry.containers;
    const updated = { ...entry, usages: [...entry.usages, u], containers };
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, updated);
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, usages: updated.usages, containers: updated.containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  removeBuildingUsage: (buildingType, usage) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const u = usage.trim().toLowerCase();
    if (!key || !u || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    const containers = entry.containers.length > 0
      ? entry.containers.map(c => ({ ...c, tags: c.tags.filter(t => t.trim().toLowerCase() !== u) }))
      : entry.containers;
    const updated = { ...entry, usages: entry.usages.filter(existing => existing.trim().toLowerCase() !== u), containers };
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, updated);
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, usages: updated.usages, containers: updated.containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  addContainerTag: (buildingType, containerName, tag) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cName = containerName.trim().toLowerCase();
    const t = tag.trim();
    if (!key || !cName || !t || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    const containers = entry.containers.map(c =>
      c.name.trim().toLowerCase() === cName && !c.tags.some(x => x.trim().toLowerCase() === t.toLowerCase())
        ? { ...c, tags: [...c.tags, t] }
        : c,
    );
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  removeContainerTag: (buildingType, containerName, tag) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cName = containerName.trim().toLowerCase();
    const t = tag.trim().toLowerCase();
    if (!key || !cName || !t || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    const containers = entry.containers.map(c =>
      c.name.trim().toLowerCase() === cName
        ? { ...c, tags: c.tags.filter(x => x.trim().toLowerCase() !== t) }
        : c,
    );
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  addContainerCategory: (buildingType, containerName, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cName = containerName.trim().toLowerCase();
    const cat = category.trim();
    if (!key || !cName || !cat || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    const containers = entry.containers.map(c =>
      c.name.trim().toLowerCase() === cName && !c.categories.some(x => x.trim().toLowerCase() === cat.toLowerCase())
        ? { ...c, categories: [...c.categories, cat] }
        : c,
    );
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  removeContainerCategory: (buildingType, containerName, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cName = containerName.trim().toLowerCase();
    const cat = category.trim().toLowerCase();
    if (!key || !cName || !cat || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    const containers = entry.containers.map(c =>
      c.name.trim().toLowerCase() === cName
        ? { ...c, categories: c.categories.filter(x => x.trim().toLowerCase() !== cat) }
        : c,
    );
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  updateContainerLootmax: (buildingType, containerName, lootmax) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cName = containerName.trim().toLowerCase();
    if (!key || !cName || !s.mapGroupProto.has(key)) return s;
    const entry = s.mapGroupProto.get(key)!;
    const containers = entry.containers.map(c =>
      c.name.trim().toLowerCase() === cName ? { ...c, lootmax } : c,
    );
    const protoNext = new Map(s.mapGroupProto);
    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );
    const mapGroupProtoHistory = [{ key, prev: cloneMapGroupProtoEntry(entry) }, ...s.mapGroupProtoHistory].slice(0, 200);
    return { mapGroupProto: protoNext, buildingInstances, mapGroupProtoHistory, dirty: { ...s.dirty, mapGroupProto: isMapGroupProtoDirty(protoNext, s.originalMapGroupProto) } };
  }),

  removeLimitsUsage: (usage) => set(s => {
    const uLower = usage.trim().toLowerCase();
    const nextDirty = { ...s.dirty };

    // Snapshot state before any mutation for undo
    const prevProtoEntries: ZoneRemoveSnapshot['prevProtoEntries'] = [];
    for (const [key, entry] of s.mapGroupProto) {
      const inUsages = entry.usages.some(x => x.trim().toLowerCase() === uLower);
      const inContainers = entry.containers.some(c => c.tags.some(t => t.trim().toLowerCase() === uLower));
      if (inUsages || inContainers) prevProtoEntries.push({ key, entry: cloneMapGroupProtoEntry(entry) });
    }
    const prevTypes: ZoneRemoveSnapshot['prevTypes'] = [];
    if (s.mission) {
      for (const [name, type] of s.mission.types) {
        if (type.usages.some(u => u.trim().toLowerCase() === uLower)) prevTypes.push({ name, type });
      }
    }
    const snapshot: ZoneRemoveSnapshot = {
      usage,
      prevLimitsDefinition: s.limitsDefinition,
      prevProtoEntries,
      prevTypes,
    };

    // Remove from cfglimitsdefinition.xml
    let nextLimits = s.limitsDefinition;
    if (s.limitsDefinition) {
      const filtered = s.limitsDefinition.usages.filter(x => x.trim().toLowerCase() !== uLower);
      if (filtered.length !== s.limitsDefinition.usages.length) {
        nextLimits = { ...s.limitsDefinition, usages: filtered };
        nextDirty.limitsDefinition = true;
      }
    }

    // Remove from mapgroupproto.xml — both entry.usages and container tags
    const protoNext = new Map(s.mapGroupProto);
    let protoChanged = false;
    for (const [key, entry] of protoNext) {
      const filteredUsages = entry.usages.filter(x => x.trim().toLowerCase() !== uLower);
      const filteredContainers = entry.containers.length > 0
        ? entry.containers.map(c => ({ ...c, tags: c.tags.filter(t => t.trim().toLowerCase() !== uLower) }))
        : entry.containers;
      const changed = filteredUsages.length !== entry.usages.length
        || filteredContainers.some((c, i) => c.tags.length !== entry.containers[i].tags.length);
      if (changed) {
        protoNext.set(key, { ...entry, usages: filteredUsages, containers: filteredContainers });
        protoChanged = true;
      }
    }
    if (protoChanged) nextDirty.mapGroupProto = isMapGroupProtoDirty(protoNext, s.originalMapGroupProto);

    const buildingInstances = protoChanged
      ? s.buildingInstances.map(b => {
          const key = b.typeName.trim().toLowerCase();
          const entry = protoNext.get(key);
          return entry ? { ...b, usages: entry.usages, containers: entry.containers } : b;
        })
      : s.buildingInstances;

    // Remove <usage name="..."/> from all types in types.xml
    let nextMission = s.mission;
    if (s.mission) {
      const nextTypes = new Map(s.mission.types);
      const dirtySources = new Set(nextDirty.typesSources);
      let typesChanged = false;
      for (const [name, type] of nextTypes) {
        if (type.usages.some(u => u.trim().toLowerCase() === uLower)) {
          nextTypes.set(name, { ...type, usages: type.usages.filter(u => u.trim().toLowerCase() !== uLower) });
          if (type.source) dirtySources.add(type.source);
          typesChanged = true;
        }
      }
      if (typesChanged) {
        nextMission = { ...s.mission, types: nextTypes };
        nextDirty.typesSources = [...dirtySources];
      }
    }

    const zoneRemoveHistory = [snapshot, ...s.zoneRemoveHistory].slice(0, 30);
    return { limitsDefinition: nextLimits, mapGroupProto: protoNext, buildingInstances, mission: nextMission, dirty: nextDirty, zoneRemoveHistory };
  }),

  undoZoneRemove: () => set(s => {
    if (s.zoneRemoveHistory.length === 0) return s;
    const [snap, ...rest] = s.zoneRemoveHistory;
    const nextDirty = { ...s.dirty };

    // Restore limitsDefinition
    nextDirty.limitsDefinition = snap.prevLimitsDefinition !== s.limitsDefinition
      ? true
      : s.dirty.limitsDefinition;

    // Restore affected mapGroupProto entries
    const protoNext = new Map(s.mapGroupProto);
    for (const { key, entry } of snap.prevProtoEntries) protoNext.set(key, entry);
    nextDirty.mapGroupProto = isMapGroupProtoDirty(protoNext, s.originalMapGroupProto);

    const buildingInstances = s.buildingInstances.map(b => {
      const key = b.typeName.trim().toLowerCase();
      const entry = protoNext.get(key);
      return entry ? { ...b, usages: entry.usages, containers: entry.containers } : b;
    });

    // Restore affected types
    let nextMission = s.mission;
    if (s.mission && snap.prevTypes.length > 0) {
      const nextTypes = new Map(s.mission.types);
      const dirtySources = new Set(nextDirty.typesSources);
      for (const { name, type } of snap.prevTypes) {
        nextTypes.set(name, type);
        if (type.source) dirtySources.add(type.source);
      }
      // Only keep sources dirty if they still differ from originals after restore
      const cleanedSources = [...dirtySources].filter(src => {
        for (const [, t] of nextTypes) {
          if (t.source === src && t !== s.originalTypes.get(t.name)) return true;
        }
        // Also keep if other non-restored types in this source are still dirty
        for (const [tName, t] of s.mission!.types) {
          if (t.source === src && !snap.prevTypes.some(p => p.name === tName)) {
            if (t !== s.originalTypes.get(tName)) return true;
          }
        }
        return false;
      });
      nextDirty.typesSources = cleanedSources;
      nextMission = { ...s.mission, types: nextTypes };
    }

    // Also clear any remaining dirty for types sources that only had this usage removed
    const remainingDirtySources = nextDirty.typesSources.filter(src => {
      if (!nextMission) return false;
      for (const [, t] of nextMission.types) {
        if (t.source === src && t !== s.originalTypes.get(t.name)) return true;
      }
      return false;
    });
    nextDirty.typesSources = remainingDirtySources;

    return {
      limitsDefinition: snap.prevLimitsDefinition,
      mapGroupProto: protoNext,
      buildingInstances,
      mission: nextMission,
      dirty: nextDirty,
      zoneRemoveHistory: rest,
    };
  }),

  addCustomTypePack: async (name, xmlContent) => {
    const { paths, economyCore } = get();
    if (!paths.missionPath || !paths.economyCorePath) {
      set({ saveError: 'No mission loaded or cfgeconomycore.xml not found.' });
      return;
    }
    const folderName = `${name}_ce`;
    const fileName   = `${name}_types.xml`;
    const folderPath = `${paths.missionPath}/CustomTypes/${folderName}`;
    const filePath   = `${folderPath}/${fileName}`;
    try {
      await createDir(folderPath);
      await writeFile(filePath, xmlContent);

      // Add ce entry if not already present
      const folderKey = `CustomTypes/${folderName}`;
      const exists = economyCore.some(e => e.folder === folderKey);
      const nextCore = exists
        ? economyCore
        : [...economyCore, { folder: folderKey, files: [{ name: fileName, type: 'types' }] }];

      await backupIfNeeded(paths.economyCorePath);
      await writeFile(paths.economyCorePath, serializeEconomyCoreXml(nextCore));
      set({ economyCore: nextCore });
    } catch (err) {
      set({ saveError: `Failed to add custom types pack: ${toMessage(err)}` });
    }
  },

  removeEconomyCoreEntry: async (folder) => {
    const { paths, economyCore } = get();
    if (!paths.economyCorePath) return;
    const nextCore = economyCore.filter(e => e.folder !== folder);
    try {
      await backupIfNeeded(paths.economyCorePath);
      await writeFile(paths.economyCorePath, serializeEconomyCoreXml(nextCore));
      set({ economyCore: nextCore });
    } catch (err) {
      set({ saveError: `Failed to update cfgeconomycore.xml: ${toMessage(err)}` });
    }
  },

  saveTypesSource: async (sourcePath) => {
    const { mission } = get();
    if (!mission) return;
    const sourceTypes = new Map(
      [...mission.types.entries()].filter(([, t]) => t.source === sourcePath)
    );
    await trySave(basename(sourcePath), async () => {
      await writeFile(sourcePath, serializeTypesXml(sourceTypes));
      set(s => {
        const originalTypes = new Map(s.originalTypes);
        for (const [name, type] of s.mission?.types ?? []) {
          if (type.source === sourcePath) originalTypes.set(name, type);
        }
        return {
          dirty: { ...s.dirty, typesSources: s.dirty.typesSources.filter(p => p !== sourcePath) },
          originalTypes,
          typeHistory: s.typeHistory.filter(entry => {
            const type = s.mission?.types.get(entry.name);
            return type ? type.source !== sourcePath : false;
          }),
        };
      });
    }, [sourcePath]);
  },

  saveEventSpawns: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventSpawnsPath) return;
    await trySave('cfgeventspawns.xml', async () => {
      await writeFile(paths.eventSpawnsPath!, serializeEventSpawnsXml(mission.eventSpawns));
      set(s => ({ dirty: { ...s.dirty, eventSpawns: false }, originalEventSpawns: [...mission.eventSpawns] }));
    }, [paths.eventSpawnsPath]);
  },

  saveEvents: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventsPath) return;
    await trySave('events.xml', async () => {
      await writeFile(paths.eventsPath!, serializeEventsXml(mission.events));
      set(s => ({ dirty: { ...s.dirty, events: false }, originalEvents: new Map(mission.events) }));
    }, [paths.eventsPath]);
  },

  saveSpawnableTypes: async () => {
    const { mission, paths } = get();
    if (!mission) return;
    const groupedBySource = new Map<string, Map<string, SpawnableType>>();
    for (const [name, spawnableType] of mission.spawnableTypes) {
      const sourcePath = spawnableType.source || paths.spawnableTypesPath || '';
      if (!sourcePath) continue;
      if (!groupedBySource.has(sourcePath)) groupedBySource.set(sourcePath, new Map<string, SpawnableType>());
      groupedBySource.get(sourcePath)!.set(name, spawnableType);
    }
    if (groupedBySource.size === 0) return;
    await trySave('cfgspawnabletypes.xml', async () => {
      for (const [sourcePath, spawnableTypes] of groupedBySource) {
        await writeFile(sourcePath, serializeSpawnableTypesXml(spawnableTypes));
      }
      set(s => ({ dirty: { ...s.dirty, spawnableTypes: false }, originalSpawnableTypes: new Map(mission.spawnableTypes) }));
    }, [...groupedBySource.keys()]);
  },

  saveMapGroupProto: async () => {
    const { mapGroupProto, paths } = get();
    if (!paths.mapGroupProtoPath) return;
    await trySave('mapgroupproto.xml', async () => {
      await writeFile(paths.mapGroupProtoPath!, serializeMapGroupProtoXml(mapGroupProto));
      set(s => ({ dirty: { ...s.dirty, mapGroupProto: false }, originalMapGroupProto: cloneMapGroupProto(s.mapGroupProto) }));
    }, [paths.mapGroupProtoPath]);
  },

  saveWeather: async () => {
    const { weather, paths } = get();
    if (!paths.weatherPath || !weather) return;
    await trySave('cfgweather.xml', async () => {
      await writeFile(paths.weatherPath!, serializeWeatherXml(weather));
      set(s => ({ dirty: { ...s.dirty, weather: false }, originalWeather: s.weather }));
    }, [paths.weatherPath]);
  },

  saveGameplay: async () => {
    const { gameplay, paths } = get();
    if (!paths.gameplayPath || !gameplay) return;
    await trySave('cfggameplay.json', async () => {
      await writeFile(paths.gameplayPath!, serializeGameplayJson(gameplay));
      set(s => ({ dirty: { ...s.dirty, gameplay: false }, originalGameplay: s.gameplay }));
    }, [paths.gameplayPath]);
  },

  saveFfSettings: async () => {
    const { ffSettings, paths } = get();
    if (!paths.ffSettingsPath || !ffSettings) return;
    await trySave('FFSpawnSelector/Settings.json', async () => {
      await writeFile(paths.ffSettingsPath!, serializeFFSettings(ffSettings));
      set(s => ({ dirty: { ...s.dirty, ffSettings: false }, originalFfSettings: s.ffSettings }));
    }, [paths.ffSettingsPath]);
  },

  saveFfSpawnPoints: async () => {
    const { ffSpawnPoints, paths } = get();
    if (!paths.ffSpawnPointsPath || !ffSpawnPoints) return;
    await trySave('FFSpawnSelector/SpawnPoints.json', async () => {
      await writeFile(paths.ffSpawnPointsPath!, serializeFFSpawnPoints(ffSpawnPoints));
      set(s => ({ dirty: { ...s.dirty, ffSpawnPoints: false }, originalFfSpawnPoints: s.ffSpawnPoints }));
    }, [paths.ffSpawnPointsPath]);
  },

  saveLimitsDefinition: async () => {
    const { limitsDefinition, paths } = get();
    if (!paths.limitsDefinitionPath || !limitsDefinition) return;
    await trySave('cfglimitsdefinition.xml', async () => {
      await writeFile(paths.limitsDefinitionPath!, serializeLimitsDefinitionXml(limitsDefinition));
      set(s => ({ dirty: { ...s.dirty, limitsDefinition: false }, originalLimitsDefinition: s.limitsDefinition }));
    }, [paths.limitsDefinitionPath]);
  },

  saveLimitsDefinitionUser: async () => {
    const { limitsDefinitionUser, paths } = get();
    if (!paths.limitsDefinitionUserPath || !limitsDefinitionUser) return;
    await trySave('cfglimitsdefinitionuser.xml', async () => {
      await writeFile(paths.limitsDefinitionUserPath!, serializeLimitsDefinitionUserXml(limitsDefinitionUser));
      set(s => ({ dirty: { ...s.dirty, limitsDefinitionUser: false }, originalLimitsDefinitionUser: s.limitsDefinitionUser }));
    }, [paths.limitsDefinitionUserPath]);
  },

  clearTerritoryState: () => {
    clearCeToolBitmapSource();
    set({
      ceToolLayers: [],
      newCeToolLayerNames: [],
      deletedCeToolLayerNames: [],
      territoryBitmaps: new Map(),
      originalTerritoryBitmaps: new Map(),
      territoryBitmapSize: null,
      ceToolWorldSize: null,
      territoryPaintHistory: [],
    });
  },

  loadTerritoryBitmaps: async (override?: TerritoryBitmapOverride) => {
    const { paths } = get();

    let xmlText: string;
    let effectiveLayersDir: string | null;

    if (override) {
      xmlText = override.xmlContent;
      effectiveLayersDir = override.layersDir;
    } else {
      if (!paths.ceToolXmlPath || !paths.ceToolLayersDir) return;
      try {
        xmlText = await readFile(paths.ceToolXmlPath);
      } catch {
        return;
      }
      effectiveLayersDir = paths.ceToolLayersDir;
    }

    // Update ceToolLayersDir so paint mode check reflects the source
    if (override) {
      set(s => ({ paths: { ...s.paths, ceToolLayersDir: override.layersDir } }));
    }

    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

    // Parse world/layer sizes
    const globalLayer = doc.querySelector('global > layer');
    const globalWorld = doc.querySelector('global > world');
    const bitmapSize = parseInt(globalLayer?.getAttribute('size') ?? '4096', 10);
    const resolvedWorldSize = override?.worldSize ?? parseInt(globalWorld?.getAttribute('size') ?? '15360', 10);

    // Parse layer metadata
    const layers: CeToolLayerMeta[] = [];
    doc.querySelectorAll('layers > layer').forEach(el => {
      const name = el.getAttribute('name') ?? '';
      const usageFlags = parseInt(el.getAttribute('usage_flags') ?? '0', 10);
      const valueFlags = parseInt(el.getAttribute('value_flags') ?? '0', 10);
      const isStandardPaint = /^usgFlg_Paint-/i.test(name);
      const isStandardValue = /^valueFlg_/i.test(name);
      const isPaintable = isStandardPaint || isStandardValue || valueFlags !== 0 || usageFlags !== 0;
      const paintMatch = name.match(/^usgFlg_Paint-(.+)$/i);
      const defMatch   = name.match(/^usgFlg_Def-(.+)$/i);
      const valueMatch = name.match(/^valueFlg_(.+)$/i);
      const tierNumMatch = !paintMatch && !defMatch && !valueMatch && name.match(/^tier(\d+)$/i);
      const usageName = paintMatch ? paintMatch[1]
        : defMatch   ? defMatch[1]
        : valueMatch ? valueMatch[1]
        : tierNumMatch ? `Tier${tierNumMatch[1]}`
        : name;
      layers.push({ name, usageFlags, valueFlags, isPaintable, usageName });
    });

    // Load TGA pixels for each paintable layer
    const bitmaps = new Map<string, Uint8ClampedArray>();
    const originals = new Map<string, Uint8ClampedArray>();

    const layerLoader = override?.layerLoader ?? ((name: string) => {
      const tgaPath = `${effectiveLayersDir}/${name}.tga`;
      return readBinaryFile(tgaPath).catch(() => null);
    });

    await Promise.all(
      layers.filter(l => l.isPaintable).map(async (layer) => {
        try {
          const raw = await layerLoader(layer.name);
          if (raw) {
            const arr = await decodeLayerImage(raw);
            if (arr) {
              bitmaps.set(layer.name, arr);
              originals.set(layer.name, arr.slice());
              return;
            }
          }
        } catch (e) {
          console.warn('[territory] layer parse failed:', layer.name, e);
        }
        // Only allocate empty bitmap for file-based paths (not bundled read-only)
        if (effectiveLayersDir !== null) {
          const empty = new Uint8ClampedArray(bitmapSize * bitmapSize * 4);
          bitmaps.set(layer.name, empty);
          originals.set(layer.name, empty.slice());
        }
      })
    );

    set({
      ceToolLayers: layers,
      territoryBitmaps: bitmaps,
      originalTerritoryBitmaps: originals,
      territoryBitmapSize: { width: bitmapSize, height: bitmapSize },
      ceToolWorldSize: resolvedWorldSize,
    });
    setCeToolBitmapSource(bitmaps, layers, { width: bitmapSize, height: bitmapSize }, resolvedWorldSize);
  },

  addCeToolLayer: (usageName) => {
    const name = `usgFlg_Paint-${usageName.trim()}`;
    const { ceToolLayers, territoryBitmaps, originalTerritoryBitmaps, territoryBitmapSize, limitsDefinition, limitsDefinitionUser, paths } = get();
    if (ceToolLayers.some(l => l.name.toLowerCase() === name.toLowerCase())) return;

    // Find first unused power-of-2 bit across all existing layers and any declared user flags
    const usedLayerBits = new Set(ceToolLayers.map(l => l.usageFlags));
    const usedUserBits = new Set(
      (limitsDefinitionUser?.usageGroups ?? []).flatMap(g => g.usages.map(u => u.flags ?? 0)).filter(f => f > 0)
    );
    const usedBits = new Set([...usedLayerBits, ...usedUserBits]);
    let freeBit = 1;
    while (usedBits.has(freeBit)) freeBit *= 2;

    const meta: CeToolLayerMeta = { name, usageFlags: freeBit, valueFlags: 0, isPaintable: true, usageName: usageName.trim() };
    const size = territoryBitmapSize ?? { width: 4096, height: 4096 };
    const empty = new Uint8ClampedArray(size.width * size.height * 4);
    const nextBitmaps = new Map(territoryBitmaps);
    nextBitmaps.set(name, empty);
    const nextOriginals = new Map(originalTerritoryBitmaps);
    nextOriginals.set(name, empty.slice());

    const nextLayers = [...ceToolLayers, meta];

    // Register usage name in cfglimitsdefinition.xml (create minimal if absent)
    const baseLimits = limitsDefinition ?? (paths.missionPath ? { categories: [], tags: [], usages: [], values: [] } : null);
    const nextLimits = baseLimits && !baseLimits.usages.some(u => u.toLowerCase() === usageName.trim().toLowerCase())
      ? { ...baseLimits, usages: [...baseLimits.usages, usageName.trim()] }
      : baseLimits;

    // Register usage + flags in cfglimitsdefinitionuser.xml (creates or updates "CustomZones" group)
    const entry = { name: usageName.trim(), flags: freeBit };
    let nextLimitsUser: typeof limitsDefinitionUser;
    if (limitsDefinitionUser) {
      const groupIdx = limitsDefinitionUser.usageGroups.findIndex(g => g.name === 'CustomZones');
      if (groupIdx >= 0) {
        const group = limitsDefinitionUser.usageGroups[groupIdx];
        if (!group.usages.some(u => u.name.toLowerCase() === entry.name.toLowerCase())) {
          const groups = [...limitsDefinitionUser.usageGroups];
          groups[groupIdx] = { ...group, usages: [...group.usages, entry] };
          nextLimitsUser = { ...limitsDefinitionUser, usageGroups: groups };
        }
      } else {
        nextLimitsUser = {
          ...limitsDefinitionUser,
          usageGroups: [...limitsDefinitionUser.usageGroups, { name: 'CustomZones', usages: [entry] }],
        };
      }
    } else if (paths.missionPath) {
      nextLimitsUser = { usageGroups: [{ name: 'CustomZones', usages: [entry] }], valueGroups: [] };
    }

    set(s => ({
      ceToolLayers: nextLayers,
      newCeToolLayerNames: [...s.newCeToolLayerNames, name],
      territoryBitmaps: nextBitmaps,
      originalTerritoryBitmaps: nextOriginals,
      territoryPaintHistory: [...s.territoryPaintHistory, { type: 'layerCreated' as const, layerName: name }],
      paths: (() => {
        let p = s.paths;
        if (nextLimitsUser && !p.limitsDefinitionUserPath && p.missionPath)
          p = { ...p, limitsDefinitionUserPath: `${p.missionPath}/cfglimitsdefinitionuser.xml` };
        if (nextLimits && !p.limitsDefinitionPath && p.missionPath)
          p = { ...p, limitsDefinitionPath: `${p.missionPath}/cfglimitsdefinition.xml` };
        return p;
      })(),
      dirty: {
        ...s.dirty,
        territoryBitmaps: true,
        ...(nextLimits ? { limitsDefinition: true } : {}),
        ...(nextLimitsUser ? { limitsDefinitionUser: true } : {}),
      },
      ...(nextLimits ? { limitsDefinition: nextLimits } : {}),
      ...(nextLimitsUser ? { limitsDefinitionUser: nextLimitsUser } : {}),
    }));
    const { ceToolWorldSize } = get();
    if (territoryBitmapSize && ceToolWorldSize)
      setCeToolBitmapSource(nextBitmaps, nextLayers, territoryBitmapSize, ceToolWorldSize);
  },

  removeCeToolLayer: (layerName) => {
    set(s => {
      const nextBitmaps = new Map(s.territoryBitmaps);
      nextBitmaps.delete(layerName);
      const nextOriginals = new Map(s.originalTerritoryBitmaps);
      nextOriginals.delete(layerName);
      const wasNew = s.newCeToolLayerNames.includes(layerName);
      return {
        ceToolLayers: s.ceToolLayers.filter(l => l.name !== layerName),
        newCeToolLayerNames: s.newCeToolLayerNames.filter(n => n !== layerName),
        deletedCeToolLayerNames: wasNew ? s.deletedCeToolLayerNames : [...s.deletedCeToolLayerNames, layerName],
        territoryBitmaps: nextBitmaps,
        originalTerritoryBitmaps: nextOriginals,
        territoryPaintHistory: [],
        dirty: { ...s.dirty, territoryBitmaps: true },
      };
    });
    const { territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize } = get();
    if (territoryBitmapSize && ceToolWorldSize)
      setCeToolBitmapSource(territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize);
  },

  commitTerritoryPaint: (layerName, newPixels) => {
    set(s => {
      const current = s.territoryBitmaps.get(layerName);
      const diffs: Array<{ idx: number; prev: number }> = [];
      if (current) {
        for (let i = 0; i < current.length; i += 4) {
          if (current[i] !== newPixels[i]) diffs.push({ idx: i, prev: current[i] });
        }
      }
      const next = new Map(s.territoryBitmaps);
      next.set(layerName, newPixels);
      return {
        territoryBitmaps: next,
        territoryPaintHistory: [...s.territoryPaintHistory, { type: 'paint' as const, layerName, diffs }],
        dirty: { ...s.dirty, territoryBitmaps: true },
      };
    });
    const { territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize } = get();
    if (territoryBitmapSize && ceToolWorldSize)
      setCeToolBitmapSource(territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize);
  },

  undoTerritoryPaint: () => {
    set(s => {
      if (s.territoryPaintHistory.length === 0) return s;
      const history = s.territoryPaintHistory.slice(0, -1);
      const entry = s.territoryPaintHistory[s.territoryPaintHistory.length - 1];

      if (entry.type === 'layerCreated') {
        const nextBitmaps = new Map(s.territoryBitmaps);
        nextBitmaps.delete(entry.layerName);
        const nextOriginals = new Map(s.originalTerritoryBitmaps);
        nextOriginals.delete(entry.layerName);
        return {
          ceToolLayers: s.ceToolLayers.filter(l => l.name !== entry.layerName),
          newCeToolLayerNames: s.newCeToolLayerNames.filter(n => n !== entry.layerName),
          territoryBitmaps: nextBitmaps,
          originalTerritoryBitmaps: nextOriginals,
          territoryPaintHistory: history,
          dirty: { ...s.dirty, territoryBitmaps: history.length > 0 },
        };
      }

      const current = s.territoryBitmaps.get(entry.layerName);
      if (!current) return { territoryPaintHistory: history };
      const restored = current.slice();
      for (const { idx, prev } of entry.diffs) {
        restored[idx] = prev; restored[idx + 1] = prev; restored[idx + 2] = prev;
        restored[idx + 3] = prev > 127 ? 255 : 0;
      }
      const next = new Map(s.territoryBitmaps);
      next.set(entry.layerName, restored);
      return { territoryBitmaps: next, territoryPaintHistory: history, dirty: { ...s.dirty, territoryBitmaps: history.length > 0 } };
    });
    const { territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize } = get();
    if (territoryBitmapSize && ceToolWorldSize)
      setCeToolBitmapSource(territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize);
  },

  saveTerritoryBitmaps: async () => {
    const { paths, ceToolLayers, newCeToolLayerNames, deletedCeToolLayerNames, territoryBitmaps, territoryBitmapSize, ceToolWorldSize } = get();
    if (!paths.ceToolLayersDir || !paths.missionPath || !territoryBitmapSize) return;

    const paintableLayers = ceToolLayers.filter(l => l.isPaintable && !/^usgFlg_Def-/i.test(l.name) && territoryBitmaps.has(l.name));
    const tgaPaths = paintableLayers.map(l => `${paths.ceToolLayersDir}/${l.name}.tga`);
    const xmlBackupPaths = paths.ceToolXmlPath ? [paths.ceToolXmlPath] : [];
    await trySave('territory zones', async () => {
      const { width, height } = territoryBitmapSize;
      // Write each modified paintable TGA
      for (const layer of paintableLayers) {
        const pixels = territoryBitmaps.get(layer.name);
        if (!pixels) continue;
        await writeBinaryFile(
          `${paths.ceToolLayersDir}/${layer.name}.tga`,
          encodeTgaLayer(pixels, width, height),
        );
      }

      // Update CE Tool XML: add new layers, remove deleted layers
      const needsXmlUpdate = (newCeToolLayerNames.length > 0 || deletedCeToolLayerNames.length > 0) && paths.ceToolXmlPath;
      if (needsXmlUpdate) {
        const xmlText = await readFile(paths.ceToolXmlPath!);
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        const layersEl = doc.querySelector('layers');
        if (layersEl) {
          // Remove deleted layers
          const deletedSet = new Set(deletedCeToolLayerNames);
          layersEl.querySelectorAll('layer').forEach(el => {
            if (deletedSet.has(el.getAttribute('name') ?? '')) el.remove();
          });
          // Append new layers
          for (const layerName of newCeToolLayerNames) {
            const meta = ceToolLayers.find(l => l.name === layerName);
            if (!meta) continue;
            const el = doc.createElement('layer');
            el.setAttribute('name', meta.name);
            el.setAttribute('usage_flags', String(meta.usageFlags));
            el.setAttribute('value_flags', String(meta.valueFlags));
            layersEl.appendChild(el);
          }
          await writeFile(paths.ceToolXmlPath!, new XMLSerializer().serializeToString(doc));
        }
      }

      // Delete TGA files for removed layers
      for (const layerName of deletedCeToolLayerNames) {
        try { await removeFile(`${paths.ceToolLayersDir}/${layerName}.tga`); } catch { /* already gone */ }
      }

      // Compile areaflags.map from all layers
      const layerMetas = ceToolLayers
        .filter(l => l.usageFlags !== 0 || l.valueFlags !== 0)
        .map(l => ({
          path: `${paths.ceToolLayersDir}/${l.name}.tga`,
          usage_flags: l.usageFlags,
          value_flags: l.valueFlags,
        }));

      await invoke('compile_areaflags', {
        layers: layerMetas,
        width,
        height,
        worldWidth: ceToolWorldSize ?? 15360,
        worldHeight: ceToolWorldSize ?? 15360,
        outPath: `${paths.missionPath}/areaflags.map`,
      });

      // Update originals and clear new layer tracking
      const newOriginals = new Map<string, Uint8ClampedArray>();
      for (const [name, arr] of territoryBitmaps) newOriginals.set(name, arr.slice());
      set(s => ({
        dirty: { ...s.dirty, territoryBitmaps: false },
        originalTerritoryBitmaps: newOriginals,
        newCeToolLayerNames: [],
        deletedCeToolLayerNames: [],
      }));
    }, [...tgaPaths, ...xmlBackupPaths]);
  },

  revertTerritoryBitmaps: () => {
    set(s => {
      const restored = new Map<string, Uint8ClampedArray>();
      for (const [name, arr] of s.originalTerritoryBitmaps) restored.set(name, arr.slice());
      // Remove unsaved new layers
      const newNames = new Set(s.newCeToolLayerNames);
      const revertedLayers = s.ceToolLayers.filter(l => !newNames.has(l.name));
      return {
        ceToolLayers: revertedLayers,
        newCeToolLayerNames: [],
        deletedCeToolLayerNames: [],
        territoryBitmaps: restored,
        territoryPaintHistory: [],
        dirty: { ...s.dirty, territoryBitmaps: false },
      };
    });
    const { territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize } = get();
    if (territoryBitmapSize && ceToolWorldSize)
      setCeToolBitmapSource(territoryBitmaps, ceToolLayers, territoryBitmapSize, ceToolWorldSize);
  },
  };
});
