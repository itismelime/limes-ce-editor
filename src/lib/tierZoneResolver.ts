// areaflags.map format:
//   Header: 6 × uint32 LE = [gridW, gridH, worldW, worldH, unknown, layerCount]
//   Data:   (gridW * gridH / 2) bytes, nibble-packed, 2 pixels per byte
//     - Even pixel index → high nibble (>> 4); odd → low nibble (& 0xF)
//     - Nibble is a bitmask: bit 0=Tier1, bit 1=Tier2, bit 2=Tier3, bit 3=Tier4
//   Coordinate mapping:
//     col = floor(worldX / worldW * gridW)
//     row = floor((1 - worldZ / worldH) * gridH)   ← Z=worldH is north (row 0), Z=0 is south

interface AreaFlagsData {
  data: Uint8Array;
  gridW: number;
  gridH: number;
  worldW: number;
  worldH: number;
  tierNames: string[];
}

let _cfg: AreaFlagsData | null = null;

export function loadAreaFlags(raw: Uint8Array): void {
  const view   = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const gridW  = view.getUint32(0, true);
  const gridH  = view.getUint32(4, true);
  const worldW = view.getUint32(8, true);
  const worldH = view.getUint32(12, true);
  const layers = view.getUint32(20, true);
  _cfg = {
    data: raw.subarray(24),
    gridW, gridH, worldW, worldH,
    tierNames: Array.from({ length: layers }, (_, i) => `Tier${i + 1}`),
  };
}

export function clearAreaFlags(): void {
  _cfg = null;
}

export function hasAreaFlags(): boolean {
  return _cfg !== null;
}

function sampleNibble(x: number, z: number): { nibble: number; pixIdx: number } | null {
  if (!_cfg) return null;
  const { data, gridW, gridH, worldW, worldH } = _cfg;
  if (x < 0 || x >= worldW || z < 0 || z >= worldH) return null;
  const col    = Math.min(Math.floor(x / worldW * gridW), gridW - 1);
  const row    = Math.min(Math.floor((1 - z / worldH) * gridH), gridH - 1);
  const pixIdx = row * gridW + col;
  const byte   = data[Math.floor(pixIdx / 2)];
  const nibble = (pixIdx % 2 === 0) ? (byte >> 4) : (byte & 0xF);
  return { nibble, pixIdx };
}

export function sampleTierAtPos(x: number, z: number): string {
  const s = sampleNibble(x, z);
  if (!s || !_cfg) return 'unknown';
  const { nibble } = s;
  const { tierNames } = _cfg;
  // Highest tier wins
  for (let bit = tierNames.length - 1; bit >= 0; bit--) {
    if (nibble & (1 << bit)) return tierNames[bit];
  }
  return 'unknown';
}

