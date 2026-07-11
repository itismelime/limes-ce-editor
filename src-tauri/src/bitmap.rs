use std::path::Path;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct BitmapData {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct LayerMeta {
    pub path: String,
    pub usage_flags: u32,
    pub value_flags: u8,
}

#[tauri::command]
pub async fn read_tga_layer(path: String) -> Result<BitmapData, String> {
    let img = image::open(&path)
        .map_err(|e| format!("Failed to open {path}: {e}"))?
        .into_rgba8();
    Ok(BitmapData {
        width: img.width(),
        height: img.height(),
        pixels: img.into_raw(),
    })
}

#[tauri::command]
pub async fn write_tga_layer(
    path: String,
    pixels: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let img = image::RgbaImage::from_raw(width, height, pixels)
        .ok_or_else(|| "Invalid pixel data".to_string())?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    img.save_with_format(&path, image::ImageFormat::Tga)
        .map_err(|e| format!("Failed to write {path}: {e}"))
}

// No real DayZ terrain grid is anywhere near this size (largest maps top out
// around a few thousand cells per side); this just bounds the worst case of
// an unchecked width/height driving a multi-GB allocation.
const MAX_GRID_DIM: u32 = 16384;

#[tauri::command]
pub async fn compile_areaflags(
    layers: Vec<LayerMeta>,
    width: u32,
    height: u32,
    world_width: u32,
    world_height: u32,
    out_path: String,
) -> Result<(), String> {
    if width > MAX_GRID_DIM || height > MAX_GRID_DIM {
        return Err(format!("grid {}x{} exceeds sane maximum", width, height));
    }
    let cell_count = (width as usize) * (height as usize);

    // 5 bytes per cell: u32 usage_flags + u8 value_flags
    let mut data = vec![0u8; cell_count * 5];

    for layer in &layers {
        if layer.usage_flags == 0 && layer.value_flags == 0 {
            continue;
        }
        let img = match image::open(&layer.path) {
            Ok(i) => i.into_rgba8(),
            Err(_) => continue, // missing layer = skip
        };
        let layer_w = img.width() as usize;
        let layer_h = img.height() as usize;
        let raw = img.into_raw();

        let target_w = width as usize;
        let target_h = height as usize;

        for y in 0..target_h {
            for x in 0..target_w {
                // sample from layer (may differ in size)
                let sx = x * layer_w / target_w;
                let sy = y * layer_h / target_h;
                let px_idx = (sy * layer_w + sx) * 4;
                let active = *raw.get(px_idx).unwrap_or(&0) > 127;
                if active {
                    let cell = (y * target_w + x) * 5;
                    let flags = u32::from_le_bytes(data[cell..cell + 4].try_into().unwrap());
                    let new_flags = flags | layer.usage_flags;
                    data[cell..cell + 4].copy_from_slice(&new_flags.to_le_bytes());
                    data[cell + 4] |= layer.value_flags;
                }
            }
        }
    }

    // backup existing areaflags.map before first write
    let bak_path = format!("{out_path}.bak");
    if Path::new(&out_path).exists() && !Path::new(&bak_path).exists() {
        std::fs::copy(&out_path, &bak_path)
            .map_err(|e| format!("Failed to create backup: {e}"))?;
    }

    if let Some(parent) = Path::new(&out_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut header = [0u8; 24];
    header[0..4].copy_from_slice(&width.to_le_bytes());
    header[4..8].copy_from_slice(&height.to_le_bytes());
    header[8..12].copy_from_slice(&world_width.to_le_bytes());
    header[12..16].copy_from_slice(&world_height.to_le_bytes());
    header[16..20].copy_from_slice(&32u32.to_le_bytes());
    // bytes 20-23 = 0 (padding)

    let mut out = Vec::with_capacity(24 + data.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&data);

    std::fs::write(&out_path, &out)
        .map_err(|e| format!("Failed to write areaflags.map: {e}"))
}
