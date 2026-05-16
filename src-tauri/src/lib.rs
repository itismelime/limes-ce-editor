pub mod tiles;
pub mod pbo;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::window::Color;

struct VersionCache(Mutex<HashMap<String, String>>);
struct SharedClient(reqwest::Client);
struct OfflinePrepareState {
    cancel_requested: AtomicBool,
}

// ── Community map registry ──────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommunityMapEntry {
    id: String,
    label: String,
    xam_name: String,
    max_zoom: u32,
    world_width: f64,
    world_height: f64,
    /// Optional path to the mod's *_data.pbo for offline satellite tile extraction.
    #[serde(default)]
    pbo_path: Option<String>,
}

struct CommunityMapRegistry(Mutex<Vec<CommunityMapEntry>>);

/// Default xam.nu versions to try for community maps (in order of preference).
const DEFAULT_COMMUNITY_VERSIONS: &[&str] = &["latest", "1.27", "1.26", "May.27", "a3"];
const DEFAULT_COMMUNITY_LAYER: &str = "topographic";

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

/// Returns `(xam_name, versions, layer)` for any map ID — built-in or community.
fn get_xam_info<'a>(
    map_id: &str,
    registry: &CommunityMapRegistry,
) -> Result<(String, &'static [&'static str], &'static str), String> {
    if let Some(def) = tiles::tile_def(map_id) {
        return Ok((def.xam_name.to_string(), def.versions, def.layer));
    }
    let reg = registry.0.lock().unwrap();
    let entry = reg.iter()
        .find(|e| e.id == map_id)
        .ok_or_else(|| format!("Unknown map '{}'", map_id))?;
    Ok((entry.xam_name.clone(), DEFAULT_COMMUNITY_VERSIONS, DEFAULT_COMMUNITY_LAYER))
}

// ── Serialisable result types ───────────────────────────────────────────────

#[derive(serde::Serialize)]
struct OfflineCacheResult {
    total: u64,
    cached: u64,
    downloaded: u64,
    failed: u64,
}

#[derive(serde::Serialize)]
struct MapOfflineStatus {
    map_id: String,
    ready: bool,
    cached: u64,
    total: u64,
}

#[derive(serde::Serialize)]
struct ProbeCommunityMapResult {
    valid: bool,
    version: String,
    max_zoom: u32,
}

// ── Built-in map helpers ────────────────────────────────────────────────────

const KNOWN_MAPS: [&str; 4] = ["namalsk", "chernarus", "livonia", "sakhal"];

fn max_xam_zoom_for_map(map_id: &str) -> u32 {
    tiles::tile_def(map_id)
        .map(|d| d.max_zoom)
        .unwrap_or(6)
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Returns the stitched 4096×4096 overview PNG for a map, downloading and
/// caching all zoom-4 tiles if needed. Emits "tile-progress" events.
#[tauri::command]
async fn download_map_tiles(
    app:           tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http:          tauri::State<'_, SharedClient>,
    registry:      tauri::State<'_, CommunityMapRegistry>,
    map_id:        String,
) -> Result<ExtractResult, String> {
    let _ = app.emit("tile-status", "Checking bundled resources…");

    // 1. Check for a bundled overview PNG shipped inside the installer.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("maps").join(format!("{}_tiles.png", map_id));
        if bundled.exists() {
            let _ = app.emit("tile-status", "Loading bundled map…");
            return Ok(ExtractResult {
                path:   bundled.to_str().ok_or("Invalid path")?.to_string(),
                width:  4096,
                height: 4096,
            });
        }
    }

    let _ = app.emit("tile-status", "Checking disk cache…");

    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    // 2. Check the on-disk download cache (covers both xam.nu and PBO-generated overviews).
    if let Some((path, w, h)) = tiles::read_cached_overview(&cache_dir, &map_id)? {
        return Ok(ExtractResult {
            path: path.to_str().ok_or("Invalid path")?.to_string(),
            width: w,
            height: h,
        });
    }

    // 3. If this community map has a PBO path, extract satellite tiles from the PBO.
    let pbo_info: Option<(std::path::PathBuf, u32)> = {
        let reg = registry.0.lock().unwrap();
        reg.iter().find(|e| e.id == map_id).and_then(|entry| {
            entry.pbo_path.as_ref().map(|p| (
                std::path::PathBuf::from(p),
                entry.world_width as u32,
            ))
        })
    };
    if let Some((pbo_path, world_size)) = pbo_info {
        let overview_path = tiles::overview_cache_path(&cache_dir, &map_id);
        let _ = app.emit("tile-status", "Extracting satellite tiles from PBO…");
        let _ = app.emit("tile-progress", 0.0f32);
        let app_progress = app.clone();
        let app_status = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            pbo::generate_overview(
                &pbo_path,
                &overview_path,
                world_size,
                move |frac| { let _ = app_progress.emit("tile-progress", frac); },
                move |status| { let _ = app_status.emit("tile-status", status); },
            )
        })
        .await
        .map_err(|e| e.to_string())??;
        let path = tiles::overview_cache_path(&cache_dir, &map_id);
        return Ok(ExtractResult {
            path: path.to_str().ok_or("Invalid path")?.to_string(),
            width: 4096,
            height: 4096,
        });
    }

    // 4. Fall back to downloading from xam.nu.
    // Check version cache first (same logic as resolve_version but with status events).
    let version = {
        let cached = version_cache.0.lock().unwrap().get(&map_id).cloned();
        if let Some(v) = cached {
            v
        } else {
            let (xam_name, versions, layer) = get_xam_info(&map_id, &registry)?;
            let app2 = app.clone();
            let v = tiles::probe_version(&http.0, &xam_name, versions, layer, move |ver| {
                let _ = app2.emit("tile-status", format!("Trying version '{}'…", ver));
            }).await?;
            version_cache.0.lock().unwrap().insert(map_id.clone(), v.clone());
            v
        }
    };
    let _ = app.emit("tile-status", format!("Downloading tiles (version {})…", version));
    let (path, w, h) = tiles::download_overview(
        &map_id,
        &cache_dir,
        &version,
        &http.0,
        |frac| {
            let _ = app.emit("tile-progress", frac);
            let _ = app.emit("tile-status", format!("Downloading tiles… {}%", (frac * 100.0) as u32));
        },
    )
    .await?;

    Ok(ExtractResult {
        path: path.to_str().ok_or("Invalid path")?.to_string(),
        width: w,
        height: h,
    })
}

/// Fetches a single detail tile (zoom ≥ 5) from cache or xam.nu, returning
/// its local file path so the frontend can load it via the asset protocol.
#[tauri::command]
async fn get_tile_path(
    app:           tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http:          tauri::State<'_, SharedClient>,
    registry:      tauri::State<'_, CommunityMapRegistry>,
    map_id:        String,
    zoom:          u32,
    x:             u32,
    y:             u32,
) -> Result<String, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    // 1. On-disk download cache (fastest for tiles already fetched).
    let cached_path = tiles::tile_cache_path(&cache_dir, &map_id, zoom, x, y);
    if cached_path.exists() {
        return cached_path
            .to_str()
            .ok_or_else(|| "Invalid path".to_string())
            .map(str::to_string);
    }

    // 2. Bundled resource tiles (shipped inside the installer).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = tiles::tile_cache_path(&resource_dir.join("maps"), &map_id, zoom, x, y);
        if bundled.exists() {
            return bundled
                .to_str()
                .ok_or_else(|| "Invalid path".to_string())
                .map(str::to_string);
        }
    }

    // 3. Download from xam.nu and cache locally.
    let version = resolve_version(&version_cache, &http, &registry, &map_id).await?;
    let (xam_name, _versions, layer) = get_xam_info(&map_id, &registry)?;

    let path = tiles::fetch_tile(&map_id, zoom, x, y, &cache_dir, &version, &http.0, &xam_name, layer).await?;
    path.to_str().ok_or_else(|| "Invalid path".to_string()).map(str::to_string)
}

#[tauri::command]
async fn prepare_map_offline(
    app:           tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http:          tauri::State<'_, SharedClient>,
    offline_state: tauri::State<'_, OfflinePrepareState>,
    registry:      tauri::State<'_, CommunityMapRegistry>,
    map_id:        String,
    max_zoom:      u32,
) -> Result<OfflineCacheResult, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    offline_state.cancel_requested.store(false, Ordering::SeqCst);
    let version = resolve_version(&version_cache, &http, &registry, &map_id).await?;
    let result = tiles::prefetch_tiles(
        &map_id,
        &cache_dir,
        &version,
        &http.0,
        max_zoom,
        |frac| { let _ = app.emit("offline-cache-progress", frac); },
        || offline_state.cancel_requested.load(Ordering::SeqCst),
    ).await;

    offline_state.cancel_requested.store(false, Ordering::SeqCst);
    let stats = result?;

    Ok(OfflineCacheResult {
        total: stats.total,
        cached: stats.cached,
        downloaded: stats.downloaded,
        failed: stats.failed,
    })
}

#[tauri::command]
async fn prepare_all_maps_offline(
    app:           tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http:          tauri::State<'_, SharedClient>,
    offline_state: tauri::State<'_, OfflinePrepareState>,
    registry:      tauri::State<'_, CommunityMapRegistry>,
) -> Result<OfflineCacheResult, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    offline_state.cancel_requested.store(false, Ordering::SeqCst);

    // Collect all maps (built-in + community) for progress calculation.
    let community_maps: Vec<CommunityMapEntry> = registry.0.lock().unwrap().clone();

    let mut total = 0u64;
    for map_id in KNOWN_MAPS {
        total += tiles::total_tiles_through_zoom(max_xam_zoom_for_map(map_id));
    }
    for entry in &community_maps {
        total += tiles::total_tiles_through_zoom(entry.max_zoom);
    }

    let mut aggregate_cached = 0u64;
    let mut aggregate_downloaded = 0u64;
    let mut aggregate_failed = 0u64;
    let mut completed_before = 0u64;

    // Built-in maps first.
    for map_id in KNOWN_MAPS {
        if offline_state.cancel_requested.load(Ordering::SeqCst) {
            offline_state.cancel_requested.store(false, Ordering::SeqCst);
            return Err("Offline preparation cancelled".to_string());
        }

        let _ = app.emit("offline-cache-map", map_id.to_string());
        let max_zoom = max_xam_zoom_for_map(map_id);
        let map_total = tiles::total_tiles_through_zoom(max_zoom);
        let version = resolve_version(&version_cache, &http, &registry, map_id).await?;
        let stats = tiles::prefetch_tiles(
            map_id, &cache_dir, &version, &http.0, max_zoom,
            |map_frac| {
                let done = completed_before as f64 + (map_frac as f64 * map_total as f64);
                let _ = app.emit("offline-cache-progress", (done / total as f64) as f32);
            },
            || offline_state.cancel_requested.load(Ordering::SeqCst),
        ).await?;

        aggregate_cached += stats.cached;
        aggregate_downloaded += stats.downloaded;
        aggregate_failed += stats.failed;
        completed_before += map_total;
    }

    // Community maps.
    for entry in community_maps {
        if offline_state.cancel_requested.load(Ordering::SeqCst) {
            offline_state.cancel_requested.store(false, Ordering::SeqCst);
            return Err("Offline preparation cancelled".to_string());
        }

        let _ = app.emit("offline-cache-map", entry.id.clone());
        let map_total = tiles::total_tiles_through_zoom(entry.max_zoom);
        let version = resolve_version(&version_cache, &http, &registry, &entry.id).await?;
        let stats = tiles::prefetch_tiles(
            &entry.id, &cache_dir, &version, &http.0, entry.max_zoom,
            |map_frac| {
                let done = completed_before as f64 + (map_frac as f64 * map_total as f64);
                let _ = app.emit("offline-cache-progress", (done / total as f64) as f32);
            },
            || offline_state.cancel_requested.load(Ordering::SeqCst),
        ).await?;

        aggregate_cached += stats.cached;
        aggregate_downloaded += stats.downloaded;
        aggregate_failed += stats.failed;
        completed_before += map_total;
    }

    offline_state.cancel_requested.store(false, Ordering::SeqCst);
    Ok(OfflineCacheResult {
        total,
        cached: aggregate_cached,
        downloaded: aggregate_downloaded,
        failed: aggregate_failed,
    })
}

#[tauri::command]
fn cancel_offline_prepare(offline_state: tauri::State<'_, OfflinePrepareState>) {
    offline_state.cancel_requested.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn get_offline_cache_statuses(
    app:      tauri::AppHandle,
    registry: tauri::State<'_, CommunityMapRegistry>,
) -> Result<Vec<MapOfflineStatus>, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    let community_maps: Vec<CommunityMapEntry> = registry.0.lock().unwrap().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut statuses = Vec::new();
        for map_id in KNOWN_MAPS {
            let (cached, total) = tiles::cached_tile_coverage(&cache_dir, map_id, max_xam_zoom_for_map(map_id));
            statuses.push(MapOfflineStatus {
                map_id: map_id.to_string(),
                ready: total > 0 && cached == total,
                cached,
                total,
            });
        }
        for entry in community_maps {
            let (cached, total) = tiles::cached_tile_coverage(&cache_dir, &entry.id, entry.max_zoom);
            statuses.push(MapOfflineStatus {
                map_id: entry.id,
                ready: total > 0 && cached == total,
                cached,
                total,
            });
        }
        Ok(statuses)
    }).await.map_err(|e| e.to_string())?
}

/// Validates that a map name exists on xam.nu and auto-detects its max zoom level.
#[tauri::command]
async fn probe_community_map(
    http:     tauri::State<'_, SharedClient>,
    xam_name: String,
) -> Result<ProbeCommunityMapResult, String> {
    let version = match tiles::probe_version(
        &http.0, &xam_name, DEFAULT_COMMUNITY_VERSIONS, DEFAULT_COMMUNITY_LAYER, |_| {},
    ).await {
        Ok(v) => v,
        Err(_) => return Ok(ProbeCommunityMapResult { valid: false, version: String::new(), max_zoom: 4 }),
    };

    // Auto-detect max zoom by probing zoom levels 5–10 at tile (0, 0).
    let mut max_zoom = 4u32;
    for z in 5u32..=10 {
        let url = format!(
            "https://static.xam.nu/dayz/maps/{}/{}/{}/{}/0/0.webp",
            xam_name, version, DEFAULT_COMMUNITY_LAYER, z
        );
        match http.0.head(&url).send().await {
            Ok(resp) if resp.status().is_success() => max_zoom = z,
            _ => break,
        }
    }

    Ok(ProbeCommunityMapResult { valid: true, version, max_zoom })
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
    *registry.0.lock().unwrap() = maps;
    Ok(())
}

// ── mpmission download ───────────────────────────────────────────────────────

struct MpmissionSource {
    zip_url:       &'static str,
    zip_subfolder: &'static str, // path inside ZIP (after the repo-branch prefix)
    mission_name:  &'static str, // destination folder name inside mpmissions/
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
        return Err(format!("Mission folder '{}' not found in archive — the repo may have been restructured. Use the manual link instead.", zip_subfolder));
    }
    Ok(())
}

#[tauri::command]
async fn download_mpmission(
    http:        tauri::State<'_, SharedClient>,
    xam_name:    String,
    mission_path: String, // path to the currently loaded mpmission (used to find mpmissions dir)
) -> Result<String, String> {
    let xam_lower = xam_name.trim().to_lowercase();
    let source = MPMISSION_SOURCES.iter()
        .find(|(id, _)| *id == xam_lower.as_str())
        .map(|(_, s)| s)
        .ok_or_else(|| format!("No automatic download available for '{}'", xam_name))?;

    // Parent of the loaded mpmission is the mpmissions/ directory.
    let mpmissions_dir = std::path::Path::new(&mission_path)
        .parent()
        .ok_or("Cannot determine mpmissions directory from mission path")?;

    let dest = mpmissions_dir.join(source.mission_name);
    if dest.exists() {
        return Err(format!("'{}' already exists in your mpmissions folder", source.mission_name));
    }

    let response = http.0.get(source.zip_url)
        .send().await
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

// ── Internal helpers ────────────────────────────────────────────────────────

async fn resolve_version(
    version_cache: &VersionCache,
    http:          &SharedClient,
    registry:      &CommunityMapRegistry,
    map_id:        &str,
) -> Result<String, String> {
    {
        let cache = version_cache.0.lock().unwrap();
        if let Some(v) = cache.get(map_id) {
            return Ok(v.clone());
        }
    }
    let (xam_name, versions, layer) = get_xam_info(map_id, registry)?;
    let v = tiles::probe_version(&http.0, &xam_name, versions, layer, |_| {}).await?;
    version_cache.0.lock().unwrap().insert(map_id.to_string(), v.clone());
    Ok(v)
}

#[derive(serde::Serialize)]
struct ExtractResult {
    path:   String,
    width:  u32,
    height: u32,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("HTTP client");

    tauri::Builder::default()
        .setup(|app| {
            // Load persisted community maps into the registry state.
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let maps = CommunityMapRegistry::load_from_disk(&app_data_dir);
                app.manage(CommunityMapRegistry(Mutex::new(maps)));
            } else {
                app.manage(CommunityMapRegistry(Mutex::new(Vec::new())));
            }

            if let Some(window) = app.get_webview_window("main") {
                // Set both native window + WebView2 background to match the app's slate-950
                // before showing, so no grey/white flash during webview initialization.
                let _ = window.set_background_color(Some(Color(2, 6, 23, 255)));
                let _ = window.show();
            }
            Ok(())
        })
        .manage(VersionCache(Mutex::new(HashMap::new())))
        .manage(SharedClient(client))
        .manage(OfflinePrepareState { cancel_requested: AtomicBool::new(false) })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            download_map_tiles,
            get_tile_path,
            prepare_map_offline,
            prepare_all_maps_offline,
            cancel_offline_prepare,
            get_offline_cache_statuses,
            probe_community_map,
            load_community_maps,
            save_community_maps,
            download_mpmission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

