// areaflags.map format:
//   Header: 6 × uint32 LE = [gridW, gridH, worldW, worldH, unknown, layerCount]
//   Data:   (gridW * gridH / 2) bytes, nibble-packed, 2 pixels per byte
//     - Even pixel index → high nibble (>> 4); odd → low nibble (& 0xF)
//     - Nibble is a bitmask: bit 0=Tier1, bit 1=Tier2, bit 2=Tier3, bit 3=Tier4
//   Coordinate mapping:
//     col = floor(worldX / worldW * gridW)
//     row = floor((1 - worldZ / worldH) * gridH)   ← Z=worldH is north (row 0), Z=0 is south

import { IS_COMPAT_MODE } from './ceMode';
import { isTga, parseTgaRgba } from './tgaParser';

interface AreaFlagsData {
  source: 'areaflags' | 'layers';
  data: Uint8Array;
  gridW: number;
  gridH: number;
  worldW: number;
  worldH: number;
  tierNames: string[];
  usageNames?: string[];
  areaflagsFormat?: 'nibble' | 'planes';
  planeStride?: number;
  planeCount?: number;
  tierPlaneOrder?: number[];
  masks?: Record<string, Uint8Array>;
  usageMasks?: Record<string, Uint8Array>;
}

let _cfg: AreaFlagsData | null = null;

// CE Tool painted territory bitmaps (primary source)
interface CeToolBitmapEntry {
  pixels: Uint8ClampedArray;
  isTier: boolean;
  tierName: string | null;
  usageName: string | null;
}
interface CeToolBitmapData {
  entries: CeToolBitmapEntry[];
  width: number;
  height: number;
  worldSize: number;
}
let _ceToolData: CeToolBitmapData | null = null;

export function setCeToolBitmapSource(
  bitmaps: Map<string, Uint8ClampedArray>,
  layers: Array<{ name: string; isPaintable: boolean; usageName: string | null }>,
  bitmapSize: { width: number; height: number },
  worldSize: number,
): void {
  const entries: CeToolBitmapEntry[] = [];
  for (const layer of layers) {
    if (!layer.isPaintable) continue;
    const pixels = bitmaps.get(layer.name);
    if (!pixels) continue;
    const tierNumMatch = layer.name.match(/^valueFlg_Tier(\d+)/i);
    const valueMatch = !tierNumMatch && layer.name.match(/^valueFlg_(.+)/i);
    if (tierNumMatch) {
      entries.push({ pixels, isTier: true, tierName: `Tier${tierNumMatch[1]}`, usageName: null });
    } else if (valueMatch) {
      entries.push({ pixels, isTier: true, tierName: valueMatch[1], usageName: null });
    } else {
      const usageName = (layer.usageName ?? layer.name.replace(/^usgFlg_Paint-/i, '')) || null;
      entries.push({ pixels, isTier: false, tierName: null, usageName });
    }
  }
  _ceToolData = entries.length > 0 ? { entries, width: bitmapSize.width, height: bitmapSize.height, worldSize } : null;
}

export function clearCeToolBitmapSource(): void {
  _ceToolData = null;
}

function sampleCeToolPixel(x: number, z: number): { tierName: string | null; usageName: string | null } | null {
  if (!_ceToolData) return null;
  const { entries, width, height, worldSize } = _ceToolData;
  if (x < 0 || x >= worldSize || z < 0 || z >= worldSize) return null;
  const bx = Math.min(Math.floor(x / worldSize * width), width - 1);
  const by = Math.min(Math.floor((1 - z / worldSize) * height), height - 1);
  const idx = (by * width + bx) * 4;

  // Check highest-numbered tiers first
  const tierEntries = entries.filter(e => e.isTier && e.tierName);
  tierEntries.sort((a, b) => {
    const na = parseInt(a.tierName!.replace(/\D/g, ''), 10);
    const nb = parseInt(b.tierName!.replace(/\D/g, ''), 10);
    return nb - na; // highest first
  });
  for (const e of tierEntries) {
    if (e.pixels[idx] > 127) return { tierName: e.tierName, usageName: null };
  }

  for (const e of entries) {
    if (!e.isTier && e.pixels[idx] > 127) return { tierName: null, usageName: e.usageName };
  }
  return null;
}

export function loadAreaFlags(raw: Uint8Array): void {
  const view   = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const gridW  = view.getUint32(0, true);
  const gridH  = view.getUint32(4, true);
  const worldW = view.getUint32(8, true);
  const worldH = view.getUint32(12, true);
  const payload = raw.subarray(24);
  const pixelCount = gridW * gridH;
  const nibbleBytes = Math.ceil(pixelCount / 2);
  const layers = 4;
  // Compat mode preserves legacy fallback interpretation of v16/v20.
  // Official missions still use 4-bit tier masks regardless of these fields.
  const compatLayers = (() => {
    const v16 = view.getUint32(16, true);
    const v20 = view.getUint32(20, true);
    return (v20 > 0 ? v20 : (v16 > 0 ? v16 : 4));
  })();
  const tierCount = IS_COMPAT_MODE ? compatLayers : layers;

  if (payload.length === nibbleBytes) {
    _cfg = {
      source: 'areaflags',
      areaflagsFormat: 'nibble',
      data: payload,
      gridW,
      gridH,
      worldW,
      worldH,
      tierNames: Array.from({ length: tierCount }, (_, i) => `Tier${i + 1}`),
    };
    return;
  }

  if (payload.length >= pixelCount && payload.length % pixelCount === 0) {
    const planeCount = Math.floor(payload.length / pixelCount);
    const planeCounts = Array.from({ length: planeCount }, () => 0);
    for (let plane = 0; plane < planeCount; plane++) {
      const start = plane * pixelCount;
      const end = start + pixelCount;
      let count = 0;
      for (let i = start; i < end; i++) {
        if (payload[i] !== 0) count++;
      }
      planeCounts[plane] = count;
    }

    // For 5-plane files, one plane is often an aggregate/aux plane.
    // Keep the best tierCount planes by excluding the densest extras.
    const allPlanes = Array.from({ length: planeCount }, (_, i) => i);
    const sortedByDensityAsc = [...allPlanes].sort((a, b) => planeCounts[a] - planeCounts[b]);
    const keptPlanes = sortedByDensityAsc.slice(0, Math.min(tierCount, sortedByDensityAsc.length));
    // Map largest coverage -> Tier1, smallest -> highest tier (Tier4+).
    const tierPlaneOrder = keptPlanes.sort((a, b) => planeCounts[b] - planeCounts[a]);

    _cfg = {
      source: 'areaflags',
      areaflagsFormat: 'planes',
      data: payload,
      gridW,
      gridH,
      worldW,
      worldH,
      tierNames: Array.from({ length: tierPlaneOrder.length }, (_, i) => `Tier${i + 1}`),
      planeStride: pixelCount,
      planeCount,
      tierPlaneOrder,
    };
    console.info('[areaflags planes] plane nonzero counts:', planeCounts.join(', '), 'tierPlaneOrder:', tierPlaneOrder.join(','));
    return;
  }

  _cfg = {
    source: 'areaflags',
    areaflagsFormat: 'nibble',
    data: payload,
    gridW,
    gridH,
    worldW,
    worldH,
    tierNames: Array.from({ length: tierCount }, (_, i) => `Tier${i + 1}`),
  };
}

async function decodeImageMask(raw: Uint8Array): Promise<{ width: number; height: number; mask: Uint8Array }> {
  // TGA files are not supported by createImageBitmap — use the custom parser.
  if (isTga(raw)) {
    const { width, height, rgba } = parseTgaRgba(raw);
    const bpp = raw[16]; // bits per pixel from TGA header
    const mask = new Uint8Array(width * height);
    let activeCount = 0;
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      // For black & white TGA: white = high brightness (avg RGB > 128)
      const brightness = (r + g + b) / 3;
      let active: boolean;
      if (bpp === 32) {
        // RGBA: require both alpha > 64 AND brightness > 128
        active = a > 64 && brightness > 128;
      } else {
        // RGB or grayscale: brightness only
        active = brightness > 128;
      }
      if (active) { mask[p] = 1; activeCount++; }
    }
    console.debug(`[tier TGA] ${width}×${height} bpp=${bpp} activePixels=${activeCount}/${width * height}`);
    return { width, height, mask };
  }

  // PNG / BMP — decode via canvas
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const blob = new Blob([copy.buffer]);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('image decode context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const mask = new Uint8Array(bitmap.width * bitmap.height);
    let activeCount = 0;
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      // For black & white PNG: white = high brightness (avg RGB > 128)
      const brightness = (r + g + b) / 3;
      const active = a > 64 && brightness > 128;
      if (active) { mask[p] = 1; activeCount++; }
    }
    console.debug(`[tier PNG/BMP] ${bitmap.width}×${bitmap.height} activePixels=${activeCount}/${bitmap.width * bitmap.height}`);
    return { width: bitmap.width, height: bitmap.height, mask };
  } finally {
    bitmap.close();
  }
}

export async function loadTierLayers(
  layers: Partial<Record<string, Uint8Array>>,
  worldW: number,
  worldH: number,
  usageLayers: Partial<Record<string, Uint8Array[]>> = {},
): Promise<boolean> {
  const decodedTier = await Promise.all(
    Object.entries(layers).map(async ([tier, raw]) => {
      if (!raw) return null;
      const d = await decodeImageMask(raw);
      return { tier, ...d };
    })
  );

  // Decode all raw files per usage, then OR the masks together so Def + Paint combine.
  const decodedUsage: Array<{ usage: string; width: number; height: number; mask: Uint8Array }> = [];
  for (const [usage, raws] of Object.entries(usageLayers)) {
    if (!raws?.length) continue;
    const decoded = (await Promise.all(raws.map(r => decodeImageMask(r)))).filter(Boolean);
    if (decoded.length === 0) continue;
    const ref = decoded[0];
    const combined = new Uint8Array(ref.mask.length);
    for (const d of decoded) {
      if (d.width !== ref.width || d.height !== ref.height) continue;
      for (let i = 0; i < combined.length; i++) {
        if (d.mask[i]) combined[i] = 1;
      }
    }
    decodedUsage.push({ usage, width: ref.width, height: ref.height, mask: combined });
  }

  const validTier = decodedTier.filter((d): d is NonNullable<typeof d> => Boolean(d));
  if (validTier.length === 0 && decodedUsage.length === 0) return false;

  const ref = validTier[0] ?? decodedUsage[0];
  const gridW = ref.width;
  const gridH = ref.height;
  const masks: Record<string, Uint8Array> = {};
  const usageMasks: Record<string, Uint8Array> = {};

  for (const layer of validTier) {
    if (layer.width !== gridW || layer.height !== gridH) continue;
    masks[layer.tier] = layer.mask;
  }

  for (const layer of decodedUsage) {
    if (layer.width !== gridW || layer.height !== gridH) continue;
    usageMasks[layer.usage] = layer.mask;
  }

  const tierNames = Object.keys(masks)
    .filter(t => /^Tier\d+$/i.test(t))
    .sort((a, b) => Number(a.replace(/\D+/g, '')) - Number(b.replace(/\D+/g, '')));

  const usageNames = Object.keys(usageMasks);

  if (tierNames.length === 0 && usageNames.length === 0) return false;

  console.info('[tier layers] Loaded:', tierNames.map(t => `${t}:${Object.values(masks[t] ?? []).filter(v => v).length}px`).join(', '),
    `usageLayers=${usageNames.length} grid=${gridW}x${gridH} world=${worldW}x${worldH}`);

  _cfg = {
    source: 'layers',
    data: new Uint8Array(0),
    gridW,
    gridH,
    worldW,
    worldH,
    tierNames,
    usageNames,
    masks,
    usageMasks,
  };

  return true;
}

export function clearAreaFlags(): void {
  _cfg = null;
}

export function hasAreaFlags(): boolean {
  return _cfg !== null;
}

export function getLoadedTierNames(): string[] {
  return _cfg?.tierNames ?? [];
}

export function getUsageMasks(): Readonly<Record<string, Uint8Array>> | null {
  if (!_cfg?.usageMasks || Object.keys(_cfg.usageMasks).length === 0) return null;
  return _cfg.usageMasks;
}

export function getLayerGridInfo(): { gridW: number; gridH: number; worldW: number; worldH: number } | null {
  if (!_cfg) return null;
  return { gridW: _cfg.gridW, gridH: _cfg.gridH, worldW: _cfg.worldW, worldH: _cfg.worldH };
}

function sampleAreaFlags(x: number, z: number): { tier: string } | null {
  if (!_cfg || _cfg.source !== 'areaflags') return null;
  const { data, gridW, gridH, worldW, worldH, tierNames, areaflagsFormat } = _cfg;
  if (x < 0 || x >= worldW || z < 0 || z >= worldH) return null;
  const col    = Math.min(Math.floor(x / worldW * gridW), gridW - 1);
  const row    = Math.min(Math.floor((1 - z / worldH) * gridH), gridH - 1);
  const pixIdx = row * gridW + col;

  if (areaflagsFormat === 'planes') {
    const planeStride = _cfg.planeStride ?? (gridW * gridH);
    const tierPlaneOrder = _cfg.tierPlaneOrder ?? tierNames.map((_, i) => i);
    const tierCount = Math.min(tierNames.length, tierPlaneOrder.length);
    for (let tierIdx = tierCount - 1; tierIdx >= 0; tierIdx--) {
      const plane = tierPlaneOrder[tierIdx];
      if (data[plane * planeStride + pixIdx] !== 0) {
        return { tier: tierNames[tierIdx] };
      }
    }
    return null;
  }

  const byte   = data[Math.floor(pixIdx / 2)];
  const nibble = (pixIdx % 2 === 0) ? (byte >> 4) : (byte & 0xF);
  for (let bit = tierNames.length - 1; bit >= 0; bit--) {
    if (nibble & (1 << bit)) return { tier: tierNames[bit] };
  }
  return null;
}

function sampleLayerTier(x: number, z: number): string | null {
  if (!_cfg || _cfg.source !== 'layers' || !_cfg.masks) return null;
  const { masks, gridW, gridH, worldW, worldH, tierNames } = _cfg;
  if (x < 0 || x >= worldW || z < 0 || z >= worldH) return null;
  const col = Math.min(Math.floor(x / worldW * gridW), gridW - 1);
  const row = Math.min(Math.floor((1 - z / worldH) * gridH), gridH - 1);
  const idx = row * gridW + col;
  for (let i = tierNames.length - 1; i >= 0; i--) {
    const tier = tierNames[i];
    if (masks[tier]?.[idx]) return tier;
  }
  // Return null (not 'unknown') so sampleTierAtPos can fall back to areaflags
  return null;
}

function sampleLayerUsage(x: number, z: number): string | null {
  if (!_cfg || _cfg.source !== 'layers' || !_cfg.usageMasks || !_cfg.usageNames) return null;
  const { usageMasks, usageNames, gridW, gridH, worldW, worldH } = _cfg;
  if (x < 0 || x >= worldW || z < 0 || z >= worldH) return null;
  const col = Math.min(Math.floor(x / worldW * gridW), gridW - 1);
  const row = Math.min(Math.floor((1 - z / worldH) * gridH), gridH - 1);
  const idx = row * gridW + col;
  for (let i = 0; i < usageNames.length; i++) {
    const usage = usageNames[i];
    if (usageMasks[usage]?.[idx]) return usage;
  }
  return null;
}

export function sampleUsageAtPos(x: number, z: number): string | null {
  const ceToolHit = sampleCeToolPixel(x, z);
  if (ceToolHit?.usageName) return ceToolHit.usageName;
  return sampleLayerUsage(x, z);
}

export function sampleTierAtPos(x: number, z: number): string {
  const ceToolHit = sampleCeToolPixel(x, z);
  if (ceToolHit?.tierName) return ceToolHit.tierName;
  const layerTier = sampleLayerTier(x, z);
  if (layerTier !== null) return layerTier;
  const areaFlagsTier = sampleAreaFlags(x, z);
  if (areaFlagsTier) return areaFlagsTier.tier;
  return 'unknown';
}

export function sampleAllZonesAtPos(x: number, z: number): { tiers: string[]; usages: string[] } {
  const tiers: string[] = [];
  const usages: string[] = [];

  if (_ceToolData) {
    const { entries, width, height, worldSize } = _ceToolData;
    if (x >= 0 && x < worldSize && z >= 0 && z < worldSize) {
      const bx = Math.min(Math.floor(x / worldSize * width), width - 1);
      const by = Math.min(Math.floor((1 - z / worldSize) * height), height - 1);
      const idx = (by * width + bx) * 4;
      for (const e of entries) {
        if (e.pixels[idx] > 127) {
          if (e.isTier && e.tierName && !tiers.includes(e.tierName)) tiers.push(e.tierName);
          if (!e.isTier && e.usageName && !usages.includes(e.usageName)) usages.push(e.usageName);
        }
      }
    }
  }

  if (tiers.length === 0) {
    const layerTier = sampleLayerTier(x, z);
    if (layerTier) tiers.push(layerTier);
    else { const af = sampleAreaFlags(x, z); if (af) tiers.push(af.tier); }
  }
  if (usages.length === 0) {
    const lu = sampleLayerUsage(x, z);
    if (lu) usages.push(lu);
  }

  return { tiers, usages };
}

export function hasCeToolBitmaps(): boolean {
  return _ceToolData !== null;
}

