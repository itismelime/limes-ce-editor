# Component Dependency Map

Compact map of major React components, hooks, stores, and parsing/services used by the app shell and editor tabs.

```mermaid
graph TD
    A[App] --> B[AppShell]
    B --> C[TopBar]
    B --> D[MissionPicker]
    B --> E[MapView]
    B --> F[TypesEditor]
    B --> G[SpawnableTypesEditor]
    B --> H[PlayerSpawnsEditor]
    B --> I[EventsEditor]
    B --> J[EventSpawnsEditor]
    B --> K[EconomyCoreEditor]
    B --> L[WeatherEditor]
    B --> M[GameplayEditor]
    B --> N[SettingsEditor]

    B --> O[useServerFolder]
    O --> P[fileDiscovery]
    O --> Q[xmlParser modules]
    O --> R[ceToolParser]
    O --> S[tierZoneResolver]

    C --> T[serverStore]
    C --> U[uiStore]
    B --> T
    B --> U
    O --> T
    O --> U

    E --> T
    E --> U
    F --> T
    F --> U
    G --> T
    G --> U
    H --> T
    H --> U
    I --> T
    I --> U
    J --> T
    J --> U
    K --> T
    K --> U
    L --> T
    L --> U
    M --> T
    M --> U
    N --> T
    N --> U

    T --> V[serialize* functions]
    V --> W[Tauri FS write]

    O --> X[Tauri FS read]
    C --> Y[Tauri invoke offline cache commands]

    classDef shell fill:#1f2937,stroke:#93c5fd,stroke-width:1px,color:#e5e7eb;
    classDef store fill:#1e293b,stroke:#34d399,stroke-width:1px,color:#e5e7eb;
    classDef io fill:#3f1d2e,stroke:#fda4af,stroke-width:1px,color:#e5e7eb;

    class A,B,C,D shell;
    class T,U store;
    class W,X,Y io;
```

## Read It Like This

- AppShell is the composition root for top-level UI and lazy tab mounting.
- useServerFolder is the data-ingest orchestrator and the main bridge between discovery/parsing and stores.
- serverStore carries editable mission domain state and save logic; uiStore carries filters, active tab/map, and UX state.
- Editors are store-driven and mostly avoid direct file IO.

## Source Anchors

- src/App.tsx
- src/components/layout/AppShell.tsx
- src/components/layout/TopBar.tsx
- src/hooks/useServerFolder.ts
- src/store/serverStore.ts
- src/store/uiStore.ts
- src/lib/fileDiscovery.ts
- src/lib/xmlParser/index.ts
- src/lib/ceToolParser.ts
