pub mod tiles;
pub mod pbo;
pub mod bitmap;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::window::Color;

struct SharedClient(reqwest::Client);

// ── Community map registry ──────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommunityMapEntry {
    id: String,
    label: String,
    max_zoom: u32,
    world_width: f64,
    world_height: f64,
    #[serde(default)]
    pbo_path: Option<String>,
    #[serde(default)]
    ce_tool_project_path: Option<String>,
}

struct CommunityMapRegistry(Mutex<Vec<CommunityMapEntry>>);

impl CommunityMapRegistry {
    fn community_maps_path(app_data_dir: &std::path::Path) -> std::path::PathBuf {
        app_data_dir.join("community_maps.json")
    }

    fn load_from_disk(app_data_dir: &std::path::Path) -> Vec<CommunityMapEntry> {
        let path = Self::community_maps_path(app_data_dir);
        if !path.exists() {
            return Vec::new();
        }
        match std::fs::read_to_string(&path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    fn save_to_disk(app_data_dir: &std::path::Path, maps: &[CommunityMapEntry]) -> Result<(), String> {
        let path = Self::community_maps_path(app_data_dir);
        let json = serde_json::to_string_pretty(maps).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())
    }
}

// ── Steam / mod auto-discovery ──────────────────────────────────────────────

struct KnownMap {
    id:         &'static str,
    patterns:   &'static [&'static str],
    label:      &'static str,
    world_size: u32,
}

const KNOWN_MAPS: &[KnownMap] = &[
    KnownMap { id: "chernarus",      patterns: &["chernarusplus", "chernarus"],  label: "Chernarus",       world_size: 15360 },
    KnownMap { id: "livonia",        patterns: &["enoch", "livonia"],            label: "Livonia",         world_size: 12800 },
    KnownMap { id: "sakhal",         patterns: &["sakhal"],                      label: "Sakhal",          world_size: 12800 },
    KnownMap { id: "namalsk",        patterns: &["namalsk"],                     label: "Namalsk",         world_size: 12800 },
    KnownMap { id: "deerisle",       patterns: &["deerisle", "deer_isle"],       label: "Deer Isle",       world_size: 16384 },
    KnownMap { id: "esseker",        patterns: &["esseker"],                     label: "Esseker",         world_size: 12800 },
    KnownMap { id: "banov",          patterns: &["banov"],                       label: "Banov",           world_size: 14336 },
    KnownMap { id: "alteria",        patterns: &["alteria"],                     label: "Alteria",         world_size: 12800 },
    KnownMap { id: "takistan",       patterns: &["takistanplus", "takistan"],    label: "Takistan",        world_size: 12800 },
    KnownMap { id: "namalskorigins", patterns: &["namalsk"],                     label: "Namalsk Origins", world_size: 12800 },
];

fn find_steam_path() -> Option<std::path::PathBuf> {
    // Try Windows registry via reg.exe
    if let Ok(out) = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            if line.contains("SteamPath") {
                let parts: Vec<&str> = line.splitn(4, "    ").collect();
                if let Some(raw) = parts.last() {
                    let p = std::path::PathBuf::from(raw.trim());
                    if p.exists() { return Some(p); }
                }
            }
        }
    }
    // Common fallback paths
    for candidate in &[
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        r"D:\Steam",
        r"D:\Program Files (x86)\Steam",
    ] {
        let p = std::path::PathBuf::from(candidate);
        if p.exists() { return Some(p); }
    }
    None
}

fn steam_library_paths(steam: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut libs = vec![steam.to_path_buf()];
    let vdf = steam.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = std::fs::read_to_string(&vdf) {
        for line in content.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() >= 5 && parts[1].trim() == "path" {
                let raw = parts[3].replace("\\\\", "\\");
                let p = std::path::PathBuf::from(&raw);
                if p.exists() && !libs.contains(&p) { libs.push(p); }
            }
        }
    }
    libs
}

/// Returns (map_id, pbo_path) for every recognized *_data.pbo found across
/// Steam workshop (DayZ app 221100) and local @mod folders in the DayZ install.
fn scan_steam_for_dayz_pbos(libs: &[std::path::PathBuf]) -> Vec<(String, std::path::PathBuf)> {
    let mut found: Vec<(String, std::path::PathBuf)> = Vec::new();

    let pbo_matches_map = |pbo_name: &str| -> Option<&'static str> {
        let lower = pbo_name.to_ascii_lowercase();
        if !lower.ends_with("_data.pbo") { return None; }
        KNOWN_MAPS.iter().find(|m| m.patterns.iter().any(|p| lower.contains(p))).map(|m| m.id)
    };

    for lib in libs {
        // Steam Workshop: {lib}/steamapps/workshop/content/221100/{workshopId}/
        let workshop = lib.join("steamapps").join("workshop").join("content").join("221100");
        if let Ok(entries) = std::fs::read_dir(&workshop) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() { continue; }
                if let Some(pbo) = pbo::find_data_pbo(&entry.path(), 4) {
                    if let Some(name) = pbo.file_name().and_then(|n| n.to_str()) {
                        if let Some(id) = pbo_matches_map(name) {
                            if !found.iter().any(|(fid, _)| fid == id) {
                                found.push((id.to_string(), pbo));
                            }
                        }
                    }
                }
            }
        }

        // Local @mods: {lib}/steamapps/common/DayZ/@*/
        let dayz = lib.join("steamapps").join("common").join("DayZ");
        if let Ok(entries) = std::fs::read_dir(&dayz) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() { continue; }
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !dir_name.starts_with('@') { continue; }
                if let Some(pbo) = pbo::find_data_pbo(&path, 3) {
                    if let Some(name) = pbo.file_name().and_then(|n| n.to_str()) {
                        if let Some(id) = pbo_matches_map(name) {
                            if !found.iter().any(|(fid, _)| fid == id) {
                                found.push((id.to_string(), pbo));
                            }
                        }
                    }
                }
            }
        }
    }
    found
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// `map_id` is meant to be a single directory-name segment (e.g. "chernarus",
/// "custom") that gets joined onto app_data_dir. The frontend already slugifies
/// these to `[a-z0-9-]+`, but a buggy or compromised caller sending `../../etc`
/// or an absolute path would have `PathBuf::join` honor it literally. Reject
/// anything that isn't exactly one plain path component.
fn validate_map_id(map_id: &str) -> Result<(), String> {
    let mut components = std::path::Path::new(map_id).components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(()),
        _ => Err(format!("invalid map_id: {}", map_id)),
    }
}

/// Returns the maps base dir where tiles exist for this map (bundled > user cache).
/// Frontend uses this to construct tile URLs synchronously.
#[tauri::command]
async fn get_tiles_base_dir(
    app:    tauri::AppHandle,
    map_id: String,
) -> Result<Option<String>, String> {
    validate_map_id(&map_id)?;
    if let Ok(resource_dir) = app.path().resource_dir() {
        let maps_dir = resource_dir.join("maps");
        if tiles::tiles_ready(&maps_dir, &map_id) {
            return Ok(Some(maps_dir.to_string_lossy().replace('\\', "/").into()));
        }
    }

    // Dev-mode fallback: exe lives at src-tauri/target/debug/<exe>, so go up 3 levels
    // to find the source resources/ directory (not copied to target/ until `tauri build`).
    #[cfg(debug_assertions)]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(src_tauri) = exe.parent().and_then(|d| d.parent()).and_then(|t| t.parent()) {
            let maps_dir = src_tauri.join("resources").join("maps");
            if tiles::tiles_ready(&maps_dir, &map_id) {
                return Ok(Some(maps_dir.to_string_lossy().replace('\\', "/").into()));
            }
        }
    }

    let maps_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("maps");
    if tiles::tiles_ready(&maps_dir, &map_id) {
        return Ok(Some(maps_dir.to_string_lossy().replace('\\', "/").into()));
    }
    Ok(None)
}

/// Returns the app-data maps dir used during extraction — no tile-completeness check.
/// Use this for early-show (z=0 ready) so we don't wait for z=5 before unhiding the map.
#[tauri::command]
async fn get_extraction_maps_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("maps");
    Ok(dir.to_string_lossy().replace('\\', "/").into())
}

/// Returns the file-system path for a single map tile (frontend uses `convertFileSrc`).
#[tauri::command]
async fn get_tile_path(
    app:    tauri::AppHandle,
    map_id: String,
    z: u32, x: u32, y: u32,
) -> Result<String, String> {
    validate_map_id(&map_id)?;
    // Bundled tile (shipped inside installer).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = tiles::tile_path(&resource_dir.join("maps"), &map_id, z, x, y);
        if p.exists() {
            return p.to_str().ok_or("Invalid path".into()).map(|s| s.to_string());
        }
    }

    // User-cache tile (extracted from PBO at runtime).
    let maps_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("maps");
    let p = tiles::tile_path(&maps_dir, &map_id, z, x, y);
    if p.exists() {
        return p.to_str().ok_or("Invalid path".into()).map(|s| s.to_string());
    }

    Err(format!("Tile {}/{}/{}/{} not found", map_id, z, x, y))
}

/// Extract tile pyramid from PBO for a community map (if not already done).
#[tauri::command]
async fn extract_map_tiles(
    app:      tauri::AppHandle,
    registry: tauri::State<'_, CommunityMapRegistry>,
    map_id:   String,
) -> Result<(), String> {
    validate_map_id(&map_id)?;
    let maps_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("maps");

    if tiles::tiles_ready(&maps_dir, &map_id) {
        return Ok(());
    }

    let pbo_info: Option<(std::path::PathBuf, u32)> = {
        let reg = registry.0.lock().unwrap_or_else(|e| e.into_inner());
        reg.iter().find(|e| e.id == map_id).and_then(|entry| {
            entry.pbo_path.as_ref().map(|p| (
                std::path::PathBuf::from(p),
                entry.world_width as u32,
            ))
        })
    };

    let (pbo_path, world_size) = if let Some(info) = pbo_info {
        info
    } else {
        // No registry entry with a pbo_path — try Steam auto-discovery.
        let discovered = find_steam_path()
            .map(|s| steam_library_paths(&s))
            .and_then(|libs| {
                scan_steam_for_dayz_pbos(&libs)
                    .into_iter()
                    .find(|(id, _)| id == &map_id)
                    .map(|(_, pbo)| pbo)
            });

        let pbo = discovered.ok_or_else(|| format!(
            "No PBO found for '{}'. Install the mod via Steam Workshop or add it manually in Settings → Community Maps.",
            map_id
        ))?;

        // Prefer user-configured world size from existing entry; fall back to KNOWN_MAPS.
        let ws = {
            let reg = registry.0.lock().unwrap_or_else(|e| e.into_inner());
            reg.iter()
                .find(|e| e.id == map_id && e.world_width > 0.0)
                .map(|e| e.world_width as u32)
                .or_else(|| KNOWN_MAPS.iter().find(|m| m.id == map_id.as_str()).map(|m| m.world_size))
                .unwrap_or(12800)
        };

        // Persist pbo_path; preserve existing entry settings or create new entry.
        let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        {
            let mut reg = registry.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(entry) = reg.iter_mut().find(|e| e.id == map_id) {
                entry.pbo_path = Some(pbo.to_string_lossy().into_owned());
            } else {
                let label = KNOWN_MAPS.iter()
                    .find(|m| m.id == map_id.as_str())
                    .map(|m| m.label.to_string())
                    .unwrap_or_else(|| map_id.clone());
                reg.push(CommunityMapEntry {
                    id: map_id.clone(),
                    label,
                    max_zoom: 7,
                    world_width: ws as f64,
                    world_height: ws as f64,
                    pbo_path: Some(pbo.to_string_lossy().into_owned()),
                    ce_tool_project_path: None,
                });
            }
            CommunityMapRegistry::save_to_disk(&app_data_dir, &reg)?;
        }

        (pbo, ws)
    };

    let _ = app.emit("tile-status", "Extracting satellite tiles from PBO…");
    let _ = app.emit("tile-progress", 0.0f32);
    let app_progress = app.clone();
    let app_status = app.clone();
    let app_level = app.clone();
    let map_id_level = map_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        pbo::generate_tile_pyramid(
            &pbo_path,
            &maps_dir,
            &map_id,
            world_size,
            move |frac| { let _ = app_progress.emit("tile-progress", frac); },
            move |status| { let _ = app_status.emit("tile-status", status); },
            move |level| {
                let _ = app_level.emit("tile-level-done", serde_json::json!({
                    "mapId": map_id_level,
                    "level": level,
                }));
            },
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
async fn clear_all_map_tiles(app: tauri::AppHandle) -> Result<(), String> {
    // Only clears app_data_dir tiles (PBO-extracted community maps).
    // Built-in map tiles in resource_dir are never touched.
    let appdata_maps = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("maps");
    if appdata_maps.exists() {
        std::fs::remove_dir_all(&appdata_maps).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn clear_map_tiles(app: tauri::AppHandle, map_id: String) -> Result<(), String> {
    validate_map_id(&map_id)?;
    let tiles_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("maps")
        .join(&map_id)
        .join("tiles");
    if tiles_dir.exists() {
        std::fs::remove_dir_all(&tiles_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn load_community_maps(app: tauri::AppHandle) -> Result<Vec<CommunityMapEntry>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(CommunityMapRegistry::load_from_disk(&app_data_dir))
}

#[tauri::command]
async fn save_community_maps(
    app:      tauri::AppHandle,
    registry: tauri::State<'_, CommunityMapRegistry>,
    maps:     Vec<CommunityMapEntry>,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    CommunityMapRegistry::save_to_disk(&app_data_dir, &maps)?;
    *registry.0.lock().unwrap_or_else(|e| e.into_inner()) = maps;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveredMap {
    id:          String,
    label:       String,
    pbo_path:    String,
    world_width: u32,
}

/// Scan Steam Workshop + local DayZ @mods for known map PBOs.
#[tauri::command]
async fn discover_installed_maps() -> Result<Vec<DiscoveredMap>, String> {
    let steam = find_steam_path().ok_or("Steam installation not found")?;
    let libs  = steam_library_paths(&steam);
    let raw   = scan_steam_for_dayz_pbos(&libs);
    Ok(raw.into_iter().filter_map(|(id, pbo)| {
        let km = KNOWN_MAPS.iter().find(|m| m.id == id.as_str())?;
        Some(DiscoveredMap {
            id,
            label:       km.label.to_string(),
            pbo_path:    pbo.to_string_lossy().replace('\\', "/"),
            world_width: km.world_size,
        })
    }).collect())
}

/// Read world size in metres directly from a *_data.pbo (no user input needed).
#[tauri::command]
async fn read_pbo_world_size(pbo_path: String) -> Result<u32, String> {
    pbo::world_size_from_pbo(std::path::Path::new(&pbo_path))
}

/// Scan a mod folder for a *_data.pbo file (up to 4 levels deep).
#[tauri::command]
async fn find_map_pbo(folder: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&folder);
    Ok(pbo::find_data_pbo(path, 4)
        .map(|p| p.to_string_lossy().replace('\\', "/")))

}

// ── mpmission download ───────────────────────────────────────────────────────

struct MpmissionSource {
    zip_url:       &'static str,
    zip_subfolder: &'static str,
    mission_name:  &'static str,
}

const MPMISSION_SOURCES: &[(&str, MpmissionSource)] = &[
    ("deerisle", MpmissionSource {
        zip_url:       "https://github.com/johnmclane666/Deerisle-Stable/archive/refs/heads/master.zip",
        zip_subfolder: "V5.9/empty.deerisle",
        mission_name:  "empty.deerisle",
    }),
    ("alteria", MpmissionSource {
        zip_url:       "https://github.com/johnmclane666/DayZ-Alteria-Stable/archive/refs/heads/main.zip",
        zip_subfolder: "empty.alteria",
        mission_name:  "empty.alteria",
    }),
    ("banov", MpmissionSource {
        zip_url:       "https://github.com/KubeloLive/Banov-Central-Economy/archive/refs/heads/main.zip",
        zip_subfolder: "empty.banov",
        mission_name:  "empty.banov",
    }),
    ("esseker", MpmissionSource {
        zip_url:       "https://github.com/InclementDab/Esseker-Server/archive/refs/heads/main.zip",
        zip_subfolder: "Mission Files/dayzOffline.Esseker",
        mission_name:  "dayzOffline.Esseker",
    }),
    ("namalskorigins", MpmissionSource {
        zip_url:       "https://github.com/SumrakDZN/Namalsk-Server/archive/refs/heads/main.zip",
        zip_subfolder: "Mission Files/regular.namalsk",
        mission_name:  "regular.namalsk",
    }),
    ("takistan", MpmissionSource {
        zip_url:       "https://github.com/CypeR79/DayZ-Projects/archive/refs/heads/main.zip",
        zip_subfolder: "TakistanPlus/mission",
        mission_name:  "TakistanPlus",
    }),
];

fn extract_mpmission_from_zip(
    zip_bytes:     &[u8],
    zip_subfolder: &str,
    dest:          &std::path::Path,
) -> Result<(), String> {
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    let subfolder = zip_subfolder.replace('\\', "/");
    let marker    = format!("/{}/", subfolder);
    let direct    = format!("{}/", subfolder);
    let mut found = false;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let raw_name  = entry.name().replace('\\', "/");

        let relative = if let Some(pos) = raw_name.find(&marker) {
            &raw_name[pos + marker.len()..]
        } else if raw_name.starts_with(&direct) {
            &raw_name[direct.len()..]
        } else {
            continue;
        };

        found = true;
        if relative.is_empty() { continue; }
        // Zip Slip guard: reject entries whose relative path climbs out of
        // `dest` via `..` segments before we ever join/write to disk.
        if std::path::Path::new(relative).components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(format!("Archive entry escapes destination folder: {}", raw_name));
        }

        let dest_path = dest.join(relative);
        if raw_name.ends_with('/') {
            std::fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }

    if !found {
        return Err(format!(
            "Mission folder '{}' not found in archive — the repo may have been restructured. Use the manual link instead.",
            zip_subfolder
        ));
    }
    Ok(())
}

#[tauri::command]
async fn download_mpmission(
    http:         tauri::State<'_, SharedClient>,
    xam_name:     String,
    mission_path: String,
) -> Result<String, String> {
    let key = xam_name.trim().to_lowercase();
    let source = MPMISSION_SOURCES.iter()
        .find(|(id, _)| *id == key.as_str())
        .map(|(_, s)| s)
        .ok_or_else(|| format!("No automatic download available for '{}'", xam_name))?;

    let mpmissions_dir = std::path::Path::new(&mission_path)
        .parent()
        .ok_or("Cannot determine mpmissions directory from mission path")?;

    let dest = mpmissions_dir.join(source.mission_name);
    if dest.exists() {
        return Err(format!("'{}' already exists in your mpmissions folder", source.mission_name));
    }

    let response = http.0.get(source.zip_url).send().await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {} — use the manual link instead", response.status()));
    }

    let bytes = response.bytes().await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    extract_mpmission_from_zip(&bytes, source.zip_subfolder, &dest)
        .map_err(|e| { let _ = std::fs::remove_dir_all(&dest); e })?;

    Ok(dest.to_string_lossy().into_owned())
}

// ── CE project import ────────────────────────────────────────────────────────

#[tauri::command]
async fn copy_ce_project(app: tauri::AppHandle, source_dir: String, map_id: String) -> Result<String, String> {
    validate_map_id(&map_id)?;
    let source = std::path::Path::new(&source_dir);
    if !source.is_dir() {
        return Err(format!("Not a directory: {}", source_dir));
    }

    // Find CE project XML in source dir (first .xml that isn't cfgAreaFlags.xml)
    let xml_entry = std::fs::read_dir(source)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            name.ends_with(".xml") && name != "cfgareaflags.xml"
        })
        .ok_or_else(|| "No CE project XML found in source directory".to_string())?;

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target = app_data_dir.join("ce-custom").join(&map_id);
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(target.join("layers")).map_err(|e| e.to_string())?;

    // Copy XML files in root
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if matches!(ext.as_str(), "xml" | "tga" | "bmp" | "png") {
                let dest = target.join(entry.file_name());
                std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
            }
        }
    }

    // Copy layers/ subfolder
    let layers_src = source.join("layers");
    if layers_src.is_dir() {
        for entry in std::fs::read_dir(&layers_src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                if matches!(ext.as_str(), "tga" | "bmp" | "png") {
                    let dest = target.join("layers").join(entry.file_name());
                    std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Return path to copied project XML
    let xml_name = xml_entry.file_name();
    let result = target.join(xml_name);
    Ok(result.to_string_lossy().replace('\\', "/"))
}

// ── App entry point ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("HTTP client");

    tauri::Builder::default()
        .setup(|app| {
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let maps = CommunityMapRegistry::load_from_disk(&app_data_dir);
                app.manage(CommunityMapRegistry(Mutex::new(maps)));
            } else {
                app.manage(CommunityMapRegistry(Mutex::new(Vec::new())));
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(Color(2, 6, 23, 255)));
                let _ = window.show();
            }
            Ok(())
        })
        .manage(SharedClient(client))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_tiles_base_dir,
            get_extraction_maps_dir,
            get_tile_path,
            extract_map_tiles,
            clear_map_tiles,
            clear_all_map_tiles,
            load_community_maps,
            save_community_maps,
            download_mpmission,
            find_map_pbo,
            read_pbo_world_size,
            discover_installed_maps,
            bitmap::read_tga_layer,
            bitmap::write_tga_layer,
            bitmap::compile_areaflags,
            copy_ce_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod zip_extract_tests {
    use super::extract_mpmission_from_zip;
    use std::io::Write;

    // Regression check for the zip crate major bump (2 -> 8): builds a real
    // deflate-compressed archive with the writer API and round-trips it
    // through the same extraction path download_mpmission uses.
    #[test]
    fn extracts_nested_mission_folder_with_deflate() {
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut writer = zip::ZipWriter::new(cursor);
            let options: zip::write::FileOptions<()> =
                zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            writer.start_file("repo-main/Mission Files/dayzOffline.Test/cfgeconomycore.xml", options).unwrap();
            writer.write_all(b"<economycore/>").unwrap();

            writer.start_file("repo-main/Mission Files/dayzOffline.Test/db/types.xml", options).unwrap();
            writer.write_all(b"<types/>").unwrap();

            writer.finish().unwrap();
        }

        let dest = std::env::temp_dir().join(format!("zip_extract_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);

        extract_mpmission_from_zip(&buf, "Mission Files/dayzOffline.Test", &dest)
            .expect("extraction should succeed against the current zip crate version");

        let economy = std::fs::read_to_string(dest.join("cfgeconomycore.xml")).unwrap();
        assert_eq!(economy, "<economycore/>");
        let types = std::fs::read_to_string(dest.join("db/types.xml")).unwrap();
        assert_eq!(types, "<types/>");

        let _ = std::fs::remove_dir_all(&dest);
    }

    // Zip Slip regression: an archive entry that climbs out of the mission
    // subfolder with `..` must be rejected, not written outside `dest`.
    #[test]
    fn rejects_path_traversal_entries() {
        let mut buf = Vec::new();
        {
            let cursor = std::io::Cursor::new(&mut buf);
            let mut writer = zip::ZipWriter::new(cursor);
            let options: zip::write::FileOptions<()> =
                zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            writer.start_file("repo-main/Mission Files/dayzOffline.Test/../../../evil.txt", options).unwrap();
            writer.write_all(b"pwned").unwrap();

            writer.finish().unwrap();
        }

        let dest = std::env::temp_dir().join(format!("zip_slip_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);

        let result = extract_mpmission_from_zip(&buf, "Mission Files/dayzOffline.Test", &dest);
        assert!(result.is_err(), "path-traversal entry should be rejected");

        let escaped = std::env::temp_dir().join("evil.txt");
        assert!(!escaped.exists(), "traversal entry must not land outside dest");

        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_file(&escaped);
    }
}
