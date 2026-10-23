use std::io::Read;
use std::collections::HashMap;
use std::sync::Arc;
use hemtt_pbo::ReadablePbo;
use image::{ImageBuffer, RgbaImage};
use rayon::prelude::*;
use crate::tiles::{MAX_ZOOM, TILE_SIZE};

/// Generate a tile pyramid from a DayZ *_data.pbo.
///
/// Output: `maps_dir/{map_id}/tiles/{z}/{x}/{y}.webp` for z=0..=MAX_ZOOM.
/// `world_size_m` is the terrain side length in metres (e.g. 12800, 15360).
pub fn generate_tile_pyramid(
    pbo_path: &std::path::Path,
    maps_dir: &std::path::Path,
    map_id: &str,
    world_size_m: u32,
    on_progress: impl Fn(f32),
    on_status: impl Fn(String),
    on_level_done: impl Fn(u32),
) -> Result<(), String> {
    on_status("Opening PBO…".into());

    let file = std::fs::File::open(pbo_path)
        .map_err(|e| format!("Cannot open PBO: {}", e))?;
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file))
        .map_err(|e| format!("PBO parse failed: {:?}", e))?;

    // Collect all _lco.paa filenames first so we can give specific errors.
    let lco_files: Vec<String> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .map(|h| h.filename().to_string())
        .collect();

    if lco_files.is_empty() {
        return Err(
            "No satellite tiles (_lco.paa) found in this PBO. \
             Make sure you selected a map data PBO (e.g. namalsk_data.pbo).".into()
        );
    }

    // Build (col, row) → filename map — prefer files in "layers\" over overlay
    // directories (e.g. "usermap\") that newer PBOs include alongside satellite tiles.
    let tile_map: HashMap<(u32, u32), String> = {
        let mut map: HashMap<(u32, u32), String> = HashMap::new();
        for name in lco_files {
            if let Some(coords) = parse_tile_coords(&name) {
                let is_layers = name.to_ascii_lowercase().starts_with("layers");
                use std::collections::hash_map::Entry;
                match map.entry(coords) {
                    Entry::Vacant(e) => { e.insert(name); }
                    Entry::Occupied(mut e) => {
                        let existing_is_layers = e.get().to_ascii_lowercase().starts_with("layers");
                        if is_layers && !existing_is_layers {
                            *e.get_mut() = name;
                        }
                    }
                }
            }
        }
        map
    };

    if tile_map.is_empty() {
        return Err(
            "_lco.paa files were found but none had parseable tile coordinates \
             (expected S_COL_ROW_lco.paa naming). The PBO format may be unsupported.".into()
        );
    }

    let max_col = tile_map.keys().map(|(c, _)| *c).max().unwrap_or(0);
    let max_row = tile_map.keys().map(|(_, r)| *r).max().unwrap_or(0);
    let grid_cols = max_col + 1;
    let grid_rows = max_row + 1;

    let sample_name = tile_map.values().next()
        .ok_or("tile_map unexpectedly empty")?
        .clone();
    let sample_data = read_pbo_file(&mut pbo, &sample_name);
    let tile_dim = paa_base_dim(&sample_data).unwrap_or(512);

    // Detect overlap by pixel-comparing two horizontally adjacent tiles.
    // Falls back to the formula-based value if detection fails or no adjacent pair exists.
    let formula_overlap = tile_dim.saturating_sub(world_size_m / grid_cols) / 2;
    let overlap = match detect_tile_overlap(&mut pbo, &tile_map, tile_dim) {
        Some(detected) => {
            on_status(format!("Detected overlap: {}px (formula: {}px)", detected, formula_overlap));
            detected
        }
        None => {
            on_status(format!("Overlap detection failed, using formula: {}px", formula_overlap));
            formula_overlap
        }
    };

    let effective = tile_dim.saturating_sub(overlap * 2);
    let canvas_w = effective * grid_cols;
    let canvas_h = effective * grid_rows;

    on_status(format!("Painting {} tiles…", tile_map.len()));

    // Sequential read — PBO is a single seekable file, can't read in parallel.
    let raw_tiles: Vec<((u32, u32), Vec<u8>)> = tile_map.iter()
        .map(|(coords, path)| (*coords, read_pbo_file(&mut pbo, path)))
        .collect();

    // Parallel PAA decode across all CPU cores.
    let decoded_tiles: Vec<((u32, u32), Result<RgbaImage, String>)> = raw_tiles
        .into_par_iter()
        .map(|(coords, data)| (coords, decode_paa(&data)))
        .collect();

    // Transparent canvas — no ocean pre-fill, water areas show map background.
    let mut canvas: RgbaImage = ImageBuffer::new(canvas_w, canvas_h);

    let total = decoded_tiles.len() as u32;
    let mut done = 0u32;
    let mut decoded = 0u32;
    let mut first_err: Option<String> = None;

    for ((x_arma, y_arma), result) in decoded_tiles {
        if first_err.is_none() {
            if let Err(ref e) = result { first_err = Some(e.clone()); }
        }
        if let Ok(tile_img) = result {
            if tile_img.width() >= 32 {
                decoded += 1;
                let cropped = image::imageops::crop_imm(
                    &tile_img, overlap, overlap, effective, effective,
                ).to_image();
                image::imageops::replace(
                    &mut canvas, &cropped,
                    (x_arma * effective) as i64,
                    (y_arma * effective) as i64,
                );
            }
        }
        done += 1;
        if done % 16 == 0 || done == total {
            on_progress(done as f32 / total as f32 * 0.7);
        }
    }

    if decoded == 0 {
        let reason = first_err.unwrap_or_else(|| "unknown".into());
        return Err(format!(
            "Found {} tile file(s) but none could be decoded (first error: {}). \
             The PBO may be corrupted or use an unsupported PAA format.",
            total, reason
        ));
    }

    // Chop canvas into zoom pyramid. Generate highest zoom first so rayon maximally
    // parallelises the many small tiles, giving visible bar movement. z=0 comes last
    // and uses Nearest filter (1 tile, 256px output — Triangle over a 15k×15k source
    // is needlessly slow for no visible quality gain at that resolution).
    let canvas = Arc::new(canvas);
    let levels = MAX_ZOOM + 1;

    for z in 0..=MAX_ZOOM {
        let grid = 1u32 << z;
        let tile_canvas_px = canvas_w / grid;
        if tile_canvas_px == 0 { on_level_done(z); continue; }

        on_status(format!("Generating zoom {}…", z));

        let filter = if z == 0 {
            image::imageops::FilterType::Nearest
        } else {
            image::imageops::FilterType::Triangle
        };
        let canvas_ref = Arc::clone(&canvas);
        let tile_results: Vec<Result<(), String>> = (0..grid * grid)
            .into_par_iter()
            .map(|i| {
                let tx = i % grid;
                let ty = i / grid;
                let x_px = tx * tile_canvas_px;
                let y_px = ty * tile_canvas_px;

                let cropped = image::imageops::crop_imm(
                    &*canvas_ref, x_px, y_px, tile_canvas_px, tile_canvas_px,
                ).to_image();
                let resized = image::imageops::resize(&cropped, TILE_SIZE, TILE_SIZE, filter);
                let out = crate::tiles::tile_path(maps_dir, map_id, z, tx, ty);
                let parent = out.parent()
                    .ok_or_else(|| format!("tile path has no parent: {}", out.display()))?;
                std::fs::create_dir_all(parent).map_err(|e| format!("Create dir: {}", e))?;
                resized.save_with_format(&out, image::ImageFormat::WebP)
                    .map_err(|e| format!("WebP save z={} ({},{}): {}", z, tx, ty, e))
            })
            .collect();

        for r in tile_results { r?; }
        on_progress(0.7 + (z + 1) as f32 / levels as f32 * 0.3);
        on_level_done(z);
    }
    Ok(())
}

// ── Public helpers ───────────────────────────────────────────────────────────

/// Derive world size in metres from a *_data.pbo without being told it.
///
/// Uses the identity: world_size = (tile_dim - 2 * overlap) * grid_cols,
/// which holds because DayZ satellite tiles are 1 px = 1 m.
/// Returns an error if the PBO has no satellite tiles or overlap detection fails.
pub fn world_size_from_pbo(pbo_path: &std::path::Path) -> Result<u32, String> {
    let file = std::fs::File::open(pbo_path)
        .map_err(|e| format!("Cannot open PBO: {}", e))?;
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file))
        .map_err(|e| format!("PBO parse failed: {:?}", e))?;

    let tile_map: HashMap<(u32, u32), String> = {
        let mut map: HashMap<(u32, u32), String> = HashMap::new();
        for h in pbo.files() {
            let name = h.filename().to_string();
            if !name.to_ascii_lowercase().contains("_lco.paa") { continue; }
            if let Some(coords) = parse_tile_coords(&name) {
                let is_layers = name.to_ascii_lowercase().starts_with("layers");
                use std::collections::hash_map::Entry;
                match map.entry(coords) {
                    Entry::Vacant(e) => { e.insert(name); }
                    Entry::Occupied(mut e) => {
                        if is_layers && !e.get().to_ascii_lowercase().starts_with("layers") {
                            *e.get_mut() = name;
                        }
                    }
                }
            }
        }
        map
    };

    if tile_map.is_empty() {
        return Err("No satellite tiles found in PBO".into());
    }

    let grid_cols = tile_map.keys().map(|(c, _)| *c).max().unwrap_or(0) + 1;

    let sample_data = read_pbo_file(&mut pbo, tile_map.values().next().unwrap());
    let tile_dim = paa_base_dim(&sample_data).unwrap_or(512);

    let overlap = detect_tile_overlap(&mut pbo, &tile_map, tile_dim)
        .ok_or_else(|| "Could not detect tile overlap — map may have uniform terrain (e.g. snow). Enter world size manually.".to_string())?;

    Ok((tile_dim - overlap * 2) * grid_cols)
}

/// Recursively search `dir` (up to `depth` levels) for any `*_data.pbo` file.
/// `patterns` empty = any `*_data.pbo`; otherwise the lowercase name must contain one.
pub fn find_data_pbo(dir: &std::path::Path, patterns: &[&str], depth: usize) -> Option<std::path::PathBuf> {
    if depth == 0 { return None; }
    let Ok(entries) = std::fs::read_dir(dir) else { return None };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_ascii_lowercase();
                if lower.ends_with("_data.pbo") && (patterns.is_empty() || patterns.iter().any(|p| lower.contains(p))) {
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

// ── Overlap detection ─────────────────────────────────────────────────────────

/// Detect satellite tile overlap by pixel-comparing two horizontally adjacent tiles.
///
/// Strategy: for each candidate overlap N, compare a fixed-width probe strip (4px wide)
/// placed at the midpoint of the hypothetical overlap region. Fixed width keeps comparison
/// fair across all candidates regardless of N. The correct N gives near-zero diff; wrong
/// values give noise-level diff.
///
/// Also computes a baseline using a non-adjacent pair to reject unreliable detections
/// (e.g. uniform snow tiles where everything scores near-zero).
///
/// Returns None if detection is unreliable (best score not clearly below baseline).
fn detect_tile_overlap(
    pbo: &mut ReadablePbo<std::io::BufReader<std::fs::File>>,
    tile_map: &HashMap<(u32, u32), String>,
    tile_dim: u32,
) -> Option<u32> {
    // Find any (col, row) where (col, row) and (col+1, row) both exist.
    let (&(col, row), _) = tile_map.iter()
        .find(|((c, r), _)| tile_map.contains_key(&(c + 1, *r)))?;
    let name_a = tile_map.get(&(col, row))?.clone();
    let name_b = tile_map.get(&(col + 1, row))?.clone();

    let img_a = decode_paa(&read_pbo_file(pbo, &name_a)).ok()?;
    let img_b = decode_paa(&read_pbo_file(pbo, &name_b)).ok()?;
    if img_a.width() != tile_dim || img_b.width() != tile_dim { return None; }

    // Sample rows spread across the middle of the tile.
    let sample_rows: Vec<u32> = (tile_dim / 8..tile_dim * 7 / 8).step_by(20).collect();
    if sample_rows.is_empty() { return None; }

    // Compare a fixed 4-px probe strip placed at the midpoint of the overlap region.
    // This keeps comparison cost constant across all candidate values.
    const PROBE_W: u32 = 4;
    let score_at = |cand: u32| -> u64 {
        if cand < PROBE_W { return u64::MAX; }
        // Place probe at quarter-point of overlap, clamped so it fits inside.
        let probe_start = (cand / 4).min(cand.saturating_sub(PROBE_W));
        let mut s: u64 = 0;
        for &r in &sample_rows {
            for dp in 0..PROBE_W {
                let col_a = tile_dim - cand + probe_start + dp;
                let col_b = probe_start + dp;
                let pa = img_a.get_pixel(col_a, r);
                let pb = img_b.get_pixel(col_b, r);
                s += (pa[0] as i32 - pb[0] as i32).unsigned_abs() as u64
                   + (pa[1] as i32 - pb[1] as i32).unsigned_abs() as u64
                   + (pa[2] as i32 - pb[2] as i32).unsigned_abs() as u64;
            }
        }
        s
    };

    // Baseline: compare the same probe strip but shifted by half a tile (clearly wrong offset).
    // If best score is not < 30% of baseline, the content is too uniform to trust.
    let baseline = score_at(tile_dim / 4);

    let max_overlap = (tile_dim / 2).min(128);
    let mut best_overlap = 0u32;
    let mut best_score = u64::MAX;

    for cand in (4..=max_overlap).step_by(4) {
        let s = score_at(cand);
        if s < best_score {
            best_score = s;
            best_overlap = cand;
        }
    }

    // No candidates were scored (e.g. tile_dim too small → max_overlap < 4).
    if best_overlap == 0 { return None; }

    // Reject if detection is unreliable (uniform content) or no clear winner.
    if baseline == 0 || best_score.saturating_mul(10) >= baseline.saturating_mul(3) {
        return None;
    }

    Some(best_overlap / 2)
}

// ── PBO helper ────────────────────────────────────────────────────────────────

fn read_pbo_file(
    pbo: &mut ReadablePbo<std::io::BufReader<std::fs::File>>,
    name: &str,
) -> Vec<u8> {
    match pbo.file(name) {
        Ok(Some(mut f)) => {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).ok();
            buf
        }
        _ => Vec::new(),
    }
}

/// Parse "layers\S_003_007_lco.paa" → (col=3, row=7).
/// ArmA naming: S_{COL}_{ROW} — first number is column (X/east), second is row.
fn parse_tile_coords(name: &str) -> Option<(u32, u32)> {
    let base = name.split(['/', '\\']).last()?;
    let upper = base.to_ascii_uppercase();
    if !upper.starts_with('S') { return None; }
    let stripped = upper.trim_start_matches('S').trim_start_matches('_');
    let parts: Vec<&str> = stripped.split('_').collect();
    if parts.len() < 2 { return None; }
    let col = parts[0].parse::<u32>().ok()?;
    let row = parts[1].parse::<u32>().ok()?;
    // Real grids are a few dozen tiles per side; bounding this keeps a malformed
    // PBO from overflowing grid math or driving a huge canvas allocation.
    (col < 256 && row < 256).then_some((col, row))
}

// ── PAA format ────────────────────────────────────────────────────────────────

const GGAT: [u8; 4] = [0x47, 0x47, 0x41, 0x54];
const SFFO: [u8; 4] = [0x53, 0x46, 0x46, 0x4F];

fn parse_sffo(data: &[u8]) -> Result<Vec<u32>, String> {
    if data.len() < 2 { return Err("too short".into()); }
    let mut pos = 2usize;
    loop {
        if pos + 4 > data.len() { break; }
        if data[pos..pos+4] != GGAT { break; }
        pos += 4;
        if pos + 4 > data.len() { return Err("truncated TAGG type".into()); }
        let type_id = &data[pos..pos+4];
        pos += 4;
        if pos + 4 > data.len() { return Err("truncated TAGG size".into()); }
        let sz = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 4;
        if type_id == SFFO {
            // `sz` is a declared length from the file, not a fact — a corrupt or
            // malicious PAA could claim ~u32::MAX and blow up Vec::with_capacity
            // before we ever read a byte. Clamp to what the remaining buffer could
            // actually hold (4 bytes per offset) instead of trusting the field.
            let max_n = (data.len().saturating_sub(pos)) / 4;
            let n = (sz / 4).min(max_n);
            let mut offsets = Vec::with_capacity(n);
            for i in 0..n {
                let start = pos + i * 4;
                if start + 4 > data.len() { break; }
                offsets.push(u32::from_le_bytes(data[start..start+4].try_into().unwrap()));
            }
            return Ok(offsets);
        }
        pos += sz;
    }
    Err("No SFFO block found".into())
}

// PAA mip0 width is stored in 15 bits (max 32767), but no real DayZ/Arma
// satellite texture is anywhere near that large — the largest in-game tiles
// are ~4096px. Cap well above real usage but far below the field's raw max
// so a corrupt/malicious width can't drive a multi-GB pixel-buffer allocation.
const MAX_PAA_DIM: u32 = 8192;

fn paa_base_dim(data: &[u8]) -> Result<u32, String> {
    let offsets = parse_sffo(data)?;
    let non_zero: Vec<u32> = offsets.into_iter().filter(|&o| o != 0).collect();
    if non_zero.is_empty() { return Err("SFFO empty".into()); }
    let start = non_zero[0] as usize;
    if start + 2 > data.len() { return Err("mip header truncated".into()); }
    let raw_w = u16::from_le_bytes([data[start], data[start + 1]]);
    let w = (raw_w & 0x7FFF) as u32;
    if w == 0 { return Err("zero width".into()); }
    if w > MAX_PAA_DIM { return Err(format!("width {} exceeds sane maximum", w)); }
    Ok(w)
}

fn decode_paa(data: &[u8]) -> Result<RgbaImage, String> {
    if data.len() < 10 { return Err(format!("too short ({} bytes)", data.len())); }
    let magic = u16::from_le_bytes([data[0], data[1]]);
    let is_dxt1 = magic == 0xFF01;
    let is_dxt5 = magic == 0xFF05;
    if !is_dxt1 && !is_dxt5 {
        return Err(format!("unsupported PAA type 0x{:04X}", magic));
    }
    let offsets = parse_sffo(data)?;
    let non_zero: Vec<u32> = offsets.into_iter().filter(|&o| o != 0).collect();
    if non_zero.is_empty() { return Err("SFFO has no offsets".into()); }

    let mip0_start = non_zero[0] as usize;
    if mip0_start + 7 > data.len() { return Err("mip0 header truncated".into()); }
    let raw_w = u16::from_le_bytes([data[mip0_start], data[mip0_start + 1]]);
    let lzo_compressed = raw_w & 0x8000 != 0;
    let base_dim = (raw_w & 0x7FFF) as usize;
    if base_dim == 0 { return Err("zero width in mip header".into()); }
    if base_dim as u32 > MAX_PAA_DIM { return Err(format!("width {} exceeds sane maximum", base_dim)); }

    let csize = (data[mip0_start + 4] as usize)
        | ((data[mip0_start + 5] as usize) << 8)
        | ((data[mip0_start + 6] as usize) << 16);
    let data_start = mip0_start + 7;
    let data_end   = data_start + csize;
    if data_end > data.len() {
        return Err(format!("mip0 data {}..{} exceeds file {}", data_start, data_end, data.len()));
    }

    let expected = if is_dxt1 { (base_dim * base_dim) / 2 } else { base_dim * base_dim };
    let dxt_data = if lzo_compressed {
        let mut v = lzo1x_decompress(&data[data_start..data_end], expected)
            .map_err(|e| format!("LZO: {}", e))?;
        if v.len() < expected { v.resize(expected, 0); }
        v
    } else {
        let mut v = data[data_start..data_end].to_vec();
        if v.len() < expected { v.resize(expected, 0); }
        v
    };

    let pixel_count = base_dim * base_dim;
    let mut rgba_u32 = vec![0u32; pixel_count];
    if is_dxt1 {
        texture2ddecoder::decode_bc1(&dxt_data, base_dim, base_dim, &mut rgba_u32)
            .map_err(|e| format!("BC1 decode: {}", e))?;
    } else {
        texture2ddecoder::decode_bc3(&dxt_data, base_dim, base_dim, &mut rgba_u32)
            .map_err(|e| format!("BC3 decode: {}", e))?;
    }

    // BGRA u32 → RGBA. DXT1-transparent pixels (alpha=0) stay transparent.
    let rgba_bytes: Vec<u8> = rgba_u32.iter().flat_map(|&p| {
        let a = ((p >> 24) & 0xFF) as u8;
        if a == 0 {
            [0u8, 0u8, 0u8, 0u8]
        } else {
            let r = ((p >> 16) & 0xFF) as u8;
            let g = ((p >>  8) & 0xFF) as u8;
            let b =  (p        & 0xFF) as u8;
            [r, g, b, 255u8]
        }
    }).collect();

    image::RgbaImage::from_raw(base_dim as u32, base_dim as u32, rgba_bytes)
        .ok_or_else(|| "RgbaImage::from_raw failed".into())
}

// ── LZO1x-1 decompressor with zeroed dictionary prefix ───────────────────────

const DICT_SIZE: usize = 0xC000;

fn lzo1x_decompress(src: &[u8], expected_out: usize) -> Result<Vec<u8>, String> {
    if src.len() < 3 { return Err("input too short".into()); }
    let total = DICT_SIZE + expected_out;
    let mut dst = vec![0u8; total];
    let mut inp = 0usize;
    let mut outp = DICT_SIZE;
    let mut state = 0usize;
    let mut nstate: usize;
    let mut lblen: usize;
    let mut lbcur: usize;

    macro_rules! rb {
        () => {{
            if inp >= src.len() { return Err("input overrun".into()); }
            let b = src[inp]; inp += 1; b as usize
        }};
    }
    macro_rules! copy_lit {
        ($n:expr) => {{
            let n = $n;
            if inp + n > src.len() || outp + n > total { return Err("literal overrun".into()); }
            dst[outp..outp+n].copy_from_slice(&src[inp..inp+n]);
            inp += n; outp += n;
        }};
    }
    macro_rules! copy_lb {
        ($cur:expr, $len:expr) => {{
            let cur: usize = $cur;
            let len: usize = $len;
            if outp + len > total { return Err("output overrun".into()); }
            for i in 0..len {
                dst[outp + i] = *dst.get(cur + i).unwrap_or(&0);
            }
            outp += len;
        }};
    }

    let mut inst = rb!();
    if inst >= 22 {
        copy_lit!(inst - 17);
        state = 4;
        inst = rb!();
    } else if inst >= 18 {
        nstate = inst - 17;
        copy_lit!(nstate);
        state = nstate;
        inst = rb!();
    }

    'outer: loop {
        if inst & 0xC0 != 0 {
            let next = rb!();
            let dist = (next << 3) + ((inst >> 2) & 7) + 1;
            lbcur = outp.saturating_sub(dist);
            lblen = (inst >> 5) + 1;
            nstate = inst & 3;
        } else if inst & 0x20 != 0 {
            lblen = (inst & 0x1F) + 2;
            if lblen == 2 {
                let mut extra = 0usize;
                while src.get(inp).copied() == Some(0) { extra += 255; inp += 1; }
                lblen += extra + 31 + rb!();
            }
            let raw = rb!() | (rb!() << 8);
            let dist = (raw >> 2) + 1;
            lbcur = outp.saturating_sub(dist);
            nstate = raw & 3;
        } else if inst & 0x10 != 0 {
            lblen = (inst & 7) + 2;
            if lblen == 2 {
                let mut extra = 0usize;
                while src.get(inp).copied() == Some(0) { extra += 255; inp += 1; }
                lblen += extra + 7 + rb!();
            }
            let raw = rb!() | (rb!() << 8);
            let base_dist = ((inst & 8) << 11) + (raw >> 2);
            if base_dist == 0 { break 'outer; }
            let dist = base_dist + 16384;
            lbcur = outp.saturating_sub(dist);
            nstate = raw & 3;
        } else {
            if state == 0 {
                let mut len = inst + 3;
                if len == 3 {
                    let mut extra = 0usize;
                    while src.get(inp).copied() == Some(0) { extra += 255; inp += 1; }
                    len += extra + 15 + rb!();
                }
                copy_lit!(len);
                state = 4;
                inst = rb!();
                continue 'outer;
            } else if state != 4 {
                let tail = rb!();
                let dist = (inst >> 2) + (tail << 2) + 1;
                lbcur = outp.saturating_sub(dist);
                lblen = 2;
                nstate = inst & 3;
            } else {
                let tail = rb!();
                let dist = (inst >> 2) + (tail << 2) + 2049;
                lbcur = outp.saturating_sub(dist);
                lblen = 3;
                nstate = inst & 3;
            }
        }

        copy_lb!(lbcur, lblen);
        copy_lit!(nstate);
        state = nstate;
        inst = rb!();
    }

    let mut result = dst[DICT_SIZE..outp].to_vec();
    if result.len() < expected_out { result.resize(expected_out, 0); }
    Ok(result)
}

#[cfg(test)]
mod paa_bounds_tests {
    use super::*;

    // A malicious/corrupt PAA can declare an SFFO block size near u32::MAX.
    // Before the fix this drove Vec::with_capacity(~1 billion) straight from
    // a tiny input. n must now be clamped to what the buffer could actually
    // hold, so parsing a small crafted file stays cheap and just returns the
    // offsets that actually fit.
    #[test]
    fn parse_sffo_clamps_declared_size_to_buffer_len() {
        let mut buf = vec![0u8; 2]; // 2-byte PAA type field, skipped by parse_sffo
        buf.extend_from_slice(b"GGAT");
        buf.extend_from_slice(b"SFFO");
        buf.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // declared size: absurd
        buf.extend_from_slice(&100u32.to_le_bytes()); // only 2 offsets actually fit
        buf.extend_from_slice(&200u32.to_le_bytes());

        let offsets = parse_sffo(&buf).expect("should parse without attempting a huge allocation");
        assert_eq!(offsets, vec![100, 200]);
    }

    // mip0 width is a 15-bit field (max 32767) but no real DayZ/Arma texture
    // is anywhere near that large. decode_paa must reject an oversized width
    // before computing pixel_count = base_dim * base_dim (up to ~4.3GB).
    #[test]
    fn decode_paa_rejects_oversized_width() {
        let mut buf = vec![0u8; 30];
        buf[0] = 0x01; buf[1] = 0xFF; // PAA magic: DXT1
        buf[2..6].copy_from_slice(b"GGAT");
        buf[6..10].copy_from_slice(b"SFFO");
        buf[10..14].copy_from_slice(&4u32.to_le_bytes()); // one offset
        buf[14..18].copy_from_slice(&18u32.to_le_bytes()); // -> mip0 header at byte 18
        buf[18..20].copy_from_slice(&0x7FFFu16.to_le_bytes()); // width 32767 > MAX_PAA_DIM

        let err = decode_paa(&buf).expect_err("oversized width must be rejected, not allocated");
        assert!(err.contains("exceeds sane maximum"), "unexpected error: {err}");
    }
}
