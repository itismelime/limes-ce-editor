# Lime's CE Editor

> A desktop tool for visualising and editing DayZ server loot tables — no more hand-editing XML.

[![Version](https://img.shields.io/badge/version-0.3.0-blue?style=flat-square)](https://github.com/itismelime/limes-ce-editor/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)]()
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)

---

<!-- Replace with an actual screenshot: docs/screenshot.png -->
<!--
![Lime's CE Editor Screenshot](docs/screenshot.png)
-->

## What it does

Lime's CE Editor opens your server mission folder and lets you read, search, filter, and edit every loot-related XML file through a clean UI. Changes write back to the original files — no format is changed, comments are preserved, and nothing outside the files you edit is touched.

Supports **vanilla loot tables** and fully merges **mod economy core entries** (Custom Types folders, extra `cfgspawnabletypes` files, rootless XML fragments — all handled automatically).

---

## Features

### Interactive Map
- Live map overlay for **Namalsk, Chernarus+, Livonia,** and **Sakhal**
- Buildings rendered as coloured markers by their dominant **tier zone**
- Click any building to see a **loot breakdown by category** — Rifles, Pistols, Weapons, Weapon Parts, Ammunition, Magazines, Ammo Boxes, Clothes, and more
- Smart attachment detection: scopes, suppressors, magazines, and mod-specific items are automatically separated from base weapons
- Filter by tier, usage zone, loot name, and **global category filter** that carries over from the Loot Types tab

### Loot Types Editor
- Browse all `types.xml` entries across base files and every merged mod file
- **Sortable columns** — Name, Category, Tiers, Usages, Min, Nominal
- **Filter by display category** — uses the same smart classification as the map popup (Rifles, Weapon Parts, Magazines, etc.) rather than the raw DayZ category field
- Filter by tier, usage zone, and source file
- Toggle inactive items (nominal = 0) on/off
- Inline edit Min and Nominal; full detail panel for Quantities, Tiers, Usages, Flags
- **Undo** (per-item, up to 200 steps) and **Revert** to restore any source file to its loaded state
- Per-file save with unsaved-changes indicator

### Spawnable Types Editor
- Full view of merged `cfgspawnabletypes` entries from all economy core sources
- Click any entry to inspect cargo groups and attachment groups with chances

### Economy Core Editor
- View and manage `cfgeconomycore.xml` entries
- Add custom type packs and remove entries directly from the UI

### Events & Event Spawn Points
- Edit event definitions (nominal, min, max, lifetime, children)
- View and edit map coordinates for every spawn event

### Player Spawn Points
- View configured player spawn locations overlaid on the map

---

## Mod Support

The editor automatically loads and merges files registered in `cfgeconomycore.xml`, including:

- Extra `types` files (adds items to the Loot Types tab)
- Extra `spawnabletypes` / `cfgspawnabletypes` files (feeds attachment classification)
- Rootless XML fragments (files with no wrapping root element)
- Files mislabelled as `cfgspawnabletypes` that are actually `types` files

Any files that cannot be read are surfaced as warnings — the editor continues working with whatever was found.

---

## Getting Started

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| Rust / Cargo | stable |
| Tauri CLI | v2 |

### Install & Run (dev)

```bash
npm install
npm run tauri:dev
```

### Build installer

Before building for distribution, generate the bundled offline map images once.
This downloads the four overview PNGs from xam.nu and stitches them locally —
internet access is required for this step, but **not** for end users after installation.

```bash
npm run prepare-maps   # one-time download + stitch (requires internet + Rust toolchain)
npm run tauri:build
```

Installers are written to `src-tauri/target/release/bundle/` — MSI under `msi/`, NSIS exe under `nsis/`.

> **Note:** The generated map PNGs (~30–50 MB total) are git-ignored.
> Re-run `npm run prepare-maps` whenever you want to refresh them from the latest xam.nu tiles.

---

## Usage

1. Launch the app and click **Open Server Folder**
2. Select your server root — the editor will scan for all missions and auto-select the one matching your active map
3. If multiple missions are found a **Mission Picker** dialog lets you choose
4. Use the tab bar to navigate between **Map → Loot Types → Spawnable Types → Player Spawn Points → Events → Event Spawn Points → Economy Core**
5. Edit values inline; a **Save** button appears per file when there are unsaved changes

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | [Tauri 2](https://tauri.app) (Rust) |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Map | Leaflet + react-leaflet |
| XML | fast-xml-parser |
| State | Zustand |
| Virtual lists | @tanstack/react-virtual |
| Bundler | Vite |

---

## License

MIT — see [LICENSE](LICENSE).
