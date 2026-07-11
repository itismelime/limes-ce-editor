// Config for the FF_SpawnSelector mod plugin (github.com/itismelime FF-lime plugin
// suite). Lives at <serverRoot>/profiles/<profileName>/Config/FFSpawnSelector/ on the
// deployed server, independent of any DayZ mission. All 0/1 flag fields are kept as
// `number`, not `boolean`, so saves round-trip byte-identically with the plugin's own
// (de)serializer, which reads/writes ints.

export interface FFSpawnSelectorSettings {
  version: number;
  enabled: number;
  deferToExpansionSpawnSelection: number;
  forceTakeoverExpansion: number;
  allowRandomSpawn: number;
  allowSleepingBagSpawn: number;
  allowGroupBaseSpawn: number;
  randomSpawnCooldown: number;
  sleepingBagCooldown: number;
  groupBaseCooldown: number;
  namedPointCooldown: number;
  maxSleepingBagsPerPlayer: number;
  requireGroupLeaderForGroupSpawn: number;
  minDistanceFromPlayers: number;
  minDistanceFromZombies: number;
  maxSafetyRetries: number;
  selectionTimeoutSeconds: number;
  limboPosX: number;
  limboPosY: number;
  limboPosZ: number;
  rawData?: Record<string, unknown>;
}

export interface FFSpawnPoint {
  version: number;
  name: string;
  x: number;
  y: number;
  z: number;
  enabled: number;
}

export interface FFSpawnPointsData {
  version: number;
  spawnPoints: FFSpawnPoint[];
  rawData?: Record<string, unknown>;
}
