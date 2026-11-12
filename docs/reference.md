# MakeupMirror 使用手册

当前交付支持 Windows amd64、本机原图预览和内置合成图口红试妆。真实照片试妆、推荐和其他妆容图层仍在 [MVP 计划](requirements-mvp.md)中。

1. 安装 Windows WebView2、Go 1.26.11 或兼容的新版本和 Node.js 24。
2. 在项目根目录运行 `npm run setup` 安装锁定的依赖，运行 `npm run build` 构建。
3. 双击 `dist/MakeupMirror.exe`，或运行 `npm start`。当前版本没有照片存储、AI 设置或需要用户配置的环境变量。
4. 点「选择本机照片」查看原图，支持 JPEG、PNG 和 WebP。取消或选到不合格的文件时会保留原预览。「清除预览」只移除应用中的预览，不删除文件。
5. 在合成图区域勾选「启用口红」，再选颜色或拖动强度。取消勾选可对比合成原图，保留当前选色和强度。

应用缺少 WebView2 时，按 [Microsoft 指引](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)安装运行时。验收需要能够启动桌面应用的 Windows 会话，使用 `npm run verify`。测试程序、正式构建和本机资源的区别见[桌面启动说明](subsystems/desktop.md)。
