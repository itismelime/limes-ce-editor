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
  Tier1: '#22c55e',
  Tier2: '#eab308',
  Tier3: '#f97316',
  Tier4: '#ef4444',
  Tier5: '#a855f7',
  Tier6: '#ec4899',
  Tier7: '#06b6d4',
  unknown: '#6b7280',
};

export const TIER_ORDER = ['Tier7', 'Tier6', 'Tier5', 'Tier4', 'Tier3', 'Tier2', 'Tier1'];

// Deterministic color from usage name — no hardcoded list needed
const COLOR_PALETTE = [
  '#dc2626', '#3b82f6', '#0ea5e9', '#f59e0b', '#84cc16',
  '#16a34a', '#ea580c', '#06b6d4', '#94a3b8', '#a8a29e',
  '#a855f7', '#7c3aed', '#38bdf8', '#ec4899', '#f97316',
  '#22c55e', '#eab308', '#14b8a6', '#8b5cf6', '#f43f5e',
];

export function getUsageColor(usage: string): string {
  if (!usage || usage === 'unknown') return '#475569';
  let h = 5381;
  for (let i = 0; i < usage.length; i++) h = (((h << 5) + h) ^ usage.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}
