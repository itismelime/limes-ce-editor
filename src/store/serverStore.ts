import { create } from 'zustand';
import type { MissionData, DayZType, DayZEvent, EventSpawnDef, SpawnableType, DirtyFlags, CeEntry, BuildingInstance, PlayerSpawnData, WeatherData, GameplayData, CeToolProject } from '../types/dayz';
import {
  serializeTypesXml, serializeEventSpawnsXml,
  serializeEventsXml, serializeSpawnableTypesXml,
  serializeEconomyCoreXml, serializeMapGroupProtoXml,
  serializeWeatherXml, serializeGameplayJson,
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
  weatherPath: string | null;
  gameplayPath: string | null;
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
  originalTypes: Map<string, DayZType>;
  originalEvents: Map<string, DayZEvent>;
  originalEventSpawns: EventSpawnDef[];
  originalSpawnableTypes: Map<string, SpawnableType>;
  originalMapGroupProto: Map<string, MapGroupProtoEntry>;
  originalWeather: WeatherData | null;
  originalGameplay: GameplayData | null;
  saveCheckpoints: SaveCheckpoint[];
  typeHistory: { name: string; prev: DayZType }[];

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
  clearSaveError: () => void;
  createSaveCheckpointFromDirty: (label?: string) => void;
  revertSaveCheckpoint: (id?: string) => void;
  clearSaveCheckpoints: () => void;

  updateType: (name: string, patch: Partial<DayZType>) => void;
  undoType: () => void;
  revertTypesSource: (sourcePath: string) => void;
  revertEventSpawns: () => void;
  revertEvents: () => void;
  revertSpawnableTypes: () => void;
  revertMapGroupProto: () => void;
  revertWeather: () => void;
  revertGameplay: () => void;
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
  saveWeather: () => Promise<void>;
  saveGameplay: () => Promise<void>;
}

const emptyDirty: DirtyFlags = { typesSources: [], eventSpawns: false, events: false, spawnableTypes: false, mapGroupProto: false, weather: false, gameplay: false };

function cloneMapGroupProto(proto: Map<string, MapGroupProtoEntry>): Map<string, MapGroupProtoEntry> {
  const next = new Map<string, MapGroupProtoEntry>();
  for (const [key, entry] of proto) {
    next.set(key, {
      rawName: entry.rawName,
      usages: [...entry.usages],
      tiers: [...entry.tiers],
      valueUsers: entry.valueUsers ? [...entry.valueUsers] : undefined,
      lootmax: entry.lootmax,
      containers: entry.containers.map(c => ({
        ...c,
        categories: [...c.categories],
        tags: [...c.tags],
      })),
      orderIndex: entry.orderIndex,
    });
  }
  return next;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function markSuccess(set: (fn: (s: ServerState) => Partial<ServerState>) => void) {
  set(() => ({ saveStatus: 'success' }));
  setTimeout(() => set(s => s.saveStatus === 'success' ? { saveStatus: 'idle' } : {}), 3000);
}

export const useServerStore = create<ServerState>((set, get) => {
  async function trySave(fileName: string, operation: () => Promise<void>): Promise<void> {
    set({ saveStatus: 'saving' });
    try {
      await operation();
      markSuccess(set);
    } catch (err) {
      set({ saveError: `Failed to save ${fileName}: ${toMessage(err)}`, saveStatus: 'idle' });
    }
  }

  return {
  mission: null,
  paths: { missionPath: null, typesPath: null, eventSpawnsPath: null, eventsPath: null, spawnableTypesPath: null, economyCorePath: null, mapGroupProtoPath: null, weatherPath: null, gameplayPath: null },
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
  weather: null,
  gameplay: null,
  originalTypes: new Map(),
  originalEvents: new Map(),
  originalEventSpawns: [],
  originalSpawnableTypes: new Map(),
  originalMapGroupProto: new Map(),
  originalWeather: null,
  originalGameplay: null,
  saveCheckpoints: [],
  typeHistory: [],

  setMission: (mission) => set({
    mission,
    dirty: emptyDirty,
    originalTypes: new Map(mission.types),
    originalEvents: new Map(mission.events),
    originalEventSpawns: [...mission.eventSpawns],
    originalSpawnableTypes: new Map(mission.spawnableTypes),
    typeHistory: [],
  }),
  setPaths: (paths) => set(s => ({ paths: { ...s.paths, ...paths } })),
  setEconomyCore: (entries) => set({ economyCore: entries }),
  setBuildingInstances: (instances) => set({ buildingInstances: instances }),
  setMapGroupProto: (proto) => set({ mapGroupProto: cloneMapGroupProto(proto), originalMapGroupProto: cloneMapGroupProto(proto) }),
  setPlayerSpawnData: (data) => set({ playerSpawnData: data }),
  setCeToolProject: (data) => set({ ceToolProject: data }),
  setServerRootPath: (path) => set({ serverRootPath: path }),
  setOpenServerFolder: (fn) => set({ openServerFolder: fn }),
  setCeToolFolderOverride: (path) => set({ ceToolFolderOverride: path }),
  setPickCeToolFolder: (fn) => set({ pickCeToolFolder: fn }),
  setCeSource: (mapId, source) => set(s => ({ ceSources: { ...s.ceSources, [mapId]: source } })),
  setReloadCeToolData: (fn) => set({ reloadCeToolData: fn }),
  setWeather: (data) => set({ weather: data, originalWeather: data }),
  setGameplay: (data) => set({ gameplay: data, originalGameplay: data }),
  updateGameplay: (data) => set(s => ({ gameplay: data, dirty: { ...s.dirty, gameplay: true } })),
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
    let nextDirtyTypes = [...s.dirty.typesSources];

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
    let nextOriginalMapGroupProto = s.originalMapGroupProto;
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
    return { mapGroupProto: proto, buildingInstances, dirty: { ...s.dirty, mapGroupProto: false } };
  }),

  revertWeather: () => set(s => ({
    weather: s.originalWeather,
    dirty: { ...s.dirty, weather: false },
  })),

  revertGameplay: () => set(s => ({
    gameplay: s.originalGameplay,
    dirty: { ...s.dirty, gameplay: false },
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

    const protoNext = new Map(s.mapGroupProto);
    const entry = protoNext.get(key)!;
    const containers = entry.containers.map(c => {
      if (c.categories.some(existing => existing.trim().toLowerCase() === normalizedCat)) return c;
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
      categories: c.categories.filter(existing => existing.trim().toLowerCase() !== cat),
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
    await trySave(sourcePath.split(/[\\/]/).pop()!, async () => {
      await writeFile(sourcePath, serializeTypesXml(sourceTypes));
      set(s => {
        const originalTypes = new Map(s.originalTypes);
        for (const [name, type] of s.mission?.types ?? []) {
          if (type.source === sourcePath) originalTypes.set(name, type);
        }
        return {
          dirty: { ...s.dirty, typesSources: s.dirty.typesSources.filter(p => p !== sourcePath) },
          originalTypes,
        };
      });
    });
  },

  saveEventSpawns: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventSpawnsPath) return;
    await trySave('cfgeventspawns.xml', async () => {
      await writeFile(paths.eventSpawnsPath!, serializeEventSpawnsXml(mission.eventSpawns));
      set(s => ({ dirty: { ...s.dirty, eventSpawns: false }, originalEventSpawns: [...mission.eventSpawns] }));
    });
  },

  saveEvents: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventsPath) return;
    await trySave('events.xml', async () => {
      await writeFile(paths.eventsPath!, serializeEventsXml(mission.events));
      set(s => ({ dirty: { ...s.dirty, events: false }, originalEvents: new Map(mission.events) }));
    });
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
    });
  },

  saveMapGroupProto: async () => {
    const { mapGroupProto, paths } = get();
    if (!paths.mapGroupProtoPath) return;
    await trySave('mapgroupproto.xml', async () => {
      await writeFile(paths.mapGroupProtoPath!, serializeMapGroupProtoXml(mapGroupProto));
      set(s => ({ dirty: { ...s.dirty, mapGroupProto: false }, originalMapGroupProto: cloneMapGroupProto(s.mapGroupProto) }));
    });
  },

  saveWeather: async () => {
    const { weather, paths } = get();
    if (!paths.weatherPath || !weather) return;
    await trySave('cfgweather.xml', async () => {
      await writeFile(paths.weatherPath!, serializeWeatherXml(weather));
      set(s => ({ dirty: { ...s.dirty, weather: false }, originalWeather: s.weather }));
    });
  },

  saveGameplay: async () => {
    const { gameplay, paths } = get();
    if (!paths.gameplayPath || !gameplay) return;
    await trySave('cfggameplay.json', async () => {
      await writeFile(paths.gameplayPath!, serializeGameplayJson(gameplay));
      set(s => ({ dirty: { ...s.dirty, gameplay: false }, originalGameplay: s.gameplay }));
    });
  },
  };
});
