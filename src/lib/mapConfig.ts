import type { MapConfig, MapId } from '../types/map';

export const MAP_CONFIGS: Record<MapId, MapConfig> = {
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
