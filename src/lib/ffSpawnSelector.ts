import { readDir } from '@tauri-apps/plugin-fs';
import { num } from './xmlParser/shared';
import type { FFSpawnSelectorSettings, FFSpawnPointsData } from '../types/ffSpawnSelector';

export interface FFSpawnSelectorPaths {
  profileName: string;
  settingsPath: string | null;
  spawnPointsPath: string | null;
}

// Scans <serverRoot>/profiles/*/Config/FFSpawnSelector/ for Settings.json and
// SpawnPoints.json. The profile name isn't known in advance and filenames are
// resolved case-sensitively from the actual directory entries (DayZ servers
// commonly run on Linux). Returns null if profiles/ doesn't exist or no
// profile has the plugin installed -- not an error, just not applicable.
export async function findFFSpawnSelectorConfig(serverRootPath: string): Promise<FFSpawnSelectorPaths | null> {
  // Mirror fileDiscovery.ts's scanDir normalization -- the picked root path
  // is raw OS dialog output (backslash-separated on Windows), not yet
  // normalized like paths that flow through scanDir.
  const root = serverRootPath.replace(/\\/g, '/');
  let profileEntries;
  try {
    profileEntries = await readDir(`${root}/profiles`);
  } catch {
    return null;
  }

  for (const profileEntry of profileEntries) {
    if (!profileEntry.isDirectory || !profileEntry.name) continue;
    const configDir = `${root}/profiles/${profileEntry.name}/Config/FFSpawnSelector`;
    let configEntries;
    try {
      configEntries = await readDir(configDir);
    } catch {
      continue;
    }

    let settingsPath: string | null = null;
    let spawnPointsPath: string | null = null;
    for (const entry of configEntries) {
      if (!entry.isFile || !entry.name) continue;
      const lower = entry.name.toLowerCase();
      if (lower === 'settings.json') settingsPath = `${configDir}/${entry.name}`;
      else if (lower === 'spawnpoints.json') spawnPointsPath = `${configDir}/${entry.name}`;
    }
    if (settingsPath || spawnPointsPath) {
      return { profileName: profileEntry.name, settingsPath, spawnPointsPath };
    }
  }
  return null;
}

export function parseFFSettings(raw: string): FFSpawnSelectorSettings {
  const data = JSON.parse(raw) as Record<string, unknown>;
  return {
    version: num(data.version, 1),
    enabled: num(data.enabled, 1),
    deferToExpansionSpawnSelection: num(data.deferToExpansionSpawnSelection, 1),
    forceTakeoverExpansion: num(data.forceTakeoverExpansion, 0),
    allowRandomSpawn: num(data.allowRandomSpawn, 1),
    allowSleepingBagSpawn: num(data.allowSleepingBagSpawn, 1),
    allowGroupBaseSpawn: num(data.allowGroupBaseSpawn, 1),
    randomSpawnCooldown: num(data.randomSpawnCooldown, 0),
    sleepingBagCooldown: num(data.sleepingBagCooldown, 3600),
    groupBaseCooldown: num(data.groupBaseCooldown, 0),
    namedPointCooldown: num(data.namedPointCooldown, 1800),
    maxSleepingBagsPerPlayer: num(data.maxSleepingBagsPerPlayer, 1),
    requireGroupLeaderForGroupSpawn: num(data.requireGroupLeaderForGroupSpawn, 0),
    minDistanceFromPlayers: num(data.minDistanceFromPlayers, 300),
    minDistanceFromZombies: num(data.minDistanceFromZombies, 150),
    maxSafetyRetries: num(data.maxSafetyRetries, 10),
    selectionTimeoutSeconds: num(data.selectionTimeoutSeconds, 60),
    limboPosX: num(data.limboPosX, 0),
    limboPosY: num(data.limboPosY, 10000),
    limboPosZ: num(data.limboPosZ, 0),
    rawData: data,
  };
}

export function serializeFFSettings(settings: FFSpawnSelectorSettings): string {
  const result: Record<string, unknown> = settings.rawData
    ? JSON.parse(JSON.stringify(settings.rawData)) as Record<string, unknown>
    : {};
  result.version = settings.version;
  result.enabled = settings.enabled;
  result.deferToExpansionSpawnSelection = settings.deferToExpansionSpawnSelection;
  result.forceTakeoverExpansion = settings.forceTakeoverExpansion;
  result.allowRandomSpawn = settings.allowRandomSpawn;
  result.allowSleepingBagSpawn = settings.allowSleepingBagSpawn;
  result.allowGroupBaseSpawn = settings.allowGroupBaseSpawn;
  result.randomSpawnCooldown = settings.randomSpawnCooldown;
  result.sleepingBagCooldown = settings.sleepingBagCooldown;
  result.groupBaseCooldown = settings.groupBaseCooldown;
  result.namedPointCooldown = settings.namedPointCooldown;
  result.maxSleepingBagsPerPlayer = settings.maxSleepingBagsPerPlayer;
  result.requireGroupLeaderForGroupSpawn = settings.requireGroupLeaderForGroupSpawn;
  result.minDistanceFromPlayers = settings.minDistanceFromPlayers;
  result.minDistanceFromZombies = settings.minDistanceFromZombies;
  result.maxSafetyRetries = settings.maxSafetyRetries;
  result.selectionTimeoutSeconds = settings.selectionTimeoutSeconds;
  result.limboPosX = settings.limboPosX;
  result.limboPosY = settings.limboPosY;
  result.limboPosZ = settings.limboPosZ;
  return JSON.stringify(result, null, '\t');
}

export function parseFFSpawnPoints(raw: string): FFSpawnPointsData {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const points = Array.isArray(data.spawnPoints) ? data.spawnPoints as Record<string, unknown>[] : [];
  return {
    version: num(data.version, 1),
    spawnPoints: points.map(p => ({
      version: num(p.version, 0),
      name: String(p.name ?? ''),
      x: num(p.x, 0),
      y: num(p.y, 0),
      z: num(p.z, 0),
      enabled: num(p.enabled, 1),
    })),
    rawData: data,
  };
}

// Each point is reconstructed fresh from its typed fields rather than
// passed through per-index -- a raw passthrough keyed by array position
// would silently corrupt once a row is added/removed/reordered, which
// this editor explicitly supports.
export function serializeFFSpawnPoints(data: FFSpawnPointsData): string {
  const result: Record<string, unknown> = data.rawData
    ? JSON.parse(JSON.stringify(data.rawData)) as Record<string, unknown>
    : {};
  result.version = data.version;
  result.spawnPoints = data.spawnPoints.map(p => ({
    version: p.version,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    enabled: p.enabled,
  }));
  return JSON.stringify(result, null, '\t');
}
