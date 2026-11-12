type Point = { x: number; y: number };
export type PaintLipstick = (
  enabled: boolean,
  color: string,
  strength: number,
) => void;

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

export function prepareLipstick(
  canvas: HTMLCanvasElement,
  frame: HTMLCanvasElement,
  points: Point[],
): PaintLipstick | null {
  const { width, height } = frame;
  const outer = contour(points, outerRing, width, height);
  const inner = contour(points, innerRing, width, height);
  if (!outer || !inner) return null;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fill(outer);
  ctx.globalCompositeOperation = "destination-out";
  ctx.fill(inner);
  ctx.globalCompositeOperation = "source-over";
  const mask = ctx.getImageData(0, 0, width, height).data;
  const affected: number[] = [];
  for (let i = 0; i < mask.length; i += 4) if (mask[i + 3]) affected.push(i);
  if (affected.length === 0) return null;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(frame, 0, 0);
  const original = ctx.getImageData(0, 0, width, height);
  const output = ctx.createImageData(width, height);
  output.data.set(original.data);
  return (enabled, color, strength) => {
    if (!enabled || strength === 0) {
      ctx.putImageData(original, 0, 0);
      return;
    }
    const target = [1, 3, 5].map((start) =>
      Number.parseInt(color.slice(start, start + 2), 16),
    );
    for (const i of affected) {
      const amount = (mask[i + 3] / 255) * (strength / 100) * 0.85;
      for (let c = 0; c < 3; c++) {
        const source = original.data[i + c];
        output.data[i + c] = source + (target[c] - source) * amount;
      }
    }
    ctx.putImageData(output, 0, 0);
  };
}
