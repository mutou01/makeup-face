import { detectFaces, prepareFaceFrame } from "./face-analysis";
import { prepareMakeup } from "./makeup-preview";
import { mountRecommendations } from "./recommendation-panel";

type PickResult = { url?: string; message?: string };

async function call<T>(operation: "Pick" | "Clear"): Promise<T> {
  // Wails serves its runtime from the same embedded application origin.
  const runtimeURL = "/wails/runtime.js";
  const runtime: { Call: { ByName: (name: string) => Promise<T> } } =
    await import(/* @vite-ignore */ runtimeURL);
  return runtime.Call.ByName(`main.PhotoPreviewService.${operation}`);
}

function layerMarkup(
  id: string,
  title: string,
  color: string,
  strength: number,
) {
  return `
    <fieldset id="${id}" class="makeup-layer">
      <legend>${title}</legend>
      <div class="controls">
        <label class="toggle"><input type="checkbox" /> 启用${title}</label>
        <label class="color-field">${title}颜色 <input type="color" value="${color}" /></label>
        <div>
          <div class="intensity-field">
            <label for="${id}-strength">${title}强度</label>
            <output for="${id}-strength" aria-hidden="true">${strength}%</output>
          </div>
          <input id="${id}-strength" type="range" min="0" max="100" value="${strength}" />
        </div>
      </div>
    </fieldset>`;
}

function layerControls(editor: HTMLElement, id: string, onInput: () => void) {
  const fieldset = editor.querySelector<HTMLFieldSetElement>(`#${id}`)!;
  const enabled = fieldset.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  const color = fieldset.querySelector<HTMLInputElement>(
    'input[type="color"]',
  )!;
  const strength = fieldset.querySelector<HTMLInputElement>(
    'input[type="range"]',
  )!;
  const output = fieldset.querySelector("output")!;
  strength.addEventListener("input", () => {
    output.value = `${strength.value}%`;
  });
  for (const input of [enabled, color, strength])
    input.addEventListener("input", onInput);
  return {
    fieldset,
    reset: () => {
      enabled.checked = false;
    },
    settings: () => ({
      enabled: enabled.checked,
      color: color.value,
      strength: strength.valueAsNumber,
    }),
  };
}

export function mountPhotoPreview(section: HTMLElement) {
  section.innerHTML = `
    <h2 id="photo-preview-title">本机照片</h2>
    <p class="sample-note">支持 JPEG、PNG、WebP。照片仅在本机用于本次试妆。</p>
    <div class="photo-actions">
      <button type="button" id="pick-photo">选择本机照片</button>
      <button type="button" id="analyse-face" disabled>分析面部</button>
      <button type="button" id="clear-photo" disabled>清除预览</button>
    </div>
    <p id="photo-status" class="status" role="status"></p>
    <div id="photo-display"></div>
    <div id="makeup-editor" hidden>
      <canvas role="img" aria-label="试妆预览" class="photo-preview-image"></canvas>
      <div class="makeup-layers">
        ${layerMarkup("lipstick", "口红", "#ae344d", 65)}
        ${layerMarkup("blush", "腮红", "#d66c83", 55)}
        ${layerMarkup("eyeshadow", "眼影", "#835d79", 50)}
      </div>
    </div>
    <section id="recommendations" class="recommendation-panel" aria-labelledby="recommendation-title"></section>
  `;
  mountRecommendations(section.querySelector<HTMLElement>("#recommendations")!);
  const pick = section.querySelector<HTMLButtonElement>("#pick-photo")!;
  const clear = section.querySelector<HTMLButtonElement>("#clear-photo")!;
  const analyse = section.querySelector<HTMLButtonElement>("#analyse-face")!;
  const status = section.querySelector("#photo-status")!;
  const display = section.querySelector<HTMLElement>("#photo-display")!;
  const editor = section.querySelector<HTMLElement>("#makeup-editor")!;
  const canvas = editor.querySelector("canvas")!;
  const lipstick = layerControls(editor, "lipstick", updatePreview);
  const blush = layerControls(editor, "blush", updatePreview);
  const eyeshadow = layerControls(editor, "eyeshadow", updatePreview);
  let original: HTMLImageElement | undefined;
  let render: ReturnType<typeof prepareMakeup> = null;

  function setBusy(busy: boolean) {
    pick.disabled = busy;
    clear.disabled = busy || !original;
    analyse.disabled = busy || !original || !!render;
  }

  function setOriginal(image?: HTMLImageElement) {
    original = image;
    render = null;
    editor.hidden = true;
    canvas.width = canvas.height = 0;
    lipstick.reset();
    blush.reset();
    eyeshadow.reset();
    display.hidden = false;
    display.replaceChildren(...(image ? [image] : []));
  }

  function updatePreview() {
    render?.paint({
      lipstick: lipstick.settings(),
      blush: blush.settings(),
      eyeshadow: eyeshadow.settings(),
    });
  }

  analyse.addEventListener("click", async () => {
    if (!original) return;
    setBusy(true);
    status.textContent = "正在本机分析面部…";
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
        render = prepareMakeup(canvas, frame, faces[0]);
        if (!render) {
          status.textContent = "唇部轮廓不完整，请换一张清晰的正面照。";
          return;
        }
        blush.fieldset.hidden = !render.hasBlush;
        eyeshadow.fieldset.hidden = !render.hasEyeshadow;
        updatePreview();
        display.hidden = true;
        editor.hidden = false;
        const ready = ["口红"];
        if (render.hasBlush) ready.push("腮红");
        if (render.hasEyeshadow) ready.push("眼影");
        status.textContent =
          ready.length === 3
            ? `已定位，可启用${ready.join("、")}。`
            : `部分区域定位不完整，可启用${ready.join("、")}。`;
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
