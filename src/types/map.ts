export type MapId = 'namalsk' | 'chernarus' | 'livonia' | 'sakhal' | 'custom';

export interface MapConfig {
  id: MapId;
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
  unknown: '#6b7280',
};

export const TIER_ORDER = ['Tier7', 'Tier6', 'Tier5', 'Tier4', 'Tier3', 'Tier2', 'Tier1'];

const TYPE_COLORS: Record<string, string> = {
  civilian: '#94a3b8',
  farm: '#16a34a',
  firefighter: '#f59e0b',
  fishing: '#14b8a6',
  hunting: '#06b6d4',
  industrial: '#8b5cf6',
  medical: '#f97316',
  medicinal: '#f97316',
  military: '#ef4444',
  police: '#3b82f6',
  seaice: '#67e8f9',
  town: '#eab308',
  village: '#ec4899',
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

export function getUsageColor(usage: string): string {
  if (!usage || usage === 'unknown') return '#475569';
  const normalizedUsage = usage.trim().toLowerCase();
  const knownColor = TYPE_COLORS[normalizedUsage];
  if (knownColor) return knownColor;

  let h = 5381;
  for (let i = 0; i < normalizedUsage.length; i++) h = (((h << 5) + h) ^ normalizedUsage.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

export function formatUsageLabel(usage: string): string {
  const normalized = usage.trim().toLowerCase();
  if (!normalized) return 'Unknown';
  return CANONICAL_USAGE_LABELS[normalized] ?? (normalized.charAt(0).toUpperCase() + normalized.slice(1));
}
