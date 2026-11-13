import { prepareFaceFrame } from "./face-analysis";
import { imagePresets } from "./recommendations";

type ImageSettings = {
  endpoint: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  warning?: string;
};

type Method =
  "GetSettings" | "SaveSettings" | "ForgetKey" | "Generate" | "ExportGenerated";

async function call<T>(method: Method, ...args: unknown[]): Promise<T> {
  const url = "/wails/runtime.js";
  const bridge: {
    Call: { ByName: (name: string, ...args: unknown[]) => Promise<T> };
  } = await import(/* @vite-ignore */ url);
  return bridge.Call.ByName(`main.ImageService.${method}`, ...args);
}

export function mountImageSettings(panel: HTMLElement) {
  panel.innerHTML = `
    <h2 id="image-provider-title">生图供应商设置</h2>
    <p>使用兼容的图片编辑接口生成妆容参考图。保存设置不会发送照片。</p>
    <form>
      <fieldset class="provider-fields" disabled>
        <label for="image-endpoint">图片编辑 HTTPS 接口</label>
        <input type="text" id="image-endpoint" maxlength="512" placeholder="https://example.com/v1/images/edits" spellcheck="false" />
        <label for="image-model">生图模型编号</label>
        <input type="text" id="image-model" maxlength="100" spellcheck="false" />
        <label for="image-key">生图密钥</label>
        <input type="password" id="image-key" maxlength="1024" autocomplete="off" />
        <p id="image-key-status" class="status"></p>
        <div class="photo-actions">
          <button type="submit">保存生图设置</button>
          <button type="button" id="image-forget" disabled>清除生图密钥</button>
        </div>
      </fieldset>
    </form>
    <p class="status" role="status" aria-label="生图设置状态"></p>
  `;
  const form = panel.querySelector("form")!;
  const fields = panel.querySelector("fieldset")!;
  const endpoint = panel.querySelector<HTMLInputElement>("#image-endpoint")!;
  const model = panel.querySelector<HTMLInputElement>("#image-model")!;
  const key = panel.querySelector<HTMLInputElement>("#image-key")!;
  const keyStatus = panel.querySelector("#image-key-status")!;
  const forget = panel.querySelector<HTMLButtonElement>("#image-forget")!;
  const status = panel.querySelector('[role="status"]')!;

  async function update(action: () => Promise<ImageSettings>, message: string) {
    fields.disabled = true;
    try {
      const view = await action();
      endpoint.value = view.endpoint;
      model.value = view.model;
      keyStatus.textContent = view.hasKey ? "密钥已保存" : "未保存密钥";
      forget.disabled = !view.hasKey;
      status.textContent = view.warning ? `${message}${view.warning}` : message;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "无法保存生图设置。";
    } finally {
      fields.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const secret = key.value;
    key.value = "";
    void update(
      () =>
        call<ImageSettings>(
          "SaveSettings",
          endpoint.value,
          model.value,
          secret,
        ),
      "生图设置已保存。",
    );
  });
  forget.addEventListener("click", () => {
    key.value = "";
    void update(() => call<ImageSettings>("ForgetKey"), "已清除生图密钥。");
  });
  void update(() => call<ImageSettings>("GetSettings"), "");
}

export function mountImagePreview(
  panel: HTMLElement,
  setWorkbenchBusy: (busy: boolean) => void,
) {
  panel.innerHTML = `
    <h2 id="generated-title">云端妆容参考图</h2>
    <p>用所选照片和预设生成整图，供对照参考，不替换本机试妆。</p>
    <div class="photo-actions">
      <label for="image-preset">生图妆容预设</label>
      <select id="image-preset"></select>
      <button type="button" id="generate-image" disabled>生成妆容参考图</button>
    </div>
    <p class="status" role="status" aria-label="生图状态"></p>
    <div id="generated-comparison" hidden>
      <div class="generated-images">
        <figure><img alt="生图对比原图" /><figcaption>原图</figcaption></figure>
        <figure><img alt="生图结果" /><figcaption id="generated-caption"></figcaption></figure>
      </div>
      <div class="photo-actions"><button type="button" id="export-generated">导出生图 PNG</button></div>
    </div>
    <dialog aria-labelledby="image-consent-title">
      <h2 id="image-consent-title">确认发送照片生图</h2>
      <p id="image-consent-destination"></p>
      <p>只发送当前照片的缩放副本和所选预设的妆容描述，不发送原文件名、拍摄元数据、关键点或项目内容。仅授权本次发送。</p>
      <div class="photo-actions">
        <button type="button" id="cancel-image" autofocus>取消</button>
        <button type="button" id="confirm-image">发送照片并生成</button>
      </div>
    </dialog>
  `;
  const preset = panel.querySelector("select")!;
  for (const { id, name } of imagePresets()) preset.add(new Option(name, id));
  const generate = panel.querySelector<HTMLButtonElement>("#generate-image")!;
  const exportButton =
    panel.querySelector<HTMLButtonElement>("#export-generated")!;
  const status = panel.querySelector('[role="status"]')!;
  const comparison = panel.querySelector<HTMLElement>("#generated-comparison")!;
  const [originalImage, generatedImage] = comparison.querySelectorAll("img");
  const caption = panel.querySelector("#generated-caption")!;
  const dialog = panel.querySelector("dialog")!;
  const destination = panel.querySelector("#image-consent-destination")!;
  let source: HTMLImageElement | undefined;
  let busy = false;

  function updateButtons() {
    generate.disabled = busy || !source;
    preset.disabled = busy || !source;
    exportButton.disabled = busy || comparison.hasAttribute("hidden");
  }

  function confirm(view: ImageSettings, name: string) {
    destination.textContent = `发送至 ${view.endpoint}，使用 ${view.model} 生成「${name}」。`;
    dialog.returnValue = "";
    return new Promise<boolean>((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "send"),
        { once: true },
      );
      dialog.showModal();
    });
  }

  panel
    .querySelector("#cancel-image")!
    .addEventListener("click", () => dialog.close("cancel"));
  panel
    .querySelector("#confirm-image")!
    .addEventListener("click", () => dialog.close("send"));

  generate.addEventListener("click", async () => {
    if (!source) return;
    const selected = source;
    const id = preset.value;
    const name = preset.selectedOptions[0].text;
    setWorkbenchBusy(true);
    try {
      const view = await call<ImageSettings>("GetSettings");
      if (!view.enabled) {
        status.textContent = "请先保存生图供应商设置。";
        return;
      }
      if (!(await confirm(view, name))) return;
      status.textContent = "正在等待供应商生成…";
      const data = prepareFaceFrame(selected)
        .toDataURL("image/png")
        .split(",", 2)[1];
      const result = await call<string>(
        "Generate",
        new URL(selected.src).pathname,
        view.endpoint,
        view.model,
        id,
        data,
      );
      generatedImage.setAttribute("src", result);
      originalImage.setAttribute("src", selected.getAttribute("src")!);
      caption.textContent = `生成参考图：${name}`;
      comparison.hidden = false;
      status.textContent = "生图已完成。";
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "生成失败，可继续查看原图或上一次生成结果。";
    } finally {
      setWorkbenchBusy(false);
    }
  });

  exportButton.addEventListener("click", async () => {
    const result = generatedImage.getAttribute("src");
    if (!result || comparison.hidden) return;
    setWorkbenchBusy(true);
    status.textContent = "正在导出生图…";
    try {
      status.textContent = await call<string>("ExportGenerated", result);
    } catch {
      status.textContent = "无法导出生图，请重试。";
    } finally {
      setWorkbenchBusy(false);
    }
  });

  updateButtons();
  return {
    setBusy(value: boolean) {
      busy = value;
      updateButtons();
    },
    setPhoto(photo?: HTMLImageElement) {
      source = photo;
      comparison.hidden = true;
      generatedImage.removeAttribute("src");
      originalImage.removeAttribute("src");
      status.textContent = "";
      updateButtons();
    },
  };
}
