const base = "/local-face-runtime";
const modelAssetPath = `${base}/face_landmarker.task`;

export async function detectFaces(frame) {
  const model = await fetch(modelAssetPath);
  if (!model.ok) return null;
  const modelAssetBuffer = new Uint8Array(await model.arrayBuffer());
  const moduleURL = `${base}/vision_bundle.mjs`;
  const runtime = await import(moduleURL);
  const files = await runtime.FilesetResolver.forVisionTasks(base);
  const landmarker = await runtime.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "IMAGE",
    numFaces: 2,
    outputFacialTransformationMatrixes: true,
  });
  try {
    const result = landmarker.detect(frame);
    return result.faceLandmarks.map((points, i) => ({
      points,
      pose: result.facialTransformationMatrixes?.[i],
    }));
  } finally {
    landmarker.close();
  }
}
