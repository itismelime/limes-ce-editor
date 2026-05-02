import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { CRS } from 'leaflet';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'leaflet/dist/leaflet.css';
import { useMapMarkers } from '../../hooks/useMapMarkers';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { gameToLeaflet, mapBounds, mapPanBounds } from '../../lib/coordinateTransform';
import { TIER_COLORS, USAGE_COLORS } from '../../types/map';
import { TierLegend } from './TierLegend';
import { MarkerPopup } from './MarkerPopup';
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
          const usageColor = USAGE_COLORS[marker.dominantUsage] ?? USAGE_COLORS['Other'];
          const isSelected = selectedEvent === marker.eventName;
          const opacity    = marker.inBounds ? (marker.active ? 0.85 : 0.4) : 0.25;
          return (
            <CircleMarker
              key={`${marker.eventName}-${idx}`}
              center={latlng}
              radius={isSelected ? 10 : 6}
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

function BuildingMarkers({ mapConfig }: { mapConfig: MapConfig }) {
  const buildingInstances    = useServerStore(s => s.buildingInstances);
  const mission              = useServerStore(s => s.mission);
  const showBuildings       = useUiStore(s => s.showBuildings);
  const buildingItemFilter  = useUiStore(s => s.buildingItemFilter);
  const hiddenUsages        = useUiStore(s => s.hiddenUsages);

  const visible = useMemo(() => {
    if (!showBuildings) return [];

    let itemUsageFilter: Set<string> | null = null;
    const q = buildingItemFilter.trim().toLowerCase();
    if (q) {
      const matched = mission ? [...mission.types.values()].filter(t =>
        t.name.toLowerCase().includes(q)
      ) : [];
      const usages = new Set(matched.flatMap(t => t.usages));
      itemUsageFilter = usages.size > 0 ? usages : new Set<string>();
    }

    return buildingInstances.filter(b => {
      const primaryUsage = b.usages[0] ?? 'Other';
      if (hiddenUsages.includes(primaryUsage)) return false;
      if (itemUsageFilter !== null) return b.usages.some(u => itemUsageFilter!.has(u));
      return true;
    });
  }, [showBuildings, buildingInstances, mission, buildingItemFilter, hiddenUsages]);

  return (
    <>
      {visible.map((b, idx) => {
        const latlng = gameToLeaflet(b.x, b.z, mapConfig);
        const primaryUsage = b.usages[0] ?? 'Other';
        const color = USAGE_COLORS[primaryUsage] ?? '#64748b';
        return (
          <CircleMarker
            key={idx}
            center={latlng}
            radius={3}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.6, weight: 1 }}
          >
            <Popup>
              <div className="text-slate-800 text-xs">
                <p className="font-mono font-semibold mb-1">{b.typeName}</p>
                {b.usages.length > 0
                  ? <p className="text-slate-600">{b.usages.join(', ')}</p>
                  : <p className="text-slate-400 italic">No usage zone</p>
                }
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
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
                          style={{ backgroundColor: USAGE_COLORS[m.dominantUsage] ?? USAGE_COLORS['Other'] }}
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
