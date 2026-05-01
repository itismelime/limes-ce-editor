import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { pickAndDiscoverServer, readFile, type MissionFiles } from '../lib/fileDiscovery';
import {
  parseTypesXml, parseEventSpawnsXml,
  parseEventsXml, parseSpawnableTypesXml,
} from '../lib/xmlParser';
import type { MissionData } from '../types/dayz';
import { useServerStore } from '../store/serverStore';
import { useUiStore } from '../store/uiStore';

const MAP_KEYWORDS: Record<string, string[]> = {
  namalsk:   ['namalsk'],
  chernarus: ['chernarus'],
  livonia:   ['livonia', 'enoch'],
  sakhal:    ['sakhal'],
};

const FILE_KEYS = ['typesPath', 'eventSpawnsPath', 'eventsPath', 'spawnableTypesPath'] as const;

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

  try { if (typesRaw)     types          = parseTypesXml(typesRaw);              } catch { warnings.push('types.xml (parse error)'); }
  try { if (spawnsRaw)    eventSpawns    = parseEventSpawnsXml(spawnsRaw);       } catch { warnings.push('cfgeventspawns.xml (parse error)'); }
  try { if (eventsRaw)    events         = parseEventsXml(eventsRaw);            } catch { warnings.push('events.xml (parse error)'); }
  try { if (spawnableRaw) spawnableTypes = parseSpawnableTypesXml(spawnableRaw); } catch { warnings.push('cfgspawnabletypes.xml (parse error)'); }

  return {
    mission: { missionName: m.missionName, types, eventSpawns, events, spawnableTypes },
    warnings,
  };
}

export function useServerFolder() {
  const setMission = useServerStore(s => s.setMission);
  const setPaths   = useServerStore(s => s.setPaths);
  const setLoading      = useUiStore(s => s.setLoading);
  const setLoadError    = useUiStore(s => s.setLoadError);
  const setLoadWarnings = useUiStore(s => s.setLoadWarnings);
  const setMapImagePath = useUiStore(s => s.setMapImagePath);
  const activeMap       = useUiStore(s => s.activeMap);

  const [allMissions, setAllMissions]       = useState<MissionFiles[]>([]);
  const [pendingMissions, setPendingMissions] = useState<MissionFiles[] | null>(null);

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
        typesPath:          m.typesPath,
        eventSpawnsPath:    m.eventSpawnsPath,
        eventsPath:         m.eventsPath,
        spawnableTypesPath: m.spawnableTypesPath,
      });

      const { mission, warnings } = await loadMission(m);
      setLoadWarnings(warnings);
      setMission(mission);

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
  }, [activeMap, setMission, setPaths, setLoading, setLoadError, setLoadWarnings, setMapImagePath]);

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

  const openFolder = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadWarnings([]);

    try {
      const missions = await pickAndDiscoverServer();
      if (!missions) { setLoading(false); return; }

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
    } catch (err) {
      if (err instanceof Error) {
        setLoadError(err.message.toLowerCase().includes('permission')
          ? 'permission_denied'
          : `error:${err.message}`
        );
      }
      setLoading(false);
    }
  }, [activeMap, selectMission, setLoading, setLoadError, setLoadWarnings]);

  const cancelPicker = useCallback(() => {
    setPendingMissions(null);
  }, []);

  return { openFolder, pendingMissions, selectMission, cancelPicker };
}
