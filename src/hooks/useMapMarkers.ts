import { useMemo } from 'react';
import { useServerStore } from '../store/serverStore';
import { useUiStore } from '../store/uiStore';
import { resolveLoot } from '../lib/lootResolver';
import { MAP_CONFIGS } from '../lib/mapConfig';

export function useMapMarkers(enabled = true) {
  const mission    = useServerStore(s => s.mission);
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

  const markers = useMemo(() => {
    if (!mission || !enabled) return [];
    const result = resolveLoot(mission, mapConfig);
    return result;
  }, [mission, mapConfig, enabled]);

  return { markers, mapConfig };
}
