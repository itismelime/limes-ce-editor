import { Marker, Popup, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { gameToLeaflet, leafletToGame } from '../../lib/coordinateTransform';
import type { MapConfig } from '../../types/map';

const FF_MARKER_SIZE = 20;
const FF_COLOR = '#a855f7'; // distinct from vanilla spawn colors (emerald/amber)

function ffSpawnPointIcon(selected: boolean): L.DivIcon {
  const size = FF_MARKER_SIZE;
  const c = size / 2;
  const color = selected ? '#e9d5ff' : FF_COLOR;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="9" fill="#1e0b2e" stroke="${color}" stroke-width="${selected ? 2.6 : 1.8}"/>
    <path d="M${c} 5.5 L${c + 4} ${c + 2} L${c} ${c + 6.5} L${c - 4} ${c + 2} Z" fill="${color}"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [c, c],
    popupAnchor: [0, -c],
  });
}

// FF_SpawnSelector overrides where players actually spawn, so when it's
// present its points are the only spawn markers shown on the map (vanilla
// PlayerSpawnMarkers hides itself via the same ffSpawnPoints !== null check).
// Point counts are small (tens, not thousands), so unlike EventMarkers this
// skips viewport culling and clustering.
export function FFSpawnPointMarkers({ mapConfig }: { mapConfig: MapConfig }) {
  const ffSpawnPoints = useServerStore(s => s.ffSpawnPoints);
  const updateFfSpawnPoints = useServerStore(s => s.updateFfSpawnPoints);
  const selected = useUiStore(s => s.selectedFFSpawnPointName);
  const setSelected = useUiStore(s => s.setSelectedFFSpawnPoint);

  if (!ffSpawnPoints) return null;

  return (
    <>
      {ffSpawnPoints.spawnPoints.map((p, idx) => (
        <Marker
          key={`${p.name}-${idx}`}
          position={gameToLeaflet(p.x, p.z, mapConfig)}
          icon={ffSpawnPointIcon(selected === p.name)}
          draggable
          eventHandlers={{
            click: () => setSelected(selected === p.name ? null : p.name),
            dragend: (e) => {
              const marker = e.target as L.Marker;
              const { lat, lng } = marker.getLatLng();
              const [x, z] = leafletToGame(lat, lng, mapConfig);
              updateFfSpawnPoints({
                ...ffSpawnPoints,
                spawnPoints: ffSpawnPoints.spawnPoints.map((pt, i) => i === idx ? { ...pt, x, z } : pt),
              });
            },
          }}
        >
          <Popup autoPan={false}>
            <div className="text-xs">
              <p className="font-semibold text-slate-100 mb-1">{p.name}</p>
              <p className="font-mono text-slate-400">X {p.x.toFixed(1)} · Z {p.z.toFixed(1)}</p>
              {p.enabled === 0 && <p className="text-slate-500 mt-1">Disabled</p>}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

// Click-to-add: armed via the "+ Add on Map" toggle, places one point at the
// click location, then disarms itself (one-shot -- avoids accidentally
// scattering points while panning around afterward).
export function FFSpawnPointAddClickHandler({ mapConfig }: { mapConfig: MapConfig }) {
  const addMode = useUiStore(s => s.ffSpawnPointAddMode);
  const setAddMode = useUiStore(s => s.setFfSpawnPointAddMode);
  const setSelected = useUiStore(s => s.setSelectedFFSpawnPoint);
  const ffSpawnPoints = useServerStore(s => s.ffSpawnPoints);
  const updateFfSpawnPoints = useServerStore(s => s.updateFfSpawnPoints);

  useMapEvent('click', (e) => {
    if (!addMode || !ffSpawnPoints) return;
    const [x, z] = leafletToGame(e.latlng.lat, e.latlng.lng, mapConfig);
    const existingNames = new Set(ffSpawnPoints.spawnPoints.map(p => p.name));
    let n = ffSpawnPoints.spawnPoints.length + 1;
    let name = `New Point ${n}`;
    while (existingNames.has(name)) { n += 1; name = `New Point ${n}`; }
    updateFfSpawnPoints({
      ...ffSpawnPoints,
      spawnPoints: [...ffSpawnPoints.spawnPoints, { version: 0, name, x, y: 0, z, enabled: 1 }],
    });
    setSelected(name);
    setAddMode(false);
  });

  return null;
}
