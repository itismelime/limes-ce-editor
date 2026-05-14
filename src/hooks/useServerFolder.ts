import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { pickAndDiscoverServer, scanFolder, readFile, findCeToolTierLayers, findCeToolProjectXmlInMission, pickCeToolFolder as pickCeToolFolderDialog, type MissionFiles } from '../lib/fileDiscovery';

const LAST_FOLDER_KEY = 'lastServerFolder';
import {
  parseTypesXml, parseEventSpawnsXml,
  parseEventsXml, parseSpawnableTypesXml,
  inspectTypesXmlCompatibility, inspectEventSpawnsCompatibility,
  inspectEventsXmlCompatibility, inspectSpawnableTypesCompatibility,
  parseEconomyCoreXml,
  parseMapGroupProtoXml, parseMapGroupPosXml, joinMapGroups,
  parsePlayerSpawnPointsXml,
  parseWeatherXml, parseGameplayJson,
} from '../lib/xmlParser';
import { clearAreaFlags, loadTierLayers } from '../lib/tierZoneResolver';
import { readBinaryFile } from '../lib/fileDiscovery';
import { MAP_CONFIGS } from '../lib/mapConfig';
import { parseCeToolProjectXml } from '../lib/ceToolParser';
import type { MissionData, CeEntry } from '../types/dayz';
import { useServerStore } from '../store/serverStore';
import { useUiStore } from '../store/uiStore';

const MAP_KEYWORDS: Record<string, string[]> = {
  namalsk:   ['namalsk'],
  chernarus: ['chernarus'],
  livonia:   ['livonia', 'enoch'],
  sakhal:    ['sakhal'],
};

const FILE_KEYS = ['typesPath', 'eventSpawnsPath', 'eventsPath', 'spawnableTypesPath'] as const;
const LAYER_EXTS = ['.png', '.bmp', '.tga'];
const ASSET_BASE = import.meta.env.BASE_URL || '/';

const BUNDLED_CETOOL_PROJECTS: Record<string, { xmlPath: string }> = {
  namalsk: { xmlPath: 'cetool/namalsk/namalsk.xml' },
  chernarus: { xmlPath: 'cetool/chernarusplus/chernarusplus.xml' },
  livonia: { xmlPath: 'cetool/enoch/enoch.xml' },
  sakhal: { xmlPath: 'cetool/sakhal/sakhal.xml' },
};

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

function autoSelectMission(missions: MissionFiles[], activeMap: string): MissionFiles | null {
  const keywords = MAP_KEYWORDS[activeMap];
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

  try { if (typesRaw)     types          = parseTypesXml(typesRaw, m.typesPath ?? ''); }
  catch (err) { warnings.push(`types.xml (parse error: ${err instanceof Error ? err.message : String(err)})`); }
  try { if (spawnsRaw)    eventSpawns    = parseEventSpawnsXml(spawnsRaw); }
  catch (err) { warnings.push(`cfgeventspawns.xml (parse error: ${err instanceof Error ? err.message : String(err)})`); }
  try { if (eventsRaw)    events         = parseEventsXml(eventsRaw); }
  catch (err) { warnings.push(`events.xml (parse error: ${err instanceof Error ? err.message : String(err)})`); }
  try { if (spawnableRaw) spawnableTypes = parseSpawnableTypesXml(spawnableRaw, m.spawnableTypesPath ?? ''); }
  catch (err) { warnings.push(`cfgspawnabletypes.xml (parse error: ${err instanceof Error ? err.message : String(err)})`); }

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
  const ceToolFolderOverride  = useServerStore(s => s.ceToolFolderOverride);
  const setWeather           = useServerStore(s => s.setWeather);
  const setGameplay          = useServerStore(s => s.setGameplay);
  const setLoading          = useUiStore(s => s.setLoading);
  const setLoadError        = useUiStore(s => s.setLoadError);
  const setLoadWarnings     = useUiStore(s => s.setLoadWarnings);
  const setMapImagePath     = useUiStore(s => s.setMapImagePath);
  const setTierZonesLoaded  = useUiStore(s => s.setTierZonesLoaded);
  const activeMap       = useUiStore(s => s.activeMap);

  const [allMissions, setAllMissions]       = useState<MissionFiles[]>([]);
  const [pendingMissions, setPendingMissions] = useState<MissionFiles[] | null>(null);
  const serverRootRef = useRef<string | null>(null);

  // Stable ref so the map-change effect always calls the latest selectMission
  // without needing it in the dependency array (which would cause double-firing).
  const selectMissionRef = useRef<(m: MissionFiles) => Promise<void>>(async () => {});

  const selectMission = useCallback(async (m: MissionFiles) => {
    setPendingMissions(null);
    setLoading(true);
    setLoadError(null);
    setLoadWarnings([]);

    try {
      setPaths({
        missionPath:        m.missionPath,
        typesPath:          m.typesPath,
        eventSpawnsPath:    m.eventSpawnsPath,
        eventsPath:         m.eventsPath,
        spawnableTypesPath: m.spawnableTypesPath,
        economyCorePath:    m.economyCorePath,
        mapGroupProtoPath:  m.mapGroupProtoPath,
        weatherPath:        m.weatherPath,
        gameplayPath:       m.gameplayPath,
      });

      const { mission, warnings } = await loadMission(m);
      const allWarnings = [...warnings];
      setLoadWarnings(allWarnings);
      setMission(mission);

      let economyCoreEntries: CeEntry[] = [];
      if (m.economyCorePath) {
        try {
          const raw = await readFile(m.economyCorePath);
          economyCoreEntries = parseEconomyCoreXml(raw);
          setEconomyCore(economyCoreEntries);
        } catch { }
      }

      // Load and merge all economy core files (types + spawnabletypes)
      if (economyCoreEntries.length > 0) {
        const mergedTypes = new Map(mission.types);
        const mergedSpawnables = new Map(mission.spawnableTypes);
        const ceWarnings: string[] = [];
        for (const entry of economyCoreEntries) {
          for (const file of entry.files) {
            const filePath = `${m.missionPath}/${entry.folder}/${file.name}`;
            try {
              if (file.type === 'types') {
                const raw = await readFile(filePath);
                for (const [name, type] of parseTypesXml(raw, filePath)) mergedTypes.set(name, type);
              } else if (file.type === 'spawnabletypes' || file.type === 'cfgspawnabletypes') {
                const raw = await readFile(filePath);
                const parsed = parseSpawnableTypesXml(raw, filePath);
                if (parsed.size === 0 && /<types[\s>]/i.test(raw)) {
                  for (const [name, type] of parseTypesXml(raw, filePath)) mergedTypes.set(name, type);
                } else {
                  for (const [name, st] of parsed) mergedSpawnables.set(name, st);
                }
              } else {
                ceWarnings.push(`${entry.folder}/${file.name} (unknown type: "${file.type}")`);
              }
            } catch (err) {
              ceWarnings.push(`${entry.folder}/${file.name} (${err instanceof Error ? err.message : String(err)})`);
            }
          }
        }
        if (ceWarnings.length > 0) {
          allWarnings.push(...ceWarnings.map(f => `ce file not found: ${f}`));
          setLoadWarnings([...allWarnings]);
        }
        const updated = {
          ...mission,
          types: mergedTypes,
          spawnableTypes: mergedSpawnables,
        };
        setMission(updated);
      }

      // Load building spawn layer
      if (m.mapGroupProtoPath && m.mapGroupPosPath) {
        try {
          const [protoRaw, posRaw] = await Promise.all([
            readFile(m.mapGroupProtoPath),
            readFile(m.mapGroupPosPath),
          ]);
          const proto = parseMapGroupProtoXml(protoRaw);
          const positions = parseMapGroupPosXml(posRaw);
          setMapGroupProto(proto);
          setBuildingInstances(joinMapGroups(proto, positions));
        } catch { /* optional layer — silently skip */ }
      } else {
        setMapGroupProto(new Map());
        setBuildingInstances([]);
      }

      // Load CE Tool project metadata + tier layers as canonical tier source
      clearAreaFlags();
      setTierZonesLoaded(false);
      let loadedTierZones = false;
      setCeToolProject(null);

      const rootPath = serverRootRef.current;
      console.info('[tiers] Starting tier load for map:', activeMap, 'root:', rootPath, 'override:', ceToolFolderOverride);
      if (rootPath) {
        try {
          // Try override (direct XML path from manual pick) or mission-scoped discovery.
          // Intentionally no global server root scan — it risks picking up a CETool project
          // for a different map when multiple missions co-exist under the same server root.
          const ceProjectPath = ceToolFolderOverride
            ? ceToolFolderOverride
            : m.missionPath
              ? await findCeToolProjectXmlInMission(m.missionPath, activeMap)
              : null;
          console.info('[tiers] Found CE project XML at:', ceProjectPath);
          const mapCfg = MAP_CONFIGS[activeMap];
          let worldSize = mapCfg.worldWidth;
          const layers: Partial<Record<string, Uint8Array>> = {};
          const usageLayers: Partial<Record<string, Uint8Array[]>> = {};
          let usingBundledCeTool = false;
          let resolvedProjectPath = ceProjectPath;

          if (!resolvedProjectPath) {
            const bundled = BUNDLED_CETOOL_PROJECTS[activeMap];
            if (bundled) {
              resolvedProjectPath = bundled.xmlPath;
              usingBundledCeTool = true;
              console.info('[tiers] Using bundled CE project XML:', resolvedProjectPath);
            }
          }

          if (resolvedProjectPath) {
            try {
              const projectRaw = usingBundledCeTool
                ? await readBundledText(resolvedProjectPath)
                : await readFile(resolvedProjectPath);
              const ceProject = parseCeToolProjectXml(projectRaw, resolvedProjectPath);
              console.info('[tiers] Parsed CE project, worldSize:', ceProject.worldSize, 'tierLayerNames:', ceProject.tierLayerNames);
              setCeToolProject(ceProject);
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
              allWarnings.push(`CETool project parse error (${err instanceof Error ? err.message : String(err)})`);
            }
          } else {
            console.warn('[tiers] No CE project XML found');
          }

          // Fallback CE layer discovery for maps with non-standard project layer names.
          if (Object.keys(layers).length === 0) {
            console.info('[tiers] Trying fallback layer discovery in mission path:', m.missionPath);
            const layerPaths = await findCeToolTierLayers(m.missionPath, activeMap);
            const layerEntries = Object.entries(layerPaths).filter((entry): entry is [string, string] => Boolean(entry[1]));
            console.info('[tiers] Fallback found', layerEntries.length, 'layers:', layerEntries.map(e => e[0]));
            if (layerEntries.length > 0) {
              for (const [tier, path] of layerEntries) {
                try { 
                  const raw = await readBinaryFile(path);
                  console.info('[tiers] Loaded fallback layer:', tier, 'from', path, 'size:', raw.byteLength);
                  layers[tier] = raw;
                }
                catch (e) { 
                  console.error('[tiers] Failed to read fallback layer:', tier, e);
                }
              }
            }
          }

          if (Object.keys(layers).length > 0) {
            console.info('[tiers] Calling loadTierLayers with', Object.keys(layers).length, 'layers,', Object.keys(usageLayers).length, 'usage types, worldSize:', worldSize);
            loadedTierZones = await loadTierLayers(layers, worldSize, worldSize, usageLayers);
            console.info('[tiers] loadTierLayers returned:', loadedTierZones);
            if (loadedTierZones) {
              setTierZonesLoaded(true);
            }
          } else {
            console.warn('[tiers] No layers found after discovery');
          }

        } catch (e) {
          console.error('[cetool tiers] load failed:', e);
        }
      } else {
        console.warn('[tiers] No rootPath available');
      }

      if (!loadedTierZones) {
        console.info('[tiers] No CE Tool tier layers found for this map.');
      } else {
        console.info('[tiers] Tier zones loaded successfully');
      }

      // Load player spawn points
      setPlayerSpawnData(null);
      if (m.playerSpawnPointsPath) {
        try {
          const raw = await readFile(m.playerSpawnPointsPath);
          setPlayerSpawnData(parsePlayerSpawnPointsXml(raw));
        } catch { /* optional — silently skip */ }
      }

      // Load weather
      setWeather(null);
      if (m.weatherPath) {
        try {
          const raw = await readFile(m.weatherPath);
          setWeather(parseWeatherXml(raw));
        } catch (err) {
          allWarnings.push(`cfgweather.xml (parse error: ${err instanceof Error ? err.message : String(err)})`);
          setLoadWarnings([...allWarnings]);
        }
      }

      // Load gameplay settings
      setGameplay(null);
      if (m.gameplayPath) {
        try {
          const raw = await readFile(m.gameplayPath);
          setGameplay(parseGameplayJson(raw));
        } catch (err) {
          allWarnings.push(`cfggameplay.json (parse error: ${err instanceof Error ? err.message : String(err)})`);
          setLoadWarnings([...allWarnings]);
        }
      }

      if (m.mapImagePath) {
        setMapImagePath(activeMap, convertFileSrc(m.mapImagePath));
      }
    } catch (err) {
      if (err instanceof Error) {
        setLoadError(`error:${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [activeMap, ceToolFolderOverride, setMission, setPaths, setLoading, setLoadError, setLoadWarnings, setMapImagePath, setCeToolProject]);

  // Keep ref current every render so the effect below always has the latest version.
  selectMissionRef.current = selectMission;

  // When the active map changes (after initial mount), try to auto-switch missions.
  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (allMissions.length === 0) return;

    if (allMissions.length === 1) {
      selectMissionRef.current(allMissions[0]);
      return;
    }

    const auto = autoSelectMission(allMissions, activeMap);
    if (auto) selectMissionRef.current(auto);
    // No match → keep current mission loaded, nothing to do
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap]);

  async function loadFromMissions(missions: MissionFiles[]) {
    if (missions.length === 0) {
      setLoadError('no_files_found');
      setLoading(false);
      return;
    }
    setAllMissions(missions);
    if (missions.length === 1) {
      await selectMission(missions[0]);
    } else {
      const auto = autoSelectMission(missions, activeMap);
      if (auto) {
        await selectMission(auto);
      } else {
        setLoading(false);
        setPendingMissions(missions);
      }
    }
  }

  const openFolder = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadWarnings([]);

    try {
      const result = await pickAndDiscoverServer();
      if (!result) { setLoading(false); return; }

      serverRootRef.current = result.path;
      localStorage.setItem(LAST_FOLDER_KEY, result.path);
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
    const saved = localStorage.getItem(LAST_FOLDER_KEY);
    if (!saved) return;

    setLoading(true);
    try {
      serverRootRef.current = saved;
      const missions = await scanFolder(saved);
      if (missions.length > 0) await loadFromMissions(missions);
    } catch {
      // Folder gone or inaccessible — silently ignore
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap, selectMission]);

  const pickCeToolFolder = useCallback(async () => {
    const projectPath = await pickCeToolFolderDialog(activeMap);
    if (!projectPath) return;
    // Store the project XML path directly (not the folder)
    setCeToolFolderOverride(projectPath);
    // Re-trigger selectMission for active mission to reload tiers
    const current = allMissions.find(m => serverRootRef.current && m.missionPath.startsWith(serverRootRef.current ?? ''));
    if (current) await selectMission(current);
  }, [activeMap, setCeToolFolderOverride, allMissions, selectMission]);

  // Expose pickCeToolFolder through store so MapView can access it without calling hook twice
  useEffect(() => {
    setPickCeToolFolder(pickCeToolFolder);
  }, [pickCeToolFolder, setPickCeToolFolder]);

  const cancelPicker = useCallback(() => {
    setPendingMissions(null);
  }, []);

  return { openFolder, autoLoad, pendingMissions, selectMission, cancelPicker };
}
