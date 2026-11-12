type Point = { x: number; y: number };
type Landmarker = {
  detect: (frame: HTMLCanvasElement) => { faceLandmarks: Point[][] };
  close: () => void;
};
type FaceRuntime = {
  FilesetResolver: { forVisionTasks: (base: string) => Promise<unknown> };
  FaceLandmarker: {
    createFromOptions: (
      files: unknown,
      options: {
        baseOptions: { modelAssetBuffer: Uint8Array; delegate: "CPU" };
        runningMode: "IMAGE";
        numFaces: number;
      },
    ) => Promise<Landmarker>;
  };
};

const base = "/local-face-runtime";
const modelAssetPath = `${base}/face_landmarker.task`;

export async function detectFaces(
  frame: HTMLCanvasElement,
): Promise<Point[][] | null> {
  const model = await fetch(modelAssetPath);
  if (!model.ok) return null;
  const modelAssetBuffer = new Uint8Array(await model.arrayBuffer());
  const moduleURL = `${base}/vision_bundle.mjs`;
  const runtime: FaceRuntime = await import(/* @vite-ignore */ moduleURL);
  const files = await runtime.FilesetResolver.forVisionTasks(base);
  const landmarker = await runtime.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "IMAGE",
    numFaces: 2,
  });
  try {
    return landmarker.detect(frame).faceLandmarks;
  } finally {
    landmarker.close();
  }
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
