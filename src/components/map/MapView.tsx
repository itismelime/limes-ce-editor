import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, ImageOverlay, Circle, Marker, Popup, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import { CRS } from 'leaflet';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'leaflet/dist/leaflet.css';
import { useMapMarkers } from '../../hooks/useMapMarkers';
import { useUiStore } from '../../store/uiStore';
import { useServerStore, toMessage } from '../../store/serverStore';
import { useCommunityMapsStore } from '../../store/communityMapsStore';
import { gameToLeaflet, mapBounds } from '../../lib/coordinateTransform';
import { getUsageColor, TIER_COLORS } from '../../types/map';
import { BUILTIN_TILE_MAP_IDS } from '../../types/map';
// MAX_PYRAMID_Z = 5 (matching tiles.rs MAX_ZOOM)
import { TierLegend } from './TierLegend';
import { EventMarkers } from './EventMarkers';
import { BuildingMarkers } from './BuildingMarkers';
import { BuildingSidebar } from './BuildingSidebar';
import type { MapConfig } from '../../types/map';

const PLAYER_MARKER_SIZE = 20;

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

    const padded = bounds.pad(0.10);
    const syncViewBounds = () => {
      const minZoom = map.getBoundsZoom(bounds, false);
      map.setMinZoom(minZoom - 3);
      map.setMaxBounds(padded);
      if (map.getZoom() < minZoom - 1.5) {
        map.setZoom(minZoom - 1.5);
      }
    };

    map.fitBounds(bounds, { animate: false, paddingTopLeft: [48, 0] });
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


// ImageBitmap cache: decoded once, drawImage is a GPU blit on revisit.
// All tiles for a standard DayZ map: pz 0–5 = 1+4+16+64+256+1024 = 1365.
// HTMLImageElement refs are tiny; actual pixel data lives in browser image cache.
const MAX_TILE_CACHE = 2000;
// Store HTMLImageElement so the browser's image memory cache is populated.
// ctx.drawImage() accepts HTMLImageElement directly — no ImageBitmap conversion needed.
const tileCache = new Map<string, HTMLImageElement>();
const tileInFlight = new Map<string, Promise<HTMLImageElement>>();

function setTileCache(url: string, img: HTMLImageElement) {
  if (tileCache.size >= MAX_TILE_CACHE) {
    const oldest = tileCache.keys().next().value!;
    tileCache.delete(oldest);
  }
  tileCache.set(url, img);
}

// zoomOffset = log2(imageWidth / 256).  For imageWidth=4096 → 4.
// maxNativeLeafletZoom = MAX_PZ - zoomOffset = 1.  Leaflet handles overzoom via CSS scale.
function DayZTileLayer({
  mapId, mapsDir, imageWidth, maxReadyLevelRef, onLayerReady,
}: {
  mapId: string;
  mapsDir: string;
  imageWidth: number;
  maxReadyLevelRef: React.RefObject<number>;
  onLayerReady: (layer: L.TileLayer) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const zo = Math.round(Math.log2(imageWidth / 256));
    const maxNative = 5 - zo;

    const MyTileLayer = L.TileLayer.extend({
      getTileUrl(coords: L.Coords) {
        // Only used as fallback; createTile handles all rendering.
        const pz = Math.max(0, Math.min(5, coords.z + zo));
        const maxTile = (1 << pz) - 1;
        if (coords.x < 0 || coords.y < 0 || coords.x > maxTile || coords.y > maxTile) {
          return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        return convertFileSrc(`${mapsDir}/${mapId}/tiles/${pz}/${coords.x}/${coords.y}.webp`);
      },

      createTile(coords: L.Coords, done: (err: Error | null, tile: HTMLElement) => void): HTMLElement {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;

        const maxReady  = Math.max(0, maxReadyLevelRef.current ?? 5);
        const naturalPz = Math.max(0, Math.min(5, coords.z + zo));
        // Clamp to highest ready level; shift coords into that level's space.
        const pz    = Math.min(naturalPz, maxReady);
        const shift = naturalPz - pz;          // levels we're downsampling by
        const tx    = coords.x >> shift;
        const ty    = coords.y >> shift;
        const maxTile = (1 << pz) - 1;

        if (tx < 0 || ty < 0 || tx > maxTile || ty > maxTile) {
          queueMicrotask(() => done(null, canvas));
          return canvas;
        }

        const url = convertFileSrc(`${mapsDir}/${mapId}/tiles/${pz}/${tx}/${ty}.webp`);

        const draw = (img: HTMLImageElement) => {
          const ctx = canvas.getContext('2d')!;
          if (shift > 0) {
            const tileCount = 1 << shift;
            const subX  = coords.x - (tx << shift);
            const subY  = coords.y - (ty << shift);
            const srcX  = (subX / tileCount) * 256;
            const srcY  = (subY / tileCount) * 256;
            const srcSz = 256 / tileCount;
            ctx.drawImage(img, srcX, srcY, srcSz, srcSz, 0, 0, 256, 256);
          } else {
            ctx.drawImage(img, 0, 0);
          }
        };

        const cached = tileCache.get(url);
        if (cached) {
          draw(cached);
          queueMicrotask(() => done(null, canvas));
          return canvas;
        }

        const inflight = tileInFlight.get(url);
        if (inflight) {
          inflight.then(img => { draw(img); done(null, canvas); })
                  .catch(err => done(err instanceof Error ? err : new Error(String(err)), canvas));
          return canvas;
        }

        // new Image() + decode() populates the browser's image memory cache.
        // Subsequent canvas re-creates for the same URL hit the browser cache instantly,
        // whereas fetch() → createImageBitmap() bypasses it entirely.
        const p = new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`tile load failed: ${url}`));
          img.src = url;
        });
        tileInFlight.set(url, p);
        p.then(img => { setTileCache(url, img); tileInFlight.delete(url); draw(img); done(null, canvas); })
         .catch(err => { tileInFlight.delete(url); done(err instanceof Error ? err : new Error(String(err)), canvas); });

        return canvas;
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = new (MyTileLayer as any)('', {
      tileSize: 256,
      noWrap: true,
      attribution: '',
      minZoom: -10,
      maxNativeZoom: maxNative,
      updateWhenZooming: false,
      keepBuffer: 6,
    }) as L.TileLayer;
    map.addLayer(layer);
    onLayerReady(layer);
    return () => { map.removeLayer(layer); };
  }, [map, mapId, mapsDir, imageWidth]);

  // Preload the low-zoom tile levels into browser image cache so Leaflet finds
  // them ready; deeper levels demand-load fine. pz<=3 is 85 tiles vs 1365 for
  // the full pyramid, which flooded the asset protocol on every map switch.
  useEffect(() => {
    const MAX_PZ = 3;
    const CONCURRENCY = 16;
    let cancelled = false;

    const queue: string[] = [];
    for (let pz = 0; pz <= MAX_PZ; pz++) {
      const count = 1 << pz;
      for (let x = 0; x < count; x++) {
        for (let y = 0; y < count; y++) {
          const url = convertFileSrc(`${mapsDir}/${mapId}/tiles/${pz}/${x}/${y}.webp`);
          if (!tileCache.has(url)) queue.push(url);
        }
      }
    }

    let active = 0;
    let idx = 0;

    const next = () => {
      while (!cancelled && active < CONCURRENCY && idx < queue.length) {
        const url = queue[idx++];
        active++;
        const img = new Image();
        img.onload  = () => { if (!cancelled) setTileCache(url, img); active--; next(); };
        img.onerror = () => { active--; next(); };
        img.src = url;
      }
    };

    next();
    return () => { cancelled = true; };
  }, [mapId, mapsDir]);
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
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
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

function TerritoryBitmapOverlays({ bounds, show }: { bounds: L.LatLngBoundsExpression; show: boolean }) {
  const territoryBitmaps = useServerStore(s => s.territoryBitmaps);
  const territoryBitmapSize = useServerStore(s => s.territoryBitmapSize);
  const ceToolLayers = useServerStore(s => s.ceToolLayers);
  const hiddenUsages = useUiStore(s => s.hiddenUsages);
  const hiddenTiers  = useUiStore(s => s.hiddenTiers);

  const overlays = useMemo(() => {
    if (!show || !territoryBitmapSize || territoryBitmaps.size === 0) return [];
    const { width, height } = territoryBitmapSize;
    const SCALE = 512 / Math.max(width, height);
    const outW = Math.round(width * SCALE);
    const outH = Math.round(height * SCALE);
    const step = Math.round(1 / SCALE);
    const results: { key: string; url: string }[] = [];
    const hiddenUsageSet = new Set(hiddenUsages.map(u => u.trim().toLowerCase()));

    for (const [layerName, pixels] of territoryBitmaps) {
      const meta = ceToolLayers.find(l => l.name === layerName);
      const usageName = meta?.usageName ?? layerName.replace(/^usgFlg_Paint-/i, '').replace(/^valueFlg_/i, '');
      const isTierLayer = (meta ? meta.valueFlags !== 0 : layerName.startsWith('valueFlg_')) && /^Tier\d+$/i.test(usageName);
      const isVisible = isTierLayer
        ? !hiddenTiers.includes(usageName)
        : !hiddenUsageSet.has(usageName.toLowerCase());
      if (!isVisible) continue;
      const rgb = hexToRgb(TIER_COLORS[usageName] ?? getUsageColor(usageName)) ?? { r: 255, g: 255, b: 255 };
      const { r, g, b } = rgb;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const imgData = ctx.createImageData(outW, outH);
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const srcX = Math.min(x * step, width - 1);
          const srcY = Math.min(y * step, height - 1);
          const active = pixels[(srcY * width + srcX) * 4] > 127;
          const i = (y * outW + x) * 4;
          imgData.data[i]     = active ? r : 0;
          imgData.data[i + 1] = active ? g : 0;
          imgData.data[i + 2] = active ? b : 0;
          imgData.data[i + 3] = active ? 160 : 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      results.push({ key: layerName, url: canvas.toDataURL() });
    }
    return results;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, territoryBitmaps, territoryBitmapSize, ceToolLayers, hiddenUsages, hiddenTiers]);

  if (!show) return null;
  return (
    <>
      {overlays.map(o => (
        <ImageOverlay key={o.key} url={o.url} bounds={bounds} opacity={1} />
      ))}
    </>
  );
}

function TerritoryPainter({ mapConfig, bitmapSize }: { mapConfig: MapConfig; bitmapSize: { width: number; height: number } }) {
  const map = useMap();
  const paintLayer      = useUiStore(s => s.territoryPaintLayer);
  const brushRadius     = useUiStore(s => s.territoryPaintBrushRadius);
  const erase           = useUiStore(s => s.territoryPaintErase);
  const ceToolLayers    = useServerStore(s => s.ceToolLayers);
  const territoryBitmaps = useServerStore(s => s.territoryBitmaps);
  const commitTerritoryPaint = useServerStore(s => s.commitTerritoryPaint);
  const undoTerritoryPaint = useServerStore(s => s.undoTerritoryPaint);

  // Refs to avoid stale closures in useMapEvent handlers (react-leaflet only re-registers on map change)
  const paintLayerRef      = useRef(paintLayer);
  const brushRadiusRef     = useRef(brushRadius);
  const eraseRef           = useRef(erase);
  const bitmapsRef         = useRef(territoryBitmaps);
  const ceToolLayersRef    = useRef(ceToolLayers);
  useEffect(() => { paintLayerRef.current = paintLayer; }, [paintLayer]);
  useEffect(() => { brushRadiusRef.current = brushRadius; }, [brushRadius]);
  useEffect(() => { eraseRef.current = erase; }, [erase]);
  useEffect(() => { bitmapsRef.current = territoryBitmaps; }, [territoryBitmaps]);
  useEffect(() => { ceToolLayersRef.current = ceToolLayers; }, [ceToolLayers]);

  const paintingRef      = useRef(false);
  const workingPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const strokeCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const cursorCanvasRef  = useRef<HTMLCanvasElement | null>(null);

  // Inject preview canvases directly into the map container
  useEffect(() => {
    const container = map.getContainer();
    const make = (z: string) => {
      const c = document.createElement('canvas');
      c.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${z}`;
      c.width = container.clientWidth;
      c.height = container.clientHeight;
      container.appendChild(c);
      return c;
    };
    const sc = make('450');
    const cc = make('451');
    strokeCanvasRef.current = sc;
    cursorCanvasRef.current = cc;
    const ro = new ResizeObserver(() => {
      sc.width = container.clientWidth; sc.height = container.clientHeight;
      cc.width = container.clientWidth; cc.height = container.clientHeight;
    });
    ro.observe(container);
    return () => { ro.disconnect(); sc.remove(); cc.remove(); };
  }, [map]);

  // Disable map drag + hide cursor while in paint mode
  useEffect(() => {
    map.dragging.disable();
    map.getContainer().style.cursor = 'none';
    return () => { map.dragging.enable(); map.getContainer().style.cursor = ''; };
  }, [map]);

  // Ctrl+Z undo
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undoTerritoryPaint(); }
    };
    document.addEventListener('keydown', h, { capture: true });
    return () => document.removeEventListener('keydown', h, { capture: true });
  }, [undoTerritoryPaint]);

  function getScreenRadius(latlng: L.LatLng): number {
    const r = brushRadiusRef.current;
    const cp = map.latLngToContainerPoint(latlng);
    const ep = map.latLngToContainerPoint(L.latLng(latlng.lat, latlng.lng + (r / bitmapSize.width) * mapConfig.imageWidth));
    return Math.max(2, Math.abs(ep.x - cp.x));
  }

  function getLayerRgb(): { r: number; g: number; b: number } {
    const layer = paintLayerRef.current;
    if (!layer) return { r: 255, g: 255, b: 255 };
    const meta = ceToolLayersRef.current.find(l => l.name === layer);
    const usage = meta?.usageName ?? layer.replace(/^usgFlg_Paint-/i, '').replace(/^valueFlg_/i, '');
    return hexToRgb(getUsageColor(usage)) ?? { r: 255, g: 255, b: 255 };
  }

  function drawCursor(latlng: L.LatLng) {
    const cc = cursorCanvasRef.current;
    if (!cc) return;
    const ctx = cc.getContext('2d')!;
    ctx.clearRect(0, 0, cc.width, cc.height);
    const pt = map.latLngToContainerPoint(latlng);
    const sr = getScreenRadius(latlng);
    const color = eraseRef.current ? 'rgba(255,100,100,0.9)' : 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, sr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2); ctx.fill();
  }

  function drawStroke(latlng: L.LatLng) {
    const sc = strokeCanvasRef.current;
    if (!sc) return;
    const ctx = sc.getContext('2d')!;
    const pt = map.latLngToContainerPoint(latlng);
    const sr = getScreenRadius(latlng);
    ctx.globalCompositeOperation = 'source-over';
    if (eraseRef.current) {
      ctx.fillStyle = 'rgba(220,50,50,0.45)';
    } else {
      const { r, g, b } = getLayerRgb();
      ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
    }
    ctx.beginPath(); ctx.arc(pt.x, pt.y, sr, 0, Math.PI * 2); ctx.fill();
  }

  function latlngToBitmapPx(latlng: L.LatLng) {
    return {
      bx: Math.round(latlng.lng / mapConfig.imageWidth * bitmapSize.width),
      by: Math.round(-latlng.lat / mapConfig.imageHeight * bitmapSize.height),
    };
  }

  function paintCircle(pixels: Uint8ClampedArray, bx: number, by: number) {
    const { width, height } = bitmapSize;
    const r = brushRadiusRef.current;
    const val = eraseRef.current ? 0 : 255;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = bx + dx; const py = by + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const idx = (py * width + px) * 4;
        pixels[idx] = val; pixels[idx + 1] = val; pixels[idx + 2] = val; pixels[idx + 3] = val > 0 ? 255 : 0;
      }
    }
  }

  useMapEvent('mousedown', (e) => {
    const layer = paintLayerRef.current;
    if (!layer) return;
    const src = bitmapsRef.current.get(layer);
    if (!src) return;
    paintingRef.current = true;
    workingPixelsRef.current = src.slice();
    const sc = strokeCanvasRef.current;
    if (sc) sc.getContext('2d')?.clearRect(0, 0, sc.width, sc.height);
    const { bx, by } = latlngToBitmapPx(e.latlng);
    paintCircle(workingPixelsRef.current, bx, by);
    drawStroke(e.latlng);
    drawCursor(e.latlng);
  });

  useMapEvent('mousemove', (e) => {
    drawCursor(e.latlng);
    if (!paintingRef.current || !workingPixelsRef.current) return;
    const { bx, by } = latlngToBitmapPx(e.latlng);
    paintCircle(workingPixelsRef.current, bx, by);
    drawStroke(e.latlng);
  });

  useMapEvent('mouseup', () => {
    if (!paintingRef.current || !workingPixelsRef.current) return;
    const layer = paintLayerRef.current;
    if (!layer) return;
    paintingRef.current = false;
    commitTerritoryPaint(layer, workingPixelsRef.current);
    workingPixelsRef.current = null;
    const sc = strokeCanvasRef.current;
    if (sc) sc.getContext('2d')?.clearRect(0, 0, sc.width, sc.height);
  });

  useMapEvent('mouseout', () => {
    const cc = cursorCanvasRef.current;
    if (cc) cc.getContext('2d')?.clearRect(0, 0, cc.width, cc.height);
  });

  return null;
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
  const ceToolLayers           = useServerStore(s => s.ceToolLayers);
  const territoryBitmapSize    = useServerStore(s => s.territoryBitmapSize);
  const mission                = useServerStore(s => s.mission);
  const canPaint               = useServerStore(s => !!s.paths.ceToolLayersDir);
  const addCeToolLayer         = useServerStore(s => s.addCeToolLayer);
  const removeCeToolLayer      = useServerStore(s => s.removeCeToolLayer);
  const missionPath            = useServerStore(s => s.paths.missionPath);
  const showTerritoryOverlay   = useUiStore(s => s.showTerritoryOverlay);
  const setShowTerritoryOverlay = useUiStore(s => s.setShowTerritoryOverlay);
  const territoryPaintMode     = useUiStore(s => s.territoryPaintMode);
  const setTerritoryPaintMode  = useUiStore(s => s.setTerritoryPaintMode);
  const territoryPaintLayer    = useUiStore(s => s.territoryPaintLayer);
  const setTerritoryPaintLayer = useUiStore(s => s.setTerritoryPaintLayer);
  const territoryPaintBrushRadius = useUiStore(s => s.territoryPaintBrushRadius);
  const setTerritoryPaintBrushRadius = useUiStore(s => s.setTerritoryPaintBrushRadius);
  const territoryPaintErase    = useUiStore(s => s.territoryPaintErase);
  const setTerritoryPaintErase = useUiStore(s => s.setTerritoryPaintErase);
  const paintableLayers = useMemo(() => ceToolLayers.filter(l => l.isPaintable), [ceToolLayers]);
  const editableLayers  = useMemo(() => ceToolLayers.filter(l => l.isPaintable && !/^usgFlg_Def-/i.test(l.name)), [ceToolLayers]);
  const [newLayerForm, setNewLayerForm]   = useState(false);
  const [newLayerName, setNewLayerName]   = useState('');
  const [overlaysReady, setOverlaysReady] = useState(false);

  // Clear selected paint layer + deactivate mode if layer was removed (e.g. undo/delete)
  useEffect(() => {
    if (territoryPaintLayer && !editableLayers.some(l => l.name === territoryPaintLayer)) {
      setTerritoryPaintLayer(null);
      setTerritoryPaintMode(false);
    }
  }, [editableLayers, territoryPaintLayer, setTerritoryPaintLayer, setTerritoryPaintMode]);
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

  const [tilesBaseDir, setTilesBaseDir]     = useState<string | null>(null);
  const [tilesNotBuilt, setTilesNotBuilt]   = useState(false);
  const [buildRequested, setBuildRequested] = useState<Set<string>>(new Set());
  const [downloading, setDownloading]       = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus]   = useState('');
  const [downloadError, setDownloadError]   = useState<string | null>(null);
  const [retryCount, setRetryCount]         = useState(0);
  const lastProgressRef  = useRef<number>(0);
  // maxReadyLevelRef: highest pyramid zoom level fully written to disk (-1 = none yet, 5 = all done)
  const maxReadyLevelRef = useRef<number>(5);
  // ref to the live TileLayer so we can call redraw() as new levels land
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [showEventList, setShowEventList]   = useState(false);
  const [showBuildingPanel, setShowBuildingPanel] = useState(false);
  const [showCeZones, setShowCeZones] = useState(false);
  const pickCeToolFolder = useServerStore(s => s.pickCeToolFolder);

  const bounds      = mapBounds(mapConfig);
  const isKnownMap  = tileMaps.has(activeMap);
  const isCustomMap = activeMap === 'custom';
  const hasImage    = !!mapConfig.imageUrl;
  // zoomOffset = log2(imageWidth/256). Native tile max leaflet zoom = MAX_PYRAMID_Z - zoomOffset.
  const zoomOffset     = Math.round(Math.log2(mapConfig.imageWidth / 256));
  // Native max = 5 - zoomOffset. Allow 3 overzoom levels on top.
  const maxLeafletZoom = isKnownMap ? (5 - zoomOffset + 3) : (communityMaxZoom[activeMap] ?? 4);

  // For known tile maps: check if tiles are ready, else ask user to build.
  useEffect(() => {
    if (!isMapActive || !isKnownMap) return;

    let cancelled = false;
    setTilesBaseDir(null);
    setTilesNotBuilt(false);
    setDownloadError(null);
    maxReadyLevelRef.current = -1;
    (async () => {
      const dir = await invoke<string | null>('get_tiles_base_dir', { mapId: activeMap });
      if (cancelled) return;
      if (dir) {
        maxReadyLevelRef.current = 5;
        setTilesBaseDir(dir);
        return;
      }

      if (!buildRequested.has(activeMap)) {
        setTilesNotBuilt(true);
        return;
      }

      // User confirmed — start extraction.
      setDownloading(true);
      setLoadingProgress(0);

      const unlisten = await listen<number>('tile-progress', e => {
        if (!cancelled) {
          const now = Date.now();
          if (now - lastProgressRef.current >= 150 || e.payload >= 1) {
            lastProgressRef.current = now;
            setLoadingProgress(e.payload);
          }
        }
      });
      const unlistenStatus = await listen<string>('tile-status', e => {
        if (!cancelled) {
          setLoadingStatus(e.payload);
        }
      });
      const unlistenLevel = await listen<{ mapId: string; level: number }>('tile-level-done', e => {
        if (cancelled || e.payload.mapId !== activeMap) return;
        maxReadyLevelRef.current = e.payload.level;
      });

      try {
        await invoke('extract_map_tiles', { mapId: activeMap });
        if (!cancelled) {
          const newDir = await invoke<string | null>('get_tiles_base_dir', { mapId: activeMap });
          if (!cancelled) {
            maxReadyLevelRef.current = 5;
            setTilesBaseDir(newDir);
          }
        }
      } catch (err) {
        if (!cancelled) setDownloadError(toMessage(err));
      } finally {
        unlisten();
        unlistenStatus();
        unlistenLevel();
        if (!cancelled) {
          setDownloading(false);
          setLoadingStatus('');
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, isMapActive, buildRequested, retryCount]);

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

  // ── Known map: tiles not ready yet ───────────────────────────────────────
  if (isKnownMap && !tilesBaseDir) {
    return (
      <div className="h-full flex flex-col">
        {tilesNotBuilt && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4 text-center space-y-3">
              <p className="text-slate-200 text-sm font-semibold">Map tiles not built</p>
              <p className="text-slate-500 text-xs">
                No tile data found for this map. Extract tiles from your local DayZ PBO file to view the satellite map.
              </p>
              <button
                onClick={() => setBuildRequested(s => new Set([...s, activeMap]))}
                className="w-full bg-lime-600 hover:bg-lime-500 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                Build tiles
              </button>
            </div>
          </div>
        )}
        {downloading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-950">
            <p className="text-slate-300 text-sm font-medium">Building map tiles…</p>
            <div className="w-64 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              {loadingProgress > 0 ? (
                <div
                  className="h-full bg-lime-500 rounded-full transition-[width] duration-150"
                  style={{ width: `${Math.round(loadingProgress * 100)}%` }}
                />
              ) : (
                <div className="h-full w-full bg-lime-500/30 rounded-full animate-pulse" />
              )}
            </div>
            <p className="text-slate-500 text-xs">
              {loadingProgress > 0 ? `${Math.round(loadingProgress * 100)}%` : 'Starting…'}
            </p>
            <p className="text-slate-600 text-xs max-w-xs text-center">
              {loadingStatus || 'Starting…'}
            </p>
          </div>
        )}
        {downloadError && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-slate-950">
            <div className="bg-red-950/40 border border-red-800/50 rounded-xl p-5 max-w-md mx-4 text-center space-y-2">
              <p className="text-red-400 text-sm font-medium">Tile build failed</p>
              <p className="text-slate-400 text-xs">{downloadError}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setDownloadError(null); setRetryCount(c => c + 1); }}
                className="px-4 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => setDownloadError(null)}
                className="px-4 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Dismiss
              </button>
            </div>
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
          maxBoundsViscosity={0.5}
          maxZoom={maxLeafletZoom}
          zoomAnimation
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


          {/* Tile pyramid for known maps; overview image for custom/fallback */}
          {isKnownMap && tilesBaseDir
            ? <DayZTileLayer
                mapId={activeMap}
                mapsDir={tilesBaseDir}
                imageWidth={mapConfig.imageWidth}
                maxReadyLevelRef={maxReadyLevelRef}
                onLayerReady={layer => { tileLayerRef.current = layer; }}
              />
            : hasImage && <OverviewOverlay mapConfig={mapConfig} bounds={bounds} />
          }


          {isMapActive && mapHeavyReady && initializedEventSignature === eventSignature && (
            <EventMarkers markers={markers} mapConfig={mapConfig} />
          )}
          {isMapActive && mapHeavyReady && overlaysReady && <BuildingMarkers mapConfig={mapConfig} />}
          {isMapActive && mapHeavyReady && overlaysReady && <PlayerSpawnMarkers mapConfig={mapConfig} />}
          {isMapActive && mapHeavyReady && overlaysReady && <CeToolZoneOverlays mapConfig={mapConfig} show={showCeZones} />}
          {isMapActive && mapHeavyReady && overlaysReady && <TerritoryBitmapOverlays bounds={bounds} show={showTerritoryOverlay} />}
          {isMapActive && mapHeavyReady && overlaysReady && territoryBitmapSize && territoryPaintMode && (
            <TerritoryPainter mapConfig={mapConfig} bitmapSize={territoryBitmapSize} />
          )}
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
        {ceToolProject && ceToolProject.territories.length > 0 && (
          <button
            onClick={() => setShowCeZones(v => !v)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showCeZones ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Spawn Territories
          </button>
        )}
        {paintableLayers.length > 0 && (
          <button
            onClick={() => setShowTerritoryOverlay(!showTerritoryOverlay)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${showTerritoryOverlay ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
          >
            Territory Zones
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

      {/* Territory paint toolbar */}
      {showTerritoryOverlay && editableLayers.length > 0 && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto flex flex-col items-center gap-2">
          {newLayerForm && !missionPath && (
            <div className="bg-amber-950/80 border border-amber-700 rounded-lg px-3 py-2 text-[11px] text-amber-300 max-w-sm text-center space-y-1">
              <p className="font-medium">No mission folder loaded</p>
              <p className="text-amber-400/80">
                The usage flag mapping can't be saved — load a mission folder first so cfglimitsdefinitionuser.xml can be written.
              </p>
            </div>
          )}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 shadow-xl">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">Layer:</span>
            <select
              value={territoryPaintLayer ?? ''}
              onChange={e => setTerritoryPaintLayer(e.target.value || null)}
              className="h-6 bg-slate-800 border border-slate-700 rounded px-1 text-[11px] text-slate-200 focus:outline-none focus:border-lime-500"
            >
              <option value="">— pick —</option>
              {editableLayers.map(layer => {
                const usageName = layer.usageName ?? layer.name.replace(/^usgFlg_Paint-/i, '').replace(/^valueFlg_/i, '');
                return <option key={layer.name} value={layer.name}>{usageName}</option>;
              })}
            </select>
            <div className="w-px h-4 bg-slate-700 mx-1" />
            <span className="text-[11px] text-slate-500">Brush:</span>
            {([15, 30, 60] as const).map(r => (
              <button
                key={r}
                onClick={() => setTerritoryPaintBrushRadius(r)}
                className={`h-6 w-6 rounded text-[11px] font-medium transition-colors ${territoryPaintBrushRadius === r ? 'bg-lime-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              >
                {r === 15 ? 'S' : r === 30 ? 'M' : 'L'}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={500}
              value={territoryPaintBrushRadius}
              onChange={e => {
                const v = Math.max(1, Math.min(500, Number(e.target.value) || 1));
                setTerritoryPaintBrushRadius(v);
              }}
              className="w-12 h-6 bg-slate-800 border border-slate-700 rounded px-1 text-[11px] text-slate-200 text-center focus:outline-none focus:border-lime-500"
            />
            <div className="w-px h-4 bg-slate-700 mx-1" />
            <button
              onClick={() => {
                if (territoryPaintMode && !territoryPaintErase) {
                  setTerritoryPaintMode(false);
                } else {
                  setTerritoryPaintErase(false);
                  setTerritoryPaintMode(true);
                  setShowTerritoryOverlay(true);
                }
              }}
              className={`h-6 px-2 rounded text-[11px] font-medium transition-colors ${territoryPaintMode && !territoryPaintErase ? 'bg-lime-500 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              disabled={!territoryPaintLayer || !canPaint}
              title={!canPaint ? 'Deploy CE files to mission to enable editing' : undefined}
            >
              Paint
            </button>
            <button
              onClick={() => {
                if (territoryPaintMode && territoryPaintErase) {
                  setTerritoryPaintMode(false);
                } else {
                  setTerritoryPaintErase(true);
                  setTerritoryPaintMode(true);
                  setShowTerritoryOverlay(true);
                }
              }}
              className={`h-6 px-2 rounded text-[11px] font-medium transition-colors ${territoryPaintMode && territoryPaintErase ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              disabled={!territoryPaintLayer || !canPaint}
              title={!canPaint ? 'Deploy CE files to mission to enable editing' : undefined}
            >
              Erase
            </button>
            {canPaint && territoryPaintLayer && !newLayerForm && (
              <>
                <div className="w-px h-4 bg-slate-700 mx-1" />
                <button
                  onClick={() => removeCeToolLayer(territoryPaintLayer)}
                  className="h-6 px-2 rounded text-[11px] font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-700 transition-colors"
                  title="Remove this layer"
                >
                  Delete Layer
                </button>
              </>
            )}
            {canPaint && !newLayerForm && (
              <>
                <div className="w-px h-4 bg-slate-700 mx-1" />
                <button
                  onClick={() => { setNewLayerForm(true); setNewLayerName(''); }}
                  className="h-6 px-2 rounded text-[11px] font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-lime-300 hover:border-lime-700 transition-colors"
                >
                  + New Layer
                </button>
              </>
            )}
            {canPaint && newLayerForm && (
              <>
                <div className="w-px h-4 bg-slate-700 mx-1" />
                <input
                  autoFocus
                  value={newLayerName}
                  onChange={e => setNewLayerName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const name = newLayerName.trim();
                      if (!name) return;
                      addCeToolLayer(name);
                      setTerritoryPaintLayer(`usgFlg_Paint-${name}`);
                      setNewLayerForm(false);
                    }
                    if (e.key === 'Escape') setNewLayerForm(false);
                  }}
                  placeholder="e.g. Endgame"
                  className="h-6 w-28 bg-slate-800 border border-lime-700 rounded px-1.5 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-lime-500"
                />
                <button
                  onClick={() => {
                    const name = newLayerName.trim();
                    if (!name) return;
                    addCeToolLayer(name);
                    setTerritoryPaintLayer(`usgFlg_Paint-${name}`);
                    setNewLayerForm(false);
                  }}
                  disabled={!newLayerName.trim()}
                  className="h-6 px-2 rounded text-[11px] font-medium bg-lime-600 hover:bg-lime-500 text-white transition-colors disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  onClick={() => setNewLayerForm(false)}
                  className="h-6 px-1.5 rounded text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
