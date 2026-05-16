use image::{ImageBuffer, RgbaImage};
use std::path::{Path, PathBuf};

pub struct TileDef {
    pub xam_name: &'static str,
    pub versions:  &'static [&'static str],
    pub layer:     &'static str,
    /// Maximum xam.nu zoom level available for this map (zoom 4 is always the minimum).
    pub max_zoom:  u32,
}

pub fn total_tiles_through_zoom(max_zoom: u32) -> u64 {
    let start_zoom = 4u32;
    let clamped_max_zoom = max_zoom.max(start_zoom);
    let mut total = 0u64;
    for z in start_zoom..=clamped_max_zoom {
        let grid = 1u32 << z;
        total += (grid as u64) * (grid as u64);
    }
    total
}

#[derive(Default)]
pub struct PrefetchStats {
    pub total: u64,
    pub cached: u64,
    pub downloaded: u64,
    pub failed: u64,
}

pub fn tile_def(map_id: &str) -> Option<TileDef> {
    match map_id {
        "namalsk" => Some(TileDef {
            xam_name: "namalsk",
            versions:  &["May.27", "a3", "latest"],
            layer:     "topographic",
            max_zoom:  6,
        }),
        "chernarus" => Some(TileDef {
            xam_name: "chernarusplus",
            versions:  &["1.27", "1.26", "latest"],
            layer:     "topographic",
            max_zoom:  8,
        }),
        "livonia" => Some(TileDef {
            xam_name: "livonia",
            versions:  &["1.27", "1.26", "latest"],
            layer:     "topographic",
            max_zoom:  7,
        }),
        "sakhal" => Some(TileDef {
            xam_name: "sakhal",
            versions:  &["1.27", "latest"],
            layer:     "topographic",
            max_zoom:  8,
        }),
        _ => None,
    }
}

pub async fn probe_version(
    client:   &reqwest::Client,
    name:     &str,
    versions: &[&str],
    layer:    &str,
    on_try:   impl Fn(&str),
) -> Result<String, String> {
    // Use a short timeout for probing — HEAD requests should respond in under a second.
    let probe_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .unwrap_or_else(|_| client.clone());

    for &ver in versions {
        on_try(ver);
        let url = format!(
            "https://static.xam.nu/dayz/maps/{}/{}/{}/4/0/0.webp",
            name, ver, layer
        );
        if let Ok(resp) = probe_client.head(&url).send().await {
            if resp.status().is_success() {
                return Ok(ver.to_string());
            }
        }
    }
    Err(format!(
        "Could not find tiles for '{}' on xam.nu (tried versions: {}). Check your internet connection or the map name.",
        name,
        versions.join(", ")
    ))
}

/// Download all zoom-4 tiles, stitch them into a 4096×4096 overview PNG, and
/// populate the per-tile cache. The overview is used as a persistent background
/// ImageOverlay; detail tiles (zoom ≥ 5) are fetched on demand via fetch_tile.
pub async fn download_overview(
    map_id:      &str,
    cache_dir:   &Path,
    version:     &str,
    client:      &reqwest::Client,
    on_progress: impl Fn(f32),
) -> Result<(PathBuf, u32, u32), String> {
    let overview = cache_dir.join(format!("{}_tiles.png", map_id));
    if overview.exists() {
        let img = image::open(&overview).map_err(|e| format!("Cache read: {}", e))?;
        return Ok((overview, img.width(), img.height()));
    }

    const ZOOM: u32 = 4;
    const GRID: u32 = 16;
    const TILE_PX: u32 = 256;
    const TOTAL: u32 = GRID * TILE_PX; // 4096

    let def = tile_def(map_id).ok_or_else(|| format!("Unknown map '{}'", map_id))?;

    let mut canvas: RgbaImage = ImageBuffer::new(TOTAL, TOTAL);
    let total = GRID * GRID;
    let mut done = 0u32;

    for ty in 0..GRID {
        for tx in 0..GRID {
            // Download tile and cache it individually for later zoom-in use
            let tile_path = fetch_tile(map_id, ZOOM, tx, ty, cache_dir, version, client, def.xam_name, def.layer).await?;
            let tile = image::open(&tile_path)
                .map_err(|e| format!("Decode ({},{}): {}", tx, ty, e))?
                .to_rgba8();
            image::imageops::replace(&mut canvas, &tile, (tx * TILE_PX) as i64, (ty * TILE_PX) as i64);
            done += 1;
            on_progress(done as f32 / total as f32);
        }
    }

    std::fs::create_dir_all(cache_dir).map_err(|e| format!("Cache dir: {}", e))?;
    canvas
        .save_with_format(&overview, image::ImageFormat::Png)
        .map_err(|e| format!("PNG save: {}", e))?;

    Ok((overview, TOTAL, TOTAL))
}

pub fn overview_cache_path(cache_dir: &Path, map_id: &str) -> PathBuf {
    cache_dir.join(format!("{}_tiles.png", map_id))
}

pub fn read_cached_overview(cache_dir: &Path, map_id: &str) -> Result<Option<(PathBuf, u32, u32)>, String> {
    let overview = overview_cache_path(cache_dir, map_id);
    if !overview.exists() {
        return Ok(None);
    }
    // Overview PNGs are always TOTAL×TOTAL (4096×4096). Skip full decode.
    const TOTAL: u32 = 4096;
    Ok(Some((overview, TOTAL, TOTAL)))
}

pub fn tile_cache_path(
    cache_dir: &Path,
    map_id: &str,
    zoom: u32,
    x: u32,
    y: u32,
) -> PathBuf {
    cache_dir
        .join(map_id)
        .join(zoom.to_string())
        .join(x.to_string())
        .join(format!("{}.webp", y))
}

pub fn cached_tile_coverage(
    cache_dir: &Path,
    map_id: &str,
    max_zoom: u32,
) -> (u64, u64) {
    let start_zoom = 4u32;
    let clamped_max_zoom = max_zoom.max(start_zoom);
    let mut total = 0u64;
    let mut cached = 0u64;

    for z in start_zoom..=clamped_max_zoom {
        let grid = 1u32 << z;
        for y in 0..grid {
            for x in 0..grid {
                total += 1;
                let path = tile_cache_path(cache_dir, map_id, z, x, y);
                if path.exists() {
                    cached += 1;
                }
            }
        }
    }

    (cached, total)
}

/// Fetch a single tile (zoom ≥ 4), downloading from xam.nu if not cached.
pub async fn fetch_tile(
    map_id:    &str,
    zoom:      u32,
    x:         u32,
    y:         u32,
    cache_dir: &Path,
    version:   &str,
    client:    &reqwest::Client,
    xam_name:  &str,
    layer:     &str,
) -> Result<PathBuf, String> {
    let path = tile_cache_path(cache_dir, map_id, zoom, x, y);

    if path.exists() {
        return Ok(path);
    }

    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("Cache dir: {}", e))?;

    let url = format!(
        "https://static.xam.nu/dayz/maps/{}/{}/{}/{}/{}/{}.webp",
        xam_name, version, layer, zoom, x, y
    );

    let resp = client.get(&url).send().await
        .map_err(|e| format!("Download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Read: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("Write: {}", e))?;

    Ok(path)
}

pub async fn prefetch_tiles(
    map_id: &str,
    cache_dir: &Path,
    version: &str,
    client: &reqwest::Client,
    max_zoom: u32,
    on_progress: impl Fn(f32),
    should_cancel: impl Fn() -> bool,
) -> Result<PrefetchStats, String> {
    let def = tile_def(map_id).ok_or_else(|| format!("Unknown map '{}'", map_id))?;

    let start_zoom = 4u32;
    let clamped_max_zoom = max_zoom.max(start_zoom);
    let mut stats = PrefetchStats::default();
    stats.total = total_tiles_through_zoom(clamped_max_zoom);

    let mut done = 0u64;
    for z in start_zoom..=clamped_max_zoom {
        let grid = 1u32 << z;
        for y in 0..grid {
            for x in 0..grid {
                if should_cancel() {
                    return Err("Offline preparation cancelled".to_string());
                }

                let path = tile_cache_path(cache_dir, map_id, z, x, y);
                if path.exists() {
                    stats.cached += 1;
                } else {
                    match fetch_tile(map_id, z, x, y, cache_dir, version, client, def.xam_name, def.layer).await {
                        Ok(_) => stats.downloaded += 1,
                        Err(_) => stats.failed += 1,
                    }
                }

                done += 1;
                on_progress(done as f32 / stats.total as f32);
            }
        }
    }

    Ok(stats)
}
