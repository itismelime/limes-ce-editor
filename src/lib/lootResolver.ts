import type { MissionData, EventSpawnPos } from '../types/dayz';
import type { MapConfig } from '../types/map';
import { TIER_ORDER } from '../types/map';
import { isInBounds } from './coordinateTransform';

export interface ResolvedLootItem {
  name: string;
  effectiveChance: number;
  tiers: string[];
  nominal: number;
  category: string | null;
}

export interface ResolvedMarker {
  eventName: string;
  positions: EventSpawnPos[];
  active: boolean;
  lootItems: ResolvedLootItem[];
  dominantTier: string;
  dominantUsage: string;
  allUsages: string[];
  inBounds: boolean;
}

export function resolveLoot(data: MissionData, mapConfig: MapConfig): ResolvedMarker[] {
  return data.eventSpawns.map(spawnDef => {
    const eventDef = data.events.get(spawnDef.eventName);
    const lootItems: ResolvedLootItem[] = [];

    if (eventDef) {
      for (const child of eventDef.children) {
        const spawnable = data.spawnableTypes.get(child.type);
        if (!spawnable) continue;
        for (const cargo of spawnable.cargo) {
          for (const item of cargo.items) {
            const typeDef = data.types.get(item.name);
            lootItems.push({
              name: item.name,
              effectiveChance: item.chance * cargo.chance,
              tiers: typeDef?.tiers ?? [],
              nominal: typeDef?.nominal ?? 0,
              category: typeDef?.category ?? null,
            });
          }
        }
      }
    }

    const allTiers = lootItems.flatMap(i => i.tiers);
    const dominantTier = TIER_ORDER.find(t => allTiers.includes(t)) ?? 'unknown';

    const allUsagesSet = new Set(lootItems.flatMap(i => {
      const typeDef = data.types.get(i.name);
      return typeDef?.usages ?? [];
    }));
    const allUsages = [...allUsagesSet];
    const dominantUsage = allUsages[0] ?? 'unknown';

    const inBounds = spawnDef.positions.length === 0 || spawnDef.positions.some(p =>
      isInBounds(p.x, p.z, mapConfig)
    );

    return {
      eventName: spawnDef.eventName,
      positions: spawnDef.positions,
      active: eventDef ? eventDef.active === 1 : false,
      lootItems,
      dominantTier,
      dominantUsage,
      allUsages,
      inBounds,
    };
  });
}
