# DayZ Loot Editor

> A desktop GUI for editing DayZ server loot configuration files — no more hand-editing XML.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange)

---

## Features

- **Types Editor** — Edit item spawn quantities, lifetime, restock timers, flags, usages, and tier assignments (`types.xml`)
- **Events Editor** — Configure event definitions, nominal/min/max counts, and child loot groups (`events.xml`)
- **Event Spawns Editor** — View and edit map coordinates for every spawn event (`cfgeventspawns.xml`)
- **Spawnable Types Editor** — Manage items that spawn inside containers and vehicles (`cfgspawnabletypes.xml`)
- **Interactive Map** — Visualise spawn markers on a live in-game map with tier/usage colour coding and high-res tile support for Chernarus, Namalsk, Livonia, and Sakhal
- **Mission Picker** — Quickly switch between multiple mission folders in one server directory
- **Search & Filter** — Fast search across all item lists with virtualised rendering for large files

---

## Getting Started

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| Rust / Cargo | stable |
| Tauri CLI | v2 |

### Install & Run

```bash
npm install
npm run tauri:dev
```

### Build

```bash
npm run tauri:build
```

The installer is output to `src-tauri/target/release/bundle/`.

---

## Usage

1. Launch the app and click **Open Server Folder**.
2. Point it at your mission's `db/` directory (e.g. `mpmissions\dayzOffline.chernarusplus\db`).
3. Use the tabs to edit **Types**, **Events**, **Event Spawns**, or **Spawnable Types**.
4. Hit **Save** in the top bar — the original XML files are written back in-place.

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
| Bundler | Vite |
