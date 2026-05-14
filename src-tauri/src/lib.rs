mod tiles;

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

const KNOWN_MAPS: [&str; 4] = ["namalsk", "chernarus", "livonia", "sakhal"];

fn max_xam_zoom_for_map(map_id: &str) -> u32 {
    match map_id {
        "namalsk" => 6,
        "chernarus" => 8,
        "livonia" => 7,
        "sakhal" => 8,
        _ => 6,
    }
}

/// Returns the stitched 4096×4096 overview PNG for a known map, downloading
/// and caching all zoom-4 tiles if needed. Emits "tile-progress" events.
#[tauri::command]
async fn download_map_tiles(
    app:           tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http:          tauri::State<'_, SharedClient>,
    map_id:        String,
) -> Result<ExtractResult, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    if let Some((path, w, h)) = tiles::read_cached_overview(&cache_dir, &map_id)? {
        return Ok(ExtractResult {
            path: path.to_str().ok_or("Invalid path")?.to_string(),
            width: w,
            height: h,
        });
    }

    let version = resolve_version(&version_cache, &http, &map_id).await?;

    let (path, w, h) = tiles::download_overview(
        &map_id,
        &cache_dir,
        &version,
        &http.0,
        |frac| { let _ = app.emit("tile-progress", frac); },
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
    map_id:        String,
    zoom:          u32,
    x:             u32,
    y:             u32,
) -> Result<String, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    let cached_path = tiles::tile_cache_path(&cache_dir, &map_id, zoom, x, y);
    if cached_path.exists() {
        return cached_path
            .to_str()
            .ok_or_else(|| "Invalid path".to_string())
            .map(str::to_string);
    }

    let version = resolve_version(&version_cache, &http, &map_id).await?;
    let def = tiles::tile_def(&map_id)
        .ok_or_else(|| format!("Unknown map '{}'", map_id))?;

    let path = tiles::fetch_tile(&map_id, zoom, x, y, &cache_dir, &version, &http.0, &def).await?;
    path.to_str().ok_or_else(|| "Invalid path".to_string()).map(str::to_string)
}

#[tauri::command]
async fn prepare_map_offline(
    app: tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http: tauri::State<'_, SharedClient>,
    offline_state: tauri::State<'_, OfflinePrepareState>,
    map_id: String,
    max_zoom: u32,
) -> Result<OfflineCacheResult, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    offline_state.cancel_requested.store(false, Ordering::SeqCst);
    let version = resolve_version(&version_cache, &http, &map_id).await?;
    let result = tiles::prefetch_tiles(
        &map_id,
        &cache_dir,
        &version,
        &http.0,
        max_zoom,
        |frac| {
            let _ = app.emit("offline-cache-progress", frac);
        },
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
    app: tauri::AppHandle,
    version_cache: tauri::State<'_, VersionCache>,
    http: tauri::State<'_, SharedClient>,
    offline_state: tauri::State<'_, OfflinePrepareState>,
) -> Result<OfflineCacheResult, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

    offline_state.cancel_requested.store(false, Ordering::SeqCst);

    let mut total = 0u64;
    for map_id in KNOWN_MAPS {
        total += tiles::total_tiles_through_zoom(max_xam_zoom_for_map(map_id));
    }

    let mut aggregate_cached = 0u64;
    let mut aggregate_downloaded = 0u64;
    let mut aggregate_failed = 0u64;
    let mut completed_before = 0u64;

    for map_id in KNOWN_MAPS {
        if offline_state.cancel_requested.load(Ordering::SeqCst) {
            offline_state.cancel_requested.store(false, Ordering::SeqCst);
            return Err("Offline preparation cancelled".to_string());
        }

        let _ = app.emit("offline-cache-map", map_id.to_string());

        let max_zoom = max_xam_zoom_for_map(map_id);
        let map_total = tiles::total_tiles_through_zoom(max_zoom);
        let version = resolve_version(&version_cache, &http, map_id).await?;
        let stats = tiles::prefetch_tiles(
            map_id,
            &cache_dir,
            &version,
            &http.0,
            max_zoom,
            |map_frac| {
                let done = completed_before as f64 + (map_frac as f64 * map_total as f64);
                let global_frac = (done / total as f64) as f32;
                let _ = app.emit("offline-cache-progress", global_frac);
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
async fn get_offline_cache_statuses(app: tauri::AppHandle) -> Result<Vec<MapOfflineStatus>, String> {
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("map_cache");

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
        Ok(statuses)
    }).await.map_err(|e| e.to_string())?
}

async fn resolve_version(
    version_cache: &VersionCache,
    http:          &SharedClient,
    map_id:        &str,
) -> Result<String, String> {
    {
        let cache = version_cache.0.lock().unwrap();
        if let Some(v) = cache.get(map_id) {
            return Ok(v.clone());
        }
    }
    let def = tiles::tile_def(map_id)
        .ok_or_else(|| format!("Unknown map '{}'", map_id))?;
    let v = tiles::probe_version(&http.0, def.xam_name, def.versions, def.layer).await?;
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
        .invoke_handler(tauri::generate_handler![
            download_map_tiles,
            get_tile_path,
            prepare_map_offline,
            prepare_all_maps_offline,
            cancel_offline_prepare,
            get_offline_cache_statuses
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
