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

export const USAGE_COLORS: Record<string, string> = {
  Military:    '#dc2626',
  Police:      '#3b82f6',
  Medic:       '#0ea5e9',
  Industrial:  '#f59e0b',
  Farm:        '#84cc16',
  Hunting:     '#16a34a',
  Firefighter: '#ea580c',
  Coastal:     '#06b6d4',
  Town:        '#94a3b8',
  Village:     '#a8a29e',
  Lunapark:    '#a855f7',
  Prison:      '#7c3aed',
  Other:       '#475569',
};

// Highest priority first — used to pick dominantUsage when an event has multiple
export const USAGE_PRIORITY = [
  'Military', 'Police', 'Medic', 'Industrial', 'Farm', 'Hunting',
  'Firefighter', 'Coastal', 'Town', 'Village', 'Lunapark', 'Prison', 'Other',
];
