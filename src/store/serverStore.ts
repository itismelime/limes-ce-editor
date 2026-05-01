import { create } from 'zustand';
import type { MissionData, DayZType, DayZEvent, EventSpawnDef, SpawnableType, DirtyFlags, CeEntry } from '../types/dayz';
import {
  serializeTypesXml, serializeEventSpawnsXml,
  serializeEventsXml, serializeSpawnableTypesXml,
  serializeEconomyCoreXml,
} from '../lib/xmlParser';
import { writeFile, createDir } from '../lib/fileDiscovery';

interface FilePaths {
  missionPath: string | null;
  typesPath: string | null;
  eventSpawnsPath: string | null;
  eventsPath: string | null;
  spawnableTypesPath: string | null;
  economyCorePath: string | null;
}

interface ServerState {
  mission: MissionData | null;
  paths: FilePaths;
  dirty: DirtyFlags;
  saveError: string | null;
  saveStatus: 'idle' | 'saving' | 'success';
  economyCore: CeEntry[];

  setMission: (mission: MissionData) => void;
  setPaths: (paths: Partial<FilePaths>) => void;
  setEconomyCore: (entries: CeEntry[]) => void;
  clearSaveError: () => void;

  updateType: (name: string, patch: Partial<DayZType>) => void;
  updateEvent: (name: string, patch: Partial<DayZEvent>) => void;
  setEventSpawns: (spawns: EventSpawnDef[]) => void;
  updateSpawnableType: (name: string, patch: Partial<SpawnableType>) => void;

  addCustomTypePack: (name: string, xmlContent: string) => Promise<void>;
  removeEconomyCoreEntry: (folder: string) => Promise<void>;
  saveTypesSource: (sourcePath: string) => Promise<void>;
  saveEventSpawns: () => Promise<void>;
  saveEvents: () => Promise<void>;
  saveSpawnableTypes: () => Promise<void>;
}

const emptyDirty: DirtyFlags = { typesSources: [], eventSpawns: false, events: false, spawnableTypes: false };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function markSuccess(set: (fn: (s: ServerState) => Partial<ServerState>) => void) {
  set(() => ({ saveStatus: 'success' }));
  setTimeout(() => set(s => s.saveStatus === 'success' ? { saveStatus: 'idle' } : {}), 3000);
}

export const useServerStore = create<ServerState>((set, get) => ({
  mission: null,
  paths: { missionPath: null, typesPath: null, eventSpawnsPath: null, eventsPath: null, spawnableTypesPath: null, economyCorePath: null },
  dirty: emptyDirty,
  saveError: null,
  saveStatus: 'idle' as const,
  economyCore: [],

  setMission: (mission) => set({ mission, dirty: emptyDirty }),
  setPaths: (paths) => set(s => ({ paths: { ...s.paths, ...paths } })),
  setEconomyCore: (entries) => set({ economyCore: entries }),
  clearSaveError: () => set({ saveError: null }),

  updateType: (name, patch) => set(s => {
    if (!s.mission) return s;
    const next = new Map(s.mission.types);
    const existing = next.get(name);
    if (!existing) return s;
    const updated = { ...existing, ...patch };
    next.set(name, updated);
    const source = (updated as any).source ?? '';
    const typesSources = s.dirty.typesSources.includes(source)
      ? s.dirty.typesSources
      : [...s.dirty.typesSources, source];
    return { mission: { ...s.mission, types: next }, dirty: { ...s.dirty, typesSources } };
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
}));
