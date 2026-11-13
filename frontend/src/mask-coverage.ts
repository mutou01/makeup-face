// Distance in pixels to the nearest outside pixel, capped to the maximum
// inset plus the one-pixel fade. The canvas edge also counts as outside.
export function insideDistance(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const distance = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      distance[i] = Math.min(
        5,
        x ? distance[i - 1] + 1 : 1,
        y ? distance[i - width] + 1 : 1,
      );
    }
  }
  let peak = 0;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!distance[i]) continue;
      distance[i] = Math.min(
        distance[i],
        x + 1 < width ? distance[i + 1] + 1 : 1,
        y + 1 < height ? distance[i + width] + 1 : 1,
      );
      peak = Math.max(peak, distance[i]);
    }
  }
  // Leave some coverage even on the thinnest valid mask.
  return {
    distance,
    maxInset: Math.min(4, Math.max(1, peak / 2), Math.max(0, peak - 0.5)),
  };
}
