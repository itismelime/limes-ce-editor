# Lime's CE Editor — Project Guide

## 1. Project Overview

**Lime's CE Editor** is a cross-platform desktop application for visualising and editing DayZ server economy core (CE) data. It replaces manual XML editing with an interactive UI that supports loot tables, spawnable types, events, player spawn points, and community map overlays.

### Key Technologies
| Layer | Tech |
|-------|------|
| Backend (Rust) | Tauri 2, `hemtt-pbo`, `tokio`, `reqwest`, `fast-xml-parser` (via JS) |
| Frontend (JS/TS) | React 19, TypeScript, Zustand, Leaflet, Tailwind CSS v4, Vite |
| Packaging | Tauri CLI → MSI (Windows) / NSIS installer |

### High-Level Architecture
```
┌─────────────────────────────────────────────────┐
│  Frontend (React + Vite)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Map View │  │ Editors │  │ Community Maps│  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│  ┌────┴──────────────┴───────────────┴───────┐  │
│  │  Zustand Stores (server, communityMaps, UI)│  │
│  └────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────┘
                         │ Tauri IPC (invoke_handler)
┌────────────────────────┴────────────────────────┐
│  Backend (Rust, src-tauri/src/)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ PBO      │  │ Tiling   │  │ CE XML       │  │
│  │ Parsing  │  │ Extract  │  │ Parsing      │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
```

The Rust backend exposes Tauri commands for:
- **PBO extraction** — reading `.pbo` files (DayZ mod archives), extracting tile pyramids for community maps
- **File discovery** — scanning Steam libraries and `@mods` for DayZ data
- **mpmission download** — fetching mission files from GitHub ZIP archives
- **CE project import** — copying Custom Editor project XML and assets
- **Bitmap operations** — reading/writing TGA layers, compiling area flags

The React frontend handles all UI, state management (Zustand), map rendering (Leaflet), and XML editing (via `lib/xmlParser/` and `lib/lootResolver.ts`).

---

## 2. Getting Started

### Prerequisites
| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| Rust (stable) + Cargo | latest stable |
| npm | ≥ 9 |

### Installation

```bash
# Install JS dependencies
npm install

# (Optional) One-time: download bundled map overview PNGs from xam.nu
npm run prepare-maps
```

### Running in Development

```bash
npm run tauri:dev
```

This starts the Vite dev server (port 5173) and launches the Tauri app, which hot-reloads the frontend.

### Building for Distribution

```bash
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/`
- `msi/` — Windows installer
- `nsis/` — NSIS executable installer

### Running Tests

```bash
# Lint
npm run lint

# Rust-side unit tests
cd src-tauri && cargo test
```

---

## 3. Project Structure

```
.
├── src/                          # React frontend
│   ├── App.tsx                   # Root component
│   ├── main.tsx                  # Entry point
│   ├── components/               # React components
│   │   ├── editors/              # All editor tabs
│   │   │   ├── TypesEditor.tsx           Loot Types (types.xml)
│   │   │   ├── SpawnableTypesEditor.tsx  cfgspawnabletypes
│   │   │   ├── EconomyCoreEditor.tsx     cfgeconomycore.xml
│   │   │   ├── EventsEditor.tsx          Event definitions
│   │   │   ├── EventSpawnsEditor.tsx     Event spawn points
│   │   │   ├── PlayerSpawnsEditor.tsx    Player spawn locations
│   │   │   ├── CommunityMapsSection.tsx  Community map management
│   │   │   ├── SettingsEditor.tsx        App settings
│   │   │   └── ...
│   │   ├── map/                  # Leaflet map components
│   │   │   ├── MapView.tsx               Map container
│   │   │   ├── BuildingMarkers.tsx       Tier-zone building markers
│   │   │   ├── BuildingPopup.tsx         Loot breakdown popup
│   │   │   ├── EventMarkers.tsx          Event markers on map
│   │   │   └── ...
│   │   ├── layout/               # Shell chrome
│   │   │   ├── AppShell.tsx              App frame
│   │   │   └── TopBar.tsx                Top toolbar
│   │   └── shared/               Reusable components
│   ├── hooks/                    # Custom React hooks
│   │   ├── useMapMarkers.ts
│   │   └── useServerFolder.ts
│   ├── lib/                      # Core business logic
│   │   ├── xmlParser/            XML parsing modules
│   │   │   ├── index.ts                  Entry point
│   │   │   ├── types.ts                  types.xml parser
│   │   │   ├── spawnableTypes.ts         cfgspawnabletypes parser
│   │   │   ├── economyCore.ts            cfgeconomycore.xml parser
│   │   │   ├── events.ts                 Event XML parser
│   │   │   ├── eventSpawns.ts            Event spawn coords
│   │   │   ├── playerSpawns.ts           Player spawn parser
│   │   │   ├── gameplay.ts               Gameplay XML
│   │   │   ├── limitsDefinition.ts       Limits definitions
│   │   │   ├── mapGroup.ts               Map group parser
│   │   │   ├── weather.ts                Weather XML
│   │   │   └── shared.ts                 Shared types/utils
│   │   ├── lootResolver.ts       Resolves loot by category/tier
│   │   ├── itemClassifier.ts     Smart item classification
│   │   ├── tierZoneResolver.ts   Tier-zone resolution
│   │   ├── coordinateTransform.ts Map↔world coordinate transforms
│   │   ├── fileDiscovery.ts      Mission/CE file discovery
│   │   ├── tgaParser.ts          TGA image parsing
│   │   ├── mapConfig.ts          Map configuration constants
│   │   ├── ceMode.ts             CE mode detection
│   │   └── ceToolParser.ts       Custom Editor tool parsing
│   ├── store/                    Zustand stores
│   │   ├── serverStore.ts        Mission/server state
│   │   ├── communityMapsStore.ts Community map registry
│   │   └── uiStore.ts            UI state (sidebar, filters)
│   ├── types/                    TypeScript type definitions
│   │   ├── dayz.ts               Dayz data models
│   │   ├── map.ts                Map-related types
│   │   └── fs.ts                 File system types
│   └── workers/
│       └── typesFilterWorker.ts  Web worker for filtering
├── src-tauri/                   # Rust backend
│   ├── src/
│   │   ├── main.rs               Binary entry point
│   │   ├── lib.rs                Library entry point + run()
│   │   ├── tiling.rs             Tile pyramid generation
│   │   ├── pbo.rs                PBO file reading
│   │   ├── bitmap.rs             TGA/area flags bitmap ops
│   │   ├── steam.rs              Steam library discovery
│   │   ├── map_registry.rs       Community map registry
│   │   ├── map_config.rs         Known map definitions
│   │   ├── bin/                  Utility binaries
│   │   │   ├── prepare_maps.rs   Download + stitch map PNGs
│   │   │   ├── test_pbo.rs       PBO testing
│   │   │   ├── dump_coords.rs    Coordinate dumping
│   │   │   ├── inspect_pbo.rs    PBO inspection
│   │   │   └── dump_cfg.rs       Config dumping
│   ├── tauri.conf.json           Tauri app config
│   ├── Cargo.toml                Rust dependencies
│   └── build.rs                  Build script
├── public/                       Static assets
├── resources/                    Bundled resources (map PNGs)
├── docs/                         Documentation
├── package.json
├── vite.config.ts
├── tsconfig.json
└── eslint.config.js
```

### Important Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | JS dependencies, scripts (`dev`, `build`, `tauri:dev`, `tauri:build`) |
| `vite.config.ts` | Vite + React + Tailwind plugins |
| `tsconfig.json` | TypeScript compiler options |
| `src-tauri/tauri.conf.json` | Tauri window config, bundle targets (MSI), CSP, asset protocol |
| `src-tauri/Cargo.toml` | Rust deps: Tauri 2, hemtt-pbo, tokio, reqwest, image, zip |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `src-tauri/target/`, generated map PNGs |

---

## 4. Development Workflow

### Coding Standards
- **TypeScript**: Strict mode enabled via `tsconfig.json`. Use the types in `src/types/dayz.ts` for Dayz data models.
- **Rust**: Edition 2021. The backend is split into a library crate (`limes_ce_editor_lib`) and multiple binaries.
- **Styling**: Tailwind CSS v4 via Vite plugin. No CSS classes outside Tailwind.
- **State**: Zustand for global state. Each major feature (server, community maps, UI) has its own store.
- **Component structure**: Components go in `src/components/` under the appropriate subdirectory matching their purpose.

### Running the Dev Server

```bash
# Full Tauri dev (Rust + Vite)
npm run tauri:dev

# Just Vite (for frontend-only debugging)
npm run dev
```

### Testing

```bash
# ESLint
npm run lint

# Rust tests
cd src-tauri && cargo test

# PBO overlap test (Rust binary)
cd src-tauri && cargo run --bin test_pbo
```

### Building

```bash
# Production build
npm run tauri:build
```

### Contribution Guidelines
1. Fork the repo and create a feature branch.
2. Make changes to both frontend (`src/`) and/or backend (`src-tauri/src/`) as needed.
3. Ensure `npm run lint` passes.
4. Test the app via `npm run tauri:dev`.
5. Submit a pull request with a clear description.

---

## 5. Key Concepts

### Domain Terminology

| Term | Meaning |
|------|---------|
| **CE** | Economy Core — DayZ server config for spawning items |
| **types.xml** | Loot table definition file (item categories, tiers, quantities) |
| **cfgspawnabletypes** | Spawnable types config (attachment groups, cargo groups) |
| **cfgeconomycore.xml** | Central CE config that references all mod files |
| **PBO** | Packaged Binary Object — DayZ mod archive format (similar to ZIP) |
| **mpmission** | Mission folder containing map-level config (spawn points, events) |
| **Tile pyramid** | Hierarchical set of map image tiles at multiple zoom levels |
| **Tier zone** | A map region classified by building tier (loot rarity) |
| **Community map** | User-added satellite map from a DayZ mod's PBO file |
| **Custom Editor (CE) project** | A set of XML + image files for a custom CE config |

### Core Abstractions

- **Server Mission**: A DayZ server root containing `mpmissions/` with mission folders. Each mission has associated config files (types, spawnable types, events, etc.).
- **Map Config**: Defines known maps (Namalsk, Chernarus+, etc.) with their world size, tile base URLs, and overview PNGs.
- **Community Map Registry**: Persisted list of user-registered community maps with PBO paths and world dimensions.
- **Loot Resolver**: Maps raw DayZ item categories to smart display categories (Rifles, Weapon Parts, Magazines, etc.).

### Design Patterns

- **Command pattern** (Tauri): Backend operations are exposed as `#[tauri::command]` async functions.
- **Store pattern** (Zustand): Frontend state is managed through dedicated stores with selectors.
- **Strategy pattern**: Different map sources (vanilla, community, Steam-discovered) use the same tile extraction interface.
- **Worker pattern**: Heavy filtering runs in a web worker (`typesFilterWorker.ts`) to avoid blocking the UI thread.

---

## 6. Common Tasks

### Adding a New Editor Tab

1. Create the editor component in `src/components/editors/MyEditor.tsx`.
2. Add it to the tab bar in `src/components/layout/TopBar.tsx` or the main app switcher in `App.tsx`.
3. If it needs backend data, add a `#[tauri::command]` in `src-tauri/src/` and call it from the component via `@tauri-apps/api/core`.
4. Add any new Zustand state to the appropriate store in `src/store/`.

### Adding a New Community Map

1. Add the map definition to `KNOWN_MAPS` in `src-tauri/src/map_config.rs` with `id`, `label`, `world_size`, and tile URLs.
2. Users can then discover it via Steam auto-discovery or manually add it in Settings → Community Maps.

### Adding a New mpmission Download Source

1. Add an entry to `MPMISSION_SOURCES` in `src-tauri/src/lib.rs`:
   ```rust
   ("newmap", MpmissionSource {
       zip_url:       "https://github.com/.../archive/refs/heads/main.zip",
       zip_subfolder: "Mission Files/dayzOffline.NewMap",
       mission_name:  "dayzOffline.NewMap",
   }),
   ```

### Running the PBO Test Binary

```bash
cd src-tauri
cargo run --bin test_pbo
```

This generates test PNGs in `src-tauri/` to verify PBO tile overlap correctness.

### Preparing Map Resources

```bash
npm run prepare-maps
```

Downloads overview PNGs from xam.nu and stitches them into `resources/maps/`. Required before `npm run tauri:build`.

---

## 7. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Grey flash on app startup | Already handled by `WEBVIEW2_DEFAULT_BACKGROUND_COLOR` env var in `main.rs`. If it persists, ensure the hex value matches your `backgroundColor` in `tauri.conf.json`. |
| Community maps not showing tiles | Run `clear_all_map_tiles` from Settings, then re-extract. Check that the PBO path is valid. |
| Steam auto-discovery fails | Ensure Steam is installed in a standard location. Check that `@DayZ` or workshop folders exist. |
| mpmission download fails | The GitHub repo structure may have changed. Use the manual link shown in the error. |
| Tauri dev server won't start | Ensure port 5173 is free. Run `npm run dev` separately to verify Vite works. |
| PBO parsing errors | The PBO may be encrypted or use a different compression. Try `cargo run --bin inspect_pbo <path>` for diagnostics. |

### Debugging Tips

- Use `cargo run --bin inspect_pbo <pbo_path>` to list PBO contents.
- Use `cargo run --bin dump_cfg <file>` to dump parsed config structure.
- Use `cargo run --bin dump_coords <file>` to extract spawn coordinates.
- Browser DevTools (via Tauri inspector) for frontend debugging.
- Check `app.emit` events (`tile-status`, `tile-progress`, `tile-level-done`) in the console for tile extraction progress.

---

## 8. References

- [Tauri v2 Documentation](https://tauri.app/v2/guides/)
- [React 19 Documentation](https://react.dev)
- [Zustand Documentation](https://zustand.docs.pmnd.rs)
- [Leaflet Documentation](https://leafletjs.com/reference.html)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [hemtt-pbo crate](https://crates.io/crates/hemtt-pbo)
- [DayZ Wiki — Economy Core](https://dayz.wiki/)
- [xam.nu — DayZ map tile service](https://xam.nu/)

---

> **Note**: This guide is auto-generated from the codebase. Sections marked "needs verification" should be reviewed against the current codebase state before sharing with the team.