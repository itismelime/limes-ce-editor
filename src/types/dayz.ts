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
  quantminPresent?: boolean;
  quantmaxPresent?: boolean;
  cost: number;
  flags: DayZTypeFlags;
  category: string | null;
  usages: string[];
  tiers: string[];
  tags?: string[];
  source: string;
}

export interface EventSpawnPos {
  x: number;
  z: number;
  rawX?: string;
  rawZ?: string;
  extraAttrs?: Record<string, string>;
}

export interface EventSpawnZone {
  smin: number;
  smax: number;
  dmin: number;
  dmax: number;
  r: number;
  rawSmin?: string;
  rawSmax?: string;
  rawDmin?: string;
  rawDmax?: string;
  rawR?: string;
}

export interface EventSpawnDef {
  eventName: string;
  positions: EventSpawnPos[];
  zones?: EventSpawnZone[];
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
  flags?: {
    deletable?: 0 | 1;
    init_random?: 0 | 1;
    remove_damaged?: 0 | 1;
    sec_spawner?: 0 | 1;
  };
  position?: string;
  limit?: string;
  secondary?: string;
  children: EventChild[];
}

export interface SpawnableItem {
  name: string;
  chance: number;
  rawChance?: string;
}

export interface SpawnableCargo {
  chance: number;
  rawChance?: string;
  preset?: string;
  items: SpawnableItem[];
}

export interface SpawnableAttachments {
  chance: number;
  rawChance?: string;
  preset?: string;
  items: SpawnableItem[];
}

export interface SpawnableType {
  name: string;
  usages: string[];
  categories: string[];
  tags: string[];
  cargo: SpawnableCargo[];
  attachments: SpawnableAttachments[];
  hoarder?: boolean;
  damage?: { min: number; max: number; rawMin?: string; rawMax?: string };
  source: string;
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
  weather: boolean;
  gameplay: boolean;
  limitsDefinition: boolean;
  limitsDefinitionUser: boolean;
  territoryBitmaps: boolean;
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

export interface WeatherValue {
  current: { actual: number; time: number; duration: number; rawActual?: string };
  limits: { min: number; max: number; rawMin?: string; rawMax?: string };
  timelimits?: { min: number; max: number };
  changelimits?: { min: number; max: number; rawMin?: string; rawMax?: string };
  thresholds?: { min: number; max: number; end: number };
}

export interface WeatherData {
  reset: number;
  enable: number;
  overcast: WeatherValue;
  fog: WeatherValue;
  rain: WeatherValue;
  windMagnitude: WeatherValue;
  windDirection: WeatherValue;
  snowfall: WeatherValue;
  storm: { density: number; threshold: number; timeout: number; rawDensity?: string; rawThreshold?: string };
  rawData?: Record<string, unknown>;
}

export interface GameplayStaminaData {
  sprintStaminaModifierErc: number;
  sprintStaminaModifierCro: number;
  staminaWeightLimitThreshold: number;
  staminaMax: number;
  staminaKgToStaminaPercentPenalty: number;
  staminaMinCap: number;
  sprintSwimmingStaminaModifier: number;
  sprintLadderStaminaModifier: number;
  meleeStaminaModifier: number;
  obstacleTraversalStaminaModifier: number;
  holdBreathStaminaModifier: number;
  rawValues?: Record<string, string>;
}

export interface GameplayPlayerData {
  ShockHandlingData?: { shockRefillSpeedUnconscious: number; rawValue?: string };
  StaminaData?: GameplayStaminaData;
}

export interface GameplayData {
  version: number;
  PlayerData?: GameplayPlayerData;
  WorldsData?: {
    environmentMinTemps?: number[];
    environmentMaxTemps?: number[];
    rawMinTemps?: string;
    rawMaxTemps?: string;
  };
  rawData?: Record<string, unknown>;
}

export interface LimitsDefinition {
  categories: string[];
  tags: string[];
  usages: string[];
  values: string[];
}

export interface LimitsUsageGroup {
  name: string;
  usages: string[];
}

export interface LimitsValueGroup {
  name: string;
  values: string[];
}

export interface LimitsDefinitionUser {
  usageGroups: LimitsUsageGroup[];
  valueGroups: LimitsValueGroup[];
}

export interface CeToolLayer {
  name: string;
  usageFlags: number;
  valueFlags: number;
  visible: boolean;
  color: number;
}

export interface CeToolZone {
  name: string;
  x: number;
  z: number;
  r: number;
  d: number;
  smin: number;
  smax: number;
  dmin: number;
  dmax: number;
}

export interface CeToolTerritory {
  type: string;
  name: string;
  visible: boolean;
  color: number;
  zones: CeToolZone[];
}

export interface CeToolProject {
  sourcePath: string;
  projectName: string;
  projectDir: string;
  backgroundFile: string;
  layerSize: number;
  worldSize: number;
  usages: string[];
  values: string[];
  layers: CeToolLayer[];
  tierLayerNames: Partial<Record<string, string>>;
  usageLayerNames: Partial<Record<string, string[]>>;
  territories: CeToolTerritory[];
}
