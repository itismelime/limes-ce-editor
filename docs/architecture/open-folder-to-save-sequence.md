# Open Folder to Save Sequence

This sequence maps the main runtime path from selecting a server folder through parsing, editing, and persisting changes.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant TB as TopBar UI
    participant AS as AppShell
    participant USF as useServerFolder hook
    participant FD as fileDiscovery
    participant XP as xmlParser modules
    participant SP as ceToolParser
    participant SS as serverStore
    participant UI as uiStore
    participant ED as Editor Components
    participant FS as Tauri FS

    User->>TB: Open Server Folder
    TB->>AS: onOpenFolder()
    AS->>USF: openFolder()

    USF->>UI: setLoading(true), clear errors/warnings
    USF->>FD: pickAndDiscoverServer()
    FD-->>USF: rootPath + mission candidates

    alt Multiple mission candidates
        USF->>AS: pendingMissions for MissionPicker
        User->>AS: choose mission
        AS->>USF: selectMission(mission)
    else Single/auto-selected mission
        USF->>USF: autoSelectMission(activeMap)
    end

    USF->>FD: readFile(...) for core files in parallel
    FD-->>USF: raw XML/JSON text

    USF->>XP: parseTypesXml()
    USF->>XP: parseEventSpawnsXml()
    USF->>XP: parseEventsXml()
    USF->>XP: parseSpawnableTypesXml()
    XP-->>USF: typed mission structures

    opt Economy core extensions present
        USF->>XP: parseEconomyCoreXml()
        USF->>FD: read CE extension files
        USF->>XP: merge extra types/spawnables
    end

    opt CE tool project/layers available
        USF->>FD: findCeToolProjectXmlInMission()
        USF->>SP: parseCeToolProjectXml()
        USF->>FD: read tier/usage layer binaries
        USF->>USF: loadTierLayers(...)
    end

    USF->>SS: setMission(), setPaths(), setEconomyCore()
    USF->>SS: setMapGroupProto(), setWeather(), setGameplay()
    USF->>UI: setLoadWarnings(), setTierZonesLoaded(), setLoading(false)

    User->>ED: Edit values in tabs
    ED->>SS: updateType/updateEvent/... (mark dirty)
    SS-->>TB: dirty flags + save status

    User->>TB: Save changes
    TB->>SS: save*() by dirty target
    SS->>XP: serialize*()
    XP-->>SS: XML/JSON text
    SS->>FS: writeFile()
    FS-->>SS: success/failure
    SS->>TB: saveStatus + saveError
```

## Key Boundaries

- Orchestration: useServerFolder
- Parsing/serialization: xmlParser and ceToolParser
- Domain state and persistence: serverStore
- View state and UX controls: uiStore + AppShell + TopBar
- Disk IO boundary: Tauri FS plugins

## Primary Source Files

- src/hooks/useServerFolder.ts
- src/lib/fileDiscovery.ts
- src/lib/xmlParser/index.ts
- src/lib/ceToolParser.ts
- src/store/serverStore.ts
- src/store/uiStore.ts
- src/components/layout/AppShell.tsx
- src/components/layout/TopBar.tsx
