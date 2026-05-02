import { readDir, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';

const TARGET_FILES = new Set([
  'types.xml',
  'cfgeventspawns.xml',
  'events.xml',
  'cfgspawnabletypes.xml',
  'cfgeconomycore.xml',
  'mapgroupproto.xml',
  'mapgrouppos.xml',
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
  mapImagePath: string | null;
}

interface ScanResult {
  name: string;
  path: string;
  isImage?: boolean;
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
      mapGroupProtoPath:  files['mapgroupproto.xml']     ?? null,
      mapGroupPosPath:    files['mapgrouppos.xml']       ?? null,
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

export async function readFile(path: string): Promise<string> {
  return readTextFile(path);
}

export async function writeFile(path: string, text: string): Promise<void> {
  return writeTextFile(path, text);
}

export async function createDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
