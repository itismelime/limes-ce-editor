// Decodes a RLE-compressed or uncompressed 8-bit grayscale TGA (image types 3 and 11).
// Returns a flat row-major pixel array (top-to-bottom, left-to-right).
export function parseTgaGrayscale(data: Uint8Array): Uint8Array {
  const idLen    = data[0];
  const imgType  = data[2];
  const width    = data[12] | (data[13] << 8);
  const height   = data[14] | (data[15] << 8);
  const pixels   = new Uint8Array(width * height);
  let i = 18 + idLen;
  let out = 0;

  if (imgType === 11) {
    // RLE grayscale
    while (i < data.length && out < pixels.length) {
      const h = data[i++];
      if (h >= 128) {
        const count = h - 127;
        const pixel = data[i++];
        const end = Math.min(out + count, pixels.length);
        pixels.fill(pixel, out, end);
        out = end;
      } else {
        const count = h + 1;
        for (let n = 0; n < count && out < pixels.length; n++) pixels[out++] = data[i++];
      }
    }
  } else if (imgType === 3) {
    // Uncompressed grayscale
    pixels.set(data.subarray(i, i + width * height));
  }

  return pixels;
}

export function tgaDimensions(data: Uint8Array): { width: number; height: number } {
  return { width: data[12] | (data[13] << 8), height: data[14] | (data[15] << 8) };
}
