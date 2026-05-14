/**
 * Decode a TGA file (types 2, 3, 10, 11) into an RGBA flat array.
 * Returns { width, height, rgba } where rgba is width*height*4 bytes.
 */
export function parseTgaRgba(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const idLen    = data[0];
  const imgType  = data[2];
  const width    = data[12] | (data[13] << 8);
  const height   = data[14] | (data[15] << 8);
  const bpp      = data[16]; // bits per pixel: 8, 24, or 32
  const descriptor = data[17];
  // Bit 5 of descriptor: 0 = bottom-to-top, 1 = top-to-bottom
  const topToBottom = (descriptor & 0x20) !== 0;
  const bytesPerPixel = Math.ceil(bpp / 8);
  const rgba = new Uint8Array(width * height * 4);
  let i = 18 + idLen;
  let pixelIdx = 0;

  function writePixel(data: Uint8Array, offset: number, outArr: Uint8Array, pIdx: number): void {
    const o = pIdx * 4;
    if (bpp === 8) {
      // Grayscale
      const v = data[offset];
      outArr[o] = v; outArr[o + 1] = v; outArr[o + 2] = v; outArr[o + 3] = 255;
    } else if (bpp === 24) {
      // BGR
      outArr[o] = data[offset + 2]; outArr[o + 1] = data[offset + 1]; outArr[o + 2] = data[offset]; outArr[o + 3] = 255;
    } else if (bpp === 32) {
      // BGRA
      outArr[o] = data[offset + 2]; outArr[o + 1] = data[offset + 1]; outArr[o + 2] = data[offset]; outArr[o + 3] = data[offset + 3];
    }
  }

  const isRle   = imgType === 10 || imgType === 11;
  const total   = width * height;

  if (isRle) {
    while (pixelIdx < total && i < data.length) {
      const header = data[i++];
      const count  = (header & 0x7f) + 1;
      if (header & 0x80) {
        // RLE run
        for (let n = 0; n < count && pixelIdx < total; n++) {
          writePixel(data, i, rgba, pixelIdx++);
        }
        i += bytesPerPixel;
      } else {
        // Raw run
        for (let n = 0; n < count && pixelIdx < total; n++) {
          writePixel(data, i, rgba, pixelIdx++);
          i += bytesPerPixel;
        }
      }
    }
  } else {
    // Uncompressed
    for (let p = 0; p < total; p++) {
      writePixel(data, i, rgba, p);
      i += bytesPerPixel;
    }
  }

  // TGA is stored bottom-to-top by default; flip vertically if needed
  if (!topToBottom) {
    const row = new Uint8Array(width * 4);
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const top = y * width * 4;
      const bot = (height - 1 - y) * width * 4;
      row.set(rgba.subarray(top, top + width * 4));
      rgba.copyWithin(top, bot, bot + width * 4);
      rgba.set(row, bot);
    }
  }

  return { width, height, rgba };
}

/** Returns true if the data looks like a TGA file we can parse (types 2, 3, 10, 11). */
export function isTga(data: Uint8Array): boolean {
  if (data.length < 18) return false;
  // PNG magic: 137 80 78 71
  if (data[0] === 137 && data[1] === 80) return false;
  // BMP magic: 66 77
  if (data[0] === 66 && data[1] === 77) return false;
  const colorMapType = data[1];
  const imgType = data[2];
  // colorMapType must be 0 or 1; imgType must be a supported value
  return (colorMapType === 0 || colorMapType === 1) &&
    (imgType === 2 || imgType === 3 || imgType === 10 || imgType === 11);
}
