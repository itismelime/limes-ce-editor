# CE Tool Tier and Zone Loading Sequence

Focused sequence for how CE Tool project metadata and layer assets are discovered, parsed, and turned into map-ready tier and usage overlays.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as UI Map Context
    participant USF as useServerFolder
    participant FD as fileDiscovery
    participant CP as ceToolParser
    participant TZ as tierZoneResolver
    participant SS as serverStore
    participant UIS as uiStore

    User->>UI: Open/select mission or change active map
    UI->>USF: loadCeToolTierData(...)

    alt Manual CE Tool override exists
        USF->>USF: use ceToolFolderOverride path
    else Try mission discovery
        USF->>FD: findCeToolProjectXmlInMission(missionPath, activeMap)
        FD-->>USF: project XML path or null
    end

    alt No project found in mission
        USF->>USF: resolve bundled CE project path by map
    end

    alt Project XML resolved
        USF->>FD: read project XML text (disk or bundled)
        FD-->>USF: raw zg-config XML
        USF->>CP: parseCeToolProjectXml(raw, sourcePath)
        CP-->>USF: worldSize, layer names, usage names, territories

        loop Tier layers (Tier1..Tier4)
            USF->>FD: read layer binary by discovered name/ext
            FD-->>USF: PNG/BMP/TGA bytes or null
        end

        loop Usage layers (usgFlg_Def/Paint variants)
            USF->>FD: read usage layer binaries
            FD-->>USF: image bytes[]
        end
    end

    alt Tier layers still empty
        USF->>FD: findCeToolTierLayers(missionPath, activeMap)
        FD-->>USF: discovered fallback tier layer paths
        USF->>FD: read fallback layer binaries
    end

    alt Any tier layers available
        USF->>TZ: loadTierLayers(layers, worldWidth, worldHeight, usageLayers)
        TZ-->>USF: loaded=true/false
        USF->>SS: setCeToolProject(project)
        USF->>SS: setCeSource(activeMap, bundled|user)
        USF->>UIS: setTierZonesLoaded(true when loaded)
    else No usable layers
        USF->>UIS: setTierZonesLoaded(false)
        USF->>UIS: append warning(s)
    end
```

## Notes

- Source priority is user override -> mission-local CE Tool project -> bundled CE Tool project.
- World size for raster mapping is taken from parsed CE project when available.
- Loading usage layers is additive; missing usage layers do not block tier loading.
- Compatibility/warning behavior is non-fatal and surfaced in UI notices.

## Source Anchors

- src/hooks/useServerFolder.ts
- src/lib/fileDiscovery.ts
- src/lib/ceToolParser.ts
- src/lib/tierZoneResolver.ts
- src/store/serverStore.ts
- src/store/uiStore.ts
