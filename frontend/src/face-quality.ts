import type { FacePose, Point } from "./face-analysis";

export type FaceBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function hasCoordinates(point: Point | undefined) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function checkFraming(
  width: number,
  height: number,
  points: Point[],
  pose?: FacePose,
) {
  const reject = (message: string) => ({ ok: false as const, message });
  if (
    ![10, 152, 234, 454].every((id) => hasCoordinates(points[id])) ||
    !points.every(hasCoordinates)
  ) {
    return reject("无法判断人脸取景，请换一张完整的正面照。");
  }
  const bounds: FaceBounds = { left: width, top: height, right: 0, bottom: 0 };
  for (const point of points) {
    if (!point) continue;
    bounds.left = Math.min(bounds.left, point.x * width);
    bounds.right = Math.max(bounds.right, point.x * width);
    bounds.top = Math.min(bounds.top, point.y * height);
    bounds.bottom = Math.max(bounds.bottom, point.y * height);
  }
  const margin = Math.max(2, Math.min(width, height) * 0.02);
  if (
    bounds.left < margin ||
    bounds.top < margin ||
    bounds.right > width - margin ||
    bounds.bottom > height - margin
  ) {
    return reject("人脸靠近照片边缘，请把整张脸移到画面中央并留出空隙。");
  }
  const faceWidth = bounds.right - bounds.left;
  const faceHeight = bounds.bottom - bounds.top;
  if (
    Math.min(faceWidth, faceHeight) < 96 ||
    faceWidth / width < 0.12 ||
    faceHeight / height < 0.12
  ) {
    return reject("人脸太小，请靠近镜头重新拍摄。");
  }

  if (
    !pose ||
    pose.rows !== 4 ||
    pose.columns !== 4 ||
    pose.data.length !== 16
  ) {
    return reject("无法判断头部姿态，请换一张清晰的正面照。");
  }
  // MediaPipe returns a column-major canonical-to-observed matrix. Column 2 is
  // the transformed face-forward axis; translation and uniform scale cancel.
  const x = pose.data[8];
  const y = pose.data[9];
  const z = pose.data[10];
  if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) < 1e-6) {
    return reject("无法判断头部姿态，请换一张清晰的正面照。");
  }
  const yaw = (Math.abs(Math.atan2(x, z)) * 180) / Math.PI;
  const pitch = (Math.abs(Math.atan2(y, Math.hypot(x, z))) * 180) / Math.PI;
  if (yaw > 25) return reject("头部侧转过大，请正对镜头。");
  if (pitch > 20) return reject("头部俯仰过大，请把镜头放到与眼睛齐平的位置。");
  return { ok: true as const, bounds };
}

export function checkImageQuality(
  frame: HTMLCanvasElement,
  bounds: FaceBounds,
): string | null {
  const size = 96;
  const sample = document.createElement("canvas");
  sample.width = sample.height = size;
  const ctx = sample.getContext("2d");
  const unreadable = "无法判断脸部光线和清晰度，请换一张完整照片。";
  if (!ctx) return unreadable;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  ctx.drawImage(
    frame,
    bounds.left + width * 0.18,
    bounds.top + height * 0.22,
    width * 0.64,
    height * 0.64,
    0,
    0,
    size,
    size,
  );
  const { data } = ctx.getImageData(0, 0, size, size);
  const luma = new Float32Array(size * size);
  for (let i = 0; i < luma.length; i++) {
    const rgba = i * 4;
    luma[i] =
      (54 * data[rgba] + 183 * data[rgba + 1] + 19 * data[rgba + 2]) / 256;
  }

  let count = 0;
  let dark = 0;
  let bright = 0;
  let detail = 0;
  const center = (size - 1) / 2;
  const radius = size * 0.46;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if ((x - center) ** 2 + (y - center) ** 2 > radius ** 2) continue;
      const i = y * size + x;
      if (
        data[i * 4 + 3] < 230 ||
        data[(i - 1) * 4 + 3] < 230 ||
        data[(i + 1) * 4 + 3] < 230 ||
        data[(i - size) * 4 + 3] < 230 ||
        data[(i + size) * 4 + 3] < 230
      )
        continue;
      const value = luma[i];
      if (value < 35) dark++;
      if (value > 242) bright++;
      // Local edge energy on the same resampled area, independent of full photo size.
      const laplacian =
        4 * value - luma[i - 1] - luma[i + 1] - luma[i - size] - luma[i + size];
      detail += laplacian * laplacian;
      count++;
    }
  }
  if (count < (size * size) / 2) return unreadable;
  if (dark / count >= 0.75) return "脸部过暗，请面向均匀光源重新拍摄。";
  if (bright / count >= 0.75) return "脸部过亮，请避开直射强光或调低曝光。";
  if (detail / count < 8) return "照片明显模糊，请对准脸部对焦并稳住镜头。";
  return null;
}
