import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, Circle, Marker, Popup, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import { CRS } from 'leaflet';
import { open } from '@tauri-apps/plugin-dialog';
import { getUsageMasks, getLayerGridInfo } from '../../lib/tierZoneResolver';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'leaflet/dist/leaflet.css';
import { useMapMarkers } from '../../hooks/useMapMarkers';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { useCommunityMapsStore } from '../../store/communityMapsStore';
import { gameToLeaflet, mapBounds } from '../../lib/coordinateTransform';
import { getUsageColor } from '../../types/map';
import { BUILTIN_TILE_MAP_IDS } from '../../types/map';
import { TierLegend } from './TierLegend';
import { EventMarkers } from './EventMarkers';
import { BuildingMarkers } from './BuildingMarkers';
import { BuildingSidebar } from './BuildingSidebar';
import type { MapConfig } from '../../types/map';

const BUILTIN_MAX_XAM_ZOOM: Record<string, number> = {
  namalsk: 6,
  chernarus: 8,
  livonia: 7,
  sakhal: 8,
};

// Leaflet zoom 0 = xam.nu zoom 4. Delay detail tiles until zoom 1 to cut heavy decode work.
const DETAIL_MIN_ZOOM = 1;
const XAM_ZOOM_OFFSET = 4;
const PLAYER_MARKER_SIZE = 20;

function getLeafletTileMaxZoom(mapId: string, communityMaxZoom: Record<string, number>): number {
  const xamZoom = BUILTIN_MAX_XAM_ZOOM[mapId] ?? communityMaxZoom[mapId] ?? 8;
  return xamZoom - XAM_ZOOM_OFFSET;
}

function FilterInput({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-5 h-5 rounded text-slate-500 hover:text-slate-300">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
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

function ZoomControlOffset({ sidebarWidth }: { sidebarWidth: number }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer().querySelector('.leaflet-top.leaflet-left') as HTMLElement | null;
    if (el) el.style.left = `${sidebarWidth + 8}px`;
  }, [map, sidebarWidth]);
  return null;
}

function MapClickDeselect() {
  const setSelectedBuilding = useUiStore(s => s.setSelectedBuilding);
  useMapEvent('click', () => setSelectedBuilding(null));
  return null;
}

function MapFitBounds({ mapConfig }: { mapConfig: MapConfig }) {
  const map = useMap();
  useEffect(() => {
    const boundsExpr = mapBounds(mapConfig) as L.LatLngBoundsLiteral;
    const bounds = L.latLngBounds(boundsExpr);

    const syncViewBounds = () => {
      const minZoom = map.getBoundsZoom(bounds, false);
      map.setMinZoom(minZoom - 1.5);
      map.setMaxBounds(bounds);
      map.panInsideBounds(bounds, { animate: false });
      if (map.getZoom() < minZoom - 1.5) {
        map.setZoom(minZoom - 1.5);
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
function DayZTileLayer({ mapId, communityMaxZoom }: { mapId: string; communityMaxZoom: Record<string, number> }) {
  const map = useMap();
  const maxTileZoom = getLeafletTileMaxZoom(mapId, communityMaxZoom);

  useEffect(() => {
    const layer = L.gridLayer({
      tileSize:  256,
      opacity:   1.0,
      minZoom:   DETAIL_MIN_ZOOM,
      maxZoom:   maxTileZoom,
      keepBuffer: 4,
      updateWhenZooming: true,
      updateWhenIdle: false,
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
  const [opacity, setOpacity] = useState(() => (map.getZoom() >= 1 ? 0.4 : 0.9));

  useMapEvent('zoomend', () => {
    setOpacity(map.getZoom() >= 1 ? 0.4 : 0.9);
  });

  return <ImageOverlay url={mapConfig.imageUrl} bounds={bounds} opacity={opacity} />;
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function UsageLayerOverlays({ bounds, show }: { bounds: L.LatLngBoundsExpression; show: boolean }) {
  const tierZonesLoaded = useUiStore(s => s.tierZonesLoaded);
  const [overlayUrls, setOverlayUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!tierZonesLoaded) { setOverlayUrls({}); return; }
    const masks = getUsageMasks();
    const grid = getLayerGridInfo();
    if (!masks || !grid) return;

    const { gridW, gridH } = grid;
    // Downsample 4096→512 for fast canvas creation (8× reduction each axis = 64× fewer pixels)
    const SCALE = 0.125;
    const outW = Math.round(gridW * SCALE);
    const outH = Math.round(gridH * SCALE);
    const step = Math.round(1 / SCALE);

    const urls: Record<string, string> = {};
    for (const [usage, mask] of Object.entries(masks)) {
      const color = hexToRgb(getUsageColor(usage));
      if (!color) continue;
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const imageData = ctx.createImageData(outW, outH);
      const data = imageData.data;
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const srcX = Math.min(x * step, gridW - 1);
          const srcY = Math.min(y * step, gridH - 1);
          if (mask[srcY * gridW + srcX]) {
            const i = (y * outW + x) * 4;
            data[i]     = color.r;
            data[i + 1] = color.g;
            data[i + 2] = color.b;
            data[i + 3] = 90;
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
      urls[usage] = canvas.toDataURL();
    }
    setOverlayUrls(urls);
  }, [tierZonesLoaded]);

  if (!show || Object.keys(overlayUrls).length === 0) return null;

  return (
    <>
      {Object.entries(overlayUrls).map(([usage, url]) => (
        <ImageOverlay key={usage} url={url} bounds={bounds} opacity={1} zIndex={10} />
      ))}
    </>
  );
}

function CeToolZoneOverlays({ mapConfig, show }: { mapConfig: MapConfig; show: boolean }) {
  const ceToolProject = useServerStore(s => s.ceToolProject);
  const map = useMap();
  const [viewportBounds, setViewportBounds] = useState(() => map.getBounds().pad(0.2));

  useEffect(() => {
    const updateBounds = () => setViewportBounds(map.getBounds().pad(0.2));
    map.on('moveend zoomend', updateBounds);
    return () => {
      map.off('moveend zoomend', updateBounds);
    };
  }, [map]);

  const zones = useMemo(() => {
    if (!show || !ceToolProject) return [];
    const scale = mapConfig.imageWidth / mapConfig.worldWidth;
    return ceToolProject.territories.flatMap(territory =>
      territory.zones.flatMap(zone => {
        const center = gameToLeaflet(zone.x, zone.z, mapConfig);
        if (!viewportBounds.contains(center)) return [];
        const radius = Math.max(2, zone.r * scale);
        return [{
          key: `${territory.type}-${territory.name}-${zone.name}-${zone.x.toFixed(2)}-${zone.z.toFixed(2)}`,
          center,
          radius,
          territory,
          zone,
          color: getUsageColor(territory.type || territory.name || 'unknown'),
        }];
      })
    );
  }, [show, ceToolProject, mapConfig, viewportBounds]);

  if (!show || zones.length === 0) return null;

  return (
    <>
      {zones.map(entry => (
        <Circle
          key={entry.key}
          center={entry.center}
          radius={entry.radius}
          pathOptions={{
            color: entry.color,
            fillColor: entry.color,
            fillOpacity: 0.16,
            opacity: 0.7,
            weight: 1.2,
          }}
        >
          <Tooltip sticky direction="top" opacity={0.95}>
            <div className="text-xs">
              <div className="font-medium text-slate-100">{entry.zone.name || 'Zone'}</div>
              <div className="text-slate-300">{entry.territory.type} / {entry.territory.name}</div>
            </div>
          </Tooltip>
        </Circle>
      ))}
    </>
  );
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

  const communityMaps = useCommunityMapsStore(s => s.maps);

  const communityMaxZoom = useMemo(() => {
    const m: Record<string, number> = {};
    for (const cm of communityMaps) m[cm.id] = cm.maxZoom;
    return m;
  }, [communityMaps]);

  const tileMaps = useMemo(() => {
    const s = new Set<string>(BUILTIN_TILE_MAP_IDS);
    for (const cm of communityMaps) s.add(cm.id);
    return s;
  }, [communityMaps]);
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
  const ceToolProject          = useServerStore(s => s.ceToolProject);
  const mission                = useServerStore(s => s.mission);
  const [overlaysReady, setOverlaysReady] = useState(false);
  const [mapHeavyReady, setMapHeavyReady] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(44);

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
  const [showCeZones, setShowCeZones] = useState(false);
  const [showUsageZones, setShowUsageZones] = useState(false);
  const pickCeToolFolder = useServerStore(s => s.pickCeToolFolder);

  const bounds      = mapBounds(mapConfig);
  const isKnownMap  = tileMaps.has(activeMap);
  const isCustomMap = activeMap === 'custom';
  const hasImage    = !!mapConfig.imageUrl;
  const maxLeafletZoom = isKnownMap ? getLeafletTileMaxZoom(activeMap, communityMaxZoom) : 4;

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
                <input name="width" type="number" defaultValue={10000} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-lime-500" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-400 block mb-1">World Height (m)</label>
                <input name="height" type="number" defaultValue={10000} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-lime-500" />
              </div>
            </div>
            <button type="submit" className="w-full bg-lime-500 hover:bg-lime-600 text-white text-sm font-medium py-2 rounded-lg transition-colors">
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
                className="h-full bg-lime-400 rounded-full transition-all"
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
    <div className="h-full relative bg-slate-950">
      <BuildingSidebar onWidthChange={setSidebarWidth} />
      <div className="absolute inset-0">
        <MapContainer
          crs={CRS.Simple}
          preferCanvas
          bounds={bounds}
          maxBoundsViscosity={1.0}
          maxZoom={maxLeafletZoom}
          zoomAnimation
          fadeAnimation
          markerZoomAnimation
          zoomSnap={0.25}
          zoomDelta={0.25}
          wheelPxPerZoomLevel={120}
          style={{ height: '100%', width: '100%', background: '#141414' }}
        >
          <MapFitBounds mapConfig={mapConfig} />
          <MapVisibilitySync isActive={isMapActive} />
          <MapClickDeselect />
          <PopupAutoFlip />
          <ZoomControlOffset sidebarWidth={sidebarWidth} />

          {/* Background overview — hidden once detail zoom takes over */}
          <OverviewOverlay mapConfig={mapConfig} bounds={bounds} />

          {/* Detail tile layer — capped per map at the highest available xam zoom */}
          {isMapActive && mapHeavyReady && isKnownMap && <DayZTileLayer mapId={activeMap} communityMaxZoom={communityMaxZoom} />}

          {isMapActive && mapHeavyReady && initializedEventSignature === eventSignature && (
            <EventMarkers markers={markers} mapConfig={mapConfig} />
          )}
          {isMapActive && mapHeavyReady && overlaysReady && <BuildingMarkers mapConfig={mapConfig} />}
          {isMapActive && mapHeavyReady && overlaysReady && <PlayerSpawnMarkers mapConfig={mapConfig} />}
          {isMapActive && mapHeavyReady && overlaysReady && <UsageLayerOverlays bounds={bounds} show={showUsageZones} />}
          {isMapActive && mapHeavyReady && overlaysReady && <CeToolZoneOverlays mapConfig={mapConfig} show={showCeZones} />}
        </MapContainer>

        {/* CE Tool not found notice */}
        {mission && !ceToolProject && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] w-[420px] max-w-[90vw] bg-slate-900 border border-amber-700/60 rounded-xl shadow-xl p-4 pointer-events-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="text-amber-400 font-semibold text-sm mb-1">CE Tool data unavailable</p>
              <p className="text-slate-400 text-xs leading-relaxed">
                CE Tool was not found for this mission, so tiers and usage zones cannot be shown. Place your CE Tool project folder inside this mission folder (named <span className="text-slate-200 font-mono">CETool</span> or <span className="text-slate-200 font-mono">Central Economy Tool</span>), or pick it manually.
              </p>
              <p className="text-slate-500 text-xs mt-1">
                Don't have CE Tool?{' '}
                <a
                  href="https://github.com/BohemiaInteractive/DayZ-Central-Economy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-lime-400 hover:text-lime-300 underline"
                  onClick={e => e.stopPropagation()}
                >
                  Get it on GitHub
                </a>
              </p>
            </div>
          </div>
          <button
            onClick={async () => { await pickCeToolFolder?.(); }}
            className="mt-3 w-full bg-amber-700/30 hover:bg-amber-700/50 border border-amber-700/60 text-amber-300 text-xs font-medium py-1.5 rounded-lg transition-colors"
          >
            Browse for CE Tool folder…
          </button>
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-[1000] pointer-events-auto">
        <TierLegend />
      </div>

      {/* Bottom-center toolbar with dropup panels */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 pointer-events-none">
        {showBuildingPanel && buildingInstances.length > 0 && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-64 flex flex-col overflow-hidden pointer-events-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
              <span className="text-xs font-medium text-slate-300">Building Filters</span>
              <span className={`text-xs ${tierZonesLoaded ? 'text-emerald-500' : 'text-slate-500'}`}>
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
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
                />
                {buildingMinLootmax > 0 && (
                  <button onClick={() => setBuildingMinLootmax(0)} className="flex items-center justify-center w-5 h-5 rounded text-slate-500 hover:text-slate-300 flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {showEventList && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-56 flex flex-col overflow-hidden pointer-events-auto">
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

        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 h-11 pointer-events-auto">
        {buildingInstances.length > 0 && (
          <button
            onClick={() => { setShowBuildingPanel(v => !v); setShowEventList(false); }}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showBuildingPanel ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Filters{(buildingNameFilter || buildingItemFilter || buildingMinLootmax > 0) ? ' ●' : ''}
          </button>
        )}
        <button
          onClick={() => { setShowEventList(v => !v); setShowBuildingPanel(false); }}
          className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showEventList ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
        >
          Events {hiddenEvents.length > 0 ? `(${hiddenEvents.length} hidden)` : ''}
        </button>
        {playerSpawnData && playerSpawnData.sections.length > 0 && (
          <button
            onClick={togglePlayerSpawns}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showPlayerSpawns ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Player Spawns
          </button>
        )}
        {tierZonesLoaded && getUsageMasks() !== null && (
          <button
            onClick={() => setShowUsageZones(v => !v)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showUsageZones ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Usage Zones
          </button>
        )}
        {ceToolProject && ceToolProject.territories.length > 0 && (
          <button
            onClick={() => setShowCeZones(v => !v)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showCeZones ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Spawn Territories
          </button>
        )}
        {buildingInstances.length > 0 && (
          <button
            onClick={toggleBuildings}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showBuildings ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Buildings
          </button>
        )}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-[1000] flex flex-col items-end gap-2">
        <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-400">
          {markers.length} events · {markers.reduce((s, m) => s + m.positions.length, 0)} spawn points
          {buildingInstances.length > 0 && ` · ${buildingInstances.length.toLocaleString()} buildings`}
          {ceToolProject && ` · ${ceToolProject.territories.length} CE territories`}
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 bg-slate-900 border border-slate-700 rounded-xl px-2 flex items-center gap-2">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">Cluster ≤ zoom</span>
            <button
              onClick={() => setMapClusterZoomThreshold(Math.max(-3, mapClusterZoomThreshold - 1))}
              className="w-6 h-6 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 hover:border-slate-500"
              aria-label="Decrease cluster zoom threshold"
            >
              -
            </button>
            <span className="w-6 text-center text-xs text-slate-200">{mapClusterZoomThreshold}</span>
            <button
              onClick={() => setMapClusterZoomThreshold(Math.min(1, mapClusterZoomThreshold + 1))}
              className="w-6 h-6 bg-slate-800 border border-slate-700 rounded-md text-xs text-slate-200 hover:border-slate-500"
              aria-label="Increase cluster zoom threshold"
            >
              +
            </button>
          </div>
          {isCustomMap && (
            <button
              onClick={() => pickMapImage(activeMap, setMapImagePath, setMapImageSize)}
              className="h-8 bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 text-xs px-3 rounded-lg transition-colors"
            >
              Change map image
            </button>
          )}
        </div>
      </div>
      </div>

    </div>
  );
}
