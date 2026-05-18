export type MapId = 'namalsk' | 'chernarus' | 'livonia' | 'sakhal' | 'custom';

export const BUILTIN_TILE_MAP_IDS = new Set<string>(['namalsk', 'chernarus', 'livonia', 'sakhal']);

export interface CommunityMapDef {
  id: string;
  label: string;
  maxZoom: number;
  worldWidth: number;
  worldHeight: number;
  pboPath?: string;
  ceToolProjectPath?: string | null;
}

export interface MapConfig {
  id: string;
  label: string;
  imageUrl: string;
  worldWidth: number;
  worldHeight: number;
  imageWidth: number;
  imageHeight: number;
}

export const TIER_COLORS: Record<string, string> = {
  Tier1: '#94a3b8',
  Tier2: '#4ade80',
  Tier3: '#38bdf8',
  Tier4: '#c084fc',
  Tier5: '#fb923c',
  Tier6: '#f87171',
  Tier7: '#fbbf24',
  Unique: '#e879f9',
  Contamination: '#a3e635',
  unknown: '#6b7280',
};

export const TIER_ORDER = ['Tier7', 'Tier6', 'Tier5', 'Tier4', 'Tier3', 'Tier2', 'Tier1'];

const TYPE_COLORS: Record<string, string> = {
  civilian: '#fef08a',
  farm: '#4ade80',
  firefighter: '#f97316',
  fishing: '#5eead4',
  hunting: '#84cc16',
  industrial: '#8b5cf6',
  medical: '#fb7185',
  medicinal: '#fb7185',
  military: '#ef4444',
  police: '#60a5fa',
  seaice: '#67e8f9',
  town: '#fbbf24',
  village: '#f59e0b',
};

const CANONICAL_USAGE_LABELS: Record<string, string> = {
  civilian: 'Civilian',
  coast: 'Coast',
  farm: 'Farm',
  firefighter: 'Firefighter',
  fishing: 'Fishing',
  floor: 'Floor',
  hunting: 'Hunting',
  industrial: 'Industrial',
  medic: 'Medic',
  medical: 'Medical',
  military: 'Military',
  office: 'Office',
  police: 'Police',
  prison: 'Prison',
  school: 'School',
  seaice: 'SeaIce',
  seasonalevent: 'SeasonalEvent',
  shelves: 'Shelves',
  town: 'Town',
  village: 'Village',
  unknown: 'Unknown',
};

// Fallback palette for unknown type names.
const COLOR_PALETTE = [
  '#dc2626', '#3b82f6', '#0ea5e9', '#f59e0b', '#84cc16',
  '#16a34a', '#ea580c', '#06b6d4', '#94a3b8', '#a8a29e',
  '#a855f7', '#7c3aed', '#38bdf8', '#ec4899', '#f97316',
  '#22c55e', '#eab308', '#14b8a6', '#8b5cf6', '#f43f5e',
];

const CUSTOM_USAGE_COLORS: Record<string, string> = {};

export function registerCustomUsageColor(usage: string, color: string): void {
  CUSTOM_USAGE_COLORS[usage.trim().toLowerCase()] = color;
}

export function unregisterCustomUsageColor(usage: string): void {
  delete CUSTOM_USAGE_COLORS[usage.trim().toLowerCase()];
}

export function getUsageColor(usage: string): string {
  if (!usage || usage === 'unknown') return '#475569';
  const normalizedUsage = usage.trim().toLowerCase();
  const customColor = CUSTOM_USAGE_COLORS[normalizedUsage];
  if (customColor) return customColor;
  const knownColor = TYPE_COLORS[normalizedUsage];
  if (knownColor) return knownColor;

  let h = 5381;
  for (let i = 0; i < normalizedUsage.length; i++) h = (((h << 5) + h) ^ normalizedUsage.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

export function getUsageTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1e293b' : '#ffffff';
}

export function formatUsageLabel(usage: string): string {
  const normalized = usage.trim().toLowerCase();
  if (!normalized) return 'Unknown';
  return CANONICAL_USAGE_LABELS[normalized] ?? (normalized.charAt(0).toUpperCase() + normalized.slice(1));
}
