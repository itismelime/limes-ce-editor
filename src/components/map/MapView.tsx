import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Marker, Popup, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import { CRS } from 'leaflet';
import { open } from '@tauri-apps/plugin-dialog';
import { sampleTierAtPos } from '../../lib/tierZoneResolver';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'leaflet/dist/leaflet.css';
import { useMapMarkers } from '../../hooks/useMapMarkers';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { gameToLeaflet, mapBounds } from '../../lib/coordinateTransform';
import { TIER_ORDER, getUsageColor } from '../../types/map';
import { TierLegend } from './TierLegend';
import { MarkerPopup } from './MarkerPopup';
import { BuildingPopup } from './BuildingPopup';
import type { ResolvedMarker } from '../../lib/lootResolver';
import type { MapConfig } from '../../types/map';

const TILE_MAPS = new Set(['namalsk', 'chernarus', 'livonia', 'sakhal']);
const MAX_XAM_ZOOM_BY_MAP: Record<string, number> = {
  namalsk: 6,
  chernarus: 8,
  livonia: 7,
  sakhal: 8,
};

// Leaflet zoom 0 = xam.nu zoom 4. Delay detail tiles until zoom 1 to cut heavy decode work.
const DETAIL_MIN_ZOOM = 1;
const XAM_ZOOM_OFFSET = 4;
const EVENT_MARKER_RADIUS = 10;
const EVENT_SELECTED_RADIUS = 13;
const BUILDING_MARKER_SIZE = 20;
const PLAYER_MARKER_SIZE = 20;

function getLeafletTileMaxZoom(mapId: string): number {
  return (MAX_XAM_ZOOM_BY_MAP[mapId] ?? 8) - XAM_ZOOM_OFFSET;
}

function FilterInput({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
      )}
    </div>
  );
}

function PopupAutoFlip() {
  const map = useMap();
  const popupCleanupRef = useRef(new WeakMap<L.Popup, () => void>());

  const attachDraggable = (popup: L.Popup, el: HTMLElement) => {
    const wrapper = el.querySelector('.leaflet-popup-content-wrapper') as HTMLElement | null;
    if (!wrapper) return;

    let handle = wrapper.querySelector('.popup-drag-handle') as HTMLDivElement | null;
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'popup-drag-handle';
      handle.style.height = '14px';
      handle.style.margin = '-8px -8px 6px -8px';
      handle.style.padding = '4px 0 0 0';
      handle.style.display = 'flex';
      handle.style.alignItems = 'center';
      handle.style.justifyContent = 'center';
      handle.style.background = 'transparent';

      const grip = document.createElement('div');
      grip.className = 'popup-drag-grip';
      grip.style.width = '34px';
      grip.style.height = '4px';
      grip.style.borderRadius = '999px';
      grip.style.background = 'rgba(148, 163, 184, 0.5)';
      handle.appendChild(grip);

      wrapper.prepend(handle);
    }
    handle.style.cursor = 'grab';

    let dragging = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let startPoint = L.point(0, 0);

    const onMouseMove = (moveEvt: MouseEvent) => {
      if (!dragging) return;
      if (!popup.isOpen() || !popup.getElement()) {
        stopDrag();
        return;
      }
      const dx = moveEvt.clientX - startMouseX;
      const dy = moveEvt.clientY - startMouseY;
      const nextPoint = L.point(startPoint.x + dx, startPoint.y + dy);
      popup.setLatLng(map.containerPointToLatLng(nextPoint));
      if (popup.isOpen()) popup.update();
      moveEvt.preventDefault();
    };

    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      map.dragging.enable();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopDrag);
    };

    const onMouseDown = (evt: MouseEvent) => {
      if (evt.button !== 0) return;

      dragging = true;
      handle.style.cursor = 'grabbing';
      startMouseX = evt.clientX;
      startMouseY = evt.clientY;
      const popupLatLng = popup.getLatLng() ?? map.getCenter();
      startPoint = map.latLngToContainerPoint(popupLatLng);
      map.dragging.disable();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', stopDrag);
      evt.preventDefault();
      evt.stopPropagation();
    };

    handle.addEventListener('mousedown', onMouseDown);

    const cleanup = () => {
      stopDrag();
      handle.style.cursor = '';
      handle.removeEventListener('mousedown', onMouseDown);
    };

    const previousCleanup = popupCleanupRef.current.get(popup);
    previousCleanup?.();
    popupCleanupRef.current.set(popup, cleanup);
  };

  useMapEvent('popupopen', (e) => {
    const popup = e.popup;
    const latlng = popup.getLatLng();
    const el = popup.getElement();
    if (!el || !latlng) return;

    attachDraggable(popup, el);

    // Give the DOM a frame to finish rendering so offsetHeight is accurate
    requestAnimationFrame(() => {
      if (!popup.isOpen() || !popup.getElement()) return;
      const markerPt = map.latLngToContainerPoint(latlng);
      const popupH = el.offsetHeight;
      const tipH = 14; // px for the leaflet popup tip

      // Check if popup would extend above the map container OR be obscured
      // by an overlay panel sitting on top of the map, using elementFromPoint.
      const mapRect = map.getContainer().getBoundingClientRect();
      const probeX = mapRect.left + markerPt.x;
      const probeY = mapRect.top + markerPt.y - popupH - tipH + 1;
      const topEl = document.elementFromPoint(probeX, probeY);
      const obscured = !topEl || !el.contains(topEl);
      const clipped = markerPt.y - popupH - tipH < 0;

      if (clipped || obscured) {
        // Flip: position popup below the marker
        popup.options.offset = [0, popupH + tipH * 2];
        if (popup.isOpen()) popup.update();
      } else {
        popup.options.offset = [0, 0];
      }
    });
  });

  useMapEvent('popupclose', (e) => {
    const cleanup = popupCleanupRef.current.get(e.popup);
    cleanup?.();
    popupCleanupRef.current.delete(e.popup);
  });

  return null;
}

function MapFitBounds({ mapConfig }: { mapConfig: MapConfig }) {
  const map = useMap();
  useEffect(() => {
    const boundsExpr = mapBounds(mapConfig) as L.LatLngBoundsLiteral;
    const bounds = L.latLngBounds(boundsExpr);

    const syncViewBounds = () => {
      const minZoom = map.getBoundsZoom(bounds, false);
      map.setMinZoom(minZoom);
      map.setMaxBounds(bounds);
      map.panInsideBounds(bounds, { animate: false });
      if (map.getZoom() < minZoom) {
        map.setZoom(minZoom);
      }
    };

    map.fitBounds(bounds, { animate: false });
    syncViewBounds();
    map.on('resize', syncViewBounds);

    return () => {
      map.off('resize', syncViewBounds);
    };
  }, [map, mapConfig.id]);
  return null;
}

function MapVisibilitySync({ isActive }: { isActive: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (isActive) {
      map.invalidateSize();
    }
  }, [isActive, map]);
  return null;
}

/** High-res tile layer — only activates at Leaflet zoom ≥ DETAIL_MIN_ZOOM. */
function DayZTileLayer({ mapId }: { mapId: string }) {
  const map = useMap();
  const maxTileZoom = getLeafletTileMaxZoom(mapId);

  useEffect(() => {
    const layer = L.gridLayer({
      tileSize:  256,
      opacity:   1.0,
      minZoom:   DETAIL_MIN_ZOOM,
      maxZoom:   maxTileZoom,
      keepBuffer: 2,
      updateWhenZooming: false,
      updateWhenIdle: true,
    });

    (layer as any).createTile = function (
      coords: L.Coords,
      done:   L.DoneCallback,
    ): HTMLElement {
      const tileSize = 256;
      const minXamZoom = 4;
      const targetXamZoom = coords.z + XAM_ZOOM_OFFSET;
      const canvas = document.createElement('canvas');
      canvas.width = tileSize;
      canvas.height = tileSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        done(new Error('tile context unavailable'), canvas);
        return canvas;
      }

      ctx.imageSmoothingEnabled = false;

      const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = document.createElement('img');
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('tile image load failed'));
        img.src = url;
      });

      const drawTile = async () => {
        for (let fallbackZoom = targetXamZoom; fallbackZoom >= minXamZoom; fallbackZoom--) {
          const zoomDiff = targetXamZoom - fallbackZoom;
          const scale = 1 << zoomDiff;
          const fallbackX = Math.floor(coords.x / scale);
          const fallbackY = Math.floor(coords.y / scale);

          try {
            const path = await invoke<string>('get_tile_path', {
              mapId,
              zoom: fallbackZoom,
              x: fallbackX,
              y: fallbackY,
            });
            const img = await loadImage(convertFileSrc(path));

            if (zoomDiff === 0) {
              ctx.clearRect(0, 0, tileSize, tileSize);
              ctx.drawImage(img, 0, 0, tileSize, tileSize);
            } else {
              const part = tileSize / scale;
              const sx = (coords.x % scale) * part;
              const sy = (coords.y % scale) * part;
              ctx.clearRect(0, 0, tileSize, tileSize);
              ctx.drawImage(img, sx, sy, part, part, 0, 0, tileSize, tileSize);
            }

            done(undefined, canvas);
            return;
          } catch {
            // Try next lower zoom tile when this exact level is missing.
          }
        }

        done(new Error('no tile available at any zoom level'), canvas);
      };

      void drawTile();
      return canvas;
    };

    map.addLayer(layer);
    return () => { map.removeLayer(layer); };
  }, [map, mapId, maxTileZoom]);

  return null;
}

function OverviewOverlay({ mapConfig, bounds }: { mapConfig: MapConfig; bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  const [opacity, setOpacity] = useState(() => (map.getZoom() >= 1 ? 0.18 : 0.9));

  useMapEvent('zoomend', () => {
    setOpacity(map.getZoom() >= 1 ? 0.18 : 0.9);
  });

  return <ImageOverlay url={mapConfig.imageUrl} bounds={bounds} opacity={opacity} />;
}

function EventMarkers({ markers, mapConfig }: { markers: ResolvedMarker[]; mapConfig: MapConfig }) {
  const map = useMap();
  const selectedEvent    = useUiStore(s => s.selectedEventName);
  const setSelectedEvent = useUiStore(s => s.setSelectedEvent);
  const clusterZoomThreshold = useUiStore(s => s.mapClusterZoomThreshold);
  const hiddenTiers      = useUiStore(s => s.hiddenTiers);
  const hiddenUsages     = useUiStore(s => s.hiddenUsages);
  const hiddenEvents     = useUiStore(s => s.hiddenEvents);
  const mapEventFilter   = useUiStore(s => s.mapEventFilter);

  const [viewportBounds, setViewportBounds] = useState(() => map.getBounds().pad(0.2));
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.2 }), []);

  useEffect(() => {
    const updateBounds = () => setViewportBounds(map.getBounds().pad(0.2));
    map.on('moveend zoomend', updateBounds);
    return () => {
      map.off('moveend zoomend', updateBounds);
    };
  }, [map]);

  const filterLower = mapEventFilter.toLowerCase();
  const hiddenTierSet = useMemo(() => new Set(hiddenTiers), [hiddenTiers]);
  const hiddenUsageSet = useMemo(() => new Set(hiddenUsages), [hiddenUsages]);
  const hiddenEventSet = useMemo(() => new Set(hiddenEvents), [hiddenEvents]);
  const visible = markers.filter(m => {
    if (hiddenTierSet.has(m.dominantTier)) return false;
    if (hiddenUsageSet.has(m.dominantUsage)) return false;
    if (hiddenEventSet.has(m.eventName)) return false;
    if (filterLower !== '' && !m.eventName.toLowerCase().includes(filterLower)) return false;
    return m.positions.some(pos => viewportBounds.contains(gameToLeaflet(pos.x, pos.z, mapConfig)));
  });

  const visiblePoints = useMemo(() => {
    const points: Array<{ marker: ResolvedMarker; latlng: L.LatLngExpression; key: string }> = [];
    for (const marker of visible) {
      for (let idx = 0; idx < marker.positions.length; idx++) {
        const pos = marker.positions[idx];
        const latlng = gameToLeaflet(pos.x, pos.z, mapConfig);
        if (!viewportBounds.contains(latlng)) continue;
        points.push({
          marker,
          latlng,
          key: `${marker.eventName}-${idx}`,
        });
      }
    }
    return points;
  }, [visible, viewportBounds, mapConfig]);

  const zoom = map.getZoom();
  const showClusters = zoom <= clusterZoomThreshold;

  const clusters = useMemo(() => {
    if (!showClusters) return [];

    const gridSize = 56;
    const buckets = new Map<string, {
      count: number;
      xSum: number;
      ySum: number;
      eventNames: Set<string>;
      samplePoint: { marker: ResolvedMarker; latlng: L.LatLngExpression; key: string } | null;
    }>();

    for (const point of visiblePoints) {
      const projected = map.latLngToLayerPoint(point.latlng as L.LatLng);
      const gx = Math.floor(projected.x / gridSize);
      const gy = Math.floor(projected.y / gridSize);
      const key = `${gx}:${gy}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, xSum: 0, ySum: 0, eventNames: new Set<string>(), samplePoint: null };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.xSum += projected.x;
      bucket.ySum += projected.y;
      bucket.eventNames.add(point.marker.eventName);
      bucket.samplePoint = point;
    }

    return [...buckets.values()].map(bucket => {
      const x = bucket.xSum / bucket.count;
      const y = bucket.ySum / bucket.count;
      return {
        center: map.layerPointToLatLng(L.point(x, y)),
        pointCount: bucket.count,
        eventCount: bucket.eventNames.size,
        samplePoint: bucket.samplePoint,
      };
    });
  }, [showClusters, visiblePoints, map]);

  if (showClusters) {
    return (
      <>
        {clusters.map((cluster, idx) => {
          if (cluster.pointCount === 1 && cluster.samplePoint) {
            const { marker, latlng, key } = cluster.samplePoint;
            const usageColor = getUsageColor(marker.dominantUsage);
            const isSelected = selectedEvent === marker.eventName;
            const opacity = marker.inBounds ? (marker.active ? 0.85 : 0.4) : 0.25;

            return (
              <CircleMarker
                key={key}
                center={latlng}
                renderer={canvasRenderer}
                radius={isSelected ? EVENT_SELECTED_RADIUS : EVENT_MARKER_RADIUS}
                pathOptions={{
                  color: '#fff',
                  fillColor: usageColor,
                  fillOpacity: opacity,
                  stroke: isSelected,
                  weight: isSelected ? 3 : 0,
                }}
                eventHandlers={{
                  click: (event) => {
                    setSelectedEvent(selectedEvent === marker.eventName ? null : marker.eventName);
                    event.target.openPopup();
                  },
                }}
              >
                <Popup autoPan={false}><MarkerPopup marker={marker} /></Popup>
              </CircleMarker>
            );
          }

          const radius = Math.min(18, 9 + Math.log2(cluster.pointCount + 1) * 2);
          return (
            <CircleMarker
              key={`cluster-${idx}`}
              center={cluster.center}
              renderer={canvasRenderer}
              radius={radius}
              pathOptions={{
                color: '#f8fafc',
                fillColor: '#334155',
                fillOpacity: 0.8,
                weight: 2,
              }}
              eventHandlers={{
                click: (event) => {
                  event.target.openPopup();
                },
                dblclick: () => {
                  map.setView(cluster.center, Math.min(zoom + 2, 2));
                },
              }}
            >
              <Tooltip permanent direction="center" className="cluster-count-label" interactive={false}>
                {cluster.pointCount}
              </Tooltip>
              <Popup autoPan={false}>
                <div className="text-xs text-slate-200">
                  {cluster.pointCount} points · {cluster.eventCount} events
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
      {visiblePoints.map(point => {
          const { marker, latlng, key } = point;
          const usageColor = getUsageColor(marker.dominantUsage);
          const isSelected = selectedEvent === marker.eventName;
          const opacity    = marker.inBounds ? (marker.active ? 0.85 : 0.4) : 0.25;
          return (
            <CircleMarker
              key={key}
              center={latlng}
              renderer={canvasRenderer}
              radius={isSelected ? EVENT_SELECTED_RADIUS : EVENT_MARKER_RADIUS}
              pathOptions={{
                color: '#fff',
                fillColor: usageColor,
                fillOpacity: opacity,
                stroke: isSelected,
                weight: isSelected ? 3 : 0,
              }}
              eventHandlers={{
                click: (event) => {
                  setSelectedEvent(selectedEvent === marker.eventName ? null : marker.eventName);
                  event.target.openPopup();
                },
              }}
            >
              <Popup autoPan={false}><MarkerPopup marker={marker} /></Popup>
            </CircleMarker>
          );
        })
      }
    </>
  );
}

function buildingMarkerIcon(usageColor: string): L.DivIcon {
  const size = BUILDING_MARKER_SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const fillR = 5.5;
  const outlineR = 7.5;
  const outlineWidth = 1.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${outlineR}" fill="#0f1117" fill-opacity="0.7" stroke="#f8fafc" stroke-width="${outlineWidth}"/><circle cx="${cx}" cy="${cy}" r="${fillR}" fill="${usageColor}" fill-opacity="0.9"/></svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [cx, cy], popupAnchor: [0, -cy] });
}

function BuildingMarkers({ mapConfig }: { mapConfig: MapConfig }) {
  const map = useMap();
  const buildingInstances   = useServerStore(s => s.buildingInstances);
  const mission             = useServerStore(s => s.mission);
  const showBuildings       = useUiStore(s => s.showBuildings);
  const clusterZoomThreshold = useUiStore(s => s.mapClusterZoomThreshold);
  const buildingItemFilter  = useUiStore(s => s.buildingItemFilter);
  const buildingNameFilter  = useUiStore(s => s.buildingNameFilter);
  const buildingMinLootmax  = useUiStore(s => s.buildingMinLootmax);
  const hiddenUsages        = useUiStore(s => s.hiddenUsages);
  const hiddenTiers         = useUiStore(s => s.hiddenTiers);
  const tierZonesLoaded     = useUiStore(s => s.tierZonesLoaded);

  const [viewportBounds, setViewportBounds] = useState(() => map.getBounds().pad(0.2));
  useEffect(() => {
    const updateBounds = () => setViewportBounds(map.getBounds().pad(0.2));
    map.on('moveend zoomend', updateBounds);
    return () => {
      map.off('moveend zoomend', updateBounds);
    };
  }, [map]);

  // Fallback: infer tier from dominant item tier per usage tag
  const usageTierMap = useMemo(() => {
    if (!mission) return new Map<string, string>();
    const counts = new Map<string, Map<string, number>>();
    for (const type of mission.types.values()) {
      const dominant = TIER_ORDER.find(t => type.tiers.includes(t));
      if (!dominant) continue;
      for (const usage of type.usages) {
        if (!counts.has(usage)) counts.set(usage, new Map());
        const m = counts.get(usage)!;
        m.set(dominant, (m.get(dominant) ?? 0) + 1);
      }
    }
    const result = new Map<string, string>();
    for (const [usage, tierCounts] of counts) {
      const best = [...tierCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) result.set(usage, best[0]);
    }
    return result;
  }, [mission]);

  const visible = useMemo(() => {
    if (!showBuildings) return [];

    const q = buildingItemFilter.trim().toLowerCase();
    let itemFilter: ((b: typeof buildingInstances[0]) => boolean) | null = null;

    if (q && mission) {
      const canonicalUsages = new Set(
        [...mission.types.values()]
          .filter(t => t.name.toLowerCase().includes(q))
          .flatMap(t => t.usages)
      );
      const rawTagUsages = new Set(
        [...mission.spawnableTypes.values()]
          .filter(st => st.name.toLowerCase().includes(q))
          .flatMap(st => st.usages)
      );
      if (canonicalUsages.size === 0 && rawTagUsages.size === 0) {
        itemFilter = () => false;
      } else {
        itemFilter = b =>
          (canonicalUsages.size > 0 && b.usages.some(u => canonicalUsages.has(u))) ||
          (rawTagUsages.size > 0 && b.containers.some(c => c.tags.some(t => rawTagUsages.has(t))));
      }
    }

    const nameQ = buildingNameFilter.trim().toLowerCase();

    return buildingInstances.flatMap(b => {
      const normalizedUsages = b.usages.length > 0 ? b.usages : ['unknown'];
      const visibleUsages = normalizedUsages.filter(u => !hiddenUsages.includes(u));
      if (visibleUsages.length === 0) return [];
      const primaryUsage = visibleUsages[0];
      if (nameQ && !b.typeName.toLowerCase().includes(nameQ)) return [];
      if (buildingMinLootmax > 0 && b.lootmax < buildingMinLootmax) return [];
      if (itemFilter !== null && !itemFilter(b)) return [];

      // Merge zone tier (areaflags, in-bounds only) with proto container tiers
      const zoneTier = tierZonesLoaded ? sampleTierAtPos(b.x, b.z) : null;
      const mergedSet = new Set<string>([
        ...(zoneTier && zoneTier !== 'unknown' ? [zoneTier] : []),
        ...b.tiers,
      ]);
      const protoTiers = TIER_ORDER.filter(t => b.tiers.includes(t));
      let displayTiers = TIER_ORDER.filter(t => mergedSet.has(t));
      let inferredTier: string | null = null;
      if (displayTiers.length === 0) {
        const fallback = usageTierMap.get(primaryUsage);
        if (fallback) {
          displayTiers = [fallback];
          inferredTier = fallback;
        }
      }
      if (displayTiers.length === 0) displayTiers = ['unknown'];

      if (displayTiers.every(t => hiddenTiers.includes(t))) return [];

      const latlng = gameToLeaflet(b.x, b.z, mapConfig);
      if (!viewportBounds.contains(latlng)) return [];

      return [{ b, primaryUsage, displayTiers, usageColor: getUsageColor(primaryUsage), latlng, zoneTier, protoTiers, inferredTier }];
    });
  }, [showBuildings, buildingInstances, mission, buildingItemFilter, buildingNameFilter, buildingMinLootmax, hiddenUsages, hiddenTiers, usageTierMap, tierZonesLoaded, mapConfig, viewportBounds]);

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
            const { b, displayTiers, usageColor, latlng, zoneTier, protoTiers, inferredTier } = cluster.sampleEntry;

            return (
              <Marker
                key={`${b.typeName}-${b.x.toFixed(3)}-${b.z.toFixed(3)}`}
                position={latlng}
                icon={buildingMarkerIcon(usageColor)}
              >
                <Popup maxWidth={320} autoPan={false}>
                  <BuildingPopup
                    building={b}
                    types={mission?.types ?? new Map()}
                    tiers={displayTiers}
                    zoneTier={zoneTier}
                    protoTiers={protoTiers}
                    inferredTier={inferredTier}
                  />
                </Popup>
              </Marker>
            );
          }

          const radius = Math.min(18, 9 + Math.log2(cluster.pointCount + 1) * 2);
          return (
            <CircleMarker
              key={`building-cluster-${idx}`}
              center={cluster.center}
              radius={radius}
              pathOptions={{
                color: '#dcfce7',
                fillColor: '#065f46',
                fillOpacity: 0.8,
                weight: 2,
              }}
              eventHandlers={{
                click: (event) => {
                  event.target.openPopup();
                },
                dblclick: () => {
                  map.setView(cluster.center, Math.min(zoom + 2, 2));
                },
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
      {visible.map(({ b, displayTiers, usageColor, latlng, zoneTier, protoTiers, inferredTier }) => (
        <Marker
          key={`${b.typeName}-${b.x.toFixed(3)}-${b.z.toFixed(3)}`}
          position={latlng}
          icon={buildingMarkerIcon(usageColor)}
        >
          <Popup maxWidth={320} autoPan={false}>
            <BuildingPopup
              building={b}
              types={mission?.types ?? new Map()}
              tiers={displayTiers}
              zoneTier={zoneTier}
              protoTiers={protoTiers}
              inferredTier={inferredTier}
            />
          </Popup>
        </Marker>
      ))}
    </>
  );
}

const PLAYER_SPAWN_COLORS: Record<string, string> = {
  fresh: '#10b981',
  respawn: '#f59e0b',
};

function playerSpawnIcon(type: string): L.DivIcon {
  const color = PLAYER_SPAWN_COLORS[type] ?? '#94a3b8';
  const size = PLAYER_MARKER_SIZE;
  const c = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="9" fill="#0b1220" stroke="${color}" stroke-width="1.8"/>
    <circle cx="${c}" cy="7.2" r="2.2" fill="#f8fafc"/>
    <path d="M${c} 10.2c-2.1 0-3.8 1.7-3.8 3.8v2h7.6v-2c0-2.1-1.7-3.8-3.8-3.8z" fill="#f8fafc"/>
    <rect x="8.2" y="12" width="3.6" height="4.8" rx="0.8" fill="${color}" fill-opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [c, c],
    popupAnchor: [0, -c],
  });
}

function PlayerSpawnMarkers({ mapConfig }: { mapConfig: MapConfig }) {
  const playerSpawnData  = useServerStore(s => s.playerSpawnData);
  const showPlayerSpawns = useUiStore(s => s.showPlayerSpawns);

  if (!showPlayerSpawns || !playerSpawnData) return null;

  return (
    <>
      {playerSpawnData.sections.flatMap(section =>
        section.points.map((p, idx) => (
          <Marker
            key={`${section.type}-${idx}`}
            position={gameToLeaflet(p.x, p.z, mapConfig)}
            icon={playerSpawnIcon(section.type)}
          >
            <Popup autoPan={false}>
              <div className="text-xs">
                <p className="font-semibold text-slate-100 mb-1">{section.type === 'fresh' ? 'Fresh Spawn' : section.type === 'respawn' ? 'Respawn' : section.type}</p>
                <p className="font-mono text-slate-400">X {p.x.toFixed(1)} · Z {p.z.toFixed(1)}</p>
              </div>
            </Popup>
          </Marker>
        ))
      )}
    </>
  );
}

async function pickMapImage(
  activeMap:       string,
  setMapImagePath: (id: string, url: string) => void,
  setMapImageSize: (id: string, w: number, h: number) => void,
) {
  const selected = await open({
    multiple: false,
    title: 'Select Map Image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp'] }],
  });
  if (selected && typeof selected === 'string') {
    const url = convertFileSrc(selected);
    setMapImagePath(activeMap, url);
    const img = new Image();
    img.onload = () => setMapImageSize(activeMap, img.naturalWidth, img.naturalHeight);
    img.src = url;
  }
}

export function MapView() {
  const activeTab         = useUiStore(s => s.activeTab);
  const activeMap         = useUiStore(s => s.activeMap);
  const isMapActive       = activeTab === 'map';
  const { markers, mapConfig } = useMapMarkers(isMapActive);
  const setMapImagePath   = useUiStore(s => s.setMapImagePath);
  const setMapImageSize   = useUiStore(s => s.setMapImageSize);
  const mapEventFilter    = useUiStore(s => s.mapEventFilter);
  const mapClusterZoomThreshold = useUiStore(s => s.mapClusterZoomThreshold);
  const setMapClusterZoomThreshold = useUiStore(s => s.setMapClusterZoomThreshold);

  const hiddenEvents          = useUiStore(s => s.hiddenEvents);
  const toggleEvent           = useUiStore(s => s.toggleEvent);
  const setHiddenEvents       = useUiStore(s => s.setHiddenEvents);
  const showBuildings           = useUiStore(s => s.showBuildings);
  const toggleBuildings         = useUiStore(s => s.toggleBuildings);
  const buildingItemFilter      = useUiStore(s => s.buildingItemFilter);
  const setBuildingItemFilter   = useUiStore(s => s.setBuildingItemFilter);
  const buildingNameFilter      = useUiStore(s => s.buildingNameFilter);
  const setBuildingNameFilter   = useUiStore(s => s.setBuildingNameFilter);
  const buildingMinLootmax      = useUiStore(s => s.buildingMinLootmax);
  const setBuildingMinLootmax   = useUiStore(s => s.setBuildingMinLootmax);
  const tierZonesLoaded         = useUiStore(s => s.tierZonesLoaded);
  const showPlayerSpawns       = useUiStore(s => s.showPlayerSpawns);
  const togglePlayerSpawns     = useUiStore(s => s.togglePlayerSpawns);
  const buildingInstances      = useServerStore(s => s.buildingInstances);
  const playerSpawnData        = useServerStore(s => s.playerSpawnData);
  const [overlaysReady, setOverlaysReady] = useState(false);
  const [mapHeavyReady, setMapHeavyReady] = useState(false);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let delayId: ReturnType<typeof setTimeout> | null = null;
    const activatedAt = performance.now();

    if (!isMapActive) {
      setMapHeavyReady(false);
      setOverlaysReady(false);
      return;
    }

    const ready = () => {
      if (cancelled) return;
      const elapsed = performance.now() - activatedAt;
      const minDelayMs = 300;
      const remaining = Math.max(0, minDelayMs - elapsed);
      delayId = setTimeout(() => {
        if (cancelled) return;
        setMapHeavyReady(true);
        setOverlaysReady(true);
      }, remaining);
    };

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(ready, { timeout: 1500 });
    } else {
      timeoutId = setTimeout(ready, 350);
    }

    return () => {
      cancelled = true;
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (delayId !== null) clearTimeout(delayId);
    };
  }, [isMapActive, activeMap]);

  const eventNames = useMemo(
    () => [...new Set(markers.map(m => m.eventName))].sort(),
    [markers],
  );
  const eventSignature = useMemo(() => eventNames.join('\n'), [eventNames]);
  const [initializedEventSignature, setInitializedEventSignature] = useState('');
  const eventSetSignature = useRef('');
  useEffect(() => {
    if (markers.length === 0) {
      eventSetSignature.current = '';
      setInitializedEventSignature('');
      setHiddenEvents([]);
      return;
    }

    const signature = eventSignature;
    if (signature !== eventSetSignature.current) {
      eventSetSignature.current = signature;
      setHiddenEvents(eventNames);
      setInitializedEventSignature(signature);
    }
  }, [markers.length, eventNames, eventSignature, setHiddenEvents]);

  const [downloading, setDownloading]       = useState(false);
  const [downloadProgress, setProgress]     = useState(0);
  const [downloadError, setDownloadError]   = useState<string | null>(null);
  const [showEventList, setShowEventList]   = useState(false);
  const [showBuildingPanel, setShowBuildingPanel] = useState(false);

  const bounds      = mapBounds(mapConfig);
  const isKnownMap  = TILE_MAPS.has(activeMap);
  const isCustomMap = activeMap === 'custom';
  const hasImage    = !!mapConfig.imageUrl;
  const maxLeafletZoom = isKnownMap ? getLeafletTileMaxZoom(activeMap) : 4;

  // Auto-download overview for known maps that don't have a cached image yet.
  useEffect(() => {
    if (!isMapActive || !isKnownMap || hasImage || downloading) return;

    let cancelled = false;

    (async () => {
      setDownloading(true);
      setProgress(0);
      setDownloadError(null);

      const unlisten = await listen<number>('tile-progress', e => {
        if (!cancelled) setProgress(e.payload);
      });

      try {
        const result = await invoke<{ path: string; width: number; height: number }>(
          'download_map_tiles', { mapId: activeMap }
        );
        if (!cancelled) {
          setMapImagePath(activeMap, convertFileSrc(result.path));
          setMapImageSize(activeMap, result.width, result.height);
        }
      } catch (err) {
        if (!cancelled) setDownloadError(err instanceof Error ? err.message : String(err));
      } finally {
        unlisten();
        if (!cancelled) setDownloading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, hasImage, isMapActive]);

  // ── Custom map: no image yet ──────────────────────────────────────────────
  if (isCustomMap && !hasImage) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4">
          <h3 className="text-slate-200 font-semibold mb-1">Custom Map</h3>
          <p className="text-xs text-slate-500 mb-4">Configure dimensions and select a map image.</p>
          <form
            onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const w = Number(fd.get('width'));
              const h = Number(fd.get('height'));
              useUiStore.getState().setCustomMap('', w || 10000, h || 10000);
              pickMapImage('custom', setMapImagePath, setMapImageSize);
            }}
            className="space-y-3"
          >
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-slate-400 block mb-1">World Width (m)</label>
                <input name="width" type="number" defaultValue={10000} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-400 block mb-1">World Height (m)</label>
                <input name="height" type="number" defaultValue={10000} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 rounded-lg transition-colors">
              Select Map Image
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Known map: downloading overview ──────────────────────────────────────
  if (isKnownMap && !hasImage) {
    return (
      <div className="h-full flex flex-col">
        {downloading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <p className="text-slate-300 text-sm font-medium">Downloading map tiles…</p>
            <div className="w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-400 rounded-full transition-all"
                style={{ width: `${downloadProgress * 100}%` }}
              />
            </div>
            <p className="text-slate-500 text-xs">{Math.round(downloadProgress * 100)}%</p>
          </div>
        )}
        {downloadError && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <p className="text-red-400 text-sm">Download failed: {downloadError}</p>
            <button
              onClick={() => setDownloadError(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Map ready ─────────────────────────────────────────────────────────────
  return (
    <div className="relative h-full">
      <MapContainer
        crs={CRS.Simple}
        preferCanvas
        bounds={bounds}
        maxBoundsViscosity={1.0}
        maxZoom={maxLeafletZoom}
        zoomAnimation={false}
        fadeAnimation={false}
        style={{ height: '100%', width: '100%', background: '#0f1117' }}
      >
        <MapFitBounds mapConfig={mapConfig} />
        <MapVisibilitySync isActive={isMapActive} />
        <PopupAutoFlip />

        {/* Background overview — hidden once detail zoom takes over */}
        <OverviewOverlay mapConfig={mapConfig} bounds={bounds} />

        {/* Detail tile layer — capped per map at the highest available xam zoom */}
        {isMapActive && mapHeavyReady && isKnownMap && <DayZTileLayer mapId={activeMap} />}

        {isMapActive && mapHeavyReady && initializedEventSignature === eventSignature && (
          <EventMarkers markers={markers} mapConfig={mapConfig} />
        )}
        {isMapActive && mapHeavyReady && overlaysReady && <BuildingMarkers mapConfig={mapConfig} />}
        {isMapActive && mapHeavyReady && overlaysReady && <PlayerSpawnMarkers mapConfig={mapConfig} />}
      </MapContainer>

      <div className="absolute bottom-4 right-4 z-[1000] flex items-end gap-2 pointer-events-none">
        {/* Filters controls column */}
        {buildingInstances.length > 0 && (
          <div className="relative flex flex-col items-end gap-2 pointer-events-auto">
            {showBuildingPanel && (
              <div className="absolute bottom-full right-0 mb-2 bg-slate-900/95 border border-slate-700 rounded-lg backdrop-blur w-64 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
                  <span className="text-xs font-medium text-slate-300">Building Filters</span>
                  <span className={`text-xs ${tierZonesLoaded ? 'text-emerald-500' : 'text-slate-600'}`}>
                    {tierZonesLoaded ? 'Tier zones active' : 'No tier zones'}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <FilterInput
                    placeholder="Building name… (e.g. mil, sea)"
                    value={buildingNameFilter}
                    onChange={setBuildingNameFilter}
                  />
                  <FilterInput
                    placeholder="Item inside… (e.g. AKM, CodeLock)"
                    value={buildingItemFilter}
                    onChange={setBuildingItemFilter}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500 whitespace-nowrap">Min lootmax</label>
                    <input
                      type="number"
                      min={0}
                      value={buildingMinLootmax || ''}
                      onChange={e => setBuildingMinLootmax(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    {buildingMinLootmax > 0 && (
                      <button onClick={() => setBuildingMinLootmax(0)} className="text-slate-500 hover:text-slate-300 text-xs flex-shrink-0">✕</button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => setShowBuildingPanel(v => !v)}
              className={`h-8 bg-slate-900/90 border rounded-lg px-3 backdrop-blur text-xs transition-colors ${showBuildingPanel ? 'border-indigo-500 text-indigo-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              Filters{(buildingNameFilter || buildingItemFilter || buildingMinLootmax > 0) ? ' ●' : ''}
            </button>
          </div>
        )}

        {/* Events controls column */}
        <div className="relative flex flex-col items-end gap-2 pointer-events-auto">
          {showEventList && (
            <div className="absolute bottom-full right-0 mb-2 bg-slate-900/95 border border-slate-700 rounded-lg backdrop-blur w-56 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
                <span className="text-xs font-medium text-slate-300">Events</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => markers.forEach(m => { if (!hiddenEvents.includes(m.eventName)) toggleEvent(m.eventName); })}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >Hide all</button>
                  <button
                    onClick={() => markers.forEach(m => { if (hiddenEvents.includes(m.eventName)) toggleEvent(m.eventName); })}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >Show all</button>
                </div>
              </div>
              <div className="overflow-y-auto max-h-64">
                {[...markers]
                  .sort((a, b) => a.eventName.localeCompare(b.eventName))
                  .filter(m => mapEventFilter === '' || m.eventName.toLowerCase().includes(mapEventFilter.toLowerCase()))
                  .map(m => {
                    const hidden = hiddenEvents.includes(m.eventName);
                    return (
                      <button
                        key={m.eventName}
                        onClick={() => toggleEvent(m.eventName)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800 transition-colors ${hidden ? 'opacity-40' : ''}`}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getUsageColor(m.dominantUsage) }}
                        />
                        <span className="text-xs text-slate-200 truncate flex-1">{m.eventName}</span>
                        <span className="text-xs text-slate-500 flex-shrink-0">{m.positions.length}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEventList(v => !v)}
              className={`h-8 bg-slate-900/90 border rounded-lg px-3 backdrop-blur text-xs transition-colors ${showEventList ? 'border-indigo-500 text-indigo-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              Events {hiddenEvents.length > 0 ? `(${hiddenEvents.length} hidden)` : ''}
            </button>
          </div>
        </div>

        {/* Player spawns toggle */}
        {playerSpawnData && playerSpawnData.sections.length > 0 && (
          <div className="pointer-events-auto">
            <button
              onClick={togglePlayerSpawns}
              className={`h-8 bg-slate-900/90 border rounded-lg px-3 backdrop-blur text-xs transition-colors ${showPlayerSpawns ? 'border-emerald-500 text-emerald-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              Player Spawns
            </button>
          </div>
        )}

        {/* Buildings controls column */}
        {buildingInstances.length > 0 && (
          <div className="flex flex-col items-end gap-2 pointer-events-auto">
            <button
              onClick={toggleBuildings}
              className={`h-8 bg-slate-900/90 border rounded-lg px-3 backdrop-blur text-xs transition-colors ${showBuildings ? 'border-emerald-500 text-emerald-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              Buildings
            </button>
          </div>
        )}

        {/* Tier/usage legend — always visible, anchored to bottom-right */}
        <TierLegend />
      </div>

      <div className="absolute top-4 right-4 z-[1000] flex flex-col items-end gap-2">
        <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 backdrop-blur text-xs text-slate-400">
          {markers.length} events · {markers.reduce((s, m) => s + m.positions.length, 0)} spawn points
          {buildingInstances.length > 0 && ` · ${buildingInstances.length.toLocaleString()} buildings`}
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 bg-slate-900/90 border border-slate-700 rounded-lg px-2 backdrop-blur flex items-center gap-2">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">Cluster ≤ zoom</span>
            <button
              onClick={() => setMapClusterZoomThreshold(Math.max(-3, mapClusterZoomThreshold - 1))}
              className="w-6 h-6 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 hover:border-slate-500"
              aria-label="Decrease cluster zoom threshold"
            >
              -
            </button>
            <span className="w-6 text-center text-xs text-slate-200">{mapClusterZoomThreshold}</span>
            <button
              onClick={() => setMapClusterZoomThreshold(Math.min(1, mapClusterZoomThreshold + 1))}
              className="w-6 h-6 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 hover:border-slate-500"
              aria-label="Increase cluster zoom threshold"
            >
              +
            </button>
          </div>
          {isCustomMap && (
            <button
              onClick={() => pickMapImage(activeMap, setMapImagePath, setMapImageSize)}
              className="h-8 bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 text-xs px-3 rounded-lg backdrop-blur transition-colors"
            >
              Change map image
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
