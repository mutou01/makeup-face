import { detectLocalFaces, prepareFaceFrame, type Mesh } from "./face-analysis";
import { mountImagePreview, mountImageSettings } from "./image-preview";
import { checkFraming, checkImageQuality } from "./face-quality";
import {
  FULL_COVERAGE,
  MIN_COVERAGE,
  prepareMakeup,
  type LayerSettings,
} from "./makeup-preview";
import { mountRecommendations } from "./recommendation-panel";
import { mountProviderSettings } from "./provider-settings";
import type { Preset, PresetLayer } from "./recommendations";

type PickResult = { url?: string; message?: string };
type Preferences = {
  scene: string;
  look: string;
};
type Makeup = {
  analyzed: boolean;
  mesh?: Mesh;
  layers: Record<
    "lipstick" | "blush" | "eyeshadow",
    Omit<LayerSettings, "coverage"> & { coverage?: number }
  >;
};
type Draft = Preferences & Makeup;
type ProjectResult = {
  active: boolean;
  url?: string;
  message: string;
  draft?: Makeup;
  preferences?: Preferences;
};
type ProjectAction = { done: boolean; message: string };
type Operation =
  | "Pick"
  | "Clear"
  | "CreateProject"
  | "OpenProject"
  | "SaveProject"
  | "CloseProject"
  | "RecordFaceAnalysis"
  | "RemoveProjectPhoto"
  | "ExportPreview";

async function call<T>(operation: Operation, ...args: unknown[]): Promise<T> {
  // Wails serves its runtime from the same embedded application origin.
  const runtimeURL = "/wails/runtime.js";
  const runtime: {
    Call: { ByName: (name: string, ...args: unknown[]) => Promise<T> };
  } = await import(/* @vite-ignore */ runtimeURL);
  return runtime.Call.ByName(`main.PhotoPreviewService.${operation}`, ...args);
}

async function loadPhoto(url: string) {
  const image = new Image();
  image.alt = "本机原图预览";
  image.className = "photo-preview-image";
  image.src = url;
  await image.decode();
  return image;
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
        <div>
          <div class="intensity-field">
            <label for="${id}-coverage">${title}范围</label>
            <output for="${id}-coverage" aria-hidden="true">${FULL_COVERAGE}%</output>
          </div>
          <input id="${id}-coverage" type="range" min="${MIN_COVERAGE}" max="${FULL_COVERAGE}" value="${FULL_COVERAGE}" />
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
  const strength = fieldset.querySelector<HTMLInputElement>(`#${id}-strength`)!;
  const coverage = fieldset.querySelector<HTMLInputElement>(`#${id}-coverage`)!;
  const output = fieldset.querySelector<HTMLOutputElement>(
    `output[for="${id}-strength"]`,
  )!;
  const coverageOutput = fieldset.querySelector<HTMLOutputElement>(
    `output[for="${id}-coverage"]`,
  )!;
  strength.addEventListener("input", () => {
    output.value = `${strength.value}%`;
  });
  function setCoverage(value: number) {
    coverage.valueAsNumber = value;
    coverageOutput.value = `${coverage.value}%`;
  }
  coverage.addEventListener("input", () => {
    coverageOutput.value = `${coverage.value}%`;
  });
  for (const input of [enabled, color, strength, coverage])
    input.addEventListener("input", onInput);
  function restore(
    layer: Omit<LayerSettings, "coverage"> & { coverage?: number },
  ) {
    enabled.checked = layer.enabled;
    color.value = layer.color;
    strength.valueAsNumber = layer.strength;
    output.value = `${strength.value}%`;
    setCoverage(layer.coverage ?? FULL_COVERAGE);
  }
  return {
    fieldset,
    reset: () => {
      enabled.checked = false;
      setCoverage(FULL_COVERAGE);
    },
    apply: (preset: PresetLayer) => {
      restore({ ...preset, enabled: true });
    },
    restore,
    resetDefaults: () =>
      restore({
        enabled: false,
        color: color.defaultValue,
        strength: Number(strength.defaultValue),
      }),
    settings: () => ({
      enabled: enabled.checked,
      color: color.value,
      strength: strength.valueAsNumber,
      coverage: coverage.valueAsNumber,
    }),
  };
}

export function mountPhotoPreview(section: HTMLElement) {
  section.innerHTML = `
    <h2 id="photo-preview-title">本机照片</h2>
    <p class="sample-note">支持 JPEG、PNG、WebP。面部定位和试妆在本机完成。</p>
    <section class="recommendation-panel" aria-labelledby="project-title">
      <h2 id="project-title">本机项目</h2>
      <div class="photo-actions">
        <button type="button" id="create-project">新建项目</button>
        <button type="button" id="open-project">打开项目</button>
        <button type="button" id="save-project" disabled>保存项目</button>
        <button type="button" id="close-project" disabled>关闭项目</button>
        <button type="button" id="remove-project-photo" disabled>移除项目照片</button>
      </div>
      <p>改动需手动保存。关闭项目会丢弃未保存的修改。</p>
      <p>移除项目照片会清除项目副本和妆容，保留导入原件。</p>
      <p id="project-status" class="status" role="status" aria-label="项目状态"></p>
    </section>
    <div class="photo-actions">
      <button type="button" id="pick-photo">选择本机照片</button>
      <button type="button" id="analyse-face" disabled>分析面部</button>
      <button type="button" id="clear-photo" disabled>清除预览</button>
      <button type="button" id="export-preview" disabled>导出预览</button>
    </div>
    <p id="photo-status" class="status" role="status" aria-label="照片处理状态"></p>
    <div id="photo-display"></div>
    <div id="makeup-editor" hidden>
      <label class="toggle compare-toggle"><input id="show-original" type="checkbox" /> 查看原图</label>
      <canvas role="img" aria-label="试妆预览" class="photo-preview-image"></canvas>
      <div class="makeup-layers">
        ${layerMarkup("lipstick", "口红", "#ae344d", 65)}
        ${layerMarkup("blush", "腮红", "#d66c83", 55)}
        ${layerMarkup("eyeshadow", "眼影", "#835d79", 50)}
      </div>
    </div>
    <section id="recommendations" class="recommendation-panel" aria-labelledby="recommendation-title"></section>
    <section id="generated-preview" class="recommendation-panel" aria-labelledby="generated-title"></section>
    <section id="provider-settings" class="recommendation-panel" aria-labelledby="provider-title"></section>
    <section id="image-provider" class="recommendation-panel" aria-labelledby="image-provider-title"></section>
  `;
  mountImageSettings(section.querySelector<HTMLElement>("#image-provider")!);
  const pick = section.querySelector<HTMLButtonElement>("#pick-photo")!;
  const clear = section.querySelector<HTMLButtonElement>("#clear-photo")!;
  const exportPreview =
    section.querySelector<HTMLButtonElement>("#export-preview")!;
  const analyse = section.querySelector<HTMLButtonElement>("#analyse-face")!;
  const status = section.querySelector("#photo-status")!;
  const createProject =
    section.querySelector<HTMLButtonElement>("#create-project")!;
  const openProject =
    section.querySelector<HTMLButtonElement>("#open-project")!;
  const saveProject =
    section.querySelector<HTMLButtonElement>("#save-project")!;
  const closeProject =
    section.querySelector<HTMLButtonElement>("#close-project")!;
  const removeProjectPhoto = section.querySelector<HTMLButtonElement>(
    "#remove-project-photo",
  )!;
  const projectStatus = section.querySelector("#project-status")!;
  const display = section.querySelector<HTMLElement>("#photo-display")!;
  const editor = section.querySelector<HTMLElement>("#makeup-editor")!;
  const canvas = editor.querySelector("canvas")!;
  const showOriginal =
    editor.querySelector<HTMLInputElement>("#show-original")!;
  showOriginal.addEventListener("input", updatePreview);
  const lipstick = layerControls(editor, "lipstick", updatePreview);
  const blush = layerControls(editor, "blush", updatePreview);
  const eyeshadow = layerControls(editor, "eyeshadow", updatePreview);
  let original: HTMLImageElement | undefined;
  let render: ReturnType<typeof prepareMakeup> = null;
  let projectActive = false;
  let hasSavedPhoto = false;
  let restoreAnalysis = false;
  const recommendations = mountRecommendations(
    section.querySelector<HTMLElement>("#recommendations")!,
    applyPreset,
  );
  const imagePreview = mountImagePreview(
    section.querySelector<HTMLElement>("#generated-preview")!,
    setBusy,
  );
  mountProviderSettings(
    section.querySelector<HTMLElement>("#provider-settings")!,
    recommendations.setProvider,
  );

  function setBusy(busy: boolean) {
    imagePreview.setBusy(busy);
    pick.disabled = busy;
    clear.disabled = busy || !original;
    exportPreview.disabled = busy || !original;
    showOriginal.disabled = busy;
    analyse.disabled = busy || !original || !!render;
    recommendations.setAvailable(!busy && render !== null);
    createProject.disabled = openProject.disabled = busy || projectActive;
    closeProject.disabled = busy || !projectActive;
    saveProject.disabled = busy || !projectActive || !original;
    removeProjectPhoto.disabled = busy || !projectActive || !hasSavedPhoto;
  }

  function setOriginal(image?: HTMLImageElement) {
    imagePreview.setPhoto(image);
    original = image;
    render = null;
    restoreAnalysis = false;
    showOriginal.checked = false;
    editor.hidden = true;
    canvas.width = canvas.height = 0;
    lipstick.reset();
    blush.reset();
    eyeshadow.reset();
    recommendations.resetFeedback();
    display.hidden = false;
    display.replaceChildren(...(image ? [image] : []));
  }

  function updatePreview() {
    if (showOriginal.checked) {
      render?.showOriginal();
      return;
    }
    render?.paint({
      lipstick: lipstick.settings(),
      blush: blush.settings(),
      eyeshadow: eyeshadow.settings(),
    });
  }

  function applyPreset(preset: Preset) {
    if (!render) return null;
    const missing: string[] = [];
    lipstick.apply(preset.layers.lipstick);
    if (render.hasBlush) blush.apply(preset.layers.blush);
    else missing.push("腮红");
    if (render.hasEyeshadow) eyeshadow.apply(preset.layers.eyeshadow);
    else missing.push("眼影");
    updatePreview();
    canvas.scrollIntoView({ block: "nearest" });
    return missing;
  }

  async function analysePhoto(savedMesh?: Mesh) {
    if (!original) return;
    const photoURL = new URL(original.src).pathname;
    const started = performance.now();
    let recorded = false;
    let reason = "unavailable";
    const unavailable =
      "本机人脸模型不可用，请检查应用的定位资源。可继续查看原图。";
    try {
      const frame = prepareFaceFrame(original);
      let faces;
      if (savedMesh) {
        if (
          savedMesh.width !== frame.width ||
          savedMesh.height !== frame.height
        ) {
          status.textContent = "已保存的关键点尺寸与照片不符，请重新分析。";
          return;
        }
        faces = savedMesh.faces;
      } else {
        status.textContent = "正在本机分析面部…";
        faces = await detectLocalFaces(frame);
      }
      if (faces === null) {
        status.textContent = unavailable;
      } else if (faces.length === 0) {
        reason = "no_face";
        status.textContent = "没有检测到人脸，请换一张清晰的正面照。";
      } else if (faces.length > 1) {
        reason = "multiple_faces";
        status.textContent = "检测到多张人脸，请换一张单人正面照。";
      } else {
        const { points, pose } = faces[0];
        const framing = checkFraming(frame.width, frame.height, points, pose);
        if (!framing.ok) {
          status.textContent = framing.message;
          return;
        }
        const imageQuality = checkImageQuality(frame, framing.bounds);
        if (imageQuality) {
          status.textContent = imageQuality;
          return;
        }
        const candidate = prepareMakeup(canvas, frame, points);
        if (!candidate) {
          status.textContent = "唇部轮廓不完整，请换一张清晰的正面照。";
          return;
        }
        if (!savedMesh && pose) {
          const result: Mesh = {
            topology: "mediapipe-478-v1",
            width: frame.width,
            height: frame.height,
            faces: [
              {
                points,
                pose: {
                  rows: pose.rows,
                  columns: pose.columns,
                  data: Array.from(pose.data),
                },
              },
            ],
          };
          recorded = true;
          if (!(await recordAnalysis(result))) {
            status.textContent = "本机关键点未通过校验，可继续查看原图。";
            return;
          }
        }
        render = candidate;
        restoreAnalysis = true;
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
      status.textContent = unavailable;
    } finally {
      if (!savedMesh && !recorded) await recordAnalysis(null);
    }

    function recordAnalysis(result: Mesh | null) {
      return call<boolean>(
        "RecordFaceAnalysis",
        photoURL,
        result,
        reason,
        Math.round(performance.now() - started),
      ).catch(() => false);
    }
  }

  analyse.addEventListener("click", async () => {
    setBusy(true);
    try {
      await analysePhoto();
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
      let image: HTMLImageElement;
      try {
        image = await loadPhoto(result.url);
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

  exportPreview.addEventListener("click", async () => {
    if (!original) return;
    setBusy(true);
    status.textContent = "正在导出预览…";
    try {
      const frame = render ? canvas : prepareFaceFrame(original);
      const encoded = frame.toDataURL("image/png").split(",", 2)[1];
      if (!encoded) throw new Error("无法编码预览");
      status.textContent = await call<string>("ExportPreview", encoded);
    } catch {
      status.textContent = "无法导出预览，请重试。";
    } finally {
      setBusy(false);
    }
  });

  function restoreDraft(draft?: Makeup, preferences?: Preferences) {
    recommendations.restore(
      preferences?.scene ?? "any",
      preferences?.look ?? "any",
    );
    if (draft) {
      lipstick.restore(draft.layers.lipstick);
      blush.restore(draft.layers.blush);
      eyeshadow.restore(draft.layers.eyeshadow);
      restoreAnalysis = draft.analyzed;
    } else {
      lipstick.resetDefaults();
      blush.resetDefaults();
      eyeshadow.resetDefaults();
    }
  }

  async function selectProject(operation: "CreateProject" | "OpenProject") {
    recommendations.cancelExplanation();
    setBusy(true);
    try {
      const result = await call<ProjectResult>(operation);
      projectStatus.textContent = result.message;
      if (!result.active) return;
      projectActive = true;
      hasSavedPhoto = !!result.url;
      if (operation === "CreateProject") return;
      setOriginal();
      status.textContent = "";
      if (result.url) {
        try {
          setOriginal(await loadPhoto(result.url));
        } catch {
          await call<boolean>("Clear");
          status.textContent = "无法显示项目照片。";
        }
      }
      restoreDraft(result.draft, result.preferences);
      if (result.draft?.mesh) await analysePhoto(result.draft.mesh);
      else if (restoreAnalysis && original)
        status.textContent =
          "此项目没有已保存的关键点。可查看原图，或主动重新分析。";
    } catch {
      projectStatus.textContent = "无法打开本机项目，请重试。";
    } finally {
      setBusy(false);
    }
  }
  createProject.addEventListener("click", () => selectProject("CreateProject"));
  openProject.addEventListener("click", () => selectProject("OpenProject"));

  saveProject.addEventListener("click", async () => {
    setBusy(true);
    try {
      const draft: Draft = {
        ...recommendations.preferences(),
        analyzed: restoreAnalysis,
        layers: {
          lipstick: lipstick.settings(),
          blush: blush.settings(),
          eyeshadow: eyeshadow.settings(),
        },
      };
      const result = await call<ProjectAction>("SaveProject", draft);
      projectStatus.textContent = result.message;
      if (result.done) hasSavedPhoto = true;
    } catch {
      projectStatus.textContent = "无法保存本机项目，请重试。";
    } finally {
      setBusy(false);
    }
  });

  closeProject.addEventListener("click", async () => {
    recommendations.cancelExplanation();
    setBusy(true);
    try {
      if (!(await call<boolean>("CloseProject"))) throw new Error();
      projectActive = false;
      hasSavedPhoto = false;
      setOriginal();
      restoreDraft();
      status.textContent = "";
      projectStatus.textContent = "项目已关闭。";
    } catch {
      projectStatus.textContent = "无法关闭项目，请重试。";
    } finally {
      setBusy(false);
    }
  });

  removeProjectPhoto.addEventListener("click", async () => {
    setBusy(true);
    try {
      const result = await call<ProjectAction>("RemoveProjectPhoto");
      projectStatus.textContent = result.message;
      if (!result.done) return;
      hasSavedPhoto = false;
      setOriginal();
      restoreDraft(undefined, recommendations.preferences());
      status.textContent = "";
    } catch {
      projectStatus.textContent = "无法移除项目照片，请重试。";
    } finally {
      setBusy(false);
    }
  });
}
