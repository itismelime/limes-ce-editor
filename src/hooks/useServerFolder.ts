import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { pickAndDiscoverServer, scanFolder, readFile, findCeToolTierLayers, findCeToolProjectXmlInMission, pickCeToolFolder as pickCeToolFolderDialog, type MissionFiles } from '../lib/fileDiscovery';

import {
  parseTypesXml, parseEventSpawnsXml,
  parseEventsXml, parseSpawnableTypesXml,
  inspectTypesXmlCompatibility, inspectEventSpawnsCompatibility,
  inspectEventsXmlCompatibility, inspectSpawnableTypesCompatibility,
  parseEconomyCoreXml,
  parseMapGroupProtoXml, parseMapGroupPosXml, joinMapGroups,
  parsePlayerSpawnPointsXml,
  parseWeatherXml, parseGameplayJson,
  parseLimitsDefinitionXml, parseLimitsDefinitionUserXml,
} from '../lib/xmlParser';
import { clearAreaFlags, loadTierLayers } from '../lib/tierZoneResolver';
import { readBinaryFile } from '../lib/fileDiscovery';
import { getAllMapConfigs, BUILTIN_MAP_BY_ID, bundledCeToolPath, detectBuiltinMap } from '../lib/mapConfig';
import { parseCeToolProjectXml } from '../lib/ceToolParser';
import { findFFSpawnSelectorConfig, parseFFSettings, parseFFSpawnPoints } from '../lib/ffSpawnSelector';
import type { MissionData, CeEntry, CeToolProject, DayZType, DayZEvent, SpawnableType } from '../types/dayz';
import type { CommunityMapDef } from '../types/map';
import { useServerStore, toMessage, confirmDiscardUnsaved, type TerritoryBitmapOverride } from '../store/serverStore';
import { useUiStore } from '../store/uiStore';
import { useCommunityMapsStore } from '../store/communityMapsStore';

const FILE_KEYS = ['typesPath', 'eventSpawnsPath', 'eventsPath', 'spawnableTypesPath'] as const;
const LAYER_EXTS = ['.tga', '.png', '.bmp'];
const ASSET_BASE = import.meta.env.BASE_URL || '/';

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function toAssetUrl(path: string): string {
  const cleanBase = ASSET_BASE.endsWith('/') ? ASSET_BASE : `${ASSET_BASE}/`;
  const cleanPath = path.replace(/^\/+/, '');
  return `${cleanBase}${cleanPath}`;
}

async function readBundledText(path: string): Promise<string> {
  const url = toAssetUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bundled asset not found: ${url}`);
  return await res.text();
}

async function readBundledBinary(path: string): Promise<Uint8Array> {
  const url = toAssetUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bundled asset not found: ${url}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) throw new Error(`bundled asset returned HTML (SPA fallback): ${url}`);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

async function loadLayerByName(projectDir: string, layerName: string): Promise<Uint8Array | null> {
  const hasExt = /\.[a-z0-9]+$/i.test(layerName);
  const names = hasExt ? [layerName] : LAYER_EXTS.map(ext => `${layerName}${ext}`);
  for (const name of names) {
    const path = joinPath(projectDir, 'layers', name);
    try {
      return await readBinaryFile(path);
    } catch {
      // try next extension candidate
    }
  }
  return null;
}

async function loadBundledLayerByName(projectDir: string, layerName: string): Promise<Uint8Array | null> {
  const hasExt = /\.[a-z0-9]+$/i.test(layerName);
  const names = hasExt ? [layerName] : LAYER_EXTS.map(ext => `${layerName}${ext}`);
  for (const name of names) {
    const path = joinPath(projectDir, 'layers', name);
    try {
      return await readBundledBinary(path);
    } catch {
      // try next extension candidate
    }
  }
  return null;
}

async function mergeEconomyCoreFiles(
  missionPath: string,
  entries: CeEntry[],
  baseTypes: Map<string, DayZType>,
  baseSpawnables: Map<string, SpawnableType>,
  baseEvents: Map<string, DayZEvent>,
): Promise<{ types: Map<string, DayZType>; spawnableTypes: Map<string, SpawnableType>; events: Map<string, DayZEvent>; warnings: string[] }> {
  const types = new Map(baseTypes);
  const spawnableTypes = new Map(baseSpawnables);
  const events = new Map(baseEvents);
  const warnings: string[] = [];

  for (const entry of entries) {
    for (const file of entry.files) {
      const filePath = `${missionPath}/${entry.folder}/${file.name}`;
      try {
        if (file.type === 'types') {
          const raw = await readFile(filePath);
          for (const [name, type] of parseTypesXml(raw, filePath)) types.set(name, type);
        } else if (file.type === 'spawnabletypes' || file.type === 'cfgspawnabletypes') {
          const raw = await readFile(filePath);
          const parsed = parseSpawnableTypesXml(raw, filePath);
          if (parsed.size === 0 && /<types[\s>]/i.test(raw)) {
            for (const [name, type] of parseTypesXml(raw, filePath)) types.set(name, type);
          } else {
            for (const [name, st] of parsed) spawnableTypes.set(name, st);
          }
        } else if (file.type === 'events') {
          for (const [name, ev] of parseEventsXml(await readFile(filePath))) events.set(name, { ...ev, source: filePath });
        } else {
          warnings.push(`ce file not found: ${entry.folder}/${file.name} (unknown type: "${file.type}")`);
        }
      } catch (err) {
        warnings.push(`ce file not found: ${entry.folder}/${file.name} (${toMessage(err)})`);
      }
    }
  }

  return { types, spawnableTypes, events, warnings };
}

async function loadCeToolTierData(opts: {
  missionPath: string | null;
  activeMap: string;
  ceToolFolderOverride: string | null;
  serverRootPath: string | null;
  communityMaps: CommunityMapDef[];
}): Promise<{ ceProject: CeToolProject | null; loaded: boolean; ceSource: 'bundled' | 'user' | null; warnings: string[] }> {
  const { missionPath, activeMap, ceToolFolderOverride, serverRootPath, communityMaps } = opts;
  const warnings: string[] = [];

  if (!serverRootPath) {
    console.warn('[tiers] No rootPath available');
    return { ceProject: null, loaded: false, ceSource: null, warnings };
  }

  const mapCfg = getAllMapConfigs(communityMaps)[activeMap] ?? getAllMapConfigs(communityMaps)['namalsk'];
  let worldSize = mapCfg.worldWidth;
  const layers: Partial<Record<string, Uint8Array>> = {};
  const usageLayers: Partial<Record<string, Uint8Array[]>> = {};
  let ceProject: CeToolProject | null = null;

  console.info('[tiers] Starting tier load for map:', activeMap, 'root:', serverRootPath, 'override:', ceToolFolderOverride);

  try {
    const ceProjectPath = ceToolFolderOverride
      ? ceToolFolderOverride
      : missionPath
        ? await findCeToolProjectXmlInMission(missionPath, activeMap)
        : null;
    console.info('[tiers] Found CE project XML at:', ceProjectPath);

    let resolvedProjectPath = ceProjectPath;
    let usingBundledCeTool = false;

    if (!resolvedProjectPath) {
      const bundled = bundledCeToolPath(activeMap, 'xml');
      if (bundled) {
        resolvedProjectPath = bundled;
        usingBundledCeTool = true;
        console.info('[tiers] Using bundled CE project XML:', resolvedProjectPath);
      }
    }

    if (resolvedProjectPath) {
      try {
        const projectRaw = usingBundledCeTool
          ? await readBundledText(resolvedProjectPath)
          : await readFile(resolvedProjectPath);
        ceProject = parseCeToolProjectXml(projectRaw, resolvedProjectPath);
        console.info('[tiers] Parsed CE project, worldSize:', ceProject.worldSize, 'tierLayerNames:', ceProject.tierLayerNames);
        if (ceProject.worldSize > 0) worldSize = ceProject.worldSize;

        for (const [tier, layerName] of Object.entries(ceProject.tierLayerNames)) {
          if (!layerName) continue;
          console.info('[tiers] Loading layer:', tier, '=', layerName);
          const raw = usingBundledCeTool
            ? await loadBundledLayerByName(ceProject.projectDir, layerName)
            : await loadLayerByName(ceProject.projectDir, layerName);
          if (raw) {
            console.info('[tiers] Loaded layer:', tier, 'size:', raw.byteLength, 'bytes');
            layers[tier] = raw;
          } else {
            console.warn('[tiers] Failed to load layer:', tier, layerName);
          }
        }

        for (const [usage, layerNames] of Object.entries(ceProject.usageLayerNames ?? {})) {
          if (!layerNames?.length) continue;
          const raws: Uint8Array[] = [];
          for (const layerName of layerNames) {
            const raw = usingBundledCeTool
              ? await loadBundledLayerByName(ceProject.projectDir, layerName)
              : await loadLayerByName(ceProject.projectDir, layerName);
            if (raw) raws.push(raw);
          }
          if (raws.length > 0) usageLayers[usage] = raws;
        }
        console.info('[tiers] Usage layers collected:', Object.keys(usageLayers).length, 'types');

      } catch (err) {
        console.error('[tiers] CE project parse error:', err);
        warnings.push(`CETool project parse error (${toMessage(err)})`);
      }
    } else {
      console.warn('[tiers] No CE project XML found');
    }

    if (Object.keys(layers).length === 0) {
      console.info('[tiers] Trying fallback layer discovery in mission path:', missionPath);
      const layerPaths = await findCeToolTierLayers(missionPath ?? '', activeMap);
      const layerEntries = Object.entries(layerPaths).filter((entry): entry is [string, string] => Boolean(entry[1]));
      console.info('[tiers] Fallback found', layerEntries.length, 'layers:', layerEntries.map(e => e[0]));
      for (const [tier, path] of layerEntries) {
        try {
          const raw = await readBinaryFile(path);
          console.info('[tiers] Loaded fallback layer:', tier, 'from', path, 'size:', raw.byteLength);
          layers[tier] = raw;
        } catch (e) {
          console.error('[tiers] Failed to read fallback layer:', tier, e);
        }
      }
    }

    if (Object.keys(layers).length > 0) {
      console.info('[tiers] Calling loadTierLayers with', Object.keys(layers).length, 'layers,', Object.keys(usageLayers).length, 'usage types, worldSize:', worldSize);
      const loaded = await loadTierLayers(layers, worldSize, worldSize, usageLayers);
      console.info('[tiers] loadTierLayers returned:', loaded);
      return { ceProject, loaded, ceSource: usingBundledCeTool ? 'bundled' : 'user', warnings };
    }

    console.warn('[tiers] No layers found after discovery');
    return { ceProject, loaded: false, ceSource: usingBundledCeTool ? 'bundled' : 'user', warnings };

  } catch (e) {
    console.error('[cetool tiers] load failed:', e);
    return { ceProject, loaded: false, ceSource: null, warnings };
  }
}

function autoSelectMission(missions: MissionFiles[], activeMap: string): MissionFiles | null {
  const keywords = BUILTIN_MAP_BY_ID[activeMap]?.keywords;
  if (!keywords) return null;
  const matches = missions.filter(m =>
    keywords.some(kw => m.missionName.toLowerCase().includes(kw))
  );
  if (matches.length === 0) return null;
  // Among matches, pick the one with the most files found
  return matches.reduce((best, m) =>
    FILE_KEYS.filter(k => m[k] !== null).length > FILE_KEYS.filter(k => best[k] !== null).length ? m : best
  );
}

async function loadMission(m: MissionFiles): Promise<{ mission: MissionData; warnings: string[] }> {
  const warnings: string[] = [];

  if (!m.typesPath)          warnings.push('types.xml');
  if (!m.eventSpawnsPath)    warnings.push('cfgeventspawns.xml');
  if (!m.eventsPath)         warnings.push('events.xml');
  if (!m.spawnableTypesPath) warnings.push('cfgspawnabletypes.xml');

  const [typesRaw, spawnsRaw, eventsRaw, spawnableRaw] = await Promise.all([
    m.typesPath          ? readFile(m.typesPath).catch(() => null)          : Promise.resolve(null),
    m.eventSpawnsPath    ? readFile(m.eventSpawnsPath).catch(() => null)    : Promise.resolve(null),
    m.eventsPath         ? readFile(m.eventsPath).catch(() => null)         : Promise.resolve(null),
    m.spawnableTypesPath ? readFile(m.spawnableTypesPath).catch(() => null) : Promise.resolve(null),
  ]);

  let types = new Map();
  let eventSpawns: MissionData['eventSpawns'] = [];
  let events = new Map();
  let spawnableTypes = new Map();

  // Duplicate name= entries are last-wins in the parsers and the dropped ones
  // would silently vanish on the next save — surface them as load notices.
  const dupWarn = (file: string, dups: string[]) => {
    if (dups.length === 0) return;
    const shown = [...new Set(dups)].slice(0, 6).join(', ');
    warnings.push(`compat: ${file} defines ${shown}${dups.length > 6 ? ', ...' : ''} more than once; the last definition is the one shown and used`);
  };
  const typeDups: string[] = [], eventDups: string[] = [], spawnableDups: string[] = [];

  try { if (typesRaw)     types          = parseTypesXml(typesRaw, m.typesPath ?? '', typeDups); }
  catch (err) { warnings.push(`types.xml (parse error: ${toMessage(err)})`); }
  try { if (spawnsRaw)    eventSpawns    = parseEventSpawnsXml(spawnsRaw); }
  catch (err) { warnings.push(`cfgeventspawns.xml (parse error: ${toMessage(err)})`); }
  try { if (eventsRaw)    events         = parseEventsXml(eventsRaw, eventDups); }
  catch (err) { warnings.push(`events.xml (parse error: ${toMessage(err)})`); }
  try { if (spawnableRaw) spawnableTypes = parseSpawnableTypesXml(spawnableRaw, m.spawnableTypesPath ?? '', spawnableDups); }
  catch (err) { warnings.push(`cfgspawnabletypes.xml (parse error: ${toMessage(err)})`); }

  dupWarn('types.xml', typeDups);
  dupWarn('events.xml', eventDups);
  dupWarn('cfgspawnabletypes.xml', spawnableDups);

  try {
    if (typesRaw) {
      const unknown = inspectTypesXmlCompatibility(typesRaw);
      if (unknown.length > 0) warnings.push(`compat: types.xml unknown nodes (${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ', ...' : ''})`);
    }
  } catch {
    // Compatibility inspector should never block loading.
  }
  try {
    if (spawnsRaw) {
      const unknown = inspectEventSpawnsCompatibility(spawnsRaw);
      if (unknown.length > 0) warnings.push(`compat: cfgeventspawns.xml unknown nodes (${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ', ...' : ''})`);
    }
  } catch {
    // Compatibility inspector should never block loading.
  }
  try {
    if (eventsRaw) {
      const unknown = inspectEventsXmlCompatibility(eventsRaw);
      if (unknown.length > 0) warnings.push(`compat: events.xml unknown nodes (${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ', ...' : ''})`);
    }
  } catch {
    // Compatibility inspector should never block loading.
  }
  try {
    if (spawnableRaw) {
      const unknown = inspectSpawnableTypesCompatibility(spawnableRaw);
      if (unknown.length > 0) warnings.push(`compat: cfgspawnabletypes.xml unknown nodes (${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ', ...' : ''})`);
    }
  } catch {
    // Compatibility inspector should never block loading.
  }

  return {
    mission: { missionName: m.missionName, types, eventSpawns, events, spawnableTypes },
    warnings,
  };
}

// FF_SpawnSelector plugin config -- not mission-scoped (profiles/ is a
// server-root sibling of mpmissions/), loaded once per server root and
// independent of which mission is currently selected. Fire-and-forget from
// callers: never awaited, so a slow profiles/ scan can't block mission load.
async function loadFFSpawnSelector(rootPath: string): Promise<void> {
  const store = useServerStore.getState();
  store.setFfSettings(null);
  store.setFfSpawnPoints(null);
  store.setFfProfileName(null);
  store.setPaths({ ffSettingsPath: null, ffSpawnPointsPath: null });

  const found = await findFFSpawnSelectorConfig(rootPath);
  if (!found) return;

  store.setFfProfileName(found.profileName);
  store.setPaths({ ffSettingsPath: found.settingsPath, ffSpawnPointsPath: found.spawnPointsPath });

  const warnings: string[] = [];
  if (found.settingsPath) {
    try { store.setFfSettings(parseFFSettings(await readFile(found.settingsPath))); }
    catch (err) { warnings.push(`FFSpawnSelector/Settings.json (parse error: ${toMessage(err)})`); }
  }
  if (found.spawnPointsPath) {
    try { store.setFfSpawnPoints(parseFFSpawnPoints(await readFile(found.spawnPointsPath))); }
    catch (err) { warnings.push(`FFSpawnSelector/SpawnPoints.json (parse error: ${toMessage(err)})`); }
  }
  if (warnings.length > 0) {
    const uiStore = useUiStore.getState();
    uiStore.setLoadWarnings([...uiStore.loadWarnings, ...warnings]);
  }
}

async function loadTerritoryBitmapsFallback(
  activeMap: string,
  communityMaps: CommunityMapDef[],
  loadTerritoryBitmaps: (override?: TerritoryBitmapOverride) => Promise<void>,
  getAllConfigs: typeof getAllMapConfigs,
): Promise<void> {
  // 1. Community map with uploaded CE project
  const communityMap = communityMaps.find(m => m.id === activeMap);
  if (communityMap?.ceToolProjectPath) {
    try {
      const xmlText = await readFile(communityMap.ceToolProjectPath);
      const layersDir = communityMap.ceToolProjectPath.replace(/[/\\][^/\\]+$/, '') + '/layers';
      const worldSize = communityMap.worldWidth;
      const layerLoader = async (name: string): Promise<Uint8Array | null> => {
        try { return await readBinaryFile(`${layersDir}/${name}.tga`); }
        catch { return null; }
      };
      await loadTerritoryBitmaps({ xmlContent: xmlText, layerLoader, worldSize, layersDir });
      return;
    } catch { /* fall through */ }
  }

  // 2. Bundled data for built-in maps
  const bundledXmlPath = bundledCeToolPath(activeMap, 'xml');
  if (!bundledXmlPath) return;

  let xmlText: string;
  try {
    xmlText = await readBundledText(bundledXmlPath);
  } catch {
    return;
  }

  const mapCfg = getAllConfigs(communityMaps)[activeMap];
  const worldSize = mapCfg?.worldWidth ?? 15360;
  const projectDir = bundledXmlPath.slice(0, bundledXmlPath.lastIndexOf('/'));

  const layerLoader = (name: string) => loadBundledLayerByName(projectDir, name);
  await loadTerritoryBitmaps({ xmlContent: xmlText, layerLoader, worldSize, layersDir: null });
}

export function useServerFolder() {
  const setMission           = useServerStore(s => s.setMission);
  const setPaths             = useServerStore(s => s.setPaths);
  const setEconomyCore       = useServerStore(s => s.setEconomyCore);
  const setBuildingInstances = useServerStore(s => s.setBuildingInstances);
  const setMapGroupProto     = useServerStore(s => s.setMapGroupProto);
  const setPlayerSpawnData   = useServerStore(s => s.setPlayerSpawnData);
  const setCeToolProject     = useServerStore(s => s.setCeToolProject);
  const setCeToolFolderOverride = useServerStore(s => s.setCeToolFolderOverride);
  const setPickCeToolFolder  = useServerStore(s => s.setPickCeToolFolder);
  const setServerRootPath    = useServerStore(s => s.setServerRootPath);
  const setOpenServerFolder  = useServerStore(s => s.setOpenServerFolder);
  const setCeSource          = useServerStore(s => s.setCeSource);
  const setReloadCeToolData  = useServerStore(s => s.setReloadCeToolData);
  const setReloadTerritoryBitmaps = useServerStore(s => s.setReloadTerritoryBitmaps);
  const setWeather           = useServerStore(s => s.setWeather);
  const setGameplay          = useServerStore(s => s.setGameplay);
  const setLimitsDefinition  = useServerStore(s => s.setLimitsDefinition);
  const setLimitsDefinitionUser = useServerStore(s => s.setLimitsDefinitionUser);
  const loadTerritoryBitmaps = useServerStore(s => s.loadTerritoryBitmaps);
  const clearTerritoryState  = useServerStore(s => s.clearTerritoryState);
  const setLoading          = useUiStore(s => s.setLoading);
  const setLoadError        = useUiStore(s => s.setLoadError);
  const setLoadWarnings     = useUiStore(s => s.setLoadWarnings);
  const setMapImagePath     = useUiStore(s => s.setMapImagePath);
  const setTierZonesLoaded  = useUiStore(s => s.setTierZonesLoaded);
  const setActiveMap        = useUiStore(s => s.setActiveMap);
  const activeMap       = useUiStore(s => s.activeMap);
  const communityMaps   = useCommunityMapsStore(s => s.maps);

  const [allMissions, setAllMissions]       = useState<MissionFiles[]>([]);
  const [pendingMissions, setPendingMissions] = useState<MissionFiles[] | null>(null);
  const serverRootRef = useRef<string | null>(null);

  // Stable ref so the map-change effect always calls the latest selectMission
  // without needing it in the dependency array (which would cause double-firing).
  const selectMissionRef = useRef<(m: MissionFiles, confirmed?: boolean) => Promise<void>>(async () => {});
  // Breaks the selectMission → setActiveMap → map-change effect → selectMission
  // cycle that reloaded every mission twice.
  const loadedMissionPathRef = useRef<string | null>(null);

  // `confirmed`: the caller already asked about unsaved changes (folder open).
  const selectMission = useCallback(async (m: MissionFiles, confirmed = false) => {
    if (!confirmed && m.missionPath !== loadedMissionPathRef.current && !confirmDiscardUnsaved('Load another mission')) {
      // The map dropdown triggers this after switching maps; put it back to the loaded mission's map.
      const loaded = useServerStore.getState().mission;
      const loadedMap = loaded ? detectBuiltinMap(loaded.missionName) : null;
      if (loadedMap) setActiveMap(loadedMap);
      return;
    }
    loadedMissionPathRef.current = m.missionPath;
    // Selections point into the previous mission's data.
    useUiStore.setState({ selectedBuildingType: null, selectedBuildingPos: null, selectedEventName: null, selectedFFSpawnPointName: null });
    setPendingMissions(null);
    setLoading(true);
    setLoadError(null);
    setLoadWarnings([]);

    try {
      setPaths({
        missionPath:              m.missionPath,
        typesPath:                m.typesPath,
        eventSpawnsPath:          m.eventSpawnsPath,
        eventsPath:               m.eventsPath,
        spawnableTypesPath:       m.spawnableTypesPath,
        economyCorePath:          m.economyCorePath,
        mapGroupProtoPath:        m.mapGroupProtoPath,
        weatherPath:              m.weatherPath,
        gameplayPath:             m.gameplayPath,
        limitsDefinitionPath:     m.limitsDefinitionPath,
        limitsDefinitionUserPath: m.limitsDefinitionUserPath,
      });

      const { mission, warnings } = await loadMission(m);
      const allWarnings = [...warnings];
      setLoadWarnings(allWarnings);
      setMission(mission);

      const lowerName = mission.missionName.toLowerCase();
      const detectedMap = detectBuiltinMap(lowerName);
      if (detectedMap) setActiveMap(detectedMap);
      const resolvedMap = detectedMap ?? activeMap;

      // Economy core
      let economyCoreEntries: CeEntry[] = [];
      setEconomyCore([]);
      if (m.economyCorePath) {
        try {
          economyCoreEntries = parseEconomyCoreXml(await readFile(m.economyCorePath));
          setEconomyCore(economyCoreEntries);
        } catch { /* optional — silently skip */ }
      }
      if (economyCoreEntries.length > 0) {
        const { types, spawnableTypes, events, warnings: ceWarnings } = await mergeEconomyCoreFiles(
          m.missionPath, economyCoreEntries, mission.types, mission.spawnableTypes, mission.events,
        );
        if (ceWarnings.length > 0) { allWarnings.push(...ceWarnings); setLoadWarnings([...allWarnings]); }
        setMission({ ...mission, types, spawnableTypes, events });
      }

      // Map group proto (building spawn layer)
      if (m.mapGroupProtoPath && m.mapGroupPosPath) {
        try {
          const [protoRaw, posRaw] = await Promise.all([readFile(m.mapGroupProtoPath), readFile(m.mapGroupPosPath)]);
          const proto = parseMapGroupProtoXml(protoRaw);
          setMapGroupProto(proto);
          setBuildingInstances(joinMapGroups(proto, parseMapGroupPosXml(posRaw)));
        } catch (err) {
          setMapGroupProto(new Map());
          setBuildingInstances([]);
          allWarnings.push(`mapgroupproto/mapgrouppos (read error: ${toMessage(err)})`);
          setLoadWarnings([...allWarnings]);
        }
      } else {
        setMapGroupProto(new Map());
        setBuildingInstances([]);
      }

      // CE Tool tiers
      clearAreaFlags();
      setTierZonesLoaded(false);
      setCeToolProject(null);
      const { ceProject, loaded: tiersLoaded, ceSource, warnings: tierWarnings } = await loadCeToolTierData({
        missionPath: m.missionPath,
        activeMap: resolvedMap,
        ceToolFolderOverride: useServerStore.getState().ceToolFolderOverride,
        serverRootPath: serverRootRef.current,
        communityMaps,
      });
      setCeToolProject(ceProject);
      setCeSource(resolvedMap, ceSource);
      if (tiersLoaded) setTierZonesLoaded(true);
      if (!tiersLoaded) console.info('[tiers] No CE Tool tier layers found for this map.');
      else console.info('[tiers] Tier zones loaded successfully');
      if (tierWarnings.length > 0) { allWarnings.push(...tierWarnings); setLoadWarnings([...allWarnings]); }

      // Optional files
      setPlayerSpawnData(null);
      if (m.playerSpawnPointsPath) {
        try { setPlayerSpawnData(parsePlayerSpawnPointsXml(await readFile(m.playerSpawnPointsPath))); }
        catch { /* optional — silently skip */ }
      }

      setWeather(null);
      if (m.weatherPath) {
        try { setWeather(parseWeatherXml(await readFile(m.weatherPath))); }
        catch (err) {
          allWarnings.push(`cfgweather.xml (parse error: ${toMessage(err)})`);
          setLoadWarnings([...allWarnings]);
        }
      }

      setGameplay(null);
      if (m.gameplayPath) {
        try { setGameplay(parseGameplayJson(await readFile(m.gameplayPath))); }
        catch (err) {
          allWarnings.push(`cfggameplay.json (parse error: ${toMessage(err)})`);
          setLoadWarnings([...allWarnings]);
        }
      }

      setLimitsDefinition(null);
      if (m.limitsDefinitionPath) {
        try { setLimitsDefinition(parseLimitsDefinitionXml(await readFile(m.limitsDefinitionPath))); }
        catch { /* optional — silently skip */ }
      }

      setLimitsDefinitionUser(null);
      if (m.limitsDefinitionUserPath) {
        try { setLimitsDefinitionUser(parseLimitsDefinitionUserXml(await readFile(m.limitsDefinitionUserPath))); }
        catch { /* optional — silently skip */ }
      }

      clearTerritoryState();
      setPaths({ ceToolXmlPath: m.ceToolXmlPath ?? null, ceToolLayersDir: m.ceToolLayersDir ?? null });
      if (m.ceToolXmlPath) {
        await loadTerritoryBitmaps().catch((e) => console.warn('[territory] file-based load failed', e));
      } else {
        await loadTerritoryBitmapsFallback(resolvedMap, communityMaps, loadTerritoryBitmaps, getAllMapConfigs).catch((e) => console.warn('[territory] fallback failed', e));
      }

      if (m.mapImagePath) setMapImagePath(resolvedMap, convertFileSrc(m.mapImagePath));
    } catch (err) {
      if (err instanceof Error) setLoadError(`error:${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [activeMap, communityMaps, setMission, setPaths, setLoading, setLoadError, setLoadWarnings, setMapImagePath, setCeToolProject, setCeSource, setLimitsDefinition, setLimitsDefinitionUser, loadTerritoryBitmaps, clearTerritoryState, setActiveMap, setBuildingInstances, setEconomyCore, setGameplay, setMapGroupProto, setPlayerSpawnData, setTierZonesLoaded, setWeather]);

  // Keep ref current every render so the effect below always has the latest version.
  useEffect(() => { selectMissionRef.current = selectMission; });

  // When the active map changes (after initial mount), try to auto-switch missions.
  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (allMissions.length === 0) return;

    if (allMissions.length === 1) {
      if (allMissions[0].missionPath !== loadedMissionPathRef.current) {
        selectMissionRef.current(allMissions[0]);
      }
      return;
    }

    const auto = autoSelectMission(allMissions, activeMap);
    if (auto && auto.missionPath !== loadedMissionPathRef.current) {
      selectMissionRef.current(auto);
    }
    // No match → keep current mission loaded, nothing to do
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap]);

  async function loadFromMissions(missions: MissionFiles[]) {
    // DayZ mission folders always follow <type>.<terrain> naming.
    // Filter out CE mod folders, tools, and other non-mission subdirectories.
    missions = missions.filter(m => m.missionName.includes('.'));
    if (missions.length === 0) {
      setLoadError('no_files_found');
      setLoading(false);
      return;
    }
    setAllMissions(missions);
    if (missions.length === 1) {
      await selectMission(missions[0], true);
    } else {
      const auto = autoSelectMission(missions, activeMap);
      if (auto) {
        await selectMission(auto, true);
      } else {
        setLoading(false);
        setPendingMissions(missions);
      }
    }
  }

  const openFolder = useCallback(async () => {
    if (!confirmDiscardUnsaved('Open another server folder')) return;
    setLoading(true);
    setLoadError(null);
    setLoadWarnings([]);

    try {
      const result = await pickAndDiscoverServer();
      if (!result) { setLoading(false); return; }

      serverRootRef.current = result.path;
      setServerRootPath(result.path);
      setCeToolFolderOverride(null); // belongs to the previous server
      useUiStore.getState().addRecentFolder(result.path);
      void loadFFSpawnSelector(result.path);
      await loadFromMissions(result.missions);
    } catch (err) {
      if (err instanceof Error) {
        setLoadError(err.message.toLowerCase().includes('permission')
          ? 'permission_denied'
          : `error:${err.message}`
        );
      }
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, selectMission, setLoading, setLoadError, setLoadWarnings]);

  const autoLoad = useCallback(async () => {
    if (!useUiStore.getState().rememberLastFolder) return;
    const saved = useUiStore.getState().recentFolders[0] ?? null;
    if (!saved) return;

    setLoading(true);
    try {
      serverRootRef.current = saved;
      setServerRootPath(saved);
      void loadFFSpawnSelector(saved);
      const missions = await scanFolder(saved);
      if (missions.length > 0) await loadFromMissions(missions);
    } catch {
      // Folder gone or inaccessible — silently ignore
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, selectMission]);

  const openFromPath = useCallback(async (path: string) => {
    if (!confirmDiscardUnsaved('Open another server folder')) return;
    setLoading(true);
    setLoadError(null);
    setLoadWarnings([]);
    try {
      serverRootRef.current = path;
      setServerRootPath(path);
      setCeToolFolderOverride(null); // belongs to the previous server
      useUiStore.getState().addRecentFolder(path);
      void loadFFSpawnSelector(path);
      const missions = await scanFolder(path);
      await loadFromMissions(missions);
    } catch (err) {
      if (err instanceof Error) {
        setLoadError(err.message.toLowerCase().includes('permission')
          ? 'permission_denied'
          : `error:${err.message}`
        );
      }
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, selectMission, setLoading, setLoadError, setLoadWarnings]);

  const pickCeToolFolder = useCallback(async () => {
    const projectPath = await pickCeToolFolderDialog(activeMap);
    if (!projectPath) return;
    // Store the project XML path directly (not the folder)
    setCeToolFolderOverride(projectPath);
    // Reload the loaded mission so tiers come from the picked project
    const current = allMissions.find(m => m.missionPath === loadedMissionPathRef.current);
    if (current) await selectMission(current, true);
  }, [activeMap, setCeToolFolderOverride, allMissions, selectMission]);

  const reloadCeToolData = useCallback(async () => {
    const missionPath = useServerStore.getState().paths.missionPath;
    if (!missionPath) return;
    clearAreaFlags();
    setTierZonesLoaded(false);
    setCeToolProject(null);
    const { ceProject, loaded, ceSource, warnings } = await loadCeToolTierData({
      missionPath,
      activeMap,
      ceToolFolderOverride: useServerStore.getState().ceToolFolderOverride,
      serverRootPath: serverRootRef.current,
      communityMaps,
    });
    setCeToolProject(ceProject);
    setCeSource(activeMap, ceSource);
    if (loaded) setTierZonesLoaded(true);
    if (warnings.length > 0) setLoadWarnings([...useUiStore.getState().loadWarnings, ...warnings]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, setCeToolProject, setTierZonesLoaded, setCeSource, setLoadWarnings]);

  const reloadTerritoryBitmaps = useCallback(async () => {
    const { missionPath } = useServerStore.getState().paths;
    if (missionPath) {
      const newXmlPath = await findCeToolProjectXmlInMission(missionPath, activeMap).catch(() => null);
      if (newXmlPath) {
        const layersDir = newXmlPath.replace(/[/\\][^/\\]+$/, '') + '/layers';
        useServerStore.getState().setPaths({ ceToolXmlPath: newXmlPath, ceToolLayersDir: layersDir });
        await loadTerritoryBitmaps().catch(() => {});
        return;
      }
    }
    await loadTerritoryBitmapsFallback(activeMap, communityMaps, loadTerritoryBitmaps, getAllMapConfigs).catch(() => {});
  }, [activeMap, communityMaps, loadTerritoryBitmaps]);

  // Expose callbacks through store so other components can access them without calling hook twice
  useEffect(() => {
    setPickCeToolFolder(pickCeToolFolder);
  }, [pickCeToolFolder, setPickCeToolFolder]);

  useEffect(() => {
    setOpenServerFolder(openFolder);
    return () => setOpenServerFolder(undefined);
  }, [openFolder, setOpenServerFolder]);

  useEffect(() => {
    setReloadCeToolData(reloadCeToolData);
    return () => setReloadCeToolData(undefined);
  }, [reloadCeToolData, setReloadCeToolData]);

  useEffect(() => {
    setReloadTerritoryBitmaps(reloadTerritoryBitmaps);
    return () => setReloadTerritoryBitmaps(undefined);
  }, [reloadTerritoryBitmaps, setReloadTerritoryBitmaps]);

  const cancelPicker = useCallback(() => {
    setPendingMissions(null);
  }, []);

  return { openFolder, openFromPath, autoLoad, pendingMissions, selectMission, cancelPicker, allMissions };
}
