import type { MapConfig, CommunityMapDef } from '../types/map';

/**
 * Single source of truth for the built-in maps. Every other table (mission
 * detection, CETool bundles, tile maps, top-bar list) derives from this one.
 * Keep world sizes in sync with src-tauri/src/lib.rs KNOWN_MAPS.
 */
export interface BuiltinMap {
  id: string;
  label: string;
  worldSize: number;
  /** Lowercase substrings matched against mission folder names (e.g. dayzOffline.enoch). */
  keywords: string[];
  /** Folder under public/cetool/ holding the bundled CE Tool project. */
  ceToolFolder: string;
  ceToolXml: string;
  /** Overview image inside the CE Tool folder, used when satellite tiles aren't built. */
  ceToolBackground: string;
}

export const BUILTIN_MAPS: BuiltinMap[] = [
  { id: 'namalsk',   label: 'Namalsk',    worldSize: 12800, keywords: ['namalsk'],                  ceToolFolder: 'namalsk',       ceToolXml: 'namalsk.xml',       ceToolBackground: 'namalsk_background.bmp' },
  { id: 'chernarus', label: 'Chernarus+', worldSize: 15360, keywords: ['chernarusplus', 'chernarus'], ceToolFolder: 'chernarusplus', ceToolXml: 'chernarusplus.xml', ceToolBackground: 'map.png' },
  { id: 'livonia',   label: 'Livonia',    worldSize: 12800, keywords: ['enoch', 'livonia'],          ceToolFolder: 'enoch',         ceToolXml: 'enoch.xml',         ceToolBackground: 'map.png' },
  { id: 'sakhal',    label: 'Sakhal',     worldSize: 15360, keywords: ['sakhal'],                    ceToolFolder: 'sakhal',        ceToolXml: 'sakhal.xml',        ceToolBackground: 'map.png' },
  { id: 'nasdara',   label: 'Nasdara',    worldSize: 16384, keywords: ['nasdara'],                   ceToolFolder: 'nasdara',       ceToolXml: 'nasdara.xml',       ceToolBackground: 'map.png' },
];

export const BUILTIN_MAP_BY_ID: Record<string, BuiltinMap> =
  Object.fromEntries(BUILTIN_MAPS.map(m => [m.id, m]));

/** Built-in map id for a mission folder name like "dayzOffline.nasdara", or null. */
export function detectBuiltinMap(missionName: string): string | null {
  const lower = missionName.toLowerCase();
  return BUILTIN_MAPS.find(m => m.keywords.some(kw => lower.includes(kw)))?.id ?? null;
}

export function bundledCeToolPath(mapId: string, file: 'xml' | 'background'): string | null {
  const m = BUILTIN_MAP_BY_ID[mapId];
  if (!m) return null;
  return `cetool/${m.ceToolFolder}/${file === 'xml' ? m.ceToolXml : m.ceToolBackground}`;
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}

export const MAP_CONFIGS: Record<string, MapConfig> = {
  ...Object.fromEntries(BUILTIN_MAPS.map(m => [m.id, {
    id: m.id,
    label: m.label,
    imageUrl: assetUrl(bundledCeToolPath(m.id, 'background')!),
    worldWidth: m.worldSize,
    worldHeight: m.worldSize,
    imageWidth: 4096,
    imageHeight: 4096,
  }])),
  custom: {
    id: 'custom',
    label: 'Custom Map',
    imageUrl: '',
    worldWidth: 10000,
    worldHeight: 10000,
    imageWidth: 2048,
    imageHeight: 2048,
  },
};

export function getAllMapConfigs(communityMaps: CommunityMapDef[]): Record<string, MapConfig> {
  const extra: Record<string, MapConfig> = {};
  for (const cm of communityMaps) {
    // The backend registers built-ins here too when building their tiles; the
    // built-in definition stays authoritative (older builds stored wrong sizes).
    if (BUILTIN_MAP_BY_ID[cm.id]) continue;
    extra[cm.id] = {
      id: cm.id,
      label: cm.label,
      imageUrl: '',
      worldWidth: cm.worldWidth,
      worldHeight: cm.worldHeight,
      imageWidth: 4096,
      imageHeight: 4096,
    };
  }
  return { ...MAP_CONFIGS, ...extra };
}
