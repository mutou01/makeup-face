# MakeupMirror 使用手册

当前交付为 Windows amd64 应用骨架。启动后可以看到产品名和中文使用说明。导入照片、推荐和调整妆容仍在 [MVP 计划](requirements-mvp.md)中。

1. 安装 Windows WebView2、Go 1.26.11 或兼容的新版本和 Node.js 24。
2. 在项目根目录运行 `npm run setup` 安装锁定的依赖，运行 `npm run build` 构建。
3. 双击 `dist/MakeupMirror.exe`，或运行 `npm start`。当前版本没有照片存储、AI 设置或需要用户配置的环境变量。

应用缺少 WebView2 时，按 [Microsoft 指引](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)安装运行时。验收需要能够启动桌面应用的 Windows 会话，使用 `npm run verify`。测试程序、正式构建和本机资源的区别见[桌面启动说明](subsystems/desktop.md)。
