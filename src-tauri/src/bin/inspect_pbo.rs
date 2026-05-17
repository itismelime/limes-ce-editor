/// Quick diagnostic: reads the first _lco.paa from a PBO and prints its header bytes.
/// Usage: cargo run --bin inspect_pbo -- "path/to/foo_data.pbo"

use std::io::Read;
use hemtt_pbo::ReadablePbo;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: inspect_pbo <path.pbo>");
        std::process::exit(1);
    }
    let path = &args[1];
    let file = std::fs::File::open(path).expect("open pbo");
    let mut pbo = ReadablePbo::from(std::io::BufReader::new(file)).expect("parse pbo");

    let lco_files: Vec<String> = pbo.files()
        .into_iter()
        .filter(|h| h.filename().to_ascii_lowercase().contains("_lco.paa"))
        .map(|h| h.filename().to_string())
        .collect();

    println!("Found {} _lco.paa files", lco_files.len());
    if lco_files.is_empty() { return; }

    let name = &lco_files[0];
    println!("Inspecting: {}", name);

    let data: Vec<u8> = match pbo.file(name) {
        Ok(Some(mut f)) => { let mut buf = Vec::new(); f.read_to_end(&mut buf).ok(); buf }
        _ => { eprintln!("Could not read file"); return; }
    };

    println!("File size: {} bytes", data.len());
    if data.len() < 16 {
        println!("Too short to inspect");
        return;
    }

    print!("First 16 bytes (hex):");
    for b in &data[..16] { print!(" {:02X}", b); }
    println!();

    let magic = u16::from_le_bytes([data[0], data[1]]);
    println!("Magic: 0x{:04X}", magic);
    match magic {
        0xFF01 => println!("Format: DXT1 (should work)"),
        0xFF05 => println!("Format: DXT5 (should work)"),
        0x4444 => println!("Format: RGBA4444 (not supported yet)"),
        0x8080 => println!("Format: 8-bit grey (not supported)"),
        0x8888 => println!("Format: RGBA8888 (not supported yet)"),
        0x1555 => println!("Format: ARGB1555 (not supported)"),
        _      => println!("Format: UNKNOWN/ENCRYPTED"),
    }

    // Trace TAGG block structure
    let ggat: [u8; 4] = [0x47, 0x47, 0x41, 0x54];
    let sffo: [u8; 4] = [0x53, 0x46, 0x46, 0x4F];
    let mut pos = 2usize;
    println!("\nTAGG blocks:");
    loop {
        if pos + 8 > data.len() { println!("  [end of data at pos {}]", pos); break; }
        if data[pos..pos+4] != ggat { println!("  [no GGAT at pos {}: {:02X} {:02X} {:02X} {:02X}]", pos, data[pos], data[pos+1], data[pos+2], data[pos+3]); break; }
        let type_id = &data[pos+4..pos+8];
        let sz = u32::from_le_bytes(data[pos+8..pos+12].try_into().unwrap_or([0;4])) as usize;
        println!("  pos={} type={} size={}", pos, std::str::from_utf8(type_id).unwrap_or("????"), sz);
        if type_id == sffo {
            println!("  -> SFFO found! offsets:");
            let n = sz / 4;
            let mut mip0_off = 0usize;
            for i in 0..n.min(10) {
                let start = pos + 12 + i * 4;
                if start + 4 > data.len() { break; }
                let off = u32::from_le_bytes(data[start..start+4].try_into().unwrap());
                if off != 0 {
                    println!("    mip[{}] offset={}", i, off);
                    if mip0_off == 0 { mip0_off = off as usize; }
                }
            }
            if mip0_off + 16 <= data.len() {
                println!("\nMip0 header at offset {}:", mip0_off);
                print!("  bytes:");
                for b in &data[mip0_off..mip0_off+16] { print!(" {:02X}", b); }
                println!();
                let raw_w = u16::from_le_bytes([data[mip0_off], data[mip0_off+1]]);
                let raw_h = u16::from_le_bytes([data[mip0_off+2], data[mip0_off+3]]);
                let lzo = raw_w & 0x8000 != 0;
                let w = raw_w & 0x7FFF;
                let h = raw_h;
                let csize = (data[mip0_off+4] as usize) | ((data[mip0_off+5] as usize) << 8) | ((data[mip0_off+6] as usize) << 16);
                println!("  raw_w=0x{:04X} → lzo={} w={}", raw_w, lzo, w);
                println!("  raw_h=0x{:04X} → h={}", raw_h, h);
                println!("  compressed_size={} (u24 LE)", csize);
                println!("  data_start={}", mip0_off + 7);
                println!("  data_end={}", mip0_off + 7 + csize);
            }
            break;
        }
        pos += 12 + sz;
    }
}
