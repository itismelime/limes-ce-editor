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
const loadWeatherEditor = () => import('../editors/WeatherEditor');
const loadGameplayEditor = () => import('../editors/GameplayEditor');

const MapView = lazy(() => loadMapView().then(m => ({ default: m.MapView })));
const TypesEditor = lazy(() => loadTypesEditor().then(m => ({ default: m.TypesEditor })));
const EventsEditor = lazy(() => loadEventsEditor().then(m => ({ default: m.EventsEditor })));
const EventSpawnsEditor = lazy(() => loadEventSpawnsEditor().then(m => ({ default: m.EventSpawnsEditor })));
const SpawnableTypesEditor = lazy(() => loadSpawnableTypesEditor().then(m => ({ default: m.SpawnableTypesEditor })));
const EconomyCoreEditor = lazy(() => loadEconomyCoreEditor().then(m => ({ default: m.EconomyCoreEditor })));
const PlayerSpawnsEditor = lazy(() => loadPlayerSpawnsEditor().then(m => ({ default: m.PlayerSpawnsEditor })));
const WeatherEditor = lazy(() => loadWeatherEditor().then(m => ({ default: m.WeatherEditor })));
const GameplayEditor = lazy(() => loadGameplayEditor().then(m => ({ default: m.GameplayEditor })));

const StableMapView = memo(MapView);
const StableTypesEditor = memo(TypesEditor);
const StableEventsEditor = memo(EventsEditor);
const StableEventSpawnsEditor = memo(EventSpawnsEditor);
const StablePlayerSpawnsEditor = memo(PlayerSpawnsEditor);
const StableSpawnableTypesEditor = memo(SpawnableTypesEditor);
const StableEconomyCoreEditor = memo(EconomyCoreEditor);
const StableWeatherEditor = memo(WeatherEditor);
const StableGameplayEditor = memo(GameplayEditor);

const TAB_PREFETCHERS: Record<ActiveTab, () => Promise<unknown>> = {
  map: loadMapView,
  types: loadTypesEditor,
  events: loadEventsEditor,
  spawns: loadEventSpawnsEditor,
  playerSpawns: loadPlayerSpawnsEditor,
  spawnableTypes: loadSpawnableTypesEditor,
  economy: loadEconomyCoreEditor,
  weather: loadWeatherEditor,
  gameplay: loadGameplayEditor,
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

type LoadWarningKind = 'missing' | 'parse' | 'compat' | 'other';

type ParsedLoadWarning = {
  raw: string;
  kind: LoadWarningKind;
  file: string;
  detail?: string;
};

function parseLoadWarning(raw: string): ParsedLoadWarning {
  if (raw.startsWith('compat: ')) {
    const rest = raw.slice('compat: '.length);
    const unknownNodesIdx = rest.indexOf(' unknown nodes ');
    if (unknownNodesIdx !== -1) {
      return {
        raw,
        kind: 'compat',
        file: rest.slice(0, unknownNodesIdx),
        detail: rest.slice(unknownNodesIdx + ' unknown nodes '.length).replace(/^\(|\)$/g, ''),
      };
    }
    return { raw, kind: 'compat', file: rest };
  }

  const parseMatch = raw.match(/^(.*) \(parse error(?:: (.*))?\)$/);
  if (parseMatch) {
    return {
      raw,
      kind: 'parse',
      file: parseMatch[1],
      detail: parseMatch[2],
    };
  }

  if (FILE_DESCRIPTIONS[raw]) {
    return { raw, kind: 'missing', file: raw };
  }

  if (raw.startsWith('ce file not found: ')) {
    return { raw, kind: 'other', file: 'cfgeconomycore.xml', detail: raw.slice('ce file not found: '.length) };
  }

  return { raw, kind: 'other', file: raw };
}

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
  const parsed = warnings.map(parseLoadWarning);
  const compatWarnings = parsed.filter(w => w.kind === 'compat');
  return (
    <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4 max-w-md w-full text-left">
      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
        ⚠ Load Notices
      </p>
      <div className="space-y-2">
        {parsed.map(w => {
          const desc = FILE_DESCRIPTIONS[w.file];
          return (
            <div key={w.raw} className="flex gap-2">
              <span className="text-amber-600 flex-shrink-0">
                {w.kind === 'parse' ? '💥' : w.kind === 'compat' ? '🧩' : '✗'}
              </span>
              <div>
                <span className="font-mono text-xs text-amber-300">{w.file}</span>
                {w.kind === 'parse' && <p className="text-xs text-slate-500">File parse failed. Check syntax or encoding.</p>}
                {w.kind === 'missing' && <p className="text-xs text-slate-500">{desc ? `Not found — ${desc.toLowerCase()}` : 'Not found in the selected folder'}</p>}
                {w.kind === 'compat' && <p className="text-xs text-slate-500">Unknown structure detected and preserved where possible.</p>}
                {w.kind === 'other' && w.detail && <p className="text-xs text-slate-500">{w.detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {compatWarnings.length > 0 && (
        <div className="mt-3 pt-2 border-t border-amber-900/30">
          <p className="text-xs text-amber-400 mb-1">Compatibility details</p>
          <div className="space-y-1">
            {compatWarnings.map(w => (
              <p key={`compat-${w.raw}`} className="text-xs text-slate-500 font-mono break-words">{w.file}: {w.detail ?? 'unknown nodes present'}</p>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-slate-600 mt-3 pt-2 border-t border-amber-900/30">
        The editor will still load, and unknown structures are reported to help harden parsers safely.
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
  const [showNoticeDetails, setShowNoticeDetails] = useState(false);

  const parsedWarnings = loadWarnings.map(parseLoadWarning);
  const compatWarnings = parsedWarnings.filter(w => w.kind === 'compat');
  const parseWarnings = parsedWarnings.filter(w => w.kind === 'parse');
  const missingWarnings = parsedWarnings.filter(w => w.kind === 'missing');

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
    if (!missionPath) {
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
  }, [missionPath, activeMap, mapImagePaths, setMapImagePath, setMapImageSize]);

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
              <div className="bg-amber-900/20 border-b border-amber-800/40 px-4 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 text-xs">⚠</span>
                  <span className="text-amber-400 text-xs">
                    Load notices: <span className="font-mono">{loadWarnings.length}</span>
                    <span className="text-amber-600 ml-1">
                      ({missingWarnings.length} missing, {parseWarnings.length} parse, {compatWarnings.length} compat)
                    </span>
                  </span>

                  {(parseWarnings.length > 0 || compatWarnings.length > 0 || missingWarnings.length > 0) && (
                    <button
                      onClick={() => setShowNoticeDetails(v => !v)}
                      className="text-xs text-amber-300 hover:text-amber-200 underline"
                    >
                      {showNoticeDetails ? 'Hide notice details' : 'Show notice details'}
                    </button>
                  )}

                  <button
                    onClick={() => useUiStore.getState().setLoadWarnings([])}
                    className="ml-auto text-amber-800 hover:text-amber-600 text-sm"
                  >
                    ×
                  </button>
                </div>

                {showNoticeDetails && (parseWarnings.length > 0 || compatWarnings.length > 0 || missingWarnings.length > 0) && (
                  <div className="mt-2 border-t border-amber-900/40 pt-2 space-y-1">
                    {parseWarnings.map(w => (
                      <p key={`top-parse-${w.raw}`} className="text-xs text-amber-200 break-words">
                        <span className="font-mono text-amber-300">{w.file}</span>: <span className="font-mono">{w.detail ?? 'parse error'}</span>
                      </p>
                    ))}
                    {compatWarnings.map(w => (
                      <p key={`top-compat-${w.raw}`} className="text-xs text-amber-200 break-words">
                        <span className="font-mono text-amber-300">{w.file}</span>: <span className="font-mono">{w.detail ?? 'unknown structure detected'}</span>
                      </p>
                    ))}
                    {missingWarnings.map(w => (
                      <p key={`top-missing-${w.raw}`} className="text-xs text-amber-200 break-words">
                        <span className="font-mono text-amber-300">{w.file}</span>: <span className="font-mono">missing</span>
                      </p>
                    ))}
                  </div>
                )}
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
                {mountedTabs.weather && (
                  <div className={tabPanelClass('weather')}>
                    <StableWeatherEditor />
                  </div>
                )}
                {mountedTabs.gameplay && (
                  <div className={tabPanelClass('gameplay')}>
                    <StableGameplayEditor />
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
