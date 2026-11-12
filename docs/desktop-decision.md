# 桌面技术决策：参考 Magpie 减少分发体积

状态：已采纳。Windows 先用 Go 1.26、Wails v3.1.0、系统 WebView2、TypeScript 和 Vite。前端初始页面用原生 TypeScript；开始开发多图层编辑器时，再按交互状态的复杂度决定是否加 React。

## 原始证据

1. 读取 `yetone/magpie` 提交 `19a698d0f9078e2ae2580f8970f808a28eecdfda`：[Go 依赖](https://github.com/yetone/magpie/blob/19a698d0f9078e2ae2580f8970f808a28eecdfda/go.mod#L23)显示 Wails v3 beta.24；[Windows 构建](https://github.com/yetone/magpie/blob/19a698d0f9078e2ae2580f8970f808a28eecdfda/Makefile#L119)用系统 WebView2 和 `CGO_ENABLED=0`；[资源入口](https://github.com/yetone/magpie/blob/19a698d0f9078e2ae2580f8970f808a28eecdfda/internal/gui/assets_embed.go#L10)用 `go:embed`。借鉴这三点，不复制其网关、遥测、自动更新或多供应商逻辑。
2. [Wails v3 路线图](https://v3.wails.io/status/)已将 v3 标为稳定版；[v3.1.0 发布说明](https://github.com/wailsapp/wails/releases/tag/v3.1.0)和 Go 模块元数据表明可固定正式版本，不跟用上游的 beta 依赖。本机 Go 满足 Go 1.26 的门槛，已查到 WebView2 `157.0.4341.46`。初始化固定含安全修复的 [Go 1.26.11](https://go.dev/doc/devel/release#go1.26.11)。
3. 通过 GitHub Release API 核对： [Magpie Windows amd64 应用](https://github.com/yetone/magpie/releases/tag/v0.1.3860)为 82.30 MiB，[Electron Windows x64 运行时压缩包](https://github.com/electron/electron/releases/tag/v45.3.1)为 151.02 MiB。两者产物类型和功能不同，只说明参考方向，不能估算 MakeupMirror 的成品体积、内存或启动时间。[Microsoft Evergreen 文档](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)说明 WebView2 可由应用共享。
4. 在本机用 Go 1.26.11、`CGO_ENABLED=0` 编译 [Wails v3.1.0 官方最小示例](https://github.com/wailsapp/wails/tree/v3.1.0/examples/plain)：`go build -trimpath -tags production -ldflags '-s -w -H=windowsgui' -o reference.exe ./examples/plain`。生成的 Windows amd64 EXE 为 9,950,720 字节（9.49 MiB），不含系统 WebView2。这证明本机构建链可用；尚未启动该示例，也没有妆容功能或模型体积数据。

## 取舍与验收

| 方案                      | 获得什么                                                                        | 为此承担什么                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Go + Wails v3 + WebView2  | 原生桌面窗口和项目选择器，Go 可嵌入页面；用户无需 Node、Python 或独立 HTTP 服务 | 系统需安装 WebView2，版本和 GPU 策略可能影响推理；维护 Go 与前端的接口。                              |
| Electron                  | 可固定 Chromium 版本，桌面端到端测试成熟；前后端都可用 TypeScript               | 随包携带运行时，包更大；应用需跟随 Electron 更新。若 WebView2 关键能力确有问题，再比较固定 Chromium。 |
| Tauri 或直接调用 WebView2 | 同样可复用系统 WebView；直接调用可减少框架层                                    | Tauri 要新增 Rust 工具链；直调需要自己处理窗口、桥接和打包。当前需求已有 Wails 可参考。               |

初始化以 **Windows 上启动构建出的真实桌面程序，看到 MakeupMirror 主窗口及中文使用说明** 为公开验收接口。先写失败测试，再导入项目模板并实现最小程序。Go 与前端构建合并进统一门禁；真实窗口用 [Playwright 连接 WebView2](https://playwright.dev/docs/webview2) 检查。Wails 会清理 WebView2 环境覆盖项，测试版通过独立构建标签和 Wails 选项设置临时配置目录与调试端口，常规构建不含该设置。

接着做 1–2 天技术试验：在 Windows 参考机实测无外网启动、从嵌入资源加载 WASM、WebGL、Worker、单张照片推理与蒙版；记录应用大小、WebView2 版本、冷启动、总进程内存及失败日志。CPU 推理仍可能依赖 WebGL。若只是显卡或策略问题，先验证支持范围；若必须改桌面壳，也保留妆容参数和前端代码，迁移以实测报告为依据。
