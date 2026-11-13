export type Point = { x: number; y: number };
export type FacePose = {
  rows: number;
  columns: number;
  data: ArrayLike<number>;
};
export type DetectedFace = { points: Point[]; pose?: FacePose };
export type Mesh = {
  topology: "mediapipe-478-v1";
  width: number;
  height: number;
  faces: DetectedFace[];
};

export async function detectLocalFaces(
  frame: HTMLCanvasElement,
): Promise<DetectedFace[] | null> {
  const driverURL = "/local-face-runtime/driver.mjs";
  const driver = await import(/* @vite-ignore */ driverURL);
  return driver.detectFaces(frame);
}

export function prepareFaceFrame(image: HTMLImageElement) {
  const scale = Math.min(
    1,
    1024 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const frame = document.createElement("canvas");
  frame.width = Math.max(1, Math.round(image.naturalWidth * scale));
  frame.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = frame.getContext("2d");
  if (!ctx) throw new Error("无法创建照片画布");
  ctx.drawImage(image, 0, 0, frame.width, frame.height);
  return frame;
}
