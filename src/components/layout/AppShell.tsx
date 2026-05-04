import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { useServerFolder } from '../../hooks/useServerFolder';
import { TopBar } from './TopBar';
import { MissionPicker } from '../shared/MissionPicker';
import type { ActiveTab } from '../../store/uiStore';

const loadMapView = () => import('../map/MapView');
const loadTypesEditor = () => import('../editors/TypesEditor');
const loadEventsEditor = () => import('../editors/EventsEditor');
const loadEventSpawnsEditor = () => import('../editors/EventSpawnsEditor');
const loadSpawnableTypesEditor = () => import('../editors/SpawnableTypesEditor');
const loadEconomyCoreEditor = () => import('../editors/EconomyCoreEditor');
const loadPlayerSpawnsEditor = () => import('../editors/PlayerSpawnsEditor');

const MapView = lazy(() => loadMapView().then(m => ({ default: m.MapView })));
const TypesEditor = lazy(() => loadTypesEditor().then(m => ({ default: m.TypesEditor })));
const EventsEditor = lazy(() => loadEventsEditor().then(m => ({ default: m.EventsEditor })));
const EventSpawnsEditor = lazy(() => loadEventSpawnsEditor().then(m => ({ default: m.EventSpawnsEditor })));
const SpawnableTypesEditor = lazy(() => loadSpawnableTypesEditor().then(m => ({ default: m.SpawnableTypesEditor })));
const EconomyCoreEditor = lazy(() => loadEconomyCoreEditor().then(m => ({ default: m.EconomyCoreEditor })));
const PlayerSpawnsEditor = lazy(() => loadPlayerSpawnsEditor().then(m => ({ default: m.PlayerSpawnsEditor })));

const StableMapView = memo(MapView);
const StableTypesEditor = memo(TypesEditor);
const StableEventsEditor = memo(EventsEditor);
const StableEventSpawnsEditor = memo(EventSpawnsEditor);
const StablePlayerSpawnsEditor = memo(PlayerSpawnsEditor);
const StableSpawnableTypesEditor = memo(SpawnableTypesEditor);
const StableEconomyCoreEditor = memo(EconomyCoreEditor);

const TAB_PREFETCHERS: Record<ActiveTab, () => Promise<unknown>> = {
  map: loadMapView,
  types: loadTypesEditor,
  events: loadEventsEditor,
  spawns: loadEventSpawnsEditor,
  playerSpawns: loadPlayerSpawnsEditor,
  spawnableTypes: loadSpawnableTypesEditor,
  economy: loadEconomyCoreEditor,
};

const IDLE_PREFETCH_TABS: ActiveTab[] = ['map', 'types'];
const prefetchedTabs = new Set<ActiveTab>();
const KNOWN_MAPS = new Set(['namalsk', 'chernarus', 'livonia', 'sakhal']);

function prefetchTabOnce(tab: ActiveTab): void {
  if (prefetchedTabs.has(tab)) return;
  prefetchedTabs.add(tab);
  void TAB_PREFETCHERS[tab]();
}

type IdleCompatWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

const FILE_DESCRIPTIONS: Record<string, string> = {
  'types.xml': 'Item spawn quantities, lifetime, flags and tiers',
  'cfgeventspawns.xml': 'Map coordinates for each spawn event',
  'events.xml': 'Event definitions and child loot groups',
  'cfgspawnabletypes.xml': 'Items that spawn inside containers',
};

function EmptyState() {
  const { loadError, loadWarnings } = useUiStore();
  const setLoadError = useUiStore(s => s.setLoadError);

  if (loadError === 'no_files_found') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
        <div className="w-20 h-20 bg-red-900/30 rounded-2xl flex items-center justify-center text-4xl">⚠️</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">No DayZ files found</h2>
          <p className="text-slate-500 text-sm max-w-md mb-4">
            The selected folder doesn't contain any recognizable DayZ loot files.
            Make sure you're opening the right directory.
          </p>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-left max-w-md mx-auto">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">What to look for</p>
            <div className="space-y-2">
              {Object.entries(FILE_DESCRIPTIONS).map(([file, desc]) => (
                <div key={file} className="flex gap-3">
                  <span className="font-mono text-xs text-indigo-400 w-44 flex-shrink-0">{file}</span>
                  <span className="text-xs text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-700">
              <p className="text-xs text-slate-500">
                These files are typically found in:<br />
                <span className="font-mono text-slate-400">mpmissions\&lt;mission_name&gt;\db\</span>
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setLoadError(null)}
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          ← Try a different folder
        </button>
      </div>
    );
  }

  if (loadError === 'permission_denied') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
        <div className="w-20 h-20 bg-red-900/30 rounded-2xl flex items-center justify-center text-4xl">🔒</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">Permission denied</h2>
          <p className="text-slate-500 text-sm max-w-sm mb-4">
            The app doesn't have permission to read that folder.
          </p>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-left max-w-sm mx-auto space-y-2 text-xs text-slate-400">
            <p>• Try running the app as Administrator</p>
            <p>• Or copy the server files to a folder in your Documents</p>
          </div>
        </div>
        <button onClick={() => setLoadError(null)} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Try again</button>
      </div>
    );
  }

  if (loadError?.startsWith('error:')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
        <div className="w-20 h-20 bg-red-900/30 rounded-2xl flex items-center justify-center text-4xl">💥</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">Failed to load</h2>
          <p className="text-slate-500 text-sm max-w-sm mb-3">An unexpected error occurred while reading the server folder.</p>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 font-mono text-xs text-red-400 max-w-md text-left">
            {loadError.replace('error:', '')}
          </div>
        </div>
        <button onClick={() => setLoadError(null)} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Try again</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
      <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center text-4xl">🗺</div>
      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-2">No server loaded</h2>
        <p className="text-slate-500 text-sm max-w-sm">
          Click <span className="text-slate-300 font-medium">Open Server Folder</span> and select your DayZ server or mission directory.
          The app will automatically find your loot files.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 text-xs text-slate-600 max-w-md">
        {Object.keys(FILE_DESCRIPTIONS).map(f => (
          <span key={f} className="bg-slate-800 px-3 py-1 rounded-full">{f}</span>
        ))}
      </div>

      {loadWarnings.length > 0 && (
        <MissingFilesWarning warnings={loadWarnings} />
      )}
    </div>
  );
}

function MissingFilesWarning({ warnings }: { warnings: string[] }) {
  return (
    <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4 max-w-md w-full text-left">
      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
        ⚠ Some files could not be loaded
      </p>
      <div className="space-y-2">
        {warnings.map(w => {
          const isParse = w.includes('parse error');
          const filename = w.replace(' (parse error)', '');
          const desc = FILE_DESCRIPTIONS[filename];
          return (
            <div key={w} className="flex gap-2">
              <span className="text-amber-600 flex-shrink-0">{isParse ? '💥' : '✗'}</span>
              <div>
                <span className="font-mono text-xs text-amber-300">{filename}</span>
                {isParse
                  ? <p className="text-xs text-slate-500">XML is malformed — check the file for syntax errors</p>
                  : <p className="text-xs text-slate-500">{desc ? `Not found — ${desc.toLowerCase()}` : 'Not found in the selected folder'}</p>
                }
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-600 mt-3 pt-2 border-t border-amber-900/30">
        The editor will still work with whatever files were found.
      </p>
    </div>
  );
}

export function AppShell() {
  const mission = useServerStore(s => s.mission);
  const missionPath = useServerStore(s => s.paths.missionPath);
  const dirty = useServerStore(s => s.dirty);
  const activeTab = useUiStore(s => s.activeTab);
  const activeMap = useUiStore(s => s.activeMap);
  const mapImagePaths = useUiStore(s => s.mapImagePaths);
  const setMapImagePath = useUiStore(s => s.setMapImagePath);
  const setMapImageSize = useUiStore(s => s.setMapImageSize);
  const loadError = useUiStore(s => s.loadError);
  const loadWarnings = useUiStore(s => s.loadWarnings);
  const isLoading = useUiStore(s => s.isLoading);
  const { openFolder, autoLoad, pendingMissions, selectMission, cancelPicker } = useServerFolder();
  const [mountedTabs, setMountedTabs] = useState<Partial<Record<ActiveTab, true>>>({ [activeTab]: true });
  const [isStartupWarmup, setIsStartupWarmup] = useState(false);
  const [startupMessage, setStartupMessage] = useState('Preparing editor...');

  useEffect(() => { autoLoad(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.values(dirty).some(Boolean)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    prefetchedTabs.add(activeTab);
  }, [activeTab]);

  useEffect(() => {
    setMountedTabs(prev => {
      if (prev[activeTab]) return prev;
      return { ...prev, [activeTab]: true };
    });
  }, [activeTab]);

  useEffect(() => {
    const targets = IDLE_PREFETCH_TABS.filter(tab => tab !== activeTab);
    if (targets.length === 0) return;

    const prefetchTargets = () => {
      for (const tab of targets) {
        prefetchTabOnce(tab);
      }
    };

    const idleWindow = window as IdleCompatWindow;
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(prefetchTargets, { timeout: 2000 });
      return () => idleWindow.cancelIdleCallback!(idleId);
    }

    const timeoutId = setTimeout(prefetchTargets, 350);
    return () => clearTimeout(timeoutId);
  }, [activeTab]);

  useEffect(() => {
    if (!mission || !missionPath) {
      setIsStartupWarmup(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    setIsStartupWarmup(true);
    setStartupMessage('Preparing map cache...');

    const warmup = async () => {
      // Keep startup focused on map readiness; avoid mounting hidden heavy tabs.
      setMountedTabs(prev => ({
        ...prev,
        map: true,
      }));
      prefetchTabOnce('map');
      prefetchTabOnce('types');

      if (KNOWN_MAPS.has(activeMap) && !mapImagePaths[activeMap]) {
        try {
          const result = await invoke<{ path: string; width: number; height: number }>('download_map_tiles', {
            mapId: activeMap,
          });
          if (!cancelled) {
            setMapImagePath(activeMap, convertFileSrc(result.path));
            setMapImageSize(activeMap, result.width, result.height);
          }
        } catch {
          // If map cache preparation fails, continue warmup and let map tab handle retries.
        }
      }

      if (cancelled) return;
      setStartupMessage('Warming editors...');
      await Promise.allSettled([TAB_PREFETCHERS.map(), TAB_PREFETCHERS.types()]);

      if (cancelled) return;
      setStartupMessage('Finalizing...');
      await new Promise<void>(resolve => {
        timeoutId = setTimeout(resolve, 220);
      });
      if (!cancelled) setIsStartupWarmup(false);
    };

    void warmup();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [missionPath, mission, activeMap, mapImagePaths, setMapImagePath, setMapImageSize]);

  const showNoFilesError = loadError === 'no_files_found' || loadError === 'permission_denied' || loadError?.startsWith('error:');
  const prefetchTab = (tab: ActiveTab) => {
    if (tab === activeTab) return;
    prefetchTabOnce(tab);
  };
  const tabPanelClass = (tab: ActiveTab) => {
    if (activeTab === tab) {
      if (tab === 'map') return 'fixed inset-0 z-10';
      return 'h-full w-full relative z-10';
    }
    return 'hidden';
  };

  return (
    <div className="relative flex flex-col h-screen bg-slate-950">
      <TopBar onOpenFolder={openFolder} onPrefetchTab={prefetchTab} />
      {pendingMissions && (
        <MissionPicker
          missions={pendingMissions}
          onSelect={selectMission}
          onCancel={cancelPicker}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        {!mission || showNoFilesError ? (
          <EmptyState />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {loadWarnings.length > 0 && (
              <div className="bg-amber-900/20 border-b border-amber-800/40 px-4 py-2 flex items-center gap-3">
                <span className="text-amber-400 text-xs">⚠</span>
                <span className="text-amber-400 text-xs">
                  Missing files: <span className="font-mono">{loadWarnings.join(', ')}</span>
                  <span className="text-amber-600 ml-1">— those features will be empty</span>
                </span>
                <button
                  onClick={() => useUiStore.getState().setLoadWarnings([])}
                  className="ml-auto text-amber-800 hover:text-amber-600 text-sm"
                >
                  ×
                </button>
              </div>
            )}
            <div className="flex-1 overflow-hidden relative">
              <Suspense fallback={<div className="h-full w-full grid place-items-center text-sm text-slate-500">Loading editor...</div>}>
                {mountedTabs.map && (
                  <div className={tabPanelClass('map')}>
                    <StableMapView />
                  </div>
                )}
                {mountedTabs.types && (
                  <div className={tabPanelClass('types')}>
                    <StableTypesEditor />
                  </div>
                )}
                {mountedTabs.events && (
                  <div className={tabPanelClass('events')}>
                    <StableEventsEditor />
                  </div>
                )}
                {mountedTabs.spawns && (
                  <div className={tabPanelClass('spawns')}>
                    <StableEventSpawnsEditor />
                  </div>
                )}
                {mountedTabs.playerSpawns && (
                  <div className={tabPanelClass('playerSpawns')}>
                    <StablePlayerSpawnsEditor />
                  </div>
                )}
                {mountedTabs.spawnableTypes && (
                  <div className={tabPanelClass('spawnableTypes')}>
                    <StableSpawnableTypesEditor />
                  </div>
                )}
                {mountedTabs.economy && (
                  <div className={tabPanelClass('economy')}>
                    <StableEconomyCoreEditor />
                  </div>
                )}
              </Suspense>
            </div>
          </div>
        )}
      </div>

      {(isLoading || isStartupWarmup) && (
        <div className="absolute inset-0 z-[5000] bg-slate-950 flex items-center justify-center">
          <div className="w-[360px] max-w-[90vw] rounded-xl border border-slate-700 bg-slate-900/95 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-5 h-5 rounded-full border-2 border-slate-600 border-t-indigo-400 animate-spin" />
              <p className="text-sm font-medium text-slate-200">
                {isLoading ? 'Loading server files...' : startupMessage}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              First load may take a moment. Tabs will become interactive once warmup finishes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
