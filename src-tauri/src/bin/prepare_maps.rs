//! Standalone build tool: downloads all DayZ map tiles (zoom 4 through each map's
//! maximum zoom) and stitches the zoom-4 overview PNGs so they can be bundled inside
//! the Tauri installer for fully offline operation.
//!
//! Run once before each release build:
//!   cargo run --manifest-path src-tauri/Cargo.toml --bin prepare_maps
//!
//! Output:
//!   src-tauri/resources/maps/{map_id}_tiles.png        — stitched overview (~5-15 MB each)
//!   src-tauri/resources/maps/{map_id}/{z}/{x}/{y}.webp — all detail tiles
//!
//! These files are git-ignored; they are embedded in the installer via tauri.conf.json "resources".

use std::path::PathBuf;
use limes_ce_editor_lib::tiles;

const KNOWN_MAPS: &[&str] = &["namalsk", "chernarus", "livonia", "sakhal"];

#[tokio::main]
async fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .unwrap_or_else(|_| ".".to_string());

    let out_dir = PathBuf::from(&manifest_dir).join("resources").join("maps");

    if !out_dir.exists() {
        std::fs::create_dir_all(&out_dir).expect("Could not create resources/maps directory");
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("Could not build HTTP client");

    println!("Writing map tiles to: {}", out_dir.display());
    println!();

    let mut grand_total_tiles = 0u64;
    let mut grand_downloaded  = 0u64;
    let mut grand_cached      = 0u64;
    let mut grand_failed      = 0u64;

    for &map_id in KNOWN_MAPS {
        let def = tiles::tile_def(map_id).expect("Unknown map id");
        let max_zoom = def.max_zoom;

        // ── Step 1: probe which tile version is live ────────────────────────
        println!("[{}] Probing tile version…", map_id);
        let version = tiles::probe_version(&client, def.xam_name, def.versions, def.layer, |v| {
            println!("[{}] Trying version '{}'…", map_id, v);
        })
            .await
            .unwrap_or_else(|e| panic!("[{}] Version probe failed: {}", map_id, e));
        println!("[{}] Version: {}", map_id, version);

        // ── Step 2: stitch the zoom-4 overview PNG (also caches zoom-4 tiles) ──
        let overview_path = out_dir.join(format!("{}_tiles.png", map_id));
        if overview_path.exists() {
            println!("[{}] Overview PNG already exists — skipping stitch", map_id);
        } else {
            println!("[{}] Stitching 16×16 overview at zoom 4…", map_id);
            tiles::download_overview(
                map_id,
                &out_dir,
                &version,
                &client,
                |frac| {
                    let pct = (frac * 100.0) as u32;
                    print!("\r[{}] Stitching {}%    ", map_id, pct);
                    let _ = std::io::Write::flush(&mut std::io::stdout());
                },
            )
            .await
            .unwrap_or_else(|e| panic!("[{}] Overview download failed: {}", map_id, e));
            println!("\r[{}] Overview PNG done                    ", map_id);
        }

        // ── Step 3: prefetch ALL zoom levels (4 through max_zoom) ────────────
        let total_tiles = tiles::total_tiles_through_zoom(max_zoom);
        println!(
            "[{}] Prefetching {} tiles (zoom 4–{})…",
            map_id, total_tiles, max_zoom
        );

        let stats = tiles::prefetch_tiles(
            map_id,
            &out_dir,
            &version,
            &client,
            max_zoom,
            |frac| {
                let pct = (frac * 100.0) as u32;
                print!("\r[{}] {}%    ", map_id, pct);
                let _ = std::io::Write::flush(&mut std::io::stdout());
            },
            || false,
        )
        .await
        .unwrap_or_else(|e| panic!("[{}] Tile prefetch failed: {}", map_id, e));

        println!(
            "\r[{}] Done — {} downloaded, {} already cached, {} failed    ",
            map_id, stats.downloaded, stats.cached, stats.failed
        );

        grand_total_tiles += stats.total;
        grand_downloaded  += stats.downloaded;
        grand_cached      += stats.cached;
        grand_failed      += stats.failed;

        println!();
    }

    println!("════════════════════════════════════════");
    println!(
        "Total tiles: {}  |  Downloaded: {}  |  Cached: {}  |  Failed: {}",
        grand_total_tiles, grand_downloaded, grand_cached, grand_failed
    );
    if grand_failed > 0 {
        eprintln!("WARNING: {} tiles failed to download. Re-run to retry.", grand_failed);
    }
    println!();
    println!("All maps ready. Run `npm run tauri:build` to embed them in the installer.");
}

