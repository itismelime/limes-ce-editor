export interface DayZTypeFlags {
  count_in_cargo: 0 | 1;
  count_in_hoarder: 0 | 1;
  count_in_map: 0 | 1;
  count_in_player: 0 | 1;
  crafted: 0 | 1;
  deloot: 0 | 1;
}

export interface DayZType {
  name: string;
  nominal: number;
  lifetime: number;
  restock: number;
  min: number;
  quantmin: number;
  quantmax: number;
  cost: number;
  flags: DayZTypeFlags;
  category: string | null;
  usages: string[];
  tiers: string[];
  source: string;
}

export interface EventSpawnPos {
  x: number;
  z: number;
}

export interface EventSpawnDef {
  eventName: string;
  positions: EventSpawnPos[];
}

export interface EventChild {
  type: string;
  min: number;
  max: number;
  lootmin: number;
  lootmax: number;
}

export interface DayZEvent {
  name: string;
  nominal: number;
  min: number;
  max: number;
  lifetime: number;
  restock: number;
  saferadius: number;
  distanceradius: number;
  cleanupradius: number;
  active: 0 | 1;
  children: EventChild[];
}

export interface SpawnableItem {
  name: string;
  chance: number;
}

export interface SpawnableCargo {
  chance: number;
  items: SpawnableItem[];
}

export interface SpawnableAttachments {
  chance: number;
  items: SpawnableItem[];
}

export interface SpawnableType {
  name: string;
  usages: string[];
  categories: string[];
  tags: string[];
  cargo: SpawnableCargo[];
  attachments: SpawnableAttachments[];
}

export interface ContainerDef {
  name: string;
  lootmax: number;
  categories: string[];
  tags: string[];
}

export interface MissionData {
  missionName: string;
  types: Map<string, DayZType>;
  eventSpawns: EventSpawnDef[];
  events: Map<string, DayZEvent>;
  spawnableTypes: Map<string, SpawnableType>;
}

export interface FileHandles {
  typesHandle: FileSystemFileHandle | null;
  eventSpawnsHandle: FileSystemFileHandle | null;
  eventsHandle: FileSystemFileHandle | null;
  spawnableTypesHandle: FileSystemFileHandle | null;
}

export type DirtyFlags = {
  typesSources: string[];
  eventSpawns: boolean;
  events: boolean;
  spawnableTypes: boolean;
  mapGroupProto: boolean;
};

export interface CeFile {
  name: string;
  type: string;
}

export interface CeEntry {
  folder: string;
  files: CeFile[];
}

export interface PlayerSpawnPoint {
  x: number;
  z: number;
}

export interface PlayerSpawnSection {
  type: string;
  points: PlayerSpawnPoint[];
  minDistInfected: number;
  maxDistInfected: number;
  minDistPlayer: number;
  maxDistPlayer: number;
  gridDensity: number;
  gridWidth: number;
  gridHeight: number;
}

export interface PlayerSpawnData {
  sections: PlayerSpawnSection[];
}

export interface BuildingInstance {
  typeName: string;
  usages: string[];
  tiers: string[];
  lootmax: number;
  containers: ContainerDef[];
  x: number;
  z: number;
}
