import type { Point } from "./face-analysis";

// Upper eyelid and lower brow landmarks, from the outer eye corner inward.
const eyes = [
  {
    upper: [33, 246, 161, 160, 159, 158, 157, 173, 133],
    brow: [46, 53, 52, 65, 55],
  },
  {
    upper: [263, 466, 388, 387, 386, 385, 384, 398, 362],
    brow: [276, 283, 282, 295, 285],
  },
];

export function eyeshadowMask(
  width: number,
  height: number,
  points: Point[],
  lips: Uint8ClampedArray,
  cheeks: Uint8ClampedArray | null,
) {
  const mask = new Uint8ClampedArray(width * height);

  function pixelPoints(indices: number[]): Point[] | null {
    const selected = indices.map((index) => points[index]);
    if (
      selected.some(
        (p) =>
          !p ||
          ![p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
      )
    )
      return null;
    return selected.map(({ x, y }) => ({ x: x * width, y: y * height }));
  }

  function shade(eye: (typeof eyes)[number]) {
    const upper = pixelPoints(eye.upper);
    const brow = pixelPoints(eye.brow);
    if (!upper || !brow) return false;
    const origin = upper[0];
    const end = upper[upper.length - 1];
    const dx = end.x - origin.x;
    const dy = end.y - origin.y;
    const span = Math.hypot(dx, dy);
    if (span < 10) return false;

    const along = (p: Point) =>
      ((p.x - origin.x) * dx + (p.y - origin.y) * dy) / span;
    const normal = (p: Point) =>
      (-(p.x - origin.x) * dy + (p.y - origin.y) * dx) / span;
    const sign = Math.sign(
      brow.reduce((total, point) => total + normal(point), 0),
    );
    if (!sign) return false;
    const above = (p: Point) => sign * normal(p);
    const browFloor = Math.min(...brow.map(above));
    const rim = upper.map((p) => ({ x: along(p), y: above(p) }));
    if (rim.some((p, i) => i > 0 && p.x <= rim[i - 1].x)) return false;

    const maxBand = span * 0.2;
    const gap = Math.max(0.9, span * 0.024);
    const minX = Math.max(
      0,
      Math.floor(Math.min(...upper.map((p) => p.x)) - maxBand),
    );
    const maxX = Math.min(
      width - 1,
      Math.ceil(Math.max(...upper.map((p) => p.x)) + maxBand),
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(...upper.map((p) => p.y)) - maxBand),
    );
    const maxY = Math.min(
      height - 1,
      Math.ceil(Math.max(...upper.map((p) => p.y)) + maxBand),
    );
    let applied = false;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const index = y * width + x;
        if (lips[index] || cheeks?.[index]) continue;
        const p = { x: x + 0.5, y: y + 0.5 };
        const t = along(p);
        if (t <= 0 || t >= span) continue;
        const segment = rim.findIndex((point) => point.x >= t);
        if (segment < 1) continue;
        const a = rim[segment - 1];
        const b = rim[segment];
        const upperEdge = a.y + ((t - a.x) / (b.x - a.x)) * (b.y - a.y);
        const taper = Math.sin((Math.PI * t) / span);
        const band =
          Math.min(maxBand, (browFloor - upperEdge) * 0.55) * taper ** 0.65;
        const distance = above(p) - upperEdge;
        if (distance <= gap || distance >= band) continue;
        const coverage = Math.round(
          255 * taper * Math.sin((Math.PI * (distance - gap)) / (band - gap)),
        );
        if (coverage > 0) {
          mask[index] = Math.max(mask[index], coverage);
          applied = true;
        }
      }
    }
    return applied;
  }

  return shade(eyes[0]) && shade(eyes[1]) ? mask : null;
}
