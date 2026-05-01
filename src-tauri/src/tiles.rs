use image::{ImageBuffer, RgbaImage};
use std::path::{Path, PathBuf};

pub struct TileDef {
    pub xam_name: &'static str,
    pub versions:  &'static [&'static str],
    pub layer:     &'static str,
}

pub fn tile_def(map_id: &str) -> Option<TileDef> {
    match map_id {
        "namalsk" => Some(TileDef {
            xam_name: "namalsk",
            versions:  &["May.27", "a3", "latest"],
            layer:     "topographic",
        }),
        "chernarus" => Some(TileDef {
            xam_name: "chernarusplus",
            versions:  &["1.27", "1.26", "latest"],
            layer:     "topographic",
        }),
        "livonia" => Some(TileDef {
            xam_name: "livonia",
            versions:  &["1.27", "1.26", "latest"],
            layer:     "topographic",
        }),
        "sakhal" => Some(TileDef {
            xam_name: "sakhal",
            versions:  &["1.27", "latest"],
            layer:     "topographic",
        }),
        _ => None,
    }
}

pub async fn probe_version(
    client:   &reqwest::Client,
    name:     &str,
    versions: &[&str],
    layer:    &str,
) -> Result<String, String> {
    for &ver in versions {
        let url = format!(
            "https://static.xam.nu/dayz/maps/{}/{}/{}/4/0/0.webp",
            name, ver, layer
        );
        if let Ok(resp) = client.head(&url).send().await {
            if resp.status().is_success() {
                return Ok(ver.to_string());
            }
        }
    }
    Err(format!(
        "Could not find tiles for '{}' (tried: {}). Check your internet connection.",
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
            let tile_path = fetch_tile(map_id, ZOOM, tx, ty, cache_dir, version, client, &def).await?;
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

/// Fetch a single tile (zoom ≥ 4), downloading from xam.nu if not cached.
pub async fn fetch_tile(
    map_id:    &str,
    zoom:      u32,
    x:         u32,
    y:         u32,
    cache_dir: &Path,
    version:   &str,
    client:    &reqwest::Client,
    def:       &TileDef,
) -> Result<PathBuf, String> {
    let path = cache_dir
        .join(map_id)
        .join(zoom.to_string())
        .join(x.to_string())
        .join(format!("{}.webp", y));

    if path.exists() {
        return Ok(path);
    }

    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("Cache dir: {}", e))?;

    let url = format!(
        "https://static.xam.nu/dayz/maps/{}/{}/{}/{}/{}/{}.webp",
        def.xam_name, version, def.layer, zoom, x, y
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
