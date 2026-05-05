import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import type { ActiveTab } from '../../store/uiStore';
import type { MapId } from '../../types/map';

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'map',           label: '🗺 Map' },
  { id: 'types',         label: '🎒 Loot Types' },
  { id: 'spawnableTypes', label: '📦 Spawnable Types' },
  { id: 'playerSpawns',  label: '🧍 Player Spawn Points' },
  { id: 'events',        label: '⚡ Events' },
  { id: 'spawns',        label: '📍 Event Spawn Points' },
  { id: 'economy',       label: '⚙ Economy Core' },
  { id: 'weather',       label: '🌤 Weather' },
  { id: 'gameplay',      label: '⚗ Gameplay' },
];

const MAPS: { id: MapId; label: string }[] = [
  { id: 'namalsk',   label: 'Namalsk' },
  { id: 'chernarus', label: 'Chernarus+' },
  { id: 'livonia',   label: 'Livonia' },
  { id: 'sakhal',    label: 'Sakhal' },
  { id: 'custom',    label: 'Custom' },
];

const OFFLINE_MAP_ORDER: MapId[] = ['namalsk', 'chernarus', 'livonia', 'sakhal'];
const MAX_XAM_ZOOM_BY_MAP: Record<string, number> = {
  namalsk: 6,
  chernarus: 8,
  livonia: 7,
  sakhal: 8,
};

type OfflineCacheStatus = {
  map_id: string;
  ready: boolean;
  cached: number;
  total: number;
};

export function TopBar({
  onOpenFolder,
  onPrefetchTab,
}: {
  onOpenFolder: () => void;
  onPrefetchTab: (tab: ActiveTab) => void;
}) {
  const mission = useServerStore(s => s.mission);
  const dirty = useServerStore(s => s.dirty);
  const saveError = useServerStore(s => s.saveError);
  const saveStatus = useServerStore(s => s.saveStatus);
  const clearSaveError = useServerStore(s => s.clearSaveError);
  const saveTypesSource = useServerStore(s => s.saveTypesSource);
  const saveEventSpawns = useServerStore(s => s.saveEventSpawns);
  const saveEvents = useServerStore(s => s.saveEvents);
  const saveSpawnableTypes = useServerStore(s => s.saveSpawnableTypes);
  const saveMapGroupProto = useServerStore(s => s.saveMapGroupProto);
  const saveWeather = useServerStore(s => s.saveWeather);
  const saveGameplay = useServerStore(s => s.saveGameplay);
  const saveCheckpoints = useServerStore(s => s.saveCheckpoints);
  const createSaveCheckpointFromDirty = useServerStore(s => s.createSaveCheckpointFromDirty);
  const revertSaveCheckpoint = useServerStore(s => s.revertSaveCheckpoint);
  const revertTypesSource = useServerStore(s => s.revertTypesSource);
  const revertEventSpawns = useServerStore(s => s.revertEventSpawns);
  const revertEvents = useServerStore(s => s.revertEvents);
  const revertSpawnableTypes = useServerStore(s => s.revertSpawnableTypes);
  const revertMapGroupProto = useServerStore(s => s.revertMapGroupProto);
  const revertWeather = useServerStore(s => s.revertWeather);
  const revertGameplay = useServerStore(s => s.revertGameplay);
  const undoType = useServerStore(s => s.undoType);
  const typeHistory = useServerStore(s => s.typeHistory);
  const activeTab = useUiStore(s => s.activeTab);
  const setActiveTab = useUiStore(s => s.setActiveTab);
  const activeMap = useUiStore(s => s.activeMap);
  const setActiveMap = useUiStore(s => s.setActiveMap);
  const showSaveReview = useUiStore(s => s.showSaveReview);
  const setShowSaveReview = useUiStore(s => s.setShowSaveReview);
  const isLoading = useUiStore(s => s.isLoading);
  const [showOfflinePanel, setShowOfflinePanel] = useState(false);
  const [preparingOffline, setPreparingOffline] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState(0);
  const [offlineStatus, setOfflineStatus] = useState<string | null>(null);
  const [offlineCurrentMap, setOfflineCurrentMap] = useState<string | null>(null);
  const [offlineStatuses, setOfflineStatuses] = useState<Record<string, OfflineCacheStatus>>({});
  const offlineRefreshInFlightRef = useRef(false);
  const [savingPending, setSavingPending] = useState(false);
  const offlinePanelRef = useRef<HTMLDivElement | null>(null);
  const pendingTabRef = useRef<ActiveTab | null>(null);
  const tabSwitchInFlightRef = useRef(false);

  const commitPendingTab = () => {
    if (tabSwitchInFlightRef.current) return;
    const targetTab = pendingTabRef.current;
    if (!targetTab) return;

    const currentTab = useUiStore.getState().activeTab;
    if (targetTab === currentTab) {
      pendingTabRef.current = null;
      return;
    }

    pendingTabRef.current = null;
    tabSwitchInFlightRef.current = true;
    setActiveTab(targetTab);
  };

  const hasDirty = dirty.typesSources.length > 0 || dirty.eventSpawns || dirty.events || dirty.spawnableTypes || dirty.mapGroupProto || dirty.weather || dirty.gameplay;
  const pendingItems: Array<{ id: string; label: string; detail: string; onRevert: () => void }> = [
    ...dirty.typesSources.map(source => ({
      id: `types:${source}`,
      label: 'types.xml source',
      detail: source.split(/[\\/]/).pop() ?? source,
      onRevert: () => revertTypesSource(source),
    })),
    ...(dirty.eventSpawns
      ? [{ id: 'eventSpawns', label: 'cfgeventspawns.xml', detail: 'Event spawn positions', onRevert: () => revertEventSpawns() }]
      : []),
    ...(dirty.events
      ? [{ id: 'events', label: 'events.xml', detail: 'Event definitions', onRevert: () => revertEvents() }]
      : []),
    ...(dirty.spawnableTypes
      ? [{ id: 'spawnableTypes', label: 'cfgspawnabletypes.xml', detail: 'Spawnable type sets', onRevert: () => revertSpawnableTypes() }]
      : []),
    ...(dirty.mapGroupProto
      ? [{ id: 'mapGroupProto', label: 'mapgroupproto.xml', detail: 'Building category containers', onRevert: () => revertMapGroupProto() }]
      : []),
    ...(dirty.weather
      ? [{ id: 'weather', label: 'weather.xml', detail: 'Weather configuration', onRevert: () => revertWeather() }]
      : []),
    ...(dirty.gameplay
      ? [{ id: 'gameplay', label: 'gameplay.json', detail: 'Gameplay settings', onRevert: () => revertGameplay() }]
      : []),
  ];
  const isKnownMap = OFFLINE_MAP_ORDER.includes(activeMap);
  const currentMapReady = isKnownMap && !!offlineStatuses[activeMap]?.ready;

  const refreshOfflineStatuses = async () => {
    if (offlineRefreshInFlightRef.current) return;
    offlineRefreshInFlightRef.current = true;
    try {
      const statuses = await invoke<OfflineCacheStatus[]>('get_offline_cache_statuses');
      const next: Record<string, OfflineCacheStatus> = {};
      statuses.forEach(s => { next[s.map_id] = s; });
      setOfflineStatuses(next);
    } catch {
      // Ignore status refresh errors in top bar.
    } finally {
      offlineRefreshInFlightRef.current = false;
    }
  };

  const prepareCurrentOffline = async () => {
    if (!isKnownMap || preparingOffline) return;
    setPreparingOffline(true);
    setOfflineProgress(0);
    setOfflineStatus(null);
    setOfflineCurrentMap(activeMap);
    try {
      const result = await invoke<{ total: number; cached: number; downloaded: number; failed: number }>(
        'prepare_map_offline',
        { mapId: activeMap, maxZoom: MAX_XAM_ZOOM_BY_MAP[activeMap] ?? 6 },
      );
      setOfflineStatus(
        `Offline cache ready: ${result.cached.toLocaleString()} cached, ${result.downloaded.toLocaleString()} downloaded${result.failed > 0 ? `, ${result.failed.toLocaleString()} missing` : ''}`,
      );
    } catch (err) {
      setOfflineStatus(`Offline prepare failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPreparingOffline(false);
      setOfflineCurrentMap(null);
      void refreshOfflineStatuses();
    }
  };

  const prepareAllOffline = async () => {
    if (preparingOffline) return;
    setPreparingOffline(true);
    setOfflineProgress(0);
    setOfflineStatus(null);
    setOfflineCurrentMap(null);
    try {
      const result = await invoke<{ total: number; cached: number; downloaded: number; failed: number }>('prepare_all_maps_offline');
      setOfflineStatus(
        `All maps prepared: ${result.cached.toLocaleString()} cached, ${result.downloaded.toLocaleString()} downloaded${result.failed > 0 ? `, ${result.failed.toLocaleString()} missing` : ''}`,
      );
    } catch (err) {
      setOfflineStatus(`Offline prepare failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPreparingOffline(false);
      setOfflineCurrentMap(null);
      void refreshOfflineStatuses();
    }
  };

  const cancelOfflinePrepare = async () => {
    if (!preparingOffline) return;
    setOfflineStatus('Cancelling offline preparation...');
    try {
      await invoke('cancel_offline_prepare');
    } catch {
      // Ignore cancellation races.
    }
  };

  useEffect(() => {
    if (showOfflinePanel) {
      void refreshOfflineStatuses();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOfflinePanel, activeMap]);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = (immediate: boolean) => {
      if (preparingOffline) return;

      const run = () => {
        if (document.hidden || preparingOffline) return;
        void refreshOfflineStatuses();
      };

      if (immediate) {
        run();
        return;
      }

      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(run, { timeout: 1200 });
        return;
      }

      timeoutId = setTimeout(run, 250);
    };

    // Seed quickly, then keep status reasonably fresh without frequent work.
    scheduleRefresh(true);
    const intervalId = setInterval(() => scheduleRefresh(false), 180000);

    const onOnline = () => scheduleRefresh(true);
    const onFocus = () => scheduleRefresh(false);
    const onVisible = () => {
      if (!document.hidden) scheduleRefresh(false);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(intervalId);
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparingOffline]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenMap: (() => void) | undefined;
    (async () => {
      unlistenProgress = await listen<number>('offline-cache-progress', e => {
        setOfflineProgress(Math.max(0, Math.min(1, e.payload)));
      });
      unlistenMap = await listen<string>('offline-cache-map', e => {
        setOfflineCurrentMap(e.payload);
      });
    })();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenMap) unlistenMap();
    };
  }, []);

  useEffect(() => {
    if (!showOfflinePanel) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (offlinePanelRef.current && target && !offlinePanelRef.current.contains(target)) {
        setShowOfflinePanel(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showOfflinePanel]);

  useEffect(() => {
    if (!tabSwitchInFlightRef.current) return;
    requestAnimationFrame(() => {
      tabSwitchInFlightRef.current = false;
      if (pendingTabRef.current && pendingTabRef.current !== useUiStore.getState().activeTab) {
        commitPendingTab();
      }
    });
  }, [activeTab]);

  useEffect(() => {
    if (showSaveReview && !hasDirty) {
      setShowSaveReview(false);
    }
  }, [showSaveReview, hasDirty]);

  const handleTabClick = (tabId: ActiveTab) => {
    pendingTabRef.current = tabId;

    if (!tabSwitchInFlightRef.current) {
      const currentTab = useUiStore.getState().activeTab;
      if (tabId !== currentTab) {
        commitPendingTab();
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        undoType();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [undoType]);

  const savePendingChanges = async () => {
    if (savingPending || !hasDirty) return;

    setSavingPending(true);
    try {
      createSaveCheckpointFromDirty('TopBar save');
      setShowSaveReview(false);
      if (dirty.mapGroupProto) await saveMapGroupProto();
      const typeSources = [...dirty.typesSources];
      for (const source of typeSources) {
        await saveTypesSource(source);
      }
      if (dirty.eventSpawns) await saveEventSpawns();
      if (dirty.events) await saveEvents();
      if (dirty.spawnableTypes) await saveSpawnableTypes();
      if (dirty.weather) await saveWeather();
      if (dirty.gameplay) await saveGameplay();
    } finally {
      setSavingPending(false);
    }
  };

  const undoLastSave = () => {
    if (saveCheckpoints.length === 0) return;
    const proceed = window.confirm('Revert the most recent saved changes?\n\nThis will restore previous values in the editor and stage them as pending changes.');
    if (!proceed) return;
    revertSaveCheckpoint();
  };

  const revertAllPending = () => {
    for (const source of dirty.typesSources) {
      revertTypesSource(source);
    }
    if (dirty.eventSpawns) revertEventSpawns();
    if (dirty.events) revertEvents();
    if (dirty.spawnableTypes) revertSpawnableTypes();
    if (dirty.mapGroupProto) revertMapGroupProto();
    if (dirty.weather) revertWeather();
    if (dirty.gameplay) revertGameplay();
  };

  return (
    <div className="relative z-[2000] flex flex-col bg-slate-900 border-b border-slate-800">
      {saveError && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-xs">
          <span className="flex-1">{saveError}</span>
          <button onClick={clearSaveError} className="text-red-400 hover:text-red-200 font-medium">Dismiss</button>
        </div>
      )}
      {/* Top row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center text-xs font-bold">DZ</div>
          <span className="font-semibold text-slate-200 text-sm">DayZ Loot Editor</span>
        </div>

        <button
          onClick={onOpenFolder}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {isLoading ? 'Loading…' : 'Open Server Folder'}
        </button>

        {mission && (
          <span className="text-slate-400 text-sm">
            <span className="text-slate-600 mr-1">Mission:</span>
            {mission.missionName}
            <span className="ml-2 text-slate-600">
              · {mission.types.size} items
              · {mission.eventSpawns.length} events
            </span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-slate-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
              Saving…
            </span>
          )}
          {saveStatus === 'success' && (
            <span className="flex items-center gap-1.5 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Saved successfully
            </span>
          )}
          {activeTab === 'map' && (<>
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
              {MAPS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setActiveMap(m.id)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    activeMap === m.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div ref={offlinePanelRef} className="relative">
              <button
                onClick={() => setShowOfflinePanel(v => !v)}
                className={`h-8 bg-slate-800 border rounded-lg px-3 backdrop-blur text-xs transition-colors flex items-center gap-2 ${showOfflinePanel ? 'border-indigo-500 text-indigo-400' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${currentMapReady ? 'bg-emerald-400' : 'bg-red-400'}`} />
                Offline
              </button>

              {showOfflinePanel && (
                <div className="absolute top-full right-0 mt-2 bg-slate-900/95 border border-slate-700 rounded-lg p-3 backdrop-blur w-[320px] z-40">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-medium text-slate-300">Offline Cache</span>
                    <span className="text-[11px] text-slate-500">{preparingOffline ? `${Math.round(offlineProgress * 100)}%` : 'Idle'}</span>
                  </div>

                  <div className="space-y-1 mb-2">
                    {OFFLINE_MAP_ORDER.map(mapId => {
                      const status = offlineStatuses[mapId];
                      const ready = !!status?.ready;
                      return (
                        <div key={mapId} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2.5 h-2.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            <span className={`${mapId === activeMap ? 'text-slate-200' : 'text-slate-300'}`}>
                              {MAPS.find(m => m.id === mapId)?.label ?? mapId}
                            </span>
                          </div>
                          <span className="text-slate-500 text-[11px]">
                            {status ? `${status.cached.toLocaleString()}/${status.total.toLocaleString()}` : '...'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {preparingOffline && (
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${offlineProgress * 100}%` }} />
                    </div>
                  )}

                  {offlineCurrentMap && (
                    <p className="text-[11px] text-slate-500 mb-2 truncate">
                      Preparing: {MAPS.find(m => m.id === offlineCurrentMap)?.label ?? offlineCurrentMap}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={prepareCurrentOffline}
                      disabled={preparingOffline || !isKnownMap}
                      className={`h-7 border rounded-lg px-2 text-xs transition-colors ${preparingOffline || !isKnownMap ? 'border-slate-700 text-slate-500' : 'border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100'}`}
                    >
                      Prepare Current
                    </button>
                    <button
                      onClick={prepareAllOffline}
                      disabled={preparingOffline}
                      className={`h-7 border rounded-lg px-2 text-xs transition-colors ${preparingOffline ? 'border-slate-700 text-slate-500' : 'border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100'}`}
                    >
                      Prepare All
                    </button>
                    <button
                      onClick={cancelOfflinePrepare}
                      disabled={!preparingOffline}
                      className={`h-7 border rounded-lg px-2 text-xs transition-colors ${!preparingOffline ? 'border-slate-700 text-slate-500' : 'border-red-500/70 text-red-300 hover:border-red-400 hover:text-red-200'}`}
                    >
                      Cancel
                    </button>
                  </div>

                  {offlineStatus && <p className="mt-2 text-[11px] text-slate-500 truncate">{offlineStatus}</p>}
                </div>
              )}
            </div>
          </>
          )}
        </div>
      </div>

      <div className="absolute bottom-2 right-4 z-30 flex items-center gap-1.5">
        <button
          onClick={typeHistory.length > 0 ? undoType : undoLastSave}
          disabled={typeHistory.length === 0 && saveCheckpoints.length === 0}
          title={typeHistory.length > 0 ? `Undo last edit (${typeHistory.length} step${typeHistory.length !== 1 ? 's' : ''})` : 'Revert most recent saved change set'}
          className="h-8 px-3 rounded-lg text-sm font-medium transition-all bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center gap-1.5"
        >
          <span aria-hidden="true">↩</span>
          Undo
        </button>
        <button
          onClick={() => setShowSaveReview(true)}
          disabled={savingPending || !hasDirty}
          className="h-8 px-3 rounded-lg text-sm font-medium transition-all bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center gap-2"
        >
          {hasDirty && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
          <span aria-hidden="true">💾</span>
          {savingPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {showSaveReview && hasDirty && (
        <div className="fixed inset-0 z-[5000] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-100">Review Pending Changes</div>
                <div className="text-xs text-slate-400">Selectively revert items or confirm save.</div>
              </div>
              <button
                onClick={() => setShowSaveReview(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
                title="Close"
              >
                x
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-3 space-y-2">
              {pendingItems.map(item => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-200 truncate">{item.label}</div>
                    <div className="text-[11px] text-slate-400 truncate">{item.detail}</div>
                  </div>
                  <button
                    onClick={item.onRevert}
                    disabled={savingPending}
                    className="h-7 px-2 rounded border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:text-rose-200 text-xs disabled:opacity-50"
                  >
                    Revert
                  </button>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between gap-2">
              <button
                onClick={revertAllPending}
                disabled={savingPending || pendingItems.length === 0}
                className="h-8 px-3 rounded-lg border border-rose-700/70 bg-rose-900/30 text-rose-300 hover:text-rose-200 text-xs disabled:opacity-50"
              >
                Revert All
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSaveReview(false)}
                  disabled={savingPending}
                  className="h-8 px-3 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 hover:text-slate-100 text-xs disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void savePendingChanges(); }}
                  disabled={savingPending || pendingItems.length === 0}
                  className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50"
                >
                  {savingPending ? 'Saving…' : `Confirm Save (${pendingItems.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab row */}
      <div className="flex gap-1 px-4 pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            onMouseEnter={() => onPrefetchTab(tab.id)}
            onFocus={() => onPrefetchTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-indigo-400 border-indigo-500 bg-slate-800/50'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>


    </div>
  );
}
