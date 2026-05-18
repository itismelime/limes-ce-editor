import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';

import { readFile, writeFile, clearCeToolCaches } from '../../lib/fileDiscovery';
import { CATEGORY_OPTIONS } from '../../lib/itemClassifier';
import { BUNDLED_CE_MAPS, deployBundledCeProject } from '../../lib/ceToolBundle';
import { CommunityMapsSection } from './CommunityMapsSection';

const KNOWN_MAPS: { id: string; label: string }[] = [
  { id: 'namalsk',   label: 'Namalsk' },
  { id: 'chernarus', label: 'Chernarus+' },
  { id: 'livonia',   label: 'Livonia' },
  { id: 'sakhal',    label: 'Sakhal' },
];

const THEME_OPTIONS: { id: 'dark' | 'light'; label: string; note: string }[] = [
  { id: 'dark', label: 'Dark (default)', note: 'Low-glare look for long sessions and night editing.' },
  { id: 'light', label: 'Light', note: 'High-contrast daytime look with brighter surfaces.' },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{children}</h2>;
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-8 py-4 border-b border-slate-800 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function PathDisplay({ path }: { path: string | null }) {
  if (!path) return <span className="text-xs text-slate-500 italic">Not set</span>;
  const parts = path.replace(/\\/g, '/').split('/');
  const short = parts.slice(-2).join('/');
  return (
    <span className="text-xs text-slate-400 font-mono truncate max-w-[220px]" title={path}>
      …/{short}
    </span>
  );
}

export function SettingsEditor() {
  // Server folder
  const serverRootPath        = useServerStore(s => s.serverRootPath);
  const openServerFolder      = useServerStore(s => s.openServerFolder);
  const rememberLastFolder    = useUiStore(s => s.rememberLastFolder);
  const setRememberLastFolder = useUiStore(s => s.setRememberLastFolder);
  const theme = useUiStore(s => s.theme);
  const setTheme = useUiStore(s => s.setTheme);
  const settingsScrollTarget = useUiStore(s => s.settingsScrollTarget);
  const setSettingsScrollTarget = useUiStore(s => s.setSettingsScrollTarget);
  const communityMapsSectionRef = useRef<HTMLDivElement>(null);

  // CE Tool
  const ceToolFolderOverride    = useServerStore(s => s.ceToolFolderOverride);
  const setCeToolFolderOverride = useServerStore(s => s.setCeToolFolderOverride);
  const pickCeToolFolder        = useServerStore(s => s.pickCeToolFolder);
  const ceSources               = useServerStore(s => s.ceSources);
  const setCeSource             = useServerStore(s => s.setCeSource);
  const reloadCeToolData           = useServerStore(s => s.reloadCeToolData);
  const reloadTerritoryBitmaps     = useServerStore(s => s.reloadTerritoryBitmaps);
  const missionPath             = useServerStore(s => s.paths.missionPath);
  const activeMap               = useUiStore(s => s.activeMap);
  const [deployingMap, setDeployingMap] = useState<string | null>(null);

  // Map image cache
  const mapImagePaths        = useUiStore(s => s.mapImagePaths);
  const clearAllMapImagePaths = useUiStore(s => s.clearAllMapImagePaths);
  const imagePathCount       = Object.keys(mapImagePaths).length;
  const [clearingTiles, setClearingTiles] = useState(false);
  const [tilesClearState, setTilesClearState] = useState<'idle' | 'done' | 'error'>('idle');
  const [tilesClearError, setTilesClearError] = useState<string | null>(null);

  async function handleClearAllTiles() {
    setClearingTiles(true);
    setTilesClearState('idle');
    setTilesClearError(null);
    try {
      await invoke('clear_all_map_tiles');
      setTilesClearState('done');
      setTimeout(() => setTilesClearState('idle'), 3000);
    } catch (err) {
      setTilesClearError(err instanceof Error ? err.message : String(err));
      setTilesClearState('error');
    } finally {
      setClearingTiles(false);
    }
  }

  // Cluster zoom
  const clusterZoom    = useUiStore(s => s.mapClusterZoomThreshold);
  const setClusterZoom = useUiStore(s => s.setMapClusterZoomThreshold);

  // Category overrides
  const categoryOverrides     = useUiStore(s => s.categoryOverrides);
  const importCategoryOverrides = useUiStore(s => s.importCategoryOverrides);
  const clearCategoryOverrides  = useUiStore(s => s.clearCategoryOverrides);
  const overrideCount = Object.keys(categoryOverrides).length;

  useEffect(() => {
    if (settingsScrollTarget === 'community-maps' && communityMapsSectionRef.current) {
      communityMapsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setSettingsScrollTarget(null);
    }
  }, [settingsScrollTarget, setSettingsScrollTarget]);

  async function handleImportOverrides() {
    const selected = await open({
      multiple: false,
      title: 'Select category override JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    try {
      const raw = await readFile(selected);
      const parsed = JSON.parse(raw) as { overrides?: Record<string, string> } | Record<string, string>;
      const source = 'overrides' in parsed && parsed.overrides ? parsed.overrides : parsed;
      const allowed = new Set(CATEGORY_OPTIONS);
      const normalized: Record<string, string> = {};
      for (const [name, category] of Object.entries(source)) {
        if (typeof category !== 'string') continue;
        if (!allowed.has(category)) continue;
        normalized[name.toLowerCase()] = category;
      }
      importCategoryOverrides(normalized);
      useServerStore.setState({ saveError: null });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to import category overrides: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleExportOverrides() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: 'Choose folder for override export',
    });
    if (!folder || typeof folder !== 'string') return;
    const payload = { version: 1, exportedAt: new Date().toISOString(), overrides: categoryOverrides };
    try {
      await writeFile(`${folder}/looteditor-category-overrides.json`, JSON.stringify(payload, null, 2));
      useServerStore.setState({ saveError: null });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to export category overrides: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function handleClearOverrides() {
    if (overrideCount === 0) return;
    clearCategoryOverrides();
  }

  async function handleDeploy(mapId: string) {
    if (!missionPath) return;
    const entry = BUNDLED_CE_MAPS[mapId];
    if (!entry) return;
    setDeployingMap(mapId);
    try {
      await deployBundledCeProject(mapId, missionPath);
      clearCeToolCaches();
      setCeSource(mapId, 'user');
      if (activeMap === mapId) {
        await reloadCeToolData?.();
        await reloadTerritoryBitmaps?.();
      }
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to deploy CE project for ${entry.label}: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setDeployingMap(null);
    }
  }


  return (
    <div className="h-full overflow-y-auto bg-slate-950">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">
        <div>
          <h1 className="text-lg font-semibold text-slate-100 mb-1">Settings</h1>
          <p className="text-xs text-slate-500">Editor preferences. These settings are stored locally and do not affect your server files.</p>
        </div>

        {/* Appearance */}
        <section>
          <SectionHeading>Appearance</SectionHeading>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">
            <SettingRow
              title="Theme"
              description="Choose how the editor looks. Theme changes apply instantly and are saved locally."
            >
              <div className="flex flex-col gap-1 items-end">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-800 border border-slate-700">
                  {THEME_OPTIONS.map(option => (
                    <button
                      key={option.id}
                      onClick={() => setTheme(option.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${theme === option.id
                        ? 'bg-lime-500 text-white'
                        : 'text-slate-300 hover:bg-slate-700'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 text-right max-w-[280px]">
                  {THEME_OPTIONS.find(option => option.id === theme)?.note}
                </p>
              </div>
            </SettingRow>
          </div>
        </section>

        {/* Server files */}
        <section>
          <SectionHeading>Server Files</SectionHeading>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">
            <SettingRow
              title="Server folder"
              description="The root server directory currently loaded. Contains your mission folder, profile, and config files."
            >
              <PathDisplay path={serverRootPath} />
              <button
                onClick={() => openServerFolder?.()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors"
              >
                Change…
              </button>
            </SettingRow>
            <SettingRow
              title="Remember last folder"
              description="Automatically reopen the most recent server folder on startup. When off, you will always see the folder picker on launch."
            >
              <button
                onClick={() => setRememberLastFolder(!rememberLastFolder)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${rememberLastFolder ? 'bg-lime-500' : 'bg-slate-700'}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${rememberLastFolder ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
                />
              </button>
            </SettingRow>
          </div>
        </section>

        {/* CE Tool */}
        <section>
          <SectionHeading>CE Tool Integration</SectionHeading>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">

            {Object.entries(BUNDLED_CE_MAPS).map(([mapId, entry]) => {
              const source = ceSources[mapId] ?? null;
              const isDeploying = deployingMap === mapId;
              return (
                <SettingRow
                  key={mapId}
                  title={entry.label}
                  description={
                    source === 'user'
                      ? 'CE project files found in your mission folder. Edits you make there will be read automatically on reload.'
                      : source === 'bundled'
                      ? 'Using bundled default zone data. Deploy to your mission folder to start customizing.'
                      : 'Status unknown — load this map to check.'
                  }
                >
                  <span className={`text-xs ${source === 'user' ? 'text-emerald-400' : source === 'bundled' ? 'text-slate-500' : 'text-slate-600'}`}>
                    {source === 'user' ? 'Custom' : source === 'bundled' ? 'Bundled' : '—'}
                  </span>
                  <button
                    onClick={() => void handleDeploy(mapId)}
                    disabled={isDeploying || !missionPath}
                    title={!missionPath ? 'Load a server folder first' : undefined}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isDeploying ? 'Deploying…' : 'Deploy to mission'}
                  </button>
                </SettingRow>
              );
            })}

            <SettingRow
              title="Project XML override"
              description="Manually point to a CE Tool project file. Overrides auto-detection for all maps. Use this for custom maps or non-standard project locations."
            >
              <PathDisplay path={ceToolFolderOverride} />
              <button
                onClick={() => pickCeToolFolder?.()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors"
              >
                Browse…
              </button>
              {ceToolFolderOverride && (
                <button
                  onClick={() => setCeToolFolderOverride(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/60 transition-colors"
                >
                  Clear
                </button>
              )}
            </SettingRow>

          </div>
        </section>

        {/* Cache */}
        <section>
          <SectionHeading>Cache</SectionHeading>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">
            <SettingRow
              title="Overview images"
              description={imagePathCount > 0
                ? `${imagePathCount} map overview image${imagePathCount !== 1 ? 's' : ''} cached locally. Clear to re-download next time those maps are opened.`
                : 'No overview images cached.'}
            >
              <span className={`text-xs ${imagePathCount > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                {imagePathCount > 0 ? `${imagePathCount} cached` : 'Empty'}
              </span>
              <button
                onClick={clearAllMapImagePaths}
                disabled={imagePathCount === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </SettingRow>
            <SettingRow
              title="Tile data (AppData)"
              description={tilesClearState === 'error'
                ? `Error: ${tilesClearError}`
                : 'Satellite tile pyramids extracted from PBO files. Stored in AppData. Clear to force re-extraction next time a map is opened.'}
            >
              {tilesClearState === 'done' && (
                <span className="text-xs text-emerald-400">Cleared</span>
              )}
              <button
                onClick={() => void handleClearAllTiles()}
                disabled={clearingTiles}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {clearingTiles ? 'Clearing…' : 'Clear'}
              </button>
            </SettingRow>
          </div>
        </section>

        {/* Map display */}
        <section>
          <SectionHeading>Map Display</SectionHeading>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">
            <SettingRow
              title="Cluster zoom threshold"
              description="Markers are grouped into clusters when the map zoom is at or below this value. Increase to keep clusters at higher zoom levels, decrease to show individual markers sooner."
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setClusterZoom(clusterZoom - 1)}
                  className="w-7 h-7 bg-slate-800 border border-slate-700 rounded-md text-slate-200 hover:border-slate-500 text-sm"
                >−</button>
                <span className="w-6 text-center text-sm text-slate-200">{clusterZoom}</span>
                <button
                  onClick={() => setClusterZoom(clusterZoom + 1)}
                  className="w-7 h-7 bg-slate-800 border border-slate-700 rounded-md text-slate-200 hover:border-slate-500 text-sm"
                >+</button>
              </div>
            </SettingRow>
          </div>
        </section>

        {/* Category mappings */}
        <section>
          <SectionHeading>Category Mappings</SectionHeading>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">
            <SettingRow
              title="Import category map"
              description="Load a previously exported JSON file to restore your custom item-to-category assignments. Useful for applying the same mapping across multiple missions or sharing your setup with others."
            >
              <button
                onClick={handleImportOverrides}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors"
              >
                Import…
              </button>
            </SettingRow>

            <SettingRow
              title="Export category map"
              description={`Save your current category assignments to a JSON file${overrideCount > 0 ? ` (${overrideCount} override${overrideCount !== 1 ? 's' : ''} active)` : ''}. You can import this file later to restore them without re-doing the work.`}
            >
              <button
                onClick={handleExportOverrides}
                disabled={overrideCount === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export…
              </button>
            </SettingRow>

            <SettingRow
              title="Clear category map"
              description="Remove all manual category assignments. Items will revert to their automatically detected categories based on name and type. This only affects the editor view — no XML files are changed."
            >
              <button
                onClick={handleClearOverrides}
                disabled={overrideCount === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear{overrideCount > 0 ? ` (${overrideCount})` : ''}
              </button>
            </SettingRow>
          </div>
        </section>

        {/* Community Maps */}
        <div ref={communityMapsSectionRef}>
          <CommunityMapsSection />
        </div>

      </div>
    </div>
  );
}
