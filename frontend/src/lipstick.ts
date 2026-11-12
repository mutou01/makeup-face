import type { Point } from "./face-analysis";

// Contour topology from MediaPipe Face Landmarker, ordered into two closed rings.
const outerRing = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84,
  181, 91, 146,
];
const innerRing = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87,
  178, 88, 95,
];

function contour(
  points: Point[],
  ring: number[],
  width: number,
  height: number,
) {
  const path = new Path2D();
  for (const [i, index] of ring.entries()) {
    const point = points[index];
    if (
      !point ||
      ![point.x, point.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      return null;
    if (i === 0) path.moveTo(point.x * width, point.y * height);
    else path.lineTo(point.x * width, point.y * height);
  }
  path.closePath();
  return path;
}

export function lipstickMask(
  width: number,
  height: number,
  points: Point[],
): Uint8ClampedArray | null {
  const outer = contour(points, outerRing, width, height);
  const inner = contour(points, innerRing, width, height);
  if (!outer || !inner) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fill(outer);
  ctx.globalCompositeOperation = "destination-out";
  ctx.fill(inner);
  ctx.globalCompositeOperation = "source-over";
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 3];
  return mask.some(Boolean) ? mask : null;
}
