//! Build-time tool: extracts satellite tile overviews for bundled built-in maps
//! from local DayZ PBO files.
//!
//! Usage (point at DayZ install, auto-discovers PBOs):
//!   cargo run --manifest-path src-tauri/Cargo.toml --bin prepare_maps -- --dayz-path "C:\Steam\steamapps\common\DayZ"
//!
//! Usage (explicit PBO paths):
//!   cargo run --manifest-path src-tauri/Cargo.toml --bin prepare_maps -- \
//!     --chernarus "C:\...\chernarusplus_data.pbo" \
//!     --livonia   "C:\...\enoch_data.pbo"         \
//!     --sakhal    "C:\...\sakhal_data.pbo"
//!
//! Output: src-tauri/resources/maps/{map_id}/tiles/{z}/{x}/{y}.webp

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use limes_ce_editor_lib::pbo;

struct BuiltinMap {
    id:         &'static str,
    patterns:   &'static [&'static str],
    world_size: u32,
}

const BUILTIN_MAPS: &[BuiltinMap] = &[
    BuiltinMap { id: "chernarus", patterns: &["chernarusplus", "chernarus"], world_size: 15360 },
    BuiltinMap { id: "livonia",   patterns: &["enoch", "livonia"],           world_size: 12800 },
    BuiltinMap { id: "sakhal",    patterns: &["sakhal"],                     world_size: 12800 },
];

/// Recursively search `dir` (up to `depth` levels) for a file whose lowercase
/// name ends in `_data.pbo` and contains at least one of `patterns`.
fn find_data_pbo(dir: &Path, patterns: &[&str], depth: usize) -> Option<PathBuf> {
    if depth == 0 { return None; }
    let Ok(entries) = std::fs::read_dir(dir) else { return None };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if lower.ends_with("_data.pbo") && patterns.iter().any(|p| lower.contains(p)) {
                    return Some(path);
                }
            }
        } else if path.is_dir() {
            if let Some(found) = find_data_pbo(&path, patterns, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let out_dir = PathBuf::from(&manifest_dir).join("resources").join("maps");

    let mut dayz_path: Option<PathBuf> = None;
    let mut explicit: std::collections::HashMap<String, PathBuf> = Default::default();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--dayz-path" => {
                i += 1;
                if i < args.len() { dayz_path = Some(PathBuf::from(&args[i])); }
            }
            s @ ("--chernarus" | "--livonia" | "--sakhal") => {
                let key = s.trim_start_matches('-').to_string();
                i += 1;
                if i < args.len() { explicit.insert(key, PathBuf::from(&args[i])); }
            }
            _ => {}
        }
        i += 1;
    }

    if dayz_path.is_none() && explicit.is_empty() {
        eprintln!("Usage:");
        eprintln!("  --dayz-path <DayZ install dir>   auto-discover PBOs");
        eprintln!("  --chernarus / --livonia / --sakhal <path>   explicit PBO paths");
        std::process::exit(1);
    }

    println!("Output dir: {}", out_dir.display());

    // Resolve PBO paths up front (sequential, no I/O contention).
    let resolved: Vec<(&BuiltinMap, PathBuf)> = BUILTIN_MAPS.iter().filter_map(|map| {
        if let Some(p) = explicit.get(map.id) {
            return Some((map, p.clone()));
        }
        if let Some(ref dayz) = dayz_path {
            println!("[{}] Searching in {}…", map.id, dayz.display());
            match find_data_pbo(dayz, map.patterns, 6) {
                Some(p) => { println!("[{}] Found: {}", map.id, p.display()); return Some((map, p)); }
                None => { eprintln!("[{}] PBO not found. Pass --{} <path> explicitly.", map.id, map.id); }
            }
        } else {
            eprintln!("[{}] No path provided. Pass --{} <path>.", map.id, map.id);
        }
        None
    }).collect();

    // stdout Mutex so parallel maps don't interleave mid-line.
    let stdout = Mutex::new(std::io::stdout());
    let any_ok = Mutex::new(false);

    std::thread::scope(|s| {
        for (map, pbo_path) in &resolved {
            let out_dir = &out_dir;
            let stdout = &stdout;
            let any_ok = &any_ok;
            s.spawn(move || {
                {
                    let mut out = stdout.lock().unwrap();
                    use std::io::Write;
                    let _ = writeln!(out, "\n[{}] ──────────────────────────────", map.id);
                }

                let tile_z0 = limes_ce_editor_lib::tiles::tile_path(out_dir, map.id, 0, 0, 0);
                if tile_z0.exists() {
                    let mut out = stdout.lock().unwrap();
                    use std::io::Write;
                    let _ = writeln!(out, "[{}] Tile pyramid already exists — delete tiles/ to re-extract.", map.id);
                    *any_ok.lock().unwrap() = true;
                    return;
                }

                {
                    let mut out = stdout.lock().unwrap();
                    use std::io::Write;
                    let _ = writeln!(out, "[{}] Extracting (world {}m)…", map.id, map.world_size);
                }

                let result = pbo::generate_tile_pyramid(
                    pbo_path,
                    out_dir,
                    map.id,
                    map.world_size,
                    |frac| {
                        let mut out = stdout.lock().unwrap();
                        use std::io::Write;
                        let _ = write!(out, "\r[{}] {:.0}%    ", map.id, frac * 100.0);
                        let _ = out.flush();
                    },
                    |status| {
                        let mut out = stdout.lock().unwrap();
                        use std::io::Write;
                        let _ = writeln!(out, "\r[{}] {}                    ", map.id, status);
                    },
                    |level| {
                        let mut out = stdout.lock().unwrap();
                        use std::io::Write;
                        let _ = writeln!(out, "\r[{}] Zoom {} done                    ", map.id, level);
                    },
                );

                let mut out = stdout.lock().unwrap();
                use std::io::Write;
                match result {
                    Ok(()) => {
                        let _ = writeln!(out, "\r[{}] Done → {}/tiles/                    ", map.id, out_dir.join(map.id).display());
                        *any_ok.lock().unwrap() = true;
                    }
                    Err(e) => { let _ = writeln!(out, "\r[{}] Failed: {}                    ", map.id, e); }
                }
            });
        }
    });

    let any_ok = any_ok.into_inner().unwrap();
    println!();
    if any_ok {
        println!("Ready. Run `npm run tauri:build` to embed overviews in the installer.");
    } else {
        eprintln!("No maps extracted. Check PBO paths and try again.");
        std::process::exit(1);
    }
}
