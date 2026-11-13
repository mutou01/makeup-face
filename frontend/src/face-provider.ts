import type { DetectedFace } from "./face-analysis";

type View = {
  endpoint: string;
  enabled: boolean;
  hasKey: boolean;
  fixture?: boolean;
};
type Method = "GetSettings" | "SaveSettings" | "ForgetKey" | "Analyze";

export type Mesh = {
  topology: "mediapipe-478-v1";
  width: number;
  height: number;
  faces: DetectedFace[];
};

async function call<T>(method: Method, ...args: unknown[]): Promise<T> {
  const url = "/wails/runtime.js";
  const bridge: {
    Call: { ByName: (name: string, ...args: unknown[]) => Promise<T> };
  } = await import(/* @vite-ignore */ url);
  return bridge.Call.ByName(`main.FaceService.${method}`, ...args);
}

export function requestFaceMesh(
  photoURL: string,
  endpoint: string,
  frame: HTMLCanvasElement,
) {
  const png = frame.toDataURL("image/png").split(",", 2)[1];
  return call<Mesh>("Analyze", photoURL, endpoint, png);
}

export function mountFaceProvider(panel: HTMLElement) {
  panel.innerHTML = `
    <h2 id="face-provider-title">云端人脸分析设置</h2>
    <p>配置一个兼容的人脸网格接口。保存设置不会发送照片。</p>
    <form>
      <fieldset class="provider-fields" disabled>
        <label for="face-endpoint">人脸网格 HTTPS 接口</label>
        <input type="text" id="face-endpoint" maxlength="512" placeholder="https://example.com/v1/face-mesh" spellcheck="false" />
        <label for="face-key">人脸分析密钥</label>
        <input type="password" id="face-key" maxlength="1024" autocomplete="off" />
        <p id="face-key-status" class="status"></p>
        <div class="photo-actions">
          <button type="submit">保存分析设置</button>
          <button type="button" id="face-forget" disabled>清除人脸分析密钥</button>
        </div>
      </fieldset>
    </form>
    <p class="status" role="status" aria-label="分析设置状态"></p>
    <dialog aria-labelledby="face-consent-title">
      <h2 id="face-consent-title">确认发送照片</h2>
      <p id="face-consent-destination"></p>
      <p>只发送当前照片的缩放副本，不附带文件名、拍摄元数据或项目内容。仅授权本次发送。</p>
      <div class="photo-actions">
        <button type="button" id="face-cancel" autofocus>取消</button>
        <button type="button" id="face-confirm">发送照片并分析</button>
      </div>
    </dialog>
  `;
  const form = panel.querySelector("form")!;
  const fields = panel.querySelector("fieldset")!;
  const endpoint = panel.querySelector<HTMLInputElement>("#face-endpoint")!;
  const key = panel.querySelector<HTMLInputElement>("#face-key")!;
  const keyStatus = panel.querySelector("#face-key-status")!;
  const forget = panel.querySelector<HTMLButtonElement>("#face-forget")!;
  const status = panel.querySelector('[role="status"]')!;
  const dialog = panel.querySelector("dialog")!;
  const destination = panel.querySelector("#face-consent-destination")!;
  let fixture = false;

  async function update(action: () => Promise<View>, message: string) {
    fields.disabled = true;
    try {
      const view = await action();
      fixture = view.fixture ?? fixture;
      endpoint.value = view.endpoint;
      keyStatus.textContent = view.hasKey ? "密钥已保存" : "未保存密钥";
      forget.disabled = !view.hasKey;
      status.textContent = message;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "无法保存分析设置。";
    } finally {
      fields.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const secret = key.value;
    key.value = "";
    void update(
      () => call<View>("SaveSettings", endpoint.value, secret),
      "分析设置已保存。",
    );
  });
  forget.addEventListener("click", () => {
    key.value = "";
    void update(() => call<View>("ForgetKey"), "已清除人脸分析密钥。");
  });
  panel
    .querySelector("#face-cancel")!
    .addEventListener("click", () => dialog.close("cancel"));
  panel
    .querySelector("#face-confirm")!
    .addEventListener("click", () => dialog.close("send"));
  void update(() => call<View>("GetSettings"), "");

  return {
    isFixture: () => fixture,
    async confirm(): Promise<string | null> {
      const view = await call<View>("GetSettings");
      if (!view.enabled)
        throw new Error("请先配置云端人脸分析接口和密钥，可继续查看原图。");
      destination.textContent = `发送至 ${view.endpoint}。`;
      dialog.returnValue = "";
      return new Promise((resolve) => {
        dialog.addEventListener(
          "close",
          () => resolve(dialog.returnValue === "send" ? view.endpoint : null),
          { once: true },
        );
        dialog.showModal();
      });
    },
  };
}
