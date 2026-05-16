/// Extract a satellite map overview PNG from a DayZ community mod PBO file.
///
/// Reads all `S_COL_ROW_lco.paa` satellite tiles, decodes PAA→RGBA,
/// stitches at native resolution with overlap-crop, downsamples to 4096×4096.
///
/// Only works on unencrypted community mod PBOs (Namalsk, Deer Isle, Banov, etc.).
/// Vanilla DayZ PBOs are signed/encrypted and will fail.
use std::io::Read;
use hemtt_pbo::ReadablePbo;
use image::{ImageBuffer, RgbaImage};

const OVERVIEW: u32 = 4096;
const OCEAN: image::Rgba<u8> = image::Rgba([28u8, 42, 58, 255]);

/// Generate a 4096×4096 satellite overview PNG from a community mod PBO.
///
/// `world_size_m` — terrain side length in metres (e.g. 12800 for Namalsk).
/// Used to compute the correct tile overlap.
pub fn generate_overview(
    pbo_path: &std::path::Path,
    output_path: &std::path::Path,
    world_size_m: u32,
    on_progress: impl Fn(f32),
    on_status: impl Fn(String),
) -> Result<(), String> {
    on_status("Opening PBO…".into());

    let file = std::fs::File::open(pbo_path)
        .map_err(|e| format!("Cannot open PBO: {}", e))?;
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file))
        .map_err(|e| format!("PBO parse failed: {:?}", e))?;

    // Collect all _lco.paa satellite tile filenames
    let lco_files: Vec<String> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .map(|h| h.filename().to_string())
        .collect();

    if lco_files.is_empty() {
        return Err("No satellite tiles (_lco.paa) found — not a *_data.pbo or PBO is encrypted".into());
    }

    on_status(format!("Found {} tiles, scanning grid…", lco_files.len()));

    // Determine grid dimensions from filenames
    let mut max_col = 0u32;
    let mut max_row = 0u32;
    for name in &lco_files {
        if let Some((col, row)) = parse_tile_coords(name) {
            max_col = max_col.max(col);
            max_row = max_row.max(row);
        }
    }
    let grid_cols = max_col + 1;
    let grid_rows = max_row + 1;

    // Detect tile pixel size from first large tile
    let sample = lco_files.iter().find(|n| parse_tile_coords(n).is_some()).cloned()
        .ok_or("No parseable tile filenames")?;
    let sample_data = read_pbo_file(&mut pbo, &sample);
    let tile_dim = paa_base_dim(&sample_data).unwrap_or(512);

    // Compute overlap: overlap = (tile_size - world_size / grid_cols) / 2
    // e.g. Namalsk: (512 - 12800/32) / 2 = (512 - 400) / 2 = 56 px
    let stride = world_size_m / grid_cols;
    let overlap = tile_dim.saturating_sub(stride) / 2;
    let effective = tile_dim.saturating_sub(overlap * 2);
    let canvas_w = effective * grid_cols;
    let canvas_h = effective * grid_rows;

    on_status(format!(
        "Grid {}×{}, tile {}px, overlap {}px, canvas {}×{}px…",
        grid_cols, grid_rows, tile_dim, overlap, canvas_w, canvas_h
    ));

    let mut canvas: RgbaImage = ImageBuffer::from_pixel(canvas_w, canvas_h, OCEAN);

    let total = grid_cols * grid_rows;
    let mut done = 0u32;

    for x_arma in 0..grid_cols {
        for y_arma in 0..grid_rows {
            let filename = format!("S_{:03}_{:03}_lco.paa", x_arma, y_arma);
            let found = lco_files.iter().find(|f| {
                f.to_ascii_lowercase().ends_with(&filename.to_ascii_lowercase())
            });
            if let Some(path) = found {
                let data = read_pbo_file(&mut pbo, path);
                if let Ok(tile_img) = decode_paa(&data) {
                    if tile_img.width() >= 32 {
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
            }
            done += 1;
            if done % 16 == 0 || done == total {
                on_progress(done as f32 / total as f32 * 0.9); // 0–90%
            }
        }
    }

    on_status(format!("Downsampling {}×{} → {}×{}…", canvas_w, canvas_h, OVERVIEW, OVERVIEW));
    let overview = image::imageops::resize(&canvas, OVERVIEW, OVERVIEW, image::imageops::FilterType::Lanczos3);
    drop(canvas);

    on_progress(0.98);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir: {}", e))?;
    }
    overview.save(output_path).map_err(|e| format!("PNG save: {}", e))?;
    on_progress(1.0);

    Ok(())
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
    Some((col, row))
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
            let n = sz / 4;
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

fn paa_base_dim(data: &[u8]) -> Result<u32, String> {
    let offsets = parse_sffo(data)?;
    let non_zero: Vec<u32> = offsets.into_iter().filter(|&o| o != 0).collect();
    if non_zero.is_empty() { return Err("SFFO empty".into()); }
    let start = non_zero[0] as usize;
    if start + 2 > data.len() { return Err("mip header truncated".into()); }
    let raw_w = u16::from_le_bytes([data[start], data[start + 1]]);
    let w = (raw_w & 0x7FFF) as u32;
    if w == 0 { return Err("zero width".into()); }
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

    // BGRA u32 → RGBA. DXT1-transparent pixels (alpha=0) → ocean blue.
    let rgba_bytes: Vec<u8> = rgba_u32.iter().flat_map(|&p| {
        let a = ((p >> 24) & 0xFF) as u8;
        if a == 0 {
            [28u8, 42u8, 58u8, 255u8]
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
    let mut lblen: usize = 0;
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
