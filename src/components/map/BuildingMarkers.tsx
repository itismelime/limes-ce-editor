import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { sampleAllZonesAtPos, hasCeToolBitmaps } from '../../lib/tierZoneResolver';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { gameToLeaflet } from '../../lib/coordinateTransform';
import { TIER_ORDER, getUsageColor } from '../../types/map';
import type { DayZType } from '../../types/dayz';
import type { MapConfig } from '../../types/map';

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function containerMatchesType(type: DayZType, containerTags: string[], containerCategories: string[]): boolean {
  const isUnrestricted = type.usages.length === 0 || type.usages.every(u => u === '');
  const normalizedTags = containerTags.map(tag => tag.toLowerCase());
  const normalizedCategories = containerCategories.map(category => category.toLowerCase());
  const usageMatch =
    isUnrestricted
    || normalizedTags.length === 0
    || type.usages.some(u => normalizedTags.includes(u.toLowerCase()));
  const catMatch =
    normalizedCategories.length > 0
    && type.category !== null
    && normalizedCategories.includes(type.category.toLowerCase());
  return usageMatch && catMatch;
}

export function BuildingMarkers({ mapConfig }: { mapConfig: MapConfig }) {
  const map = useMap();
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const buildingInstances   = useServerStore(s => s.buildingInstances);
  const mapGroupProto       = useServerStore(s => s.mapGroupProto);
  const originalMapGroupProto = useServerStore(s => s.originalMapGroupProto);
  const originalTypes       = useServerStore(s => s.originalTypes);
  const typeHistory         = useServerStore(s => s.typeHistory);
  const dirtyMapGroupProto  = useServerStore(s => s.dirty.mapGroupProto);
  const mission             = useServerStore(s => s.mission);
  const showBuildings       = useUiStore(s => s.showBuildings);
  const clusterZoomThreshold = useUiStore(s => s.mapClusterZoomThreshold);
  const buildingItemFilter  = useUiStore(s => s.buildingItemFilter);
  const buildingNameFilter  = useUiStore(s => s.buildingNameFilter);
  const buildingMinLootmax  = useUiStore(s => s.buildingMinLootmax);
  const hiddenUsages        = useUiStore(s => s.hiddenUsages);
  const hiddenTiers         = useUiStore(s => s.hiddenTiers);
  const tierZonesLoaded     = useUiStore(s => s.tierZonesLoaded);
  const territoryBitmaps    = useServerStore(s => s.territoryBitmaps);
  const setSelectedBuilding = useUiStore(s => s.setSelectedBuilding);
  const useZoneData         = tierZonesLoaded || (territoryBitmaps.size > 0 && hasCeToolBitmaps());

  const dirtyTypeAffectedBuildingKeys = useMemo(() => {
    if (!mission || typeHistory.length === 0) return new Set<string>();

    const changedNames = [...new Set(typeHistory.map(entry => entry.name))];
    const changedTypes: Array<{ current: DayZType; original: DayZType | null }> = [];
    for (const name of changedNames) {
      const current = mission.types.get(name);
      if (!current) continue;
      const original = originalTypes.get(name) ?? null;
      changedTypes.push({ current, original });
    }

    if (changedTypes.length === 0) return new Set<string>();

    const affected = new Set<string>();
    for (const b of buildingInstances) {
      const key = b.typeName.trim().toLowerCase();
      let buildingAffected = false;

      for (const { current, original } of changedTypes) {
        if (buildingAffected) break;
        for (const container of b.containers) {
          const currentMatch = containerMatchesType(current, container.tags, container.categories);
          const originalMatch = original ? containerMatchesType(original, container.tags, container.categories) : false;
          if (currentMatch || originalMatch) {
            buildingAffected = true;
            break;
          }
        }
      }

      if (buildingAffected) affected.add(key);
    }

    return affected;
  }, [mission, typeHistory, originalTypes, buildingInstances]);

  const dirtyBuildingKeys = useMemo(() => {
    const keys = new Set<string>(dirtyTypeAffectedBuildingKeys);
    if (!dirtyMapGroupProto) return keys;

    const sameEntry = (
      a: { usages: string[]; tiers: string[]; lootmax: number; containers: Array<{ categories: string[]; tags: string[] }> } | undefined,
      b: { usages: string[]; tiers: string[]; lootmax: number; containers: Array<{ categories: string[]; tags: string[] }> } | undefined,
    ) => {
      if (!a || !b) return a === b;
      if (a.lootmax !== b.lootmax) return false;
      if (!sameStringArray(a.usages, b.usages)) return false;
      if (!sameStringArray(a.tiers, b.tiers)) return false;
      if (a.containers.length !== b.containers.length) return false;
      for (let i = 0; i < a.containers.length; i++) {
        const ac = a.containers[i];
        const bc = b.containers[i];
        if (!sameStringArray(ac.categories, bc.categories)) return false;
        if (!sameStringArray(ac.tags, bc.tags)) return false;
      }
      return true;
    };

    for (const [key, entry] of mapGroupProto) {
      const original = originalMapGroupProto.get(key);
      if (!sameEntry(entry, original)) keys.add(key);
    }
    for (const key of originalMapGroupProto.keys()) {
      if (!mapGroupProto.has(key)) keys.add(key);
    }
    return keys;
  }, [dirtyMapGroupProto, mapGroupProto, originalMapGroupProto, dirtyTypeAffectedBuildingKeys]);

  const [viewportBounds, setViewportBounds] = useState(() => map.getBounds().pad(0.2));
  useEffect(() => {
    const updateBounds = () => setViewportBounds(map.getBounds().pad(0.2));
    map.on('moveend zoomend', updateBounds);
    return () => { map.off('moveend zoomend', updateBounds); };
  }, [map]);

  // Pre-compute zone data for ALL buildings once — NOT on every pan/zoom.
  const buildingZoneCache = useMemo(() => {
    if (!useZoneData) return null;
    const cache = new Map<string, { usages: string[]; tiers: string[] }>();
    for (const b of buildingInstances) {
      cache.set(`${b.typeName}-${b.x}-${b.z}`, sampleAllZonesAtPos(b.x, b.z));
    }
    return cache;
  }, [buildingInstances, useZoneData, territoryBitmaps]);

  // Filter logic — stable across pans, no viewport check.
  const filteredBuildings = useMemo(() => {
    if (!showBuildings) return [];

    const q = buildingItemFilter.trim().toLowerCase();
    let itemFilter: ((b: typeof buildingInstances[0]) => boolean) | null = null;

    if (q && mission) {
      const canonicalUsages = new Set(
        [...mission.types.values()]
          .filter(t => t.name.toLowerCase().includes(q))
          .flatMap(t => t.usages.map(usage => usage.trim().toLowerCase()))
          .filter(Boolean)
      );
      const rawTagUsages = new Set(
        [...mission.spawnableTypes.values()]
          .filter(st => st.name.toLowerCase().includes(q))
          .flatMap(st => st.usages.map(usage => usage.trim().toLowerCase()))
      );
      if (canonicalUsages.size === 0 && rawTagUsages.size === 0) {
        itemFilter = () => false;
      } else {
        itemFilter = b =>
          (canonicalUsages.size > 0 && b.usages.some(u => canonicalUsages.has(u.trim().toLowerCase()))) ||
          (rawTagUsages.size > 0 && b.containers.some(c => c.tags.some(t => rawTagUsages.has(t.toLowerCase()))));
      }
    }

    const nameQ = buildingNameFilter.trim().toLowerCase();
    const hiddenUsageSet = new Set(hiddenUsages.map(u => u.trim().toLowerCase()));

    return buildingInstances.flatMap(b => {
      const zones = buildingZoneCache?.get(`${b.typeName}-${b.x}-${b.z}`) ?? null;
      const zoneUsages = zones?.usages ?? [];
      const zoneTiers  = zones?.tiers  ?? [];

      if (useZoneData) {
        const ceUsages = zoneUsages.length > 0 ? zoneUsages : ['unknown'];
        const protoUsages = b.usages.length > 0 ? b.usages : ['unknown'];
        const allUsages = [...new Set([...ceUsages, ...protoUsages].map(u => u.trim().toLowerCase()))];
        if (allUsages.every(u => hiddenUsageSet.has(u))) return [];
      } else {
        const normalizedUsages = b.usages.length > 0 ? b.usages : ['unknown'];
        if (normalizedUsages.every(u => hiddenUsageSet.has(u.trim().toLowerCase()))) return [];
      }

      const primaryUsage = b.usages[0] ?? 'unknown';
      if (nameQ && !b.typeName.toLowerCase().includes(nameQ)) return [];
      if (buildingMinLootmax > 0 && b.lootmax < buildingMinLootmax) return [];
      if (itemFilter !== null && !itemFilter(b)) return [];

      const protoTiers = TIER_ORDER.filter(t => b.tiers.includes(t));
      const allZoneTiers = zoneTiers.filter(t => t !== 'unknown');
      const mergedTiers = [...new Set([...allZoneTiers, ...protoTiers])];
      const displayTiers = mergedTiers.length > 0 ? mergedTiers : ['unknown'];

      if (displayTiers.every(t => hiddenTiers.includes(t))) return [];

      const latlng = gameToLeaflet(b.x, b.z, mapConfig);
      const dirtyKey = b.typeName.trim().toLowerCase();
      const markerKey = `${dirtyKey}-${b.x.toFixed(3)}-${b.z.toFixed(3)}`;
      const hasUnsavedChanges = dirtyBuildingKeys.has(dirtyKey);
      const markerUsage = zoneUsages[0] ?? primaryUsage;
      return [{ b, markerKey, primaryUsage, usageColor: getUsageColor(markerUsage), latlng, hasUnsavedChanges }];
    });
  }, [showBuildings, buildingInstances, mission, buildingItemFilter, buildingNameFilter, buildingMinLootmax, hiddenUsages, hiddenTiers, useZoneData, mapConfig, dirtyBuildingKeys, buildingZoneCache]);

  // Viewport cull only — fast on every pan/zoom.
  const visible = useMemo(() =>
    filteredBuildings.filter(entry => viewportBounds.contains(entry.latlng)),
  [filteredBuildings, viewportBounds]);

  const zoom = map.getZoom();
  const showClusters = zoom <= clusterZoomThreshold;

  const clusters = useMemo(() => {
    if (!showClusters) return [];

    const gridSize = 56;
    const buckets = new Map<string, {
      count: number;
      xSum: number;
      ySum: number;
      usages: Set<string>;
      sampleEntry: (typeof visible)[number] | null;
    }>();

    for (const entry of visible) {
      const projected = map.latLngToLayerPoint(L.latLng(entry.latlng));
      const gx = Math.floor(projected.x / gridSize);
      const gy = Math.floor(projected.y / gridSize);
      const key = `${gx}:${gy}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, xSum: 0, ySum: 0, usages: new Set<string>(), sampleEntry: null };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.xSum += projected.x;
      bucket.ySum += projected.y;
      bucket.usages.add(entry.primaryUsage);
      bucket.sampleEntry = entry;
    }

    return [...buckets.values()].map(bucket => {
      const x = bucket.xSum / bucket.count;
      const y = bucket.ySum / bucket.count;
      return {
        center: map.layerPointToLatLng(L.point(x, y)),
        pointCount: bucket.count,
        usageCount: bucket.usages.size,
        sampleEntry: bucket.sampleEntry,
      };
    });
  }, [showClusters, visible, map]);

  if (showClusters) {
    return (
      <>
        {clusters.map((cluster, idx) => {
          if (cluster.pointCount === 1 && cluster.sampleEntry) {
            const { b, usageColor, latlng, hasUnsavedChanges } = cluster.sampleEntry;
            return (
              <CircleMarker
                key={`${b.typeName}-${b.x.toFixed(3)}-${b.z.toFixed(3)}`}
                center={latlng}
                radius={7}
                renderer={canvasRenderer}
                bubblingMouseEvents={false}
                pathOptions={{
                  fillColor: hasUnsavedChanges ? '#4f46e5' : usageColor,
                  fillOpacity: 0.9,
                  color: hasUnsavedChanges ? '#818cf8' : '#0f1117',
                  weight: 2.5,
                }}
                eventHandlers={{
                  click: () => setSelectedBuilding(b.typeName, { x: b.x, z: b.z }),
                }}
              />
            );
          }

          const radius = Math.min(18, 9 + Math.log2(cluster.pointCount + 1) * 2);
          return (
            <CircleMarker
              key={`building-cluster-${idx}`}
              center={cluster.center}
              radius={radius}
              renderer={canvasRenderer}
              pathOptions={{
                color: '#dcfce7',
                fillColor: '#065f46',
                fillOpacity: 0.8,
                weight: 2,
              }}
              eventHandlers={{
                click: (event) => { event.target.openPopup(); },
                dblclick: () => { map.setView(cluster.center, Math.min(zoom + 2, 2)); },
              }}
            >
              <Tooltip permanent direction="center" className="cluster-count-label" interactive={false}>
                {cluster.pointCount}
              </Tooltip>
              <Popup autoPan={false}>
                <div className="text-xs text-slate-200">
                  {cluster.pointCount} buildings · {cluster.usageCount} type tags
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </>
    );
  }

  return (
    <>
      {visible.map(({ b, markerKey, usageColor, latlng, hasUnsavedChanges }) => (
        <CircleMarker
          key={markerKey}
          center={latlng}
          radius={7}
          renderer={canvasRenderer}
          bubblingMouseEvents={false}
          pathOptions={{
            fillColor: hasUnsavedChanges ? '#4f46e5' : usageColor,
            fillOpacity: 0.9,
            color: hasUnsavedChanges ? '#818cf8' : '#0f1117',
            weight: 2.5,
          }}
          eventHandlers={{
            click: () => setSelectedBuilding(b.typeName, { x: b.x, z: b.z }),
          }}
        />
      ))}
    </>
  );
}
