import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useCommunityMapsStore } from '../../store/communityMapsStore';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import type { CommunityMapDef } from '../../types/map';
import { SectionHeading } from '../shared/ui';
import { toMessage } from '../../store/serverStore';
import { basename } from '../../lib/fileDiscovery';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function CommunityMapsSection({ hideHeading, defaultShowAdd }: { hideHeading?: boolean; defaultShowAdd?: boolean } = {}) {
  const { maps, addMap, removeMap } = useCommunityMapsStore();
  const reloadTerritoryBitmaps = useServerStore(s => s.reloadTerritoryBitmaps);
  const activeMap = useUiStore(s => s.activeMap);

  const [label, setLabel]             = useState('');
  const [worldWidth, setWorldWidth]   = useState(15360);
  const [worldHeight, setWorldHeight] = useState(15360);
  const [maxZoom, setMaxZoom]         = useState(7);
  const [pboPath, setPboPath]         = useState<string | undefined>(undefined);
  const [ceToolProjectPath, setCeToolProjectPath] = useState<string | null>(null);
  const [importingCe, setImportingCe] = useState(false);
  const [scanningPbo, setScanningPbo] = useState(false);
  const [detectingSize, setDetectingSize] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [showAdd, setShowAdd]         = useState(defaultShowAdd ?? false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  async function applyPboPath(path: string) {
    setPboPath(path);
    setDetectingSize(true);
    try {
      const size = await invoke<number>('read_pbo_world_size', { pboPath: path });
      if (size > 0) {
        setWorldWidth(size);
        setWorldHeight(size);
      }
    } catch {
      // detection failed — leave current values, user can edit manually
    } finally {
      setDetectingSize(false);
    }
  }

  async function handleBrowsePbo() {
    const selected = await openDialog({
      filters: [{ name: 'DayZ PBO', extensions: ['pbo'] }],
      multiple: false,
    });
    if (typeof selected === 'string') await applyPboPath(selected);
  }

  async function handleBrowseCeFolder(mapId: string) {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== 'string') return;
    setImportingCe(true);
    setError(null);
    try {
      const xmlPath = await invoke<string>('copy_ce_project', { sourceDir: selected, mapId });
      setCeToolProjectPath(xmlPath);
    } catch (e) {
      setError(`CE import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportingCe(false);
    }
  }

  async function handleBrowseModFolder() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== 'string') return;
    setScanningPbo(true);
    setError(null);
    try {
      const found = await invoke<string | null>('find_map_pbo', { folder: selected });
      if (found) {
        await applyPboPath(found);
      } else {
        setError('No *_data.pbo found in that folder. Try browsing directly to the .pbo file.');
      }
    } catch (e) {
      setError(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanningPbo(false);
    }
  }

  function handleEdit(cm: CommunityMapDef) {
    setEditingId(cm.id);
    setLabel(cm.label);
    setWorldWidth(cm.worldWidth);
    setWorldHeight(cm.worldHeight);
    setMaxZoom(cm.maxZoom);
    setPboPath(cm.pboPath);
    setCeToolProjectPath(cm.ceToolProjectPath ?? null);
    setError(null);
    setShowAdd(true);
  }

  function resetForm() {
    setLabel('');
    setWorldWidth(15360);
    setWorldHeight(15360);
    setMaxZoom(7);
    setPboPath(undefined);
    setCeToolProjectPath(null);
    setEditingId(null);
    setError(null);
    setShowAdd(false);
  }

  async function handleAdd() {
    if (!label.trim()) return;
    const clampedWidth  = Math.min(100000, Math.max(100, worldWidth));
    const clampedHeight = Math.min(100000, Math.max(100, worldHeight));
    setSaving(true);
    setError(null);
    try {
      const mapId = editingId ?? slugify(label);
      const def: CommunityMapDef = {
        id: mapId,
        label: label.trim(),
        maxZoom,
        worldWidth: clampedWidth,
        worldHeight: clampedHeight,
        pboPath: pboPath || undefined,
        ceToolProjectPath: ceToolProjectPath || null,
      };
      await addMap(def);
      if (ceToolProjectPath && activeMap === mapId) {
        await reloadTerritoryBitmaps?.();
      }
      resetForm();
    } catch (err) {
      setError(`Save failed: ${toMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string, _mapLabel: string) {
    await removeMap(id);
  }

  const canAdd = !!label.trim();

  return (
    <section>
      {!hideHeading && <SectionHeading>Community Maps</SectionHeading>}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-4">
        <p className="text-xs text-slate-500 mb-4">
          Add community maps. Satellite tiles are extracted from the mod's PBO file on first load.
        </p>

        {maps.length > 0 && (
          <div className="space-y-2 mb-4">
            {maps.map(cm => (
              <div key={cm.id} className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{cm.label}</p>
                    <p className="text-xs text-slate-500 font-mono">
                      {cm.id} · zoom max {cm.maxZoom} · {cm.worldWidth}×{cm.worldHeight}m
                      {cm.pboPath && <span className="text-emerald-600"> · PBO</span>}
                      {cm.ceToolProjectPath && <span className="text-lime-600"> · CE zones</span>}
                    </p>
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
              </div>
            ))}
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

            <div className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-[11px] text-slate-400 space-y-1">
              <p className="font-medium text-slate-300">How to get a community map</p>
              <p>1. Subscribe to the map mod on Steam Workshop.</p>
              <p>2. Let Steam download it (appears in your library).</p>
              <p>3. Click <span className="text-slate-200">Browse mod folder…</span> and select the mod folder from <span className="font-mono text-slate-300">steamapps/workshop/content/221100/</span></p>
              <p>4. The PBO and world size are detected automatically.</p>
            </div>

            {/* Display name */}
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Display name</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Esseker"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-lime-500"
              />
            </div>

            {detectingSize && (
              <p className="text-[11px] text-lime-500">Detecting world size from PBO…</p>
            )}

            {/* PBO path */}
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Satellite tiles PBO</p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => void handleBrowseModFolder()}
                  disabled={scanningPbo}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-lime-700 text-lime-400 hover:border-lime-500 hover:text-lime-200 transition-colors flex-shrink-0 disabled:opacity-40"
                >
                  {scanningPbo ? 'Scanning…' : 'Browse mod folder…'}
                </button>
                <button
                  onClick={() => void handleBrowsePbo()}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors flex-shrink-0"
                >
                  Browse .pbo…
                </button>
                {pboPath ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-emerald-400 font-mono truncate">{basename(pboPath)}</span>
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

            {/* CE Tool project */}
            <div>
              <p className="text-[11px] text-slate-500 mb-1">Territory zones (CE Tool project)</p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => void handleBrowseCeFolder((editingId ?? slugify(label)) || 'custom')}
                  disabled={importingCe}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-lime-700 text-lime-400 hover:border-lime-500 hover:text-lime-200 transition-colors flex-shrink-0 disabled:opacity-40"
                >
                  {importingCe ? 'Importing…' : 'Browse CE folder…'}
                </button>
                {ceToolProjectPath ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-lime-400 truncate">Configured</span>
                    <button onClick={() => setCeToolProjectPath(null)} className="text-slate-500 hover:text-slate-300 flex-shrink-0">✕</button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600">None</span>
                )}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">
                Select the CE Tool project folder (containing the .xml + layers/ subfolder). Files are copied to app data.
              </p>
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
                onClick={resetForm}
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
