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

// Inverse of gameToLeaflet, for click-to-place and drag-to-reposition.
export function leafletToGame(
  lat: number,
  lng: number,
  map: MapConfig,
): [number, number] {
  const gameX = (lng / map.imageWidth) * map.worldWidth;
  const gameZ = (lat / map.imageHeight + 1) * map.worldHeight;
  return [gameX, gameZ];
}

export function mapBounds(map: MapConfig): LatLngBoundsExpression {
  return [[0, 0], [-map.imageHeight, map.imageWidth]];
}

export function isInBounds(x: number, z: number, map: MapConfig): boolean {
  return x >= 0 && x <= map.worldWidth && z >= 0 && z <= map.worldHeight;
}
