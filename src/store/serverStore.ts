import { create } from 'zustand';
import type { MissionData, DayZType, DayZEvent, EventSpawnDef, SpawnableType, DirtyFlags, CeEntry, BuildingInstance, PlayerSpawnData } from '../types/dayz';
import {
  serializeTypesXml, serializeEventSpawnsXml,
  serializeEventsXml, serializeSpawnableTypesXml,
  serializeEconomyCoreXml, serializeMapGroupProtoXml,
} from '../lib/xmlParser';
import { writeFile, createDir } from '../lib/fileDiscovery';
import type { ContainerDef } from '../types/dayz';

interface FilePaths {
  missionPath: string | null;
  typesPath: string | null;
  eventSpawnsPath: string | null;
  eventsPath: string | null;
  spawnableTypesPath: string | null;
  economyCorePath: string | null;
  mapGroupProtoPath: string | null;
}

type MapGroupProtoEntry = {
  usages: string[];
  tiers: string[];
  lootmax: number;
  containers: ContainerDef[];
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
  originalTypes: Map<string, DayZType>;
  typeHistory: { name: string; prev: DayZType }[];

  setMission: (mission: MissionData) => void;
  setPaths: (paths: Partial<FilePaths>) => void;
  setEconomyCore: (entries: CeEntry[]) => void;
  setBuildingInstances: (instances: BuildingInstance[]) => void;
  setMapGroupProto: (proto: Map<string, MapGroupProtoEntry>) => void;
  setPlayerSpawnData: (data: PlayerSpawnData | null) => void;
  clearSaveError: () => void;

  updateType: (name: string, patch: Partial<DayZType>) => void;
  undoType: () => void;
  revertTypesSource: (sourcePath: string) => void;
  updateEvent: (name: string, patch: Partial<DayZEvent>) => void;
  setEventSpawns: (spawns: EventSpawnDef[]) => void;
  updateSpawnableType: (name: string, patch: Partial<SpawnableType>) => void;
  addBuildingCategory: (buildingType: string, category: string) => void;
  removeBuildingCategory: (buildingType: string, category: string) => void;

  addCustomTypePack: (name: string, xmlContent: string) => Promise<void>;
  removeEconomyCoreEntry: (folder: string) => Promise<void>;
  saveTypesSource: (sourcePath: string) => Promise<void>;
  saveEventSpawns: () => Promise<void>;
  saveEvents: () => Promise<void>;
  saveSpawnableTypes: () => Promise<void>;
  saveMapGroupProto: () => Promise<void>;
}

const emptyDirty: DirtyFlags = { typesSources: [], eventSpawns: false, events: false, spawnableTypes: false, mapGroupProto: false };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function markSuccess(set: (fn: (s: ServerState) => Partial<ServerState>) => void) {
  set(() => ({ saveStatus: 'success' }));
  setTimeout(() => set(s => s.saveStatus === 'success' ? { saveStatus: 'idle' } : {}), 3000);
}

export const useServerStore = create<ServerState>((set, get) => ({
  mission: null,
  paths: { missionPath: null, typesPath: null, eventSpawnsPath: null, eventsPath: null, spawnableTypesPath: null, economyCorePath: null, mapGroupProtoPath: null },
  dirty: emptyDirty,
  saveError: null,
  saveStatus: 'idle' as const,
  economyCore: [],
  buildingInstances: [],
  mapGroupProto: new Map(),
  playerSpawnData: null,
  originalTypes: new Map(),
  typeHistory: [],

  setMission: (mission) => set({ mission, dirty: emptyDirty, originalTypes: new Map(mission.types), typeHistory: [] }),
  setPaths: (paths) => set(s => ({ paths: { ...s.paths, ...paths } })),
  setEconomyCore: (entries) => set({ economyCore: entries }),
  setBuildingInstances: (instances) => set({ buildingInstances: instances }),
  setMapGroupProto: (proto) => set({ mapGroupProto: new Map(proto) }),
  setPlayerSpawnData: (data) => set({ playerSpawnData: data }),
  clearSaveError: () => set({ saveError: null }),

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
    const cat = category.trim().toLowerCase();
    if (!key || !cat || !s.mapGroupProto.has(key)) return s;

    const protoNext = new Map(s.mapGroupProto);
    const entry = protoNext.get(key)!;
    const containers = entry.containers.map(c => {
      if (c.categories.includes(cat)) return c;
      return { ...c, categories: [...c.categories, cat] };
    });

    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );

    return { mapGroupProto: protoNext, buildingInstances, dirty: { ...s.dirty, mapGroupProto: true } };
  }),

  removeBuildingCategory: (buildingType, category) => set(s => {
    const key = buildingType.trim().toLowerCase();
    const cat = category.trim().toLowerCase();
    if (!key || !cat || !s.mapGroupProto.has(key)) return s;

    const protoNext = new Map(s.mapGroupProto);
    const entry = protoNext.get(key)!;
    const containers = entry.containers.map(c => ({
      ...c,
      categories: c.categories.filter(existing => existing !== cat),
    }));

    protoNext.set(key, { ...entry, containers });
    const buildingInstances = s.buildingInstances.map(b =>
      b.typeName.trim().toLowerCase() === key ? { ...b, containers } : b,
    );

    return { mapGroupProto: protoNext, buildingInstances, dirty: { ...s.dirty, mapGroupProto: true } };
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
    set({ saveStatus: 'saving' });
    try {
      await writeFile(sourcePath, serializeTypesXml(sourceTypes));
      set(s => ({ dirty: { ...s.dirty, typesSources: s.dirty.typesSources.filter(p => p !== sourcePath) } }));
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save ${sourcePath.split(/[\\/]/).pop()}: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  },

  saveEventSpawns: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventSpawnsPath) return;
    set({ saveStatus: 'saving' });
    try {
      await writeFile(paths.eventSpawnsPath, serializeEventSpawnsXml(mission.eventSpawns));
      set(s => ({ dirty: { ...s.dirty, eventSpawns: false } }));
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save cfgeventspawns.xml: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  },

  saveEvents: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventsPath) return;
    set({ saveStatus: 'saving' });
    try {
      await writeFile(paths.eventsPath, serializeEventsXml(mission.events));
      set(s => ({ dirty: { ...s.dirty, events: false } }));
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save events.xml: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  },

  saveSpawnableTypes: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.spawnableTypesPath) return;
    set({ saveStatus: 'saving' });
    try {
      await writeFile(paths.spawnableTypesPath, serializeSpawnableTypesXml(mission.spawnableTypes));
      set(s => ({ dirty: { ...s.dirty, spawnableTypes: false } }));
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save cfgspawnabletypes.xml: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  },

  saveMapGroupProto: async () => {
    const { mapGroupProto, paths } = get();
    if (!paths.mapGroupProtoPath) return;
    set({ saveStatus: 'saving' });
    try {
      await writeFile(paths.mapGroupProtoPath, serializeMapGroupProtoXml(mapGroupProto));
      set(s => ({ dirty: { ...s.dirty, mapGroupProto: false } }));
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save mapgroupproto.xml: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  },
}));
