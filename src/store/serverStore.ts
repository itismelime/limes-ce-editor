import { create } from 'zustand';
import type { MissionData, DayZType, DayZEvent, EventSpawnDef, SpawnableType, DirtyFlags } from '../types/dayz';
import {
  serializeTypesXml, serializeEventSpawnsXml,
  serializeEventsXml, serializeSpawnableTypesXml,
} from '../lib/xmlParser';
import { writeFile } from '../lib/fileDiscovery';

interface FilePaths {
  typesPath: string | null;
  eventSpawnsPath: string | null;
  eventsPath: string | null;
  spawnableTypesPath: string | null;
}

interface ServerState {
  mission: MissionData | null;
  paths: FilePaths;
  dirty: DirtyFlags;

  setMission: (mission: MissionData) => void;
  setPaths: (paths: Partial<FilePaths>) => void;

  updateType: (name: string, patch: Partial<DayZType>) => void;
  updateEvent: (name: string, patch: Partial<DayZEvent>) => void;
  setEventSpawns: (spawns: EventSpawnDef[]) => void;
  updateSpawnableType: (name: string, patch: Partial<SpawnableType>) => void;

  saveTypes: () => Promise<void>;
  saveEventSpawns: () => Promise<void>;
  saveEvents: () => Promise<void>;
  saveSpawnableTypes: () => Promise<void>;
}

const emptyDirty: DirtyFlags = { types: false, eventSpawns: false, events: false, spawnableTypes: false };

export const useServerStore = create<ServerState>((set, get) => ({
  mission: null,
  paths: { typesPath: null, eventSpawnsPath: null, eventsPath: null, spawnableTypesPath: null },
  dirty: emptyDirty,

  setMission: (mission) => set({ mission, dirty: emptyDirty }),
  setPaths: (paths) => set(s => ({ paths: { ...s.paths, ...paths } })),

  updateType: (name, patch) => set(s => {
    if (!s.mission) return s;
    const next = new Map(s.mission.types);
    const existing = next.get(name);
    if (existing) next.set(name, { ...existing, ...patch });
    return { mission: { ...s.mission, types: next }, dirty: { ...s.dirty, types: true } };
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

  saveTypes: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.typesPath) return;
    await writeFile(paths.typesPath, serializeTypesXml(mission.types));
    set(s => ({ dirty: { ...s.dirty, types: false } }));
  },

  saveEventSpawns: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventSpawnsPath) return;
    await writeFile(paths.eventSpawnsPath, serializeEventSpawnsXml(mission.eventSpawns));
    set(s => ({ dirty: { ...s.dirty, eventSpawns: false } }));
  },

  saveEvents: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.eventsPath) return;
    await writeFile(paths.eventsPath, serializeEventsXml(mission.events));
    set(s => ({ dirty: { ...s.dirty, events: false } }));
  },

  saveSpawnableTypes: async () => {
    const { mission, paths } = get();
    if (!mission || !paths.spawnableTypesPath) return;
    await writeFile(paths.spawnableTypesPath, serializeSpawnableTypesXml(mission.spawnableTypes));
    set(s => ({ dirty: { ...s.dirty, spawnableTypes: false } }));
  },
}));
