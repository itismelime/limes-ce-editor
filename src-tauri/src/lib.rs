mod tiles;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct VersionCache(Mutex<HashMap<String, String>>);
struct SharedClient(reqwest::Client);

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

    let version = resolve_version(&version_cache, &http, &map_id).await?;
    let def = tiles::tile_def(&map_id)
        .ok_or_else(|| format!("Unknown map '{}'", map_id))?;

    let path = tiles::fetch_tile(&map_id, zoom, x, y, &cache_dir, &version, &http.0, &def).await?;
    path.to_str().ok_or_else(|| "Invalid path".to_string()).map(str::to_string)
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
        .manage(VersionCache(Mutex::new(HashMap::new())))
        .manage(SharedClient(client))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![download_map_tiles, get_tile_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
