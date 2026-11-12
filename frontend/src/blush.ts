import type { Point } from "./face-analysis";

export function blushMask(
  width: number,
  height: number,
  points: Point[],
  lips: Uint8ClampedArray,
) {
  const anchors = [33, 263, 205, 425, 234, 454].map((id) => points[id]);
  if (
    anchors.some(
      (p) =>
        !p || ![p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
    )
  )
    return null;
  const [leftEye, rightEye, leftCheek, rightCheek, leftEdge, rightEdge] =
    anchors.map(({ x, y }) => ({ x: x * width, y: y * height }));
  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const span = Math.hypot(dx, dy);
  if (span < 12 || dx <= 0) return null;

  const acrossX = dx / span;
  const acrossY = dy / span;
  const across = (x: number, y: number) => x * acrossX + y * acrossY;
  const down = (x: number, y: number) => -x * acrossY + y * acrossX;
  const eyeMiddle = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };
  const mask = new Uint8ClampedArray(width * height);

  function feather(center: Point, edge: Point, eye: Point, side: -1 | 1) {
    const innerRoom =
      side * across(center.x - eyeMiddle.x, center.y - eyeMiddle.y);
    const outerRoom = side * across(edge.x - center.x, edge.y - center.y);
    const eyeRoom = down(center.x - eye.x, center.y - eye.y);
    const radiusX = Math.min(span * 0.17, innerRoom * 0.65, outerRoom * 0.8);
    const radiusY = Math.min(span * 0.105, eyeRoom * 0.55);
    if (radiusX < 2 || radiusY < 2) return false;

    const limit = Math.ceil(Math.hypot(radiusX, radiusY));
    const minX = Math.max(0, Math.floor(center.x - limit));
    const maxX = Math.min(width - 1, Math.ceil(center.x + limit));
    const minY = Math.max(0, Math.floor(center.y - limit));
    const maxY = Math.min(height - 1, Math.ceil(center.y + limit));
    let applied = false;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * width + x;
        if (lips[i]) continue;
        const offsetX = x + 0.5 - center.x;
        const offsetY = y + 0.5 - center.y;
        const distance =
          (across(offsetX, offsetY) / radiusX) ** 2 +
          (down(offsetX, offsetY) / radiusY) ** 2;
        if (distance >= 1) continue;
        const coverage = Math.round(255 * (1 - distance) ** 2);
        mask[i] = Math.max(mask[i], coverage);
        if (coverage) applied = true;
      }
    }
    return applied;
  }

  return feather(leftCheek, leftEdge, leftEye, -1) &&
    feather(rightCheek, rightEdge, rightEye, 1)
    ? mask
    : null;
}
