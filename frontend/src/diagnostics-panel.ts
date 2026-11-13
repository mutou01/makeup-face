const operations: Readonly<Record<string, string>> = {
  face_analysis: "本机人脸定位",
  project_create: "新建项目",
  project_open: "打开项目",
  project_save: "保存项目",
  project_close: "关闭项目",
  project_remove_photo: "移除项目照片",
  preview_export: "导出预览",
};
const outcomes: Readonly<Record<string, string>> = {
  success: "成功",
  failed: "失败",
  canceled: "取消",
};
const codes: Readonly<Record<string, string>> = {
  unavailable: "操作未完成",
  no_face: "未检测到人脸",
  multiple_faces: "检测到多人",
};
const durations: Readonly<Record<string, string>> = {
  under_100ms: "少于 100 毫秒",
  "100ms_to_1s": "100 毫秒至不足 1 秒",
  "1s_to_10s": "1 秒至不足 10 秒",
  "10s_or_more": "至少 10 秒",
};

type Event = {
  operation: string;
  outcome: string;
  code: string;
  durationBucket: string;
  time: string;
};

async function diagnosticsCall<T>(method: "Snapshot" | "Export"): Promise<T> {
  const runtimeURL = "/wails/runtime.js";
  const bridge: { Call: { ByName: (name: string) => Promise<T> } } =
    await import(/* @vite-ignore */ runtimeURL);
  return bridge.Call.ByName(`main.DiagnosticsService.${method}`);
}

export function mountDiagnostics(panel: HTMLElement) {
  panel.innerHTML = `
    <h2 id="diagnostics-title">本机诊断</h2>
    <p>仅在内存保留最近 32 条会话事件，不会自动保存或上传。</p>
    <div class="photo-actions">
      <button type="button" id="diagnostic-refresh">刷新诊断</button>
      <button type="button" id="diagnostic-export">导出诊断 JSON</button>
    </div>
    <p class="status" role="status"></p>
    <ol aria-label="会话诊断事件" hidden></ol>
  `;
  const refresh = panel.querySelector<HTMLButtonElement>(
    "#diagnostic-refresh",
  )!;
  const status = panel.querySelector('[role="status"]')!;
  const exportButton =
    panel.querySelector<HTMLButtonElement>("#diagnostic-export")!;
  const list = panel.querySelector("ol")!;
  refresh.addEventListener("click", async () => {
    refresh.disabled = exportButton.disabled = true;
    try {
      const snapshot = await diagnosticsCall<{ events: Event[] }>("Snapshot");
      list.replaceChildren(
        ...snapshot.events
          .slice()
          .reverse()
          .map((event) => {
            const row = document.createElement("li");
            const reason = codes[event.code];
            const stamp = new Date(event.time).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            });
            row.textContent = `${stamp} · ${operations[event.operation] ?? "其他操作"} · ${outcomes[event.outcome] ?? "未知"} · ${durations[event.durationBucket] ?? "耗时未知"}${reason ? ` · ${reason}` : ""}`;
            return row;
          }),
      );
      list.hidden = snapshot.events.length === 0;
      status.textContent = snapshot.events.length
        ? ""
        : "本次会话还没有诊断记录。";
    } catch {
      status.textContent = "无法读取诊断记录，请重试。";
    } finally {
      refresh.disabled = exportButton.disabled = false;
    }
  });
  exportButton.addEventListener("click", async () => {
    refresh.disabled = exportButton.disabled = true;
    status.textContent = "请选择诊断文件的保存位置。";
    try {
      status.textContent = await diagnosticsCall<string>("Export");
    } catch {
      status.textContent = "无法导出诊断，请重试。";
    } finally {
      refresh.disabled = exportButton.disabled = false;
    }
  });
}
