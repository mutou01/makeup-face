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
    <p class="sample-note">支持 JPEG、PNG、WebP。照片只用于本次预览。</p>
    <div class="photo-actions">
      <button type="button" id="pick-photo">选择本机照片</button>
      <button type="button" id="clear-photo" disabled>清除预览</button>
    </div>
    <p id="photo-status" class="status" role="status"></p>
    <div id="photo-display"></div>
  `;
  const pick = section.querySelector<HTMLButtonElement>("#pick-photo")!;
  const clear = section.querySelector<HTMLButtonElement>("#clear-photo")!;
  const status = section.querySelector("#photo-status")!;
  const display = section.querySelector("#photo-display")!;

  function setBusy(busy: boolean) {
    pick.disabled = busy;
    clear.disabled = busy || display.childElementCount === 0;
  }

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
        display.replaceChildren();
        await call<boolean>("Clear");
        status.textContent = "无法显示这张照片，请换一张。";
        return;
      }
      display.replaceChildren(image);
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
      display.replaceChildren();
      status.textContent = "已清除预览。";
    } catch {
      status.textContent = "无法清除预览，请重试。";
    } finally {
      setBusy(false);
    }
  });
}
