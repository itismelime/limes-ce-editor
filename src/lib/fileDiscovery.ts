import { readDir, readTextFile, readFile as readBinaryFileNative, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';

const TARGET_FILES = new Set([
  'types.xml',
  'cfgeventspawns.xml',
  'events.xml',
  'cfgspawnabletypes.xml',
  'cfgeconomycore.xml',
  'mapgroupproto.xml',
  'mapgrouppos.xml',
  'areaflags.map',
  'cfgplayerspawnpoints.xml',
  'cfgweather.xml',
  'cfggameplay.json',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tga']);
const MAP_NAME_HINTS = ['map', 'satellite', 'terrain', 'overview', 'namalsk', 'chernarus', 'livonia'];

const SKIP_DIRS = /^(@|steam_workshop|workshop|steamapps)/i;
const MAX_DEPTH = 6;

export interface MissionFiles {
  missionName: string;
  missionPath: string;
  typesPath: string | null;
  eventSpawnsPath: string | null;
  eventsPath: string | null;
  spawnableTypesPath: string | null;
  economyCorePath: string | null;
  mapGroupProtoPath: string | null;
  mapGroupPosPath: string | null;
  areaFlagsPath: string | null;
  playerSpawnPointsPath: string | null;
  weatherPath: string | null;
  gameplayPath: string | null;
  mapImagePath: string | null;
}

const MAP_HINTS: Record<string, string[]> = {
  namalsk: ['namalsk'],
  chernarus: ['chernarus', 'chernarusplus'],
  livonia: ['livonia', 'enoch'],
  sakhal: ['sakhal'],
};

const TIER_LAYER_RE = /(?:valuef(?:lg|ig)[-_ ]?)?tier([1-9])\.(png|bmp|tga)$/i;
const TIER_LAYER_CACHE = new Map<string, Promise<Partial<Record<string, string>>>>();
const CETOOL_PROJECT_CACHE = new Map<string, Promise<string | null>>();

const CETOOL_DIR_RE = /^(cetool|central.?economy.?tool|ce.?tool)$/i;

function scoreTierLayerPath(path: string, mapId?: string): number {
  const p = normalizePath(path).toLowerCase();
  let score = 0;
  if (p.includes('/cetool/')) score += 4;
  if (p.includes('/layers/')) score += 2;
  if (mapId) {
    const hints = MAP_HINTS[mapId] ?? [];
    if (hints.some(h => p.includes(h))) score += 3;
  }
  return score;
}

export async function findCeToolTierLayers(folderPath: string, mapId?: string): Promise<Partial<Record<string, string>>> {
  const cacheKey = `${normalizePath(folderPath).toLowerCase()}|${String(mapId ?? '').toLowerCase()}`;
  const cached = TIER_LAYER_CACHE.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const results: ScanResult[] = [];
    await scanDir(folderPath, 0, results);

    const bestByTier = new Map<string, { path: string; score: number }>();
    for (const r of results) {
      if (!r.isImage) continue;
      const m = r.name.match(TIER_LAYER_RE);
      if (!m) continue;
      const tier = `Tier${m[1]}`;
      const score = scoreTierLayerPath(r.path, mapId);
      const prev = bestByTier.get(tier);
      if (!prev || score > prev.score) {
        bestByTier.set(tier, { path: r.path, score });
      }
    }

    const out: Partial<Record<string, string>> = {};
    for (const [tier, entry] of bestByTier.entries()) out[tier] = entry.path;
    return out;
  })();

  TIER_LAYER_CACHE.set(cacheKey, promise);

  return promise;
}

export async function findCeToolProjectXml(folderPath: string, mapId?: string): Promise<string | null> {
  const cacheKey = `${normalizePath(folderPath).toLowerCase()}|${String(mapId ?? '').toLowerCase()}`;
  const cached = CETOOL_PROJECT_CACHE.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const results: ScanResult[] = [];
    await scanDir(folderPath, 0, results);

    // Accept XMLs that are either inside a folder matching the CE Tool name pattern,
    // or anywhere under a path segment whose name matches.
    const xmlCandidates = results.filter(r => {
      if (!r.isXml) return false;
      const parts = normalizePath(r.path).toLowerCase().split('/');
      return parts.some(seg => CETOOL_DIR_RE.test(seg));
    });
    if (xmlCandidates.length === 0) return null;

    const hints = mapId ? (MAP_HINTS[mapId] ?? []) : [];
    const scored = xmlCandidates
      .map(c => {
        const p = normalizePath(c.path).toLowerCase();
        const parts = p.split('/');
        let score = 0;
        if (parts.some(seg => CETOOL_DIR_RE.test(seg))) score += 4;
        if (hints.some(h => p.includes(h))) score += 3;
        if (mapId && c.name === `${mapId}.xml`) score += 4;
        if (c.name.includes('project')) score += 1;
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.path ?? null;
  })();

  CETOOL_PROJECT_CACHE.set(cacheKey, promise);
  return promise;
}

/**
 * Find CE Tool project XML within a specific mission folder.
 * Looks in {missionPath}/CETool/ and similar folders for map-specific project files.
 */
export async function findCeToolProjectXmlInMission(missionPath: string, mapId?: string): Promise<string | null> {
  const normalPath = normalizePath(missionPath);
  const cacheKey = `mission:${normalPath.toLowerCase()}|${String(mapId ?? '').toLowerCase()}`;
  const cached = CETOOL_PROJECT_CACHE.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const results: ScanResult[] = [];
    await scanDir(normalPath, 0, results);

    // Filter for XMLs inside a CETool folder
    const xmlCandidates = results.filter(r => {
      if (!r.isXml) return false;
      const parts = normalizePath(r.path).toLowerCase().split('/');
      return parts.some(seg => CETOOL_DIR_RE.test(seg));
    });
    if (xmlCandidates.length === 0) return null;

    const hints = mapId ? (MAP_HINTS[mapId] ?? []) : [];
    
    // Score candidates: prefer map-specific names, then hint matches
    const scored = xmlCandidates
      .map(c => {
        let score = 10; // Base score for being in CETool folder
        
        // Exact map name match (e.g., "chernarus.xml")
        if (mapId && c.name === `${mapId}.xml`) score += 100;
        
        // Hint-based match (e.g., "chernarusplus.xml" for map "chernarus")
        if (hints.some(h => c.name.toLowerCase().includes(h))) score += 50;
        
        // Avoid cfgAreaFlags (tool config, not project file)
        if (c.name.toLowerCase() === 'cfgareaflags.xml' || c.name.toLowerCase() === 'cfgareasflags.xml') score -= 1000;
        
        // Project-named files
        if (c.name.toLowerCase().includes('project')) score += 20;
        
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.path ?? null;
  })();

  CETOOL_PROJECT_CACHE.set(cacheKey, promise);
  return promise;
}

interface ScanResult {
  name: string;
  path: string;
  isImage?: boolean;
  isXml?: boolean;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

async function scanDir(
  dirPath: string,
  depth: number,
  results: ScanResult[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  const normalDir = normalizePath(dirPath);
  let entries;
  try {
    entries = await readDir(normalDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.name) continue;
    const fullPath = `${normalDir}/${entry.name}`;

    if (entry.isDirectory) {
      if (SKIP_DIRS.test(entry.name)) continue;
      await scanDir(fullPath, depth + 1, results);
    } else if (entry.isFile) {
      const lname = entry.name.toLowerCase();
      if (TARGET_FILES.has(lname)) {
        results.push({ name: lname, path: fullPath });
      } else {
        const ext = lname.substring(lname.lastIndexOf('.'));
        if (IMAGE_EXTENSIONS.has(ext)) {
          results.push({ name: lname, path: fullPath, isImage: true });
        } else if (ext === '.xml') {
          results.push({ name: lname, path: fullPath, isXml: true });
        }
      }
    }
  }
}

const MISSION_SUBFOLDERS = new Set(['db', 'env', 'ce', 'custom_types', 'customtypes']);

function getMissionFolder(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/');
  // If the file lives inside a known mission subfolder, go up one extra level
  const parentDir = parts[parts.length - 2]?.toLowerCase() ?? '';
  if (MISSION_SUBFOLDERS.has(parentDir)) {
    return parts.slice(0, -2).join('/');
  }
  return parts.slice(0, -1).join('/');
}

function groupByMission(results: ScanResult[]): MissionFiles[] {
  const map = new Map<string, { files: Partial<Record<string, string>>; images: string[] }>();

  for (const r of results) {
    const folder = getMissionFolder(r.path);
    if (!map.has(folder)) map.set(folder, { files: {}, images: [] });
    if (r.isImage) {
      map.get(folder)!.images.push(r.path);
    } else {
      map.get(folder)!.files[r.name] = r.path;
    }
  }

  return Array.from(map.entries()).map(([missionPath, { files, images }]) => {
    const parts = missionPath.replace(/\\/g, '/').split('/');
    const missionName = parts[parts.length - 1] ?? missionPath;

    // Prefer images that match map name hints or mission name, fall back to any image found
    const scored = images.map(img => {
      const base = img.split('/').pop()?.toLowerCase() ?? '';
      const hintMatch = MAP_NAME_HINTS.some(h => base.includes(h)) ? 2 : 0;
      const nameMatch = missionName.toLowerCase().split('.').some(part => part.length > 3 && base.includes(part)) ? 1 : 0;
      return { img, score: hintMatch + nameMatch };
    });
    scored.sort((a, b) => b.score - a.score);
    const mapImagePath = scored[0]?.img ?? null;

    return {
      missionName,
      missionPath,
      typesPath:          files['types.xml']             ?? null,
      eventSpawnsPath:    files['cfgeventspawns.xml']    ?? null,
      eventsPath:         files['events.xml']            ?? null,
      spawnableTypesPath: files['cfgspawnabletypes.xml'] ?? null,
      economyCorePath:    files['cfgeconomycore.xml']    ?? null,
      mapGroupProtoPath:     files['mapgroupproto.xml']        ?? null,
      mapGroupPosPath:       files['mapgrouppos.xml']          ?? null,
      areaFlagsPath:         files['areaflags.map']            ?? null,
      playerSpawnPointsPath: files['cfgplayerspawnpoints.xml'] ?? null,
      weatherPath:           files['cfgweather.xml']           ?? null,
      gameplayPath:          files['cfggameplay.json']         ?? null,
      mapImagePath,
    };
  });
}

export async function scanFolder(folderPath: string): Promise<MissionFiles[]> {
  const results: ScanResult[] = [];
  await scanDir(folderPath, 0, results);
  return groupByMission(results);
}

export async function pickAndDiscoverServer(): Promise<{ path: string; missions: MissionFiles[] } | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select DayZ Server Folder',
  });

  if (!selected || typeof selected !== 'string') return null;

  const missions = await scanFolder(selected);
  return { path: selected, missions };
}

/**
 * Let the user pick a CE Tool folder manually.
 * Returns the path to the best matching project XML, or null if none found / cancelled.
 */
export async function pickCeToolFolder(mapId?: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select CE Tool Folder (contains zg-config XML)',
  });

  if (!selected || typeof selected !== 'string') return null;

  // Scan the picked folder for a project XML
  const results: ScanResult[] = [];
  await scanDir(selected, 0, results);

  const xmlCandidates = results.filter(r => r.isXml);
  if (xmlCandidates.length === 0) return null;

  const hints = mapId ? (MAP_HINTS[mapId] ?? []) : [];
  const scored = xmlCandidates
    .map(c => {
      const p = normalizePath(c.path).toLowerCase();
      let score = 0;
      if (hints.some(h => p.includes(h))) score += 3;
      if (mapId && c.name === `${mapId}.xml`) score += 4;
      if (c.name.includes('project') || c.name.includes('zg-config')) score += 2;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.path ?? null;
}

export async function readFile(path: string): Promise<string> {
  return readTextFile(path);
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  return readBinaryFileNative(path);
}

export async function writeFile(path: string, text: string): Promise<void> {
  return writeTextFile(path, text);
}

export async function createDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
