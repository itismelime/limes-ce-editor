use std::path::{Path, PathBuf};

/// Native PBO grid is 32×32 = 2^5, so max Leaflet zoom is 5.
pub const MAX_ZOOM: u32 = 5;
pub const TILE_SIZE: u32 = 256;

/// `{maps_dir}/{map_id}/tiles/{z}/{x}/{y}.webp`
pub fn tile_path(maps_dir: &Path, map_id: &str, z: u32, x: u32, y: u32) -> PathBuf {
    maps_dir
        .join(map_id)
        .join("tiles")
        .join(z.to_string())
        .join(x.to_string())
        .join(format!("{}.webp", y))
}

/// Returns true if the full tile pyramid exists for this map.
/// Checks the last tile at MAX_ZOOM — if that exists, the full pyramid was written.
/// Checking only z=0 would pass for partial/interrupted extractions.
pub fn tiles_ready(maps_dir: &Path, map_id: &str) -> bool {
    let last = (1u32 << MAX_ZOOM) - 1;
    tile_path(maps_dir, map_id, MAX_ZOOM, last, last).exists()
}
