import type { DayZType, SpawnableType } from '../types/dayz';

export const CATEGORY_LABELS: Record<string, string> = {
  rifles:       'Rifles',
  pistols:      'Pistols',
  weapons:      'Weapons',
  weapon_parts: 'Weapon Parts',
  ammunition:   'Ammunition',
  magazines:    'Magazines',
  ammoboxes:    'Ammo Boxes',
  explosives:   'Explosives',
  tools:        'Tools',
  containers:   'Containers',
  clothes:      'Clothes',
  bags:         'Backpacks & Bags',
  food:         'Food',
  lore:         'Lore',
  lantia:       'Lantia',
};

export const CATEGORY_ORDER = [
  'rifles', 'pistols', 'weapons', 'weapon_parts', 'ammunition', 'magazines', 'ammoboxes',
  'explosives', 'tools', 'containers', 'clothes', 'bags', 'food', 'lore', 'lantia',
];

const ATTACHMENT_KEYWORDS = [
  'suppressor', 'silencer', 'optic', 'scope', 'sight', 'stock', 'grip',
  'handguard', 'rail', 'bipod', 'flashlight', 'laser', 'barrel', 'mount',
  'foregrip', 'buttstock',
];

export function buildAttachmentNames(spawnableTypes: Map<string, SpawnableType>): Set<string> {
  const s = new Set<string>();
  for (const st of spawnableTypes.values())
    for (const group of st.attachments)
      for (const att of group.items) s.add(att.name);
  return s;
}

export function displayCategory(item: DayZType, attachmentNames: Set<string>): string {
  const cat = item.category?.toLowerCase() ?? '__none__';
  if (cat !== 'weapons') return cat;
  const lower = item.name.toLowerCase();
  const parts = lower.split('_');
  if (parts.some(p => p === 'ammobox')) return 'ammoboxes';
  if (parts.some(p => p === 'mag' || p.endsWith('magazine'))) return 'magazines';
  if (parts.some(p => p === 'ammo')) return 'ammunition';
  if (parts[0] === 'ad') return 'weapon_parts';
  if (attachmentNames.has(item.name)) return 'weapon_parts';
  if (ATTACHMENT_KEYWORDS.some(k => parts.some(p => p === k || p.endsWith(k)))) return 'weapon_parts';
  return 'weapons';
}
