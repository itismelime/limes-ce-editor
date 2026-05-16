//! Prototype: extract satellite tiles from a DayZ terrain PBO, decode PAA → RGBA,
//! stitch into a sample PNG.
//!
//! Run (from the src-tauri directory):
//!   cargo run --bin test_pbo --features pbo-proto -- "C:/path/to/namalsk_data.pbo"
//!
//! Community mod PBOs (Namalsk, Deer Isle, Banov…) are unencrypted and work.
//! Vanilla DayZ PBOs are signed/encrypted — this will NOT work on those.
//!
//! Output: test_pbo_output.png in the current directory.

use std::io::Read;
use std::path::PathBuf;
use hemtt_pbo::ReadablePbo;
use image::{ImageBuffer, RgbaImage};

// Pixels to crop from each side of a raw tile.
// Formula: overlap = (tile_size - terrain_size_m / grid_count) / 2
// Namalsk: (512 - 12800/32) / 2 = (512 - 400) / 2 = 56
// Chernarus: (512 - 15360/32) / 2 = (512 - 480) / 2 = 16
const OVERLAP: u32 = 56;
const OVERVIEW: u32 = 4096;
const OCEAN: image::Rgba<u8> = image::Rgba([28u8, 42, 58, 255]);

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("--extract") => {
            if args.len() < 4 {
                eprintln!("Usage: test_pbo --extract <pbo_path> <tile_dir>");
                std::process::exit(1);
            }
            cmd_extract(PathBuf::from(&args[2]), PathBuf::from(&args[3]));
        }
        Some("--stitch") => {
            // --stitch <tile_dir> [--overlap N] [output.png]
            if args.len() < 3 {
                eprintln!("Usage: test_pbo --stitch <tile_dir> [--overlap N] [output.png]");
                std::process::exit(1);
            }
            let tile_dir = PathBuf::from(&args[2]);
            let mut overlap = OVERLAP;
            let mut out = PathBuf::from("test_pbo_output.png");
            let mut i = 3usize;
            while i < args.len() {
                if args[i] == "--overlap" {
                    i += 1;
                    overlap = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(OVERLAP);
                } else {
                    out = PathBuf::from(&args[i]);
                }
                i += 1;
            }
            cmd_stitch(tile_dir, overlap, out);
        }
        Some("--list") => {
            if args.len() < 3 {
                eprintln!("Usage: test_pbo --list <pbo_path> [pattern]");
                std::process::exit(1);
            }
            cmd_list(PathBuf::from(&args[2]), args.get(3).cloned());
        }
        _ => {
            if args.len() < 2 {
                eprintln!("Usage:");
                eprintln!("  test_pbo <pbo> [output.png]              extract + stitch");
                eprintln!("  test_pbo --extract <pbo> <tile_dir>      decode PAA → PNG (run once)");
                eprintln!("  test_pbo --stitch <tile_dir> [output.png] stitch cached PNGs");
                std::process::exit(1);
            }
            let out = args.get(2).map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("test_pbo_output.png"));
            cmd_extract_and_stitch(PathBuf::from(&args[1]), out);
        }
    }
}

fn cmd_list(pbo_path: PathBuf, pattern: Option<String>) {
    let file = std::fs::File::open(&pbo_path)
        .unwrap_or_else(|e| { eprintln!("Open failed: {}", e); std::process::exit(1) });
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file))
        .unwrap_or_else(|e| { eprintln!("PBO parse failed: {:?}", e); std::process::exit(1) });
    for h in pbo.files() {
        let name = h.filename().to_string();
        println!("{}", name);
        if let Some(ref pat) = pattern {
            if name.to_ascii_lowercase().contains(pat.as_str()) {
                let bytes = read_pbo_file(&mut pbo, &name);
                if name.to_ascii_lowercase().ends_with(".wrp") {
                    println!("  WRP {} bytes", bytes.len());
                    for chunk in bytes[..bytes.len().min(64)].chunks(16) {
                        let hex: Vec<String> = chunk.iter().map(|b| format!("{:02X}", b)).collect();
                        let asc: String = chunk.iter().map(|&b| if b.is_ascii_graphic() { b as char } else { '.' }).collect();
                        println!("    {}  {}", hex.join(" "), asc);
                    }
                }
            }
        }
    }
}

/// Decode all _lco.paa tiles from a PBO and save as PNG files.
fn cmd_extract(pbo_path: PathBuf, tile_dir: PathBuf) {
    std::fs::create_dir_all(&tile_dir).unwrap_or_else(|e| {
        eprintln!("Cannot create tile dir: {}", e); std::process::exit(1);
    });

    println!("Opening PBO: {}", pbo_path.display());
    let file = std::fs::File::open(&pbo_path)
        .unwrap_or_else(|e| { eprintln!("Open failed: {}", e); std::process::exit(1) });
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file))
        .unwrap_or_else(|e| { eprintln!("PBO parse failed: {:?}", e); std::process::exit(1) });

    let lco_files: Vec<String> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .map(|h| h.filename().to_string())
        .collect();
    println!("Found {} _lco.paa tiles", lco_files.len());

    let mut ok = 0u32;
    let mut fail = 0u32;
    for (i, path) in lco_files.iter().enumerate() {
        let base = path.split(['/', '\\']).last().unwrap_or(path);
        let png_name = base.to_ascii_uppercase().replace(".PAA", ".png").replace(".paa", ".png");
        let out_path = tile_dir.join(&png_name);

        let data = read_pbo_file(&mut pbo, path);
        match decode_paa(&data) {
            Ok(img) => {
                img.save(&out_path).unwrap_or_else(|e| eprintln!("Save {} failed: {}", png_name, e));
                ok += 1;
            }
            Err(e) => {
                eprintln!("FAIL {} — {}", base, e);
                fail += 1;
            }
        }
        print!("\r  {}/{} ({} ok, {} fail)   ", i + 1, lco_files.len(), ok, fail);
        let _ = std::io::Write::flush(&mut std::io::stdout());
    }
    println!("\nExtracted {}/{} tiles to {}", ok, lco_files.len(), tile_dir.display());
}

/// Stitch pre-extracted PNG tiles into a single overview image.
fn cmd_stitch(tile_dir: PathBuf, overlap: u32, output_path: PathBuf) {
    let entries = std::fs::read_dir(&tile_dir)
        .unwrap_or_else(|e| { eprintln!("Cannot read tile dir: {}", e); std::process::exit(1) });

    // Collect all S_COL_ROW_lco.png files and parse coordinates
    let mut tiles: Vec<(u32, u32, PathBuf)> = Vec::new(); // (col, row, path)
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if let Some((col, row)) = parse_tile_coords(&name) {
            if name.to_ascii_lowercase().ends_with(".png") {
                tiles.push((col, row, path));
            }
        }
    }
    if tiles.is_empty() {
        eprintln!("No S_COL_ROW_lco.png tiles found in {}", tile_dir.display());
        std::process::exit(1);
    }

    let grid_cols = tiles.iter().map(|(c, _, _)| c).max().copied().unwrap_or(0) + 1;
    let grid_rows = tiles.iter().map(|(_, r, _)| r).max().copied().unwrap_or(0) + 1;
    println!("Grid: {}×{} ({} tiles found)", grid_cols, grid_rows, tiles.len());

    // Detect tile_dim from first large tile
    let tile_dim = tiles.iter()
        .find_map(|(_, _, p)| {
            image::open(p).ok().map(|i| i.width()).filter(|&w| w >= 32)
        })
        .unwrap_or(512);

    println!("Overlap: {}px each side ({} total)", overlap, overlap * 2);
    stitch_tiles_iter(
        tiles.into_iter().map(|(col, row, path)| {
            let img = image::open(&path)
                .map(|i| i.into_rgba8())
                .unwrap_or_else(|_| ImageBuffer::from_pixel(tile_dim, tile_dim, OCEAN));
            (col, row, img)
        }),
        grid_cols, grid_rows, tile_dim, overlap, output_path,
    );
}

/// Extract from PBO and immediately stitch — no on-disk cache.
fn cmd_extract_and_stitch(pbo_path: PathBuf, output_path: PathBuf) {
    println!("Opening PBO: {}", pbo_path.display());
    let file = std::fs::File::open(&pbo_path)
        .unwrap_or_else(|e| { eprintln!("Open failed: {}", e); std::process::exit(1) });
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file))
        .unwrap_or_else(|e| { eprintln!("PBO parse failed: {:?}", e); std::process::exit(1) });

    let lco_files: Vec<String> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .map(|h| h.filename().to_string())
        .collect();
    println!("Found {} _lco.paa satellite tile files", lco_files.len());
    if lco_files.is_empty() {
        eprintln!("No satellite tiles found.");
        std::process::exit(1);
    }

    let mut max_col = 0u32;
    let mut max_row = 0u32;
    for name in &lco_files {
        if let Some((c, r)) = parse_tile_coords(name) {
            max_col = max_col.max(c);
            max_row = max_row.max(r);
        }
    }
    let grid_cols = max_col + 1;
    let grid_rows = max_row + 1;
    println!("Grid: {}×{} ({} total)", grid_cols, grid_rows, grid_cols * grid_rows);

    // Detect tile_dim from a land tile
    let sample = lco_files.iter()
        .find(|n| parse_tile_coords(n).is_some()).cloned().unwrap();
    let sample_data = read_pbo_file(&mut pbo, &sample);
    let tile_dim = paa_base_dim(&sample_data).unwrap_or(512);
    println!("Tile size: {}px", tile_dim);

    let total = grid_cols * grid_rows;
    let mut decoded: Vec<(u32, u32, RgbaImage)> = Vec::with_capacity(total as usize);
    let mut fail = 0u32;

    for x_arma in 0..grid_cols {
        for y_arma in 0..grid_rows {
            let filename = format!("S_{:03}_{:03}_lco.paa", x_arma, y_arma);
            let found = lco_files.iter().find(|f| {
                f.to_ascii_lowercase().ends_with(&filename.to_ascii_lowercase())
            });
            match found {
                None => { fail += 1; }
                Some(path) => {
                    let data = read_pbo_file(&mut pbo, path);
                    match decode_paa(&data) {
                        Ok(img) => decoded.push((x_arma, y_arma, img)),
                        Err(e) => {
                            eprintln!("ERR [{:02},{:02}] {}", x_arma, y_arma, e);
                            fail += 1;
                        }
                    }
                }
            }
            let done = x_arma * grid_rows + y_arma + 1;
            print!("\r  {}/{} ({} ok, {} fail)   ", done, total, decoded.len(), fail);
            let _ = std::io::Write::flush(&mut std::io::stdout());
        }
    }
    println!("\nDecoded {}/{}", decoded.len(), total);

    stitch_tiles_iter(decoded.into_iter(), grid_cols, grid_rows, tile_dim, OVERLAP, output_path);
}

/// Core stitch: crop overlap from each tile, place at stride, downsample to OVERVIEW.
fn stitch_tiles_iter<I>(tiles: I, grid_cols: u32, grid_rows: u32, tile_dim: u32, overlap: u32, output_path: PathBuf)
where
    I: Iterator<Item = (u32, u32, RgbaImage)>,
{
    let effective = tile_dim.saturating_sub(overlap * 2);
    let canvas_w = effective * grid_cols;
    let canvas_h = effective * grid_rows;
    println!("Canvas: {}×{} ({}px tiles, {}px overlap each side, {}px stride)",
        canvas_w, canvas_h, tile_dim, OVERLAP, effective);
    println!("Allocating {} MB…", canvas_w as u64 * canvas_h as u64 * 4 / 1_048_576);

    let mut canvas: RgbaImage = ImageBuffer::from_pixel(canvas_w, canvas_h, OCEAN);

    for (col, row, tile_img) in tiles {
        // Skip tiny ocean tiles (4×4px) — ocean background already filled.
        if tile_img.width() < 32 { continue; }
        // Crop overlap border from all 4 sides.
        let cropped = image::imageops::crop_imm(&tile_img, overlap, overlap, effective, effective)
            .to_image();
        let sx = (col * effective) as i64;
        let sy = (row * effective) as i64;
        image::imageops::replace(&mut canvas, &cropped, sx, sy);
    }

    println!("Downsampling {}×{} → {}×{}…", canvas_w, canvas_h, OVERVIEW, OVERVIEW);
    let overview = image::imageops::resize(&canvas, OVERVIEW, OVERVIEW, image::imageops::FilterType::Lanczos3);
    drop(canvas);

    overview.save(&output_path).unwrap_or_else(|e| eprintln!("Save failed: {}", e));
    println!("Saved: {}", output_path.display());
}

// ── PBO helper ───────────────────────────────────────────────────────────────

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
/// ArmA naming: S_{COL}_{ROW} — first number is column (X/east), second is row (Y/south).
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

// ── PAA format constants ─────────────────────────────────────────────────────

/// TAGG block magic: bytes 0x47 0x47 0x41 0x54 = "GGAT" = reversed "TAGG"
const GGAT: [u8; 4] = [0x47, 0x47, 0x41, 0x54];
/// Offset-table block type: "SFFO" = reversed "OFFS"
const SFFO: [u8; 4] = [0x53, 0x46, 0x46, 0x4F];

/// Parse TAGG blocks and return the SFFO offset table (absolute file offsets per mip).
fn parse_sffo(data: &[u8]) -> Result<Vec<u32>, String> {
    if data.len() < 2 { return Err("too short".into()); }
    let mut pos = 2usize; // skip 2-byte type magic

    loop {
        if pos + 4 > data.len() { break; }
        if data[pos..pos+4] != GGAT {
            break; // not a TAGG block → we've reached mip data
        }
        pos += 4; // consumed GGAT
        if pos + 4 > data.len() { return Err("truncated TAGG type".into()); }
        let type_id = &data[pos..pos+4];
        pos += 4;
        if pos + 4 > data.len() { return Err("truncated TAGG size".into()); }
        let sz = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 4;

        if type_id == SFFO {
            // SFFO block: array of u32 LE absolute offsets
            let mut offsets = Vec::new();
            let n = sz / 4;
            for i in 0..n {
                let start = pos + i * 4;
                if start + 4 > data.len() { break; }
                let v = u32::from_le_bytes(data[start..start+4].try_into().unwrap());
                offsets.push(v);
            }
            return Ok(offsets);
        }

        pos += sz; // skip other block data
    }

    Err("No SFFO (OFFS) block found in PAA".into())
}

/// Determine the base (largest mip) dimension from the per-mip header at SFFO[0].
/// Header bytes 0-1 are u16 LE (actual_width | 0x8000); mask off the flag bit.
fn paa_base_dim(data: &[u8]) -> Result<u32, String> {
    let offsets = parse_sffo(data)?;
    let non_zero: Vec<u32> = offsets.into_iter().filter(|&o| o != 0).collect();
    if non_zero.is_empty() { return Err("SFFO table is empty".into()); }
    let start = non_zero[0] as usize;
    if start + 2 > data.len() { return Err("mip header truncated".into()); }
    let raw_w = u16::from_le_bytes([data[start], data[start + 1]]);
    let w = (raw_w & 0x7FFF) as u32;
    if w == 0 { return Err("zero width in mip header".into()); }
    Ok(w)
}

/// Decode a PAA file to an RGBA image (largest mip only).
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
    if non_zero.is_empty() {
        return Err("SFFO has no offsets".into());
    }

    // Mip header: u16 raw_w + u16 h + u24 LE csize = 7 bytes.
    // Bit 15 of raw_w = LZO-compressed flag. Clear = raw (uncompressed) DXT data.
    let mip0_start = non_zero[0] as usize;
    if mip0_start + 7 > data.len() {
        return Err("mip0 header truncated".into());
    }
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

    // Expected uncompressed DXT size
    let expected = if is_dxt1 { (base_dim * base_dim) / 2 } else { base_dim * base_dim };
    let dxt_data = if lzo_compressed {
        let mut v = lzo1x_decompress(&data[data_start..data_end], expected)
            .map_err(|e| format!("LZO decompress: {}", e))?;
        if v.len() < expected { v.resize(expected, 0); }
        v
    } else {
        // Uncompressed: raw DXT bytes follow the 7-byte header directly
        let mut v = data[data_start..data_end].to_vec();
        if v.len() < expected { v.resize(expected, 0); }
        v
    };

    // DXT → BGRA u32
    let pixel_count = base_dim * base_dim;
    let mut rgba_u32 = vec![0u32; pixel_count];
    if is_dxt1 {
        texture2ddecoder::decode_bc1(&dxt_data, base_dim, base_dim, &mut rgba_u32)
            .map_err(|e| format!("BC1 decode: {}", e))?;
    } else {
        texture2ddecoder::decode_bc3(&dxt_data, base_dim, base_dim, &mut rgba_u32)
            .map_err(|e| format!("BC3 decode: {}", e))?;
    }

    // BGRA u32 → RGBA bytes. texture2ddecoder packs B=bits0-7, G=bits8-15, R=bits16-23, A=bits24-31.
    // BGRA u32 → RGBA bytes. DXT1-transparent pixels (alpha=0) → ocean blue.
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

// ── LZO1x-1 decompressor with dictionary prefix ───────────────────────────
//
// DayZ PAA files are LZO1x-1 compressed against a 4 kB zeroed dictionary.
// The standard lzokay crate starts outp=0, so M1-long matches (distance ≥ 2049)
// that reference dictionary data cause LookbehindOverrun. We fix this by
// pre-allocating a zeroed DICT_SIZE prefix and starting outp at DICT_SIZE,
// allowing all back-references to land in valid (zeroed) memory.
//
// Algorithm translated from lzokay-2.0.1/src/decompress.rs with outp offset.

const DICT_SIZE: usize = 0xC000; // 48 kB — covers all M4 max distances (≤ 49151)

fn lzo1x_decompress(src: &[u8], expected_out: usize) -> Result<Vec<u8>, String> {
    if src.len() < 3 { return Err("input too short".into()); }

    let total = DICT_SIZE + expected_out;
    let mut dst = vec![0u8; total];
    let mut inp = 0usize;
    let mut outp = DICT_SIZE; // start after zeroed dictionary
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
            let cur: usize = $cur; // may be in the dict prefix (reads zeros there)
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
            // M2: copy 2-8 bytes within 2kB
            let next = rb!();
            let dist = (next << 3) + ((inst >> 2) & 7) + 1;
            lbcur = outp.saturating_sub(dist);
            lblen = (inst >> 5) + 1;
            nstate = inst & 3;
        } else if inst & 0x20 != 0 {
            // M3: copy 2+ bytes within 16kB
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
            // M4: copy 2+ bytes within 48kB; distance=0 → end
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
                // Literal run
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
                // M1 short (state 1..3): distance 1..1024, 2 bytes
                let tail = rb!();
                let dist = (inst >> 2) + (tail << 2) + 1;
                lbcur = outp.saturating_sub(dist);
                lblen = 2;
                nstate = inst & 3;
            } else {
                // M1 long (state=4, after literal run): distance 2049..3081, 3 bytes
                let tail = rb!();
                let dist = (inst >> 2) + (tail << 2) + 2049;
                lbcur = outp.saturating_sub(dist);
                lblen = 3;
                nstate = inst & 3;
            }
        }

        copy_lb!(lbcur, lblen);

        // Trailing literals (nstate bytes)
        copy_lit!(nstate);
        state = nstate;

        inst = rb!();
    }

    let mut result = dst[DICT_SIZE..outp].to_vec();
    if result.len() < expected_out {
        result.resize(expected_out, 0);
    }
    Ok(result)
}
