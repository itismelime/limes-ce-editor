import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useCommunityMapsStore } from '../../store/communityMapsStore';
import { useServerStore } from '../../store/serverStore';
import type { CommunityMapDef } from '../../types/map';

// Well-known community maps that can be pre-filled from a lookup table.
const KNOWN_COMMUNITY_MAPS: Omit<CommunityMapDef, 'id'>[] = [
  { label: 'Deer Isle',       xamName: 'deerisle',        maxZoom: 7, worldWidth: 15360, worldHeight: 15360 },
  { label: 'Alteria',         xamName: 'alteria',         maxZoom: 7, worldWidth: 15360, worldHeight: 15360 },
  { label: 'Banov',           xamName: 'banov',           maxZoom: 7, worldWidth: 15360, worldHeight: 15360 },
  { label: 'Esseker',         xamName: 'esseker',         maxZoom: 7, worldWidth: 15360, worldHeight: 15360 },
  { label: 'Rostow',          xamName: 'rostow',          maxZoom: 6, worldWidth: 12800, worldHeight: 12800 },
  { label: 'Taiga',           xamName: 'taiga',           maxZoom: 7, worldWidth: 12800, worldHeight: 12800 },
  { label: 'Namalsk Origins', xamName: 'namalskorigins',  maxZoom: 6, worldWidth: 12800, worldHeight: 12800 },
  { label: 'Takistan',        xamName: 'takistan',        maxZoom: 7, worldWidth: 15360, worldHeight: 15360 },
];

// Maps with a known mpmission download source.
const MPMISSION_SOURCES: Record<string, { hasDownload: boolean; fallbackUrl: string }> = {
  deerisle:       { hasDownload: true,  fallbackUrl: 'https://github.com/johnmclane666/Deerisle-Stable' },
  alteria:        { hasDownload: true,  fallbackUrl: 'https://github.com/johnmclane666/DayZ-Alteria-Stable' },
  banov:          { hasDownload: true,  fallbackUrl: 'https://github.com/KubeloLive/Banov-Central-Economy' },
  esseker:        { hasDownload: true,  fallbackUrl: 'https://github.com/InclementDab/Esseker-Server' },
  namalskorigins: { hasDownload: true,  fallbackUrl: 'https://github.com/SumrakDZN/Namalsk-Server' },
  takistan:       { hasDownload: true,  fallbackUrl: 'https://github.com/CypeR79/DayZ-Projects/tree/main/TakistanPlus' },
  rostow:         { hasDownload: false, fallbackUrl: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2344585107' },
};

interface ProbeResult {
  valid: boolean;
  version: string;
  max_zoom: number;
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{children}</h2>;
}

export function CommunityMapsSection({ hideHeading, defaultShowAdd }: { hideHeading?: boolean; defaultShowAdd?: boolean } = {}) {
  const { maps, addMap, removeMap } = useCommunityMapsStore();
  const missionPath = useServerStore(s => s.paths.missionPath);

  const [xamName, setXamName]         = useState('');
  const [label, setLabel]             = useState('');
  const [worldWidth, setWorldWidth]   = useState(15360);
  const [worldHeight, setWorldHeight] = useState(15360);
  const [maxZoom, setMaxZoom]         = useState(7);
  const [pboPath, setPboPath]         = useState<string | undefined>(undefined);
  const [probing, setProbing]         = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [saving, setSaving]           = useState(false);
  const [showAdd, setShowAdd]         = useState(defaultShowAdd ?? false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [downloadStates, setDownloadStates] = useState<Record<string, 'downloading' | 'done' | string>>({});

  function fillFromPreset(xam: string) {
    const preset = KNOWN_COMMUNITY_MAPS.find(p => p.xamName === xam);
    if (preset) {
      setLabel(preset.label);
      setWorldWidth(preset.worldWidth);
      setWorldHeight(preset.worldHeight);
      setMaxZoom(preset.maxZoom);
    }
  }

  function handleXamNameChange(value: string) {
    setXamName(value);
    setProbeResult(null);
    setError(null);
    fillFromPreset(value.trim().toLowerCase());
  }

  function handlePresetSelect(preset: Omit<CommunityMapDef, 'id'>) {
    setXamName(preset.xamName);
    setLabel(preset.label);
    setWorldWidth(preset.worldWidth);
    setWorldHeight(preset.worldHeight);
    setMaxZoom(preset.maxZoom);
    setProbeResult(null);
    setError(null);
  }

  async function handleProbe() {
    const name = xamName.trim().toLowerCase();
    if (!name) return;
    setProbing(true);
    setProbeResult(null);
    setError(null);
    try {
      const result = await invoke<ProbeResult>('probe_community_map', { xamName: name });
      setProbeResult(result);
      if (result.valid) {
        setMaxZoom(result.max_zoom);
        if (!label) setLabel(KNOWN_COMMUNITY_MAPS.find(p => p.xamName === name)?.label ?? name);
      }
    } catch (err) {
      setError(`Probe failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProbing(false);
    }
  }

  async function handleBrowsePbo() {
    const selected = await openDialog({
      filters: [{ name: 'DayZ PBO', extensions: ['pbo'] }],
      multiple: false,
    });
    if (typeof selected === 'string') setPboPath(selected);
  }

  function handleEdit(cm: CommunityMapDef) {
    setEditingId(cm.id);
    setXamName(cm.xamName);
    setLabel(cm.label);
    setWorldWidth(cm.worldWidth);
    setWorldHeight(cm.worldHeight);
    setMaxZoom(cm.maxZoom);
    setPboPath(cm.pboPath);
    setProbeResult(null);
    setError(null);
    setShowAdd(true);
  }

  async function handleAdd() {
    const name = xamName.trim().toLowerCase();
    if (!name || !label.trim()) return;
    const clampedWidth  = Math.min(100000, Math.max(100, worldWidth));
    const clampedHeight = Math.min(100000, Math.max(100, worldHeight));
    setSaving(true);
    setError(null);
    try {
      const def: CommunityMapDef = {
        id: editingId ?? slugify(name || label),
        label: label.trim(),
        xamName: name,
        maxZoom,
        worldWidth: clampedWidth,
        worldHeight: clampedHeight,
        pboPath: pboPath || undefined,
      };
      await addMap(def);
      setXamName('');
      setLabel('');
      setWorldWidth(15360);
      setWorldHeight(15360);
      setMaxZoom(7);
      setPboPath(undefined);
      setProbeResult(null);
      setEditingId(null);
      setShowAdd(false);
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string, mapLabel: string) {
    if (!window.confirm(`Remove community map "${mapLabel}"? Cached tiles are kept on disk.`)) return;
    await removeMap(id);
  }

  // Valid if either a xam.nu name or a PBO path is provided, plus a display name.
  const canAdd = (!!xamName.trim() || !!pboPath) && !!label.trim() && worldWidth > 0 && worldHeight > 0;

  async function handleDownload(cm: CommunityMapDef) {
    if (!missionPath) return;
    setDownloadStates(s => ({ ...s, [cm.id]: 'downloading' }));
    try {
      await invoke('download_mpmission', { xamName: cm.xamName, missionPath });
      setDownloadStates(s => ({ ...s, [cm.id]: 'done' }));
    } catch (err) {
      setDownloadStates(s => ({ ...s, [cm.id]: err instanceof Error ? err.message : String(err) }));
    }
  }

  return (
    <section>
      {!hideHeading && <SectionHeading>Community Maps</SectionHeading>}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-4">
        <p className="text-xs text-slate-500 mb-4">
          Add community maps to the map selector. Map tiles are fetched from xam.nu, and mpmission files can be downloaded from the mod's GitHub repository.
        </p>

        {maps.length > 0 && (
          <div className="space-y-2 mb-4">
            {maps.map(cm => {
              const src = MPMISSION_SOURCES[cm.xamName];
              const dlState = downloadStates[cm.id];
              return (
              <div key={cm.id} className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{cm.label}</p>
                    <p className="text-xs text-slate-500 font-mono">{cm.xamName} · zoom max {cm.maxZoom} · {cm.worldWidth}×{cm.worldHeight}m</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleEdit(cm)}
                      className="px-2.5 py-1 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleRemove(cm.id, cm.label)}
                      className="px-2.5 py-1 rounded-lg text-xs bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/60 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {src && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {src.hasDownload && (
                      <button
                        onClick={() => void handleDownload(cm)}
                        disabled={!missionPath || dlState === 'downloading' || dlState === 'done'}
                        title={!missionPath ? 'Open a server folder first' : undefined}
                        className="px-2.5 py-1 rounded-lg text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-slate-100 border border-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {dlState === 'downloading' && <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />}
                        {dlState === 'downloading' ? 'Downloading…' : dlState === 'done' ? '✓ Downloaded' : '↓ Download mpmission'}
                      </button>
                    )}
                    <button
                      onClick={() => void openUrl(src.fallbackUrl)}
                      className="px-2.5 py-1 rounded-lg text-xs bg-transparent hover:bg-slate-700 text-slate-500 hover:text-slate-300 border border-slate-700 transition-colors flex items-center gap-1"
                    >
                      {src.hasDownload ? 'Manual link ↗' : 'Steam Workshop ↗'}
                    </button>
                    {dlState && dlState !== 'downloading' && dlState !== 'done' && (
                      <p className="text-xs text-red-400 w-full">{dlState}</p>
                    )}
                  </div>
                )}
              </div>
            );
            })}
          </div>
        )}

        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors"
          >
            + Add map
          </button>
        ) : (
          <div className="border border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-medium text-slate-300">{editingId ? 'Edit community map' : 'Add community map'}</p>

            {/* Quick-select presets */}
            <div>
              <p className="text-[11px] text-slate-500 mb-1.5">Quick-select a known map:</p>
              <div className="flex flex-wrap gap-1.5">
                {KNOWN_COMMUNITY_MAPS.map(p => (
                  <button
                    key={p.xamName}
                    onClick={() => handlePresetSelect(p)}
                    className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                      xamName === p.xamName
                        ? 'bg-lime-500 border-lime-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* xam.nu name + probe */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-slate-500 mb-1">xam.nu map name</label>
                <input
                  value={xamName}
                  onChange={e => handleXamNameChange(e.target.value)}
                  placeholder="e.g. deerisle"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-lime-500 font-mono"
                />
                <p className="text-[10px] text-slate-600 mt-1">Found in the URL: xam.nu/map/<span className="text-slate-500 font-mono">name</span>/…</p>
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleProbe}
                  disabled={!xamName.trim() || probing}
                  className="h-8 px-3 rounded-lg text-xs border transition-colors border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {probing ? 'Probing…' : 'Probe'}
                </button>
              </div>
            </div>

            {probeResult && (
              <p className={`text-xs ${probeResult.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                {probeResult.valid
                  ? `✓ Found on xam.nu (${probeResult.version}) · max zoom ${probeResult.max_zoom}`
                  : '✗ Not found on xam.nu — check the map name'}
              </p>
            )}

            {/* PBO path for offline satellite tile extraction */}
            <div>
              <p className="text-[11px] text-slate-500 mb-1">
                Satellite tiles from PBO <span className="text-slate-600">(optional — for maps not on xam.nu)</span>
              </p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => void handleBrowsePbo()}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 transition-colors flex-shrink-0"
                >
                  Browse PBO…
                </button>
                {pboPath ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-emerald-400 font-mono truncate">{pboPath.split(/[\\/]/).pop()}</span>
                    <button onClick={() => setPboPath(undefined)} className="text-slate-500 hover:text-slate-300 flex-shrink-0">✕</button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600">No PBO selected</span>
                )}
              </div>
              {pboPath && (
                <p className="text-[10px] text-slate-600 mt-1">
                  Tiles extracted on first map load (~2 min). Cached afterward.
                </p>
              )}
            </div>

            {/* Display name */}
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Display name</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Deer Isle"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-lime-500"
              />
            </div>

            {/* World dimensions + max zoom */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">World width (m)</label>
                <input
                  type="number"
                  min={100}
                  max={100000}
                  value={worldWidth}
                  onChange={e => setWorldWidth(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-lime-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">World height (m)</label>
                <input
                  type="number"
                  min={100}
                  max={100000}
                  value={worldHeight}
                  onChange={e => setWorldHeight(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-lime-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Max zoom (4–10)</label>
                <input
                  type="number"
                  min={4}
                  max={10}
                  value={maxZoom}
                  onChange={e => setMaxZoom(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-lime-500"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAdd}
                disabled={!canAdd || saving}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-lime-500 hover:bg-lime-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add map'}
              </button>
              <button
                onClick={() => { setShowAdd(false); setEditingId(null); setError(null); setProbeResult(null); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
