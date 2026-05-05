import { useMemo } from 'react';
import { useServerStore } from '../store/serverStore';
import { useUiStore } from '../store/uiStore';
import { resolveLoot } from '../lib/lootResolver';
import { MAP_CONFIGS } from '../lib/mapConfig';

const EMPTY_EVENTS = new Map();
const EMPTY_SPAWNABLE_TYPES = new Map();
const EMPTY_TYPES = new Map();

export function useMapMarkers(enabled = true) {
  const missionName = useServerStore(s => s.mission?.missionName ?? '');
  const eventSpawns = useServerStore(s => s.mission?.eventSpawns ?? []);
  const events = useServerStore(s => s.mission?.events ?? EMPTY_EVENTS);
  const spawnableTypes = useServerStore(s => s.mission?.spawnableTypes ?? EMPTY_SPAWNABLE_TYPES);
  const originalTypes = useServerStore(s => s.originalTypes ?? EMPTY_TYPES);
  const activeMap  = useUiStore(s => s.activeMap);
  const mapImagePaths  = useUiStore(s => s.mapImagePaths);
  const mapImageSizes  = useUiStore(s => s.mapImageSizes);
  const customMapUrl   = useUiStore(s => s.customMapUrl);
  const customMapWidth = useUiStore(s => s.customMapWidth);
  const customMapHeight = useUiStore(s => s.customMapHeight);

  const mapConfig = useMemo(() => {
    const base = MAP_CONFIGS[activeMap];
    const imageUrl = mapImagePaths[activeMap]
      ?? (activeMap === 'custom' ? customMapUrl : base.imageUrl);

    // Use actual pixel dimensions if we know them (from extraction or prior load)
    const size = mapImageSizes[activeMap];
    const imageWidth  = size?.w ?? base.imageWidth;
    const imageHeight = size?.h ?? base.imageHeight;

    if (activeMap === 'custom') {
      return { ...base, imageUrl, imageWidth, imageHeight, worldWidth: customMapWidth, worldHeight: customMapHeight };
    }
    return { ...base, imageUrl, imageWidth, imageHeight };
  }, [activeMap, mapImagePaths, mapImageSizes, customMapUrl, customMapWidth, customMapHeight]);

  const markerMission = useMemo(() => {
    if (!missionName) return null;
    return {
      missionName,
      eventSpawns,
      events,
      spawnableTypes,
      // Keep event markers stable while unsaved types edits are being staged from building popups.
      types: originalTypes,
    };
  }, [missionName, eventSpawns, events, spawnableTypes, originalTypes]);

  const markers = useMemo(() => {
    if (!markerMission || !enabled) return [];
    const result = resolveLoot(markerMission, mapConfig);
    return result;
  }, [markerMission, mapConfig, enabled]);

  return { markers, mapConfig };
}
