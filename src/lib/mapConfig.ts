import type { MapConfig, CommunityMapDef } from '../types/map';

export const MAP_CONFIGS: Record<string, MapConfig> = {
  namalsk: {
    id: 'namalsk',
    label: 'Namalsk',
    imageUrl: '',
    worldWidth: 12800,
    worldHeight: 12800,
    imageWidth: 4096,
    imageHeight: 4096,
  },
  chernarus: {
    id: 'chernarus',
    label: 'Chernarus+',
    imageUrl: '',
    worldWidth: 15360,
    worldHeight: 15360,
    imageWidth: 4096,
    imageHeight: 4096,
  },
  livonia: {
    id: 'livonia',
    label: 'Livonia',
    imageUrl: '',
    worldWidth: 12800,
    worldHeight: 12800,
    imageWidth: 4096,
    imageHeight: 4096,
  },
  sakhal: {
    id: 'sakhal',
    label: 'Sakhal',
    imageUrl: '',
    worldWidth: 15360,
    worldHeight: 15360,
    imageWidth: 4096,
    imageHeight: 4096,
  },
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
