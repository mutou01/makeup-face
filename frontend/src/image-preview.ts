type ImageSettings = {
  endpoint: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  warning?: string;
};

type Method = "GetSettings" | "SaveSettings" | "ForgetKey";

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
