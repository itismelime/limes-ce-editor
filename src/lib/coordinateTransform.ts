import type { MapConfig } from '../types/map';
import type { LatLngBoundsExpression } from 'leaflet';

export function gameToLeaflet(
  gameX: number,
  gameZ: number,
  map: MapConfig,
): [number, number] {
  const lng =  (gameX / map.worldWidth)  * map.imageWidth;
  // Z increases northward in DayZ; north = top of image (lat=0), south = bottom (lat=-imageHeight)
  const lat = (gameZ / map.worldHeight - 1) * map.imageHeight;
  return [lat, lng];
}

export function leafletToGame(
  lat: number,
  lng: number,
  map: MapConfig,
): { x: number; z: number } {
  return {
    x: (lng / map.imageWidth) * map.worldWidth,
    z: (lat / map.imageHeight + 1) * map.worldHeight,
  };
}

const PAN_PADDING = 300; // px beyond the map edge the user can pan

export function mapBounds(map: MapConfig): LatLngBoundsExpression {
  return [[0, 0], [-map.imageHeight, map.imageWidth]];
}

export function mapPanBounds(map: MapConfig): LatLngBoundsExpression {
  return [
    [PAN_PADDING, -PAN_PADDING],
    [-map.imageHeight - PAN_PADDING, map.imageWidth + PAN_PADDING],
  ];
}

export function isInBounds(x: number, z: number, map: MapConfig): boolean {
  return x >= 0 && x <= map.worldWidth && z >= 0 && z <= map.worldHeight;
}
