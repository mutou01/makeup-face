type View = {
  enabled: boolean;
  endpoint: string;
  model: string;
  hasKey: boolean;
  warning?: string;
};

async function call<T>(
  method: "GetSettings" | "SaveSettings" | "ForgetKey",
  ...args: unknown[]
): Promise<T> {
  const url = "/wails/runtime.js";
  const runtime: {
    Call: { ByName: (name: string, ...args: unknown[]) => Promise<T> };
  } = await import(/* @vite-ignore */ url);
  return runtime.Call.ByName(`main.ProviderService.${method}`, ...args);
}

export function mountProviderSettings(panel: HTMLElement) {
  panel.innerHTML = `
    <h2 id="provider-title">AI 解释设置</h2>
    <p>可选功能。启用后也只有点击生成时才会联系所配置的供应商。</p>
    <form>
      <fieldset class="provider-fields" disabled>
        <label class="toggle"><input type="checkbox" id="provider-enabled" /> 启用 AI 解释</label>
        <label for="provider-endpoint">HTTPS 接口</label>
        <input id="provider-endpoint" type="text" placeholder="https://example.com/v1/chat/completions" maxlength="512" spellcheck="false" />
        <label for="provider-model">模型编号</label>
        <input id="provider-model" type="text" maxlength="100" spellcheck="false" />
        <label for="provider-key">供应商密钥</label>
        <input id="provider-key" type="password" autocomplete="off" maxlength="1024" />
        <p id="provider-key-status" class="status"></p>
        <div class="photo-actions">
          <button type="submit">保存供应商设置</button>
          <button type="button" id="provider-forget" disabled>清除已保存密钥</button>
        </div>
      </fieldset>
    </form>
    <p class="status" role="status" aria-label="供应商设置状态"></p>
  `;
  const form = panel.querySelector("form")!;
  const fields = panel.querySelector("fieldset")!;
  const enabled = panel.querySelector<HTMLInputElement>("#provider-enabled")!;
  const endpoint = panel.querySelector<HTMLInputElement>("#provider-endpoint")!;
  const model = panel.querySelector<HTMLInputElement>("#provider-model")!;
  const key = panel.querySelector<HTMLInputElement>("#provider-key")!;
  const keyStatus = panel.querySelector("#provider-key-status")!;
  const forget = panel.querySelector<HTMLButtonElement>("#provider-forget")!;
  const status = panel.querySelector('[role="status"]')!;

  function render(view: View) {
    enabled.checked = view.enabled;
    endpoint.value = view.endpoint;
    model.value = view.model;
    key.value = "";
    keyStatus.textContent = view.hasKey ? "密钥已保存" : "未保存密钥";
    forget.disabled = !view.hasKey;
  }

  function failure(error: unknown) {
    status.textContent =
      error instanceof Error ? error.message : "供应商设置未保存。";
  }

  async function run(action: () => Promise<View>, message: string) {
    fields.disabled = true;
    try {
      const view = await action();
      render(view);
      status.textContent = view.warning ? `${message}${view.warning}` : message;
    } catch (error) {
      failure(error);
    } finally {
      fields.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = {
      enabled: enabled.checked,
      endpoint: endpoint.value,
      model: model.value,
      key: key.value,
    };
    key.value = "";
    void run(() => call<View>("SaveSettings", input), "供应商设置已保存。");
  });
  forget.addEventListener("click", () => {
    key.value = "";
    void run(() => call<View>("ForgetKey"), "已清除密钥，AI 解释已关闭。");
  });
  void run(() => call<View>("GetSettings"), "");
}
