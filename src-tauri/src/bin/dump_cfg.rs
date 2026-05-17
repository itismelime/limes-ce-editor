/// Dump landgrid dimensions from P_COL-ROW_*.rvmat files in a DayZ _data PBO.
/// Also prints .cfg file contents if any.
/// cargo run --bin dump_cfg -- "path/to/foo_data.pbo" [world_size_m]
use hemtt_pbo::ReadablePbo;
use std::io::Read;

fn parse_landgrid_coords(name: &str) -> Option<(u32, u32)> {
    let base = name.split(['/', '\\']).last()?;
    let upper = base.to_ascii_uppercase();
    if !upper.starts_with('P') { return None; }
    let stripped = upper.trim_start_matches('P').trim_start_matches('_');
    // format: COL-ROW_...
    let dash = stripped.find('-')?;
    let col = stripped[..dash].parse::<u32>().ok()?;
    let rest = &stripped[dash + 1..];
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    let row = rest[..end].parse::<u32>().ok()?;
    Some((col, row))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: dump_cfg <path.pbo> [world_size_m]");
        std::process::exit(1);
    }
    let world_size: Option<u32> = args.get(2).and_then(|s| s.parse().ok());

    let file = std::fs::File::open(&args[1]).expect("open pbo");
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file)).expect("parse pbo");

    let names: Vec<String> = pbo.files()
        .into_iter()
        .map(|h| h.filename().to_string())
        .collect();

    // Landgrid dimensions from P_ RVMATs
    let mut max_col: u32 = 0;
    let mut max_row: u32 = 0;
    let mut p_count = 0u32;
    for name in &names {
        if let Some((col, row)) = parse_landgrid_coords(name) {
            if col > max_col { max_col = col; }
            if row > max_row { max_row = row; }
            p_count += 1;
        }
    }

    if p_count == 0 {
        println!("No P_COL-ROW_*.rvmat files found.");
    } else {
        let landgrid_cols = max_col + 1;
        let landgrid_rows = max_row + 1;
        println!("Landgrid: {}×{} cells ({} RVMAT entries)", landgrid_cols, landgrid_rows, p_count);

        if let Some(ws) = world_size {
            let tls = ws / landgrid_cols;
            println!("World: {}m  →  texture_layer_size = {}m", ws, tls);

            // Apply wiki formula with desired_overlap=0
            let tile_dim: u32 = 512;
            let tile_cols: u32 = 32;
            let stride_m = ws / tile_cols;
            let mut lcc = stride_m / tls;
            lcc -= lcc % 4;
            let tile_meters = lcc * tls;
            let total_overlap = tile_dim.saturating_sub(tile_meters);
            let per_side = total_overlap / 2;
            println!("stride_m={stride_m}  landgrid_cells_per_stride={lcc} (after %4 alignment)");
            println!("→ tile_meters={tile_meters}px  overlap_total={total_overlap}px  overlap_per_side={per_side}px");

            // Simple formula for comparison
            let simple = tile_dim.saturating_sub(stride_m) / 2;
            println!("Simple formula: (512 - {stride_m}) / 2 = {simple}px");
            if simple == per_side {
                println!("✓ Formulas agree");
            } else {
                println!("✗ Formulas DISAGREE — use wiki formula ({per_side}px), not simple formula ({simple}px)");
            }
        }
    }

    // Print any .cfg file contents
    for name in &names {
        if name.to_ascii_lowercase().ends_with(".cfg") {
            println!("\n=== {} ===", name);
            if let Ok(Some(mut cursor)) = pbo.file(name) {
                let mut buf = String::new();
                cursor.read_to_string(&mut buf).ok();
                println!("{}", buf);
            }
        }
    }
}
