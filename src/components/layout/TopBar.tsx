import { useEffect, useRef, useState, useMemo } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { useCommunityMapsStore } from '../../store/communityMapsStore';
import type { ActiveTab } from '../../store/uiStore';
import { basename, type MissionFiles } from '../../lib/fileDiscovery';

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'map',           label: 'Map' },
  { id: 'types',         label: 'Loot Types' },
  { id: 'spawnableTypes', label: 'Spawnable Types' },
  { id: 'playerSpawns',  label: 'Player Spawns' },
  { id: 'events',        label: 'Events' },
  { id: 'spawns',        label: 'Event Spawns' },
  { id: 'economy',       label: 'Economy Core' },
  { id: 'weather',       label: 'Weather' },
  { id: 'gameplay',      label: 'Gameplay' },
];

const BUILTIN_MAPS: { id: string; label: string }[] = [
  { id: 'namalsk',   label: 'Namalsk' },
  { id: 'chernarus', label: 'Chernarus+' },
  { id: 'livonia',   label: 'Livonia' },
  { id: 'sakhal',    label: 'Sakhal' },
  { id: 'custom',    label: 'Custom' },
];

function Row({ label, value, mono, href }: { label: string; value: string; mono?: boolean; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-slate-500">{label}</span>
      {href ? (
        <button
          onClick={() => openUrl(href)}
          className={`text-xs text-lime-400 hover:text-lime-300 hover:underline transition-colors ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </button>
      ) : (
        <span className={`text-xs text-slate-300 ${mono ? 'font-mono' : ''}`}>{value}</span>
      )}
    </div>
  );
}

function folderLabel(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

function folderSubLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? `…/${parts.slice(-2).join('/')}` : path;
}

export function TopBar({
  onOpenFolder,
  onOpenFromPath,
  onPrefetchTab,
  allMissions,
}: {
  onOpenFolder: () => void;
  onOpenFromPath: (path: string) => void;
  onPrefetchTab: (tab: ActiveTab) => void;
  allMissions: MissionFiles[];
}) {
  const serverRootPath = useServerStore(s => s.serverRootPath);
  const missionPath = useServerStore(s => s.paths.missionPath);
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
  const saveLimitsDefinition = useServerStore(s => s.saveLimitsDefinition);
  const saveLimitsDefinitionUser = useServerStore(s => s.saveLimitsDefinitionUser);
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
  const revertLimitsDefinition = useServerStore(s => s.revertLimitsDefinition);
  const revertLimitsDefinitionUser = useServerStore(s => s.revertLimitsDefinitionUser);
  const saveTerritoryBitmaps = useServerStore(s => s.saveTerritoryBitmaps);
  const revertTerritoryBitmaps = useServerStore(s => s.revertTerritoryBitmaps);
  const undoTerritoryPaint = useServerStore(s => s.undoTerritoryPaint);
  const territoryPaintHistory = useServerStore(s => s.territoryPaintHistory);
  const undoType = useServerStore(s => s.undoType);
  const undoMapGroupProto = useServerStore(s => s.undoMapGroupProto);
  const undoZoneRemove = useServerStore(s => s.undoZoneRemove);
  const typeHistory = useServerStore(s => s.typeHistory);
  const mapGroupProtoHistory = useServerStore(s => s.mapGroupProtoHistory);
  const zoneRemoveHistory = useServerStore(s => s.zoneRemoveHistory);
  const activeTab = useUiStore(s => s.activeTab);
  const setActiveTab = useUiStore(s => s.setActiveTab);
  const activeMap = useUiStore(s => s.activeMap);
  const setActiveMap = useUiStore(s => s.setActiveMap);
  const showSaveReview = useUiStore(s => s.showSaveReview);
  const setShowSaveReview = useUiStore(s => s.setShowSaveReview);
  const isLoading = useUiStore(s => s.isLoading);
  const recentFolders = useUiStore(s => s.recentFolders);

  const communityMaps = useCommunityMapsStore(s => s.maps);
  const setSettingsScrollTarget = useUiStore(s => s.setSettingsScrollTarget);
  const setShowCommunityMapsModal = useUiStore(s => s.setShowCommunityMapsModal);
  const mapImagePaths = useUiStore(s => s.mapImagePaths);



  const TERRAIN_KEYWORDS: Record<string, string[]> = {
    namalsk:   ['namalsk'],
    chernarus: ['chernarus'],
    livonia:   ['livonia', 'enoch'],
    sakhal:    ['sakhal'],
  };

  const mapsWithMissions = useMemo(() => {
    const s = new Set<string>();
    for (const m of allMissions) {
      const lower = m.missionName.toLowerCase();
      for (const [mapId, keywords] of Object.entries(TERRAIN_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) { s.add(mapId); break; }
      }
    }
    return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMissions]);

  const MAPS = useMemo(() => {
    const builtinIds = new Set(BUILTIN_MAPS.map(m => m.id));
    const missionName = mission?.missionName.toLowerCase() ?? null;
    const builtins = missionName
      ? BUILTIN_MAPS.filter(m =>
          m.id === 'custom' ||
          (TERRAIN_KEYWORDS[m.id]?.some(kw => missionName.includes(kw)) ?? false) ||
          mapsWithMissions.has(m.id) ||
          !!mapImagePaths[m.id]
        )
      : BUILTIN_MAPS;
    return [
      ...builtins.filter(m => m.id !== 'custom'),
      ...communityMaps
        .filter(cm => !builtinIds.has(cm.id))
        .map(cm => ({ id: cm.id, label: cm.label })),
      { id: 'custom', label: 'Custom' },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityMaps, mission, mapsWithMissions, mapImagePaths]);

  const [showAbout, setShowAbout] = useState(false);
  const [showServerMenu, setShowServerMenu] = useState(false);
  const serverMenuRef = useRef<HTMLDivElement | null>(null);
  const [showMapDropdown, setShowMapDropdown] = useState(false);
  const mapDropdownRef = useRef<HTMLDivElement | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [savingPending, setSavingPending] = useState(false);
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

  const hasDirty = dirty.typesSources.length > 0 || dirty.eventSpawns || dirty.events || dirty.spawnableTypes || dirty.mapGroupProto || dirty.weather || dirty.gameplay || dirty.limitsDefinition || dirty.limitsDefinitionUser || dirty.territoryBitmaps;
  const pendingItems: Array<{ id: string; label: string; detail: string; onRevert: () => void }> = [
    ...dirty.typesSources.map(source => ({
      id: `types:${source}`,
      label: 'types.xml source',
      detail: basename(source),
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
    ...(dirty.limitsDefinition
      ? [{ id: 'limitsDefinition', label: 'cfglimitsdefinition.xml', detail: 'Usage zones & categories', onRevert: () => revertLimitsDefinition() }]
      : []),
    ...(dirty.limitsDefinitionUser
      ? [{ id: 'limitsDefinitionUser', label: 'cfglimitsdefinitionuser.xml', detail: 'Usage & value group aliases', onRevert: () => revertLimitsDefinitionUser() }]
      : []),
    ...(dirty.territoryBitmaps
      ? [{ id: 'territoryBitmaps', label: 'territory zones', detail: 'areaflags.map will be recompiled', onRevert: () => revertTerritoryBitmaps() }]
      : []),
  ];

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  useEffect(() => {
    if (!showServerMenu) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (serverMenuRef.current && target && !serverMenuRef.current.contains(target)) {
        setShowServerMenu(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showServerMenu]);

  useEffect(() => {
    if (!showMapDropdown) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (mapDropdownRef.current && target && !mapDropdownRef.current.contains(target)) {
        setShowMapDropdown(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showMapDropdown]);

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

  const handleTabClick = (tabId: ActiveTab) => {
    pendingTabRef.current = tabId;
    if (!tabSwitchInFlightRef.current) {
      const currentTab = useUiStore.getState().activeTab;
      if (tabId !== currentTab) {
        commitPendingTab();
      }
    }
  };

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
      if (dirty.limitsDefinition) await saveLimitsDefinition();
      if (dirty.limitsDefinitionUser) await saveLimitsDefinitionUser();
      if (dirty.territoryBitmaps) await saveTerritoryBitmaps();
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
    for (const source of dirty.typesSources) revertTypesSource(source);
    if (dirty.eventSpawns) revertEventSpawns();
    if (dirty.events) revertEvents();
    if (dirty.spawnableTypes) revertSpawnableTypes();
    if (dirty.mapGroupProto) revertMapGroupProto();
    if (dirty.weather) revertWeather();
    if (dirty.gameplay) revertGameplay();
    if (dirty.limitsDefinition) revertLimitsDefinition();
    if (dirty.limitsDefinitionUser) revertLimitsDefinitionUser();
    if (dirty.territoryBitmaps) revertTerritoryBitmaps();
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
          <img src="/favicon.svg" className="w-6 h-6" />
          <span className="font-semibold text-slate-200 text-sm">lime's CE Editor</span>
        </div>

        <div ref={serverMenuRef} className="relative">
          <button
            onClick={() => !isLoading && setShowServerMenu(v => !v)}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {isLoading ? 'Loading…' : (serverRootPath ? folderLabel(serverRootPath) : 'Open Server…')}
            {!isLoading && (
              <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>

          {showServerMenu && (
            <div className="absolute top-full left-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[260px]">
              {recentFolders.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[11px] text-slate-500 uppercase tracking-wider">Recent</div>
                  {recentFolders.map(path => (
                    <button
                      key={path}
                      onClick={() => { onOpenFromPath(path); setShowServerMenu(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors flex items-center gap-2.5"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${path === serverRootPath ? 'text-lime-400' : 'text-slate-200'}`}>{folderLabel(path)}</p>
                        <p className="text-xs text-slate-500 font-mono truncate">{folderSubLabel(path)}</p>
                      </div>
                    </button>
                  ))}
                  <div className="border-t border-slate-700 my-1" />
                </>
              )}
              <button
                onClick={() => { onOpenFolder(); setShowServerMenu(false); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors flex items-center gap-2.5 text-slate-300"
              >
                <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm">Browse for folder…</span>
              </button>
            </div>
          )}
        </div>

        {mission && (
          <span className="flex items-center text-slate-400 text-sm">
            <span className="text-slate-500 mr-1">Mission:</span>
            {mission.missionName}
            <span className="ml-2 text-slate-500">
              · {mission.types.size} items
              · {mission.eventSpawns.length} events
            </span>
            <button
              onClick={() => {
                const dir = missionPath ?? serverRootPath;
                if (dir) openPath(dir).catch(err => console.error('Failed to open folder:', err));
              }}
              className="ml-2 flex items-center justify-center w-6 h-6 rounded border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors"
              title="Open mission folder in file manager"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {serverRootPath && (
            <>
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1.5 text-slate-400 text-xs">
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
                  Saving…
                </span>
              )}
              {saveStatus === 'success' && (
                <span className="flex items-center gap-1.5 text-green-400 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  Saved
                </span>
              )}

              <div className="flex items-center gap-1.5">
                <button
                  onClick={typeHistory.length > 0 ? undoType : mapGroupProtoHistory.length > 0 ? undoMapGroupProto : zoneRemoveHistory.length > 0 ? undoZoneRemove : territoryPaintHistory.length > 0 ? undoTerritoryPaint : undoLastSave}
                  disabled={typeHistory.length === 0 && mapGroupProtoHistory.length === 0 && zoneRemoveHistory.length === 0 && territoryPaintHistory.length === 0 && saveCheckpoints.length === 0}
                  title={typeHistory.length > 0 ? `Undo last edit (${typeHistory.length} step${typeHistory.length !== 1 ? 's' : ''})` : mapGroupProtoHistory.length > 0 ? `Undo last building change (${mapGroupProtoHistory.length} step${mapGroupProtoHistory.length !== 1 ? 's' : ''})` : zoneRemoveHistory.length > 0 ? `Undo zone deletion "${zoneRemoveHistory[0].usage}"` : territoryPaintHistory.length > 0 ? `Undo territory paint (${territoryPaintHistory.length} stroke${territoryPaintHistory.length !== 1 ? 's' : ''})` : 'Revert most recent saved change set'}
                  className="h-8 px-3 rounded-lg text-xs font-medium transition-colors bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <span aria-hidden="true">↩</span>
                  Undo
                </button>
                <button
                  onClick={() => setShowSaveReview(true)}
                  disabled={savingPending || !hasDirty}
                  title={hasDirty ? `Unsaved changes:\n${pendingItems.map(i => `  • ${i.detail}`).join('\n')}` : 'Nothing to save'}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${hasDirty ? 'bg-lime-500 hover:bg-lime-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-500 cursor-default'}`}
                >
                  {hasDirty && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                  {savingPending ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div className="w-px h-4 bg-slate-700 mx-1" />

              <div ref={mapDropdownRef} className="relative">
                <button
                  onClick={() => setShowMapDropdown(v => !v)}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${showMapDropdown ? 'bg-lime-600 text-white' : 'bg-lime-500 text-white'}`}
                >
                  {MAPS.find(m => m.id === activeMap)?.label ?? activeMap}
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showMapDropdown && (
                  <div className="absolute top-full right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[160px] py-1">
                    {MAPS.map(m => (
                      <div key={m.id}>
                        {m.id === 'custom' && <div className="my-1 border-t border-slate-700" />}
                        <button
                          onClick={() => {
                            setShowMapDropdown(false);
                            if (m.id === 'custom') {
                              if (activeTab === 'settings') {
                                setSettingsScrollTarget('community-maps');
                              } else {
                                setShowCommunityMapsModal(true);
                              }
                            } else {
                              setActiveMap(m.id);
                            }
                          }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                            activeMap === m.id
                              ? 'text-lime-400 bg-slate-800'
                              : 'text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          {activeMap === m.id && (
                            <svg className="w-3 h-3 text-lime-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                          )}
                          {activeMap !== m.id && <span className="w-3 flex-shrink-0" />}
                          {m.label}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-slate-700 mx-1" />
            </>
          )}

          <button
            onClick={() => setShowAbout(true)}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            title="About"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>
      </div>

      {showSaveReview && hasDirty && (
        <div className="fixed inset-0 z-[5000] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-100">Review Pending Changes</div>
                <div className="text-xs text-slate-500">Selectively revert items or confirm save.</div>
              </div>
              <button
                onClick={() => setShowSaveReview(false)}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
                    className="h-8 px-3 rounded-lg border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:text-rose-200 text-xs disabled:opacity-50"
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
                className="h-8 px-3 rounded-lg border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:text-rose-200 text-xs disabled:opacity-50"
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
                  className="h-8 px-3 rounded-lg bg-lime-500 hover:bg-lime-600 text-white text-xs font-medium disabled:opacity-50"
                >
                  {savingPending ? 'Saving…' : `Confirm Save (${pendingItems.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAbout && (
        <div
          className="fixed inset-0 z-[5000] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowAbout(false)}
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center">
              <img src="/favicon.svg" className="w-14 h-14 mb-4" />
              <h2 className="text-lg font-semibold text-slate-100">Lime's CE Editor</h2>
              {appVersion && (
                <span className="mt-1 text-xs text-slate-500 font-mono">v{appVersion}</span>
              )}
            </div>

            <div className="border-t border-slate-800 px-6 py-4 space-y-3">
              <Row label="Author" value="lime" />
              <Row label="GitHub" value="itismelime/limes-ce-editor" href="https://github.com/itismelime/limes-ce-editor" mono />
              <Row label="License" value="MIT" />
              <Row label="Built with" value="Tauri v2 · React · Rust" />
            </div>

            <div className="border-t border-slate-800 px-6 py-4">
              <p className="text-xs text-slate-500 text-center leading-relaxed">
                A desktop editor for DayZ server loot tables, CE economy files,
                and map group configurations.
              </p>
            </div>

            <div className="border-t border-slate-800 px-6 py-3 flex justify-center">
              <button
                onClick={() => setShowAbout(false)}
                className="h-8 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab row */}
      <div className="flex gap-1 px-4 pb-2">
        {serverRootPath && TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            onMouseEnter={() => onPrefetchTab(tab.id)}
            onFocus={() => onPrefetchTab(tab.id)}
            className={`h-8 px-4 text-xs font-medium rounded-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-lime-500 text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => handleTabClick('settings')}
          onMouseEnter={() => onPrefetchTab('settings')}
          onFocus={() => onPrefetchTab('settings')}
          className={`ml-auto h-8 px-4 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'settings'
              ? 'bg-lime-500 text-white'
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
          }`}
        >
          Settings
        </button>
      </div>
    </div>
  );
}
