import { detectFaces, prepareFaceFrame } from "./face-analysis";
import { prepareLipstick, type PaintLipstick } from "./lipstick";

type PickResult = { url?: string; message?: string };

async function call<T>(operation: "Pick" | "Clear"): Promise<T> {
  // Wails serves its runtime from the same embedded application origin.
  const runtimeURL = "/wails/runtime.js";
  const runtime: { Call: { ByName: (name: string) => Promise<T> } } =
    await import(/* @vite-ignore */ runtimeURL);
  return runtime.Call.ByName(`main.PhotoPreviewService.${operation}`);
}

export function mountPhotoPreview(section: HTMLElement) {
  section.innerHTML = `
    <h2 id="photo-preview-title">本机照片</h2>
    <p class="sample-note">支持 JPEG、PNG、WebP。照片仅在本机用于本次试妆。</p>
    <div class="photo-actions">
      <button type="button" id="pick-photo">选择本机照片</button>
      <button type="button" id="analyse-lips" disabled>分析唇部</button>
      <button type="button" id="clear-photo" disabled>清除预览</button>
    </div>
    <p id="photo-status" class="status" role="status"></p>
    <div id="photo-display"></div>
    <div id="lipstick-editor" hidden>
      <canvas role="img" aria-label="口红试妆预览" class="photo-preview-image"></canvas>
      <div class="controls">
        <label class="toggle"><input id="lipstick-enabled" type="checkbox" /> 启用口红</label>
        <label class="color-field">口红颜色 <input id="lipstick-color" type="color" value="#ae344d" /></label>
        <div>
          <div class="intensity-field">
            <label for="lipstick-strength">口红强度</label>
            <output id="lipstick-strength-value" for="lipstick-strength" aria-hidden="true">65%</output>
          </div>
          <input id="lipstick-strength" type="range" min="0" max="100" value="65" />
        </div>
      </div>
    </div>
  `;
  const pick = section.querySelector<HTMLButtonElement>("#pick-photo")!;
  const clear = section.querySelector<HTMLButtonElement>("#clear-photo")!;
  const analyse = section.querySelector<HTMLButtonElement>("#analyse-lips")!;
  const status = section.querySelector("#photo-status")!;
  const display = section.querySelector<HTMLElement>("#photo-display")!;
  const editor = section.querySelector<HTMLElement>("#lipstick-editor")!;
  const canvas = editor.querySelector("canvas")!;
  const enabled = editor.querySelector<HTMLInputElement>("#lipstick-enabled")!;
  const color = editor.querySelector<HTMLInputElement>("#lipstick-color")!;
  const strength =
    editor.querySelector<HTMLInputElement>("#lipstick-strength")!;
  const strengthValue = editor.querySelector<HTMLOutputElement>(
    "#lipstick-strength-value",
  )!;
  let original: HTMLImageElement | undefined;
  let render: PaintLipstick | undefined;

  function setBusy(busy: boolean) {
    pick.disabled = busy;
    clear.disabled = busy || !original;
    analyse.disabled = busy || !original || !!render;
  }

  function setOriginal(image?: HTMLImageElement) {
    original = image;
    render = undefined;
    editor.hidden = true;
    canvas.width = canvas.height = 0;
    enabled.checked = false;
    display.hidden = false;
    display.replaceChildren(...(image ? [image] : []));
  }

  function updatePreview() {
    strengthValue.value = `${strength.value}%`;
    render?.(enabled.checked, color.value, strength.valueAsNumber);
  }
  for (const control of [enabled, color, strength])
    control.addEventListener("input", updatePreview);

  analyse.addEventListener("click", async () => {
    if (!original) return;
    setBusy(true);
    status.textContent = "正在本机分析唇部…";
    try {
      const frame = prepareFaceFrame(original);
      const faces = await detectFaces(frame);
      if (faces === null) {
        status.textContent = "本机人脸模型尚未安装或校验失败，可继续查看原图。";
      } else if (faces.length === 0) {
        status.textContent = "没有检测到人脸，请换一张清晰的正面照。";
      } else if (faces.length > 1) {
        status.textContent = "检测到多张人脸，请换一张单人正面照。";
      } else {
        render = prepareLipstick(canvas, frame, faces[0]) ?? undefined;
        if (!render) {
          status.textContent = "唇部轮廓不完整，请换一张清晰的正面照。";
          return;
        }
        updatePreview();
        display.hidden = true;
        editor.hidden = false;
        status.textContent = "唇部已定位，可以启用口红。";
      }
    } catch {
      status.textContent = "本机人脸分析未能完成，可继续查看原图。";
    } finally {
      setBusy(false);
    }
  });

  pick.addEventListener("click", async () => {
    setBusy(true);
    status.textContent = "正在选择和检查照片…";
    try {
      const result = await call<PickResult>("Pick");
      if (!result.url) {
        status.textContent = result.message ?? "未更换照片。";
        return;
      }
      const image = new Image();
      image.alt = "本机原图预览";
      image.className = "photo-preview-image";
      image.src = result.url;
      try {
        await image.decode();
      } catch {
        setOriginal();
        await call<boolean>("Clear");
        status.textContent = "无法显示这张照片，请换一张。";
        return;
      }
      setOriginal(image);
      status.textContent = `原图已加载（${image.naturalWidth} × ${image.naturalHeight}）。`;
    } catch {
      status.textContent = "无法读取照片，请重试。";
    } finally {
      setBusy(false);
    }
  });

  clear.addEventListener("click", async () => {
    setBusy(true);
    try {
      if (!(await call<boolean>("Clear"))) throw new Error();
      setOriginal();
      status.textContent = "已清除预览。";
    } catch {
      status.textContent = "无法清除预览，请重试。";
    } finally {
      setBusy(false);
    }
  });
}
