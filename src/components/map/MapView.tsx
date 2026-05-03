import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
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
import { gameToLeaflet, mapBounds, mapPanBounds } from '../../lib/coordinateTransform';
import { TIER_COLORS, TIER_ORDER, getUsageColor } from '../../types/map';
import { TierLegend } from './TierLegend';
import { MarkerPopup } from './MarkerPopup';
import { BuildingPopup } from './BuildingPopup';
import type { ResolvedMarker } from '../../lib/lootResolver';
import type { MapConfig } from '../../types/map';

const TILE_MAPS = new Set(['namalsk', 'chernarus', 'livonia', 'sakhal']);

// Leaflet zoom 0 = xam.nu zoom 4.  Detail tiles start at Leaflet zoom 1 (xam zoom 5).
const DETAIL_MIN_ZOOM = 1;
const XAM_ZOOM_OFFSET = 4;

function MapFitBounds({ mapConfig }: { mapConfig: MapConfig }) {
  const map = useMap();
  useMemo(() => { // eslint-disable-line
    map.setMaxBounds(mapPanBounds(mapConfig));
    map.fitBounds(mapBounds(mapConfig));
  }, [mapConfig.id]); // eslint-disable-line
  return null;
}

/** High-res tile layer — only activates at Leaflet zoom ≥ DETAIL_MIN_ZOOM. */
function DayZTileLayer({ mapId }: { mapId: string }) {
  const map = useMap();

  useEffect(() => {
    const layer = L.gridLayer({
      tileSize:  256,
      opacity:   1.0,
      minZoom:   DETAIL_MIN_ZOOM,
      maxZoom:   2,              // xam.nu zoom 6 (64×64 tiles)
    });

    (layer as any).createTile = function (
      coords: L.Coords,
      done:   L.DoneCallback,
    ): HTMLElement {
      const img = document.createElement('img');
      const xamZoom = coords.z + XAM_ZOOM_OFFSET;

      invoke<string>('get_tile_path', { mapId, zoom: xamZoom, x: coords.x, y: coords.y })
        .then(path => {
          img.src    = convertFileSrc(path);
          img.onload  = () => done(undefined, img);
          img.onerror = () => done(new Error('tile error'), img);
        })
        .catch(err => done(new Error(String(err)), img));

      return img;
    };

    map.addLayer(layer);
    return () => { map.removeLayer(layer); };
  }, [map, mapId]);

  return null;
}

function EventMarkers({ markers, mapConfig }: { markers: ResolvedMarker[]; mapConfig: MapConfig }) {
  const selectedEvent    = useUiStore(s => s.selectedEventName);
  const setSelectedEvent = useUiStore(s => s.setSelectedEvent);
  const hiddenTiers      = useUiStore(s => s.hiddenTiers);
  const hiddenUsages     = useUiStore(s => s.hiddenUsages);
  const hiddenEvents     = useUiStore(s => s.hiddenEvents);
  const mapEventFilter   = useUiStore(s => s.mapEventFilter);

  const filterLower = mapEventFilter.toLowerCase();
  const visible = markers.filter(m =>
    !hiddenTiers.includes(m.dominantTier) &&
    !hiddenUsages.includes(m.dominantUsage) &&
    !hiddenEvents.includes(m.eventName) &&
    (filterLower === '' || m.eventName.toLowerCase().includes(filterLower))
  );

  return (
    <>
      {visible.map(marker =>
        marker.positions.map((pos, idx) => {
          const latlng     = gameToLeaflet(pos.x, pos.z, mapConfig);
          const tierColor  = TIER_COLORS[marker.dominantTier] ?? TIER_COLORS.unknown;
          const usageColor = getUsageColor(marker.dominantUsage);
          const isSelected = selectedEvent === marker.eventName;
          const opacity    = marker.inBounds ? (marker.active ? 0.85 : 0.4) : 0.25;
          return (
            <CircleMarker
              key={`${marker.eventName}-${idx}`}
              center={latlng}
              radius={isSelected ? 14 : 9}
              pathOptions={{
                color: isSelected ? '#fff' : tierColor,
                fillColor: usageColor,
                fillOpacity: opacity,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{ click: () => setSelectedEvent(selectedEvent === marker.eventName ? null : marker.eventName) }}
            >
              <Popup><MarkerPopup marker={marker} /></Popup>
            </CircleMarker>
          );
        })
      )}
    </>
  );
}

function buildingMarkerIcon(tiers: string[], usageColor: string): L.DivIcon {
  const size = 18;
  const cx = 9, cy = 9;
  const fillR = 5;
  const ringR = 7;
  const sw = 2.5;
  const n = Math.max(tiers.length, 1);

  let ringPaths = '';
  if (n === 1) {
    const color = TIER_COLORS[tiers[0]] ?? TIER_COLORS.unknown;
    ringPaths = `<circle cx="${cx}" cy="${cy}" r="${ringR}" stroke="${color}" stroke-width="${sw}" fill="none"/>`;
  } else {
    const gap = 0.1;
    const step = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const color = TIER_COLORS[tiers[i]] ?? TIER_COLORS.unknown;
      const sa = i * step - Math.PI / 2 + gap / 2;
      const ea = (i + 1) * step - Math.PI / 2 - gap / 2;
      const x1 = (cx + ringR * Math.cos(sa)).toFixed(2);
      const y1 = (cy + ringR * Math.sin(sa)).toFixed(2);
      const x2 = (cx + ringR * Math.cos(ea)).toFixed(2);
      const y2 = (cy + ringR * Math.sin(ea)).toFixed(2);
      const large = (ea - sa) > Math.PI ? 1 : 0;
      ringPaths += `<path d="M${x1} ${y1} A${ringR} ${ringR} 0 ${large} 1 ${x2} ${y2}" stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${fillR}" fill="${usageColor}" fill-opacity="0.75"/>${ringPaths}</svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [cx, cy], popupAnchor: [0, -cy] });
}

function BuildingMarkers({ mapConfig }: { mapConfig: MapConfig }) {
  const buildingInstances  = useServerStore(s => s.buildingInstances);
  const mission            = useServerStore(s => s.mission);
  const showBuildings      = useUiStore(s => s.showBuildings);
  const buildingItemFilter = useUiStore(s => s.buildingItemFilter);
  const hiddenUsages       = useUiStore(s => s.hiddenUsages);
  const hiddenTiers        = useUiStore(s => s.hiddenTiers);
  const tierZonesLoaded    = useUiStore(s => s.tierZonesLoaded);

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

    return buildingInstances.flatMap(b => {
      const primaryUsage = b.usages[0] ?? 'Other';
      if (hiddenUsages.includes(primaryUsage)) return [];
      if (itemFilter !== null && !itemFilter(b)) return [];

      // Merge zone tier (areaflags, in-bounds only) with proto container tiers
      const zoneTier = tierZonesLoaded ? sampleTierAtPos(b.x, b.z) : null;
      const mergedSet = new Set<string>([
        ...(zoneTier && zoneTier !== 'unknown' ? [zoneTier] : []),
        ...b.tiers,
      ]);
      let displayTiers = TIER_ORDER.filter(t => mergedSet.has(t));
      if (displayTiers.length === 0) {
        const fallback = usageTierMap.get(primaryUsage);
        if (fallback) displayTiers = [fallback];
      }
      if (displayTiers.length === 0) displayTiers = ['unknown'];

      if (displayTiers.every(t => hiddenTiers.includes(t))) return [];

      return [{ b, displayTiers, usageColor: getUsageColor(primaryUsage), latlng: gameToLeaflet(b.x, b.z, mapConfig) }];
    });
  }, [showBuildings, buildingInstances, mission, buildingItemFilter, hiddenUsages, hiddenTiers, usageTierMap, tierZonesLoaded, mapConfig]);

  return (
    <>
      {visible.map(({ b, displayTiers, usageColor, latlng }, idx) => (
        <Marker
          key={idx}
          position={latlng}
          icon={buildingMarkerIcon(displayTiers, usageColor)}
        >
          <Popup maxWidth={320}>
            <BuildingPopup
              building={b}
              spawnableTypes={mission?.spawnableTypes ?? new Map()}
              types={mission?.types ?? new Map()}
              tiers={displayTiers}
            />
          </Popup>
        </Marker>
      ))}
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
  const { markers, mapConfig } = useMapMarkers();
  const activeMap         = useUiStore(s => s.activeMap);
  const mapImagePaths     = useUiStore(s => s.mapImagePaths);
  const setMapImagePath   = useUiStore(s => s.setMapImagePath);
  const setMapImageSize   = useUiStore(s => s.setMapImageSize);
  const mapEventFilter    = useUiStore(s => s.mapEventFilter);
  const setMapEventFilter = useUiStore(s => s.setMapEventFilter);

  const hiddenEvents          = useUiStore(s => s.hiddenEvents);
  const toggleEvent           = useUiStore(s => s.toggleEvent);
  const showBuildings          = useUiStore(s => s.showBuildings);
  const toggleBuildings        = useUiStore(s => s.toggleBuildings);
  const buildingItemFilter     = useUiStore(s => s.buildingItemFilter);
  const setBuildingItemFilter  = useUiStore(s => s.setBuildingItemFilter);
  const tierZonesLoaded        = useUiStore(s => s.tierZonesLoaded);
  const buildingInstances      = useServerStore(s => s.buildingInstances);

  const eventsInitialized = useRef(false);
  useEffect(() => {
    if (!eventsInitialized.current && markers.length > 0) {
      eventsInitialized.current = true;
      const { hiddenEvents: current, toggleEvent: toggle } = useUiStore.getState();
      markers.forEach(m => { if (!current.includes(m.eventName)) toggle(m.eventName); });
    }
  }, [markers.length]);

  const [downloading, setDownloading]       = useState(false);
  const [downloadProgress, setProgress]     = useState(0);
  const [downloadError, setDownloadError]   = useState<string | null>(null);
  const [showEventList, setShowEventList]   = useState(false);
  const [showBuildingPanel, setShowBuildingPanel] = useState(false);

  const bounds      = mapBounds(mapConfig);
  const isKnownMap  = TILE_MAPS.has(activeMap);
  const isCustomMap = activeMap === 'custom';
  const hasImage    = !!mapConfig.imageUrl;

  // Auto-download overview for known maps that don't have a cached image yet.
  useEffect(() => {
    if (!isKnownMap || hasImage || downloading) return;

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
  }, [activeMap, hasImage]);

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
        bounds={bounds}
        maxBoundsViscosity={1.0}
        minZoom={-3}
        maxZoom={2}
        style={{ height: '100%', width: '100%', background: '#0f1117' }}
      >
        <MapFitBounds mapConfig={mapConfig} />

        {/* Background overview — always visible at all zoom levels */}
        <ImageOverlay url={mapConfig.imageUrl} bounds={bounds} opacity={0.9} />

        {/* Detail tile layer — only activates at zoom ≥ 1 (xam.nu zoom 5+) */}
        {isKnownMap && <DayZTileLayer mapId={activeMap} />}

        <EventMarkers markers={markers} mapConfig={mapConfig} />
        <BuildingMarkers mapConfig={mapConfig} />
      </MapContainer>

      <div className="absolute bottom-4 right-4 z-[1000] flex items-end gap-2 pointer-events-none">
        {/* Buildings controls column */}
        {buildingInstances.length > 0 && (
          <div className="flex flex-col items-end gap-2 pointer-events-auto">
            {showBuildingPanel && (
              <div className="bg-slate-900/95 border border-slate-700 rounded-lg backdrop-blur w-64 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
                  <span className="text-xs font-medium text-slate-300">Buildings</span>
                  <span className="text-xs text-slate-600">{buildingInstances.length.toLocaleString()} total</span>
                </div>
                <div className="p-3 space-y-3">
                  {/* Tier zone status */}
                  <p className={`text-xs ${tierZonesLoaded ? 'text-green-500' : 'text-slate-600'}`}>
                    {tierZonesLoaded ? 'Tier zones: loaded from areaflags.map' : 'Tier zones: not available (no areaflags.map found)'}
                  </p>
                  {/* Item search */}
                  <div className="relative">
                    <input
                      type="text"
                      value={buildingItemFilter}
                      onChange={e => setBuildingItemFilter(e.target.value)}
                      placeholder="Search item to find spawn zones…"
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    {buildingItemFilter && (
                      <button onClick={() => setBuildingItemFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => setShowBuildingPanel(v => !v)}
              className={`bg-slate-900/90 border rounded-lg px-3 py-1.5 backdrop-blur text-xs transition-colors ${showBuildingPanel ? 'border-indigo-500 text-indigo-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              Buildings
            </button>
          </div>
        )}

        {/* Events controls column */}
        <div className="flex flex-col items-end gap-2 pointer-events-auto">
          {showEventList && (
            <div className="bg-slate-900/95 border border-slate-700 rounded-lg backdrop-blur w-56 flex flex-col overflow-hidden">
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
              className={`bg-slate-900/90 border rounded-lg px-3 py-1.5 backdrop-blur text-xs transition-colors ${showEventList ? 'border-indigo-500 text-indigo-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              Events {hiddenEvents.length > 0 ? `(${hiddenEvents.length} hidden)` : ''}
            </button>
            <div className="relative">
              <input
                type="text"
                value={mapEventFilter}
                onChange={e => setMapEventFilter(e.target.value)}
                placeholder="Filter events…"
                className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 backdrop-blur text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-40"
              />
              {mapEventFilter && (
                <button
                  onClick={() => setMapEventFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                >✕</button>
              )}
            </div>
          </div>
        </div>

        {/* Tier/usage legend — always visible, anchored to bottom-right */}
        <TierLegend />
      </div>

      <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
        <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 backdrop-blur text-xs text-slate-400">
          {markers.length} events · {markers.reduce((s, m) => s + m.positions.length, 0)} spawn points
          {buildingInstances.length > 0 && ` · ${buildingInstances.length.toLocaleString()} buildings`}
        </div>
        {isCustomMap && (
          <button
            onClick={() => pickMapImage(activeMap, setMapImagePath, setMapImageSize)}
            className="bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 text-xs px-3 py-1.5 rounded-lg backdrop-blur transition-colors"
          >
            Change map image
          </button>
        )}
      </div>
    </div>
  );
}
