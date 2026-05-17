/// Diagnostic: print _lco.paa coordinate range from a PBO.
/// cargo run --bin dump_coords -- "path/to/foo_data.pbo"
use hemtt_pbo::ReadablePbo;

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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: dump_coords <path.pbo>");
        std::process::exit(1);
    }
    let file = std::fs::File::open(&args[1]).expect("open pbo");
    let pbo = ReadablePbo::from(std::io::BufReader::new(file)).expect("parse pbo");

    let mut coords: Vec<(u32, u32)> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .filter_map(|h| parse_tile_coords(h.filename()))
        .collect();

    println!("Total _lco.paa tiles: {}", coords.len());
    if coords.is_empty() { return; }

    let max_col = coords.iter().map(|(c,_)| *c).max().unwrap();
    let max_row = coords.iter().map(|(_,r)| *r).max().unwrap();
    let min_col = coords.iter().map(|(c,_)| *c).min().unwrap();
    let min_row = coords.iter().map(|(_,r)| *r).min().unwrap();

    println!("col range: {}..={}", min_col, max_col);
    println!("row range: {}..={}", min_row, max_row);
    println!("grid dims: {} cols x {} rows", max_col+1, max_row+1);

    // Sample first 5 and last 5 filenames
    coords.sort();
    println!("\nFirst 5 coords: {:?}", &coords[..5.min(coords.len())]);
    println!("Last  5 coords: {:?}", &coords[coords.len().saturating_sub(5)..]);

    // Show unique directory prefixes
    let all_names: Vec<String> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .map(|h| h.filename().to_string())
        .collect();

    let mut prefixes: std::collections::HashSet<String> = Default::default();
    for name in &all_names {
        let parts: Vec<&str> = name.split(['/', '\\']).collect();
        if parts.len() > 1 {
            prefixes.insert(parts[..parts.len()-1].join("/"));
        } else {
            prefixes.insert("(root)".to_string());
        }
    }
    println!("\nUnique directories ({}):", prefixes.len());
    let mut sorted: Vec<_> = prefixes.into_iter().collect();
    sorted.sort();
    for p in &sorted { println!("  {}", p); }
    println!("\nSample filenames:");
    for name in all_names.iter().take(4) { println!("  {}", name); }
}
