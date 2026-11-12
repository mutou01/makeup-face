# MakeupMirror 使用手册

当前交付支持 Windows amd64、本机原图预览、单人照片试妆和本地推荐。其他功能仍在 [MVP 计划](requirements-mvp.md)中。

1. 安装 Windows WebView2、Go 1.26.11 或兼容的新版本和 Node.js 24。
2. 在项目根目录运行 `npm run setup`，再运行 `npm run setup:face-model` 安装本机试妆模型，最后运行 `npm run build` 构建。只需看原图时可跳过模型安装。
3. 双击 `dist/MakeupMirror.exe`，或运行 `npm start`。当前版本没有照片存储、AI 设置或需要用户配置的环境变量。
4. 点「选择本机照片」查看原图，支持 JPEG、PNG 和 WebP。取消或选到不合格的文件时会保留原预览。「清除预览」只移除应用中的预览，不删除文件。
5. 点「分析面部」，分别启用口红、腮红或眼影，调整各自颜色和强度。关闭一层不影响其他层，三层都关可对比相同分辨率的原图。双颊或上眼睑定位无效时只显示可用图层；模型未安装、没有检测到人脸或检测到多人时，仍可看原图。

「妆容推荐」可按场景和妆感查看三套预设及理由；切换筛选不会改动试妆。详见[推荐说明](subsystems/recommendations.md)。

应用缺少 WebView2 时，按 [Microsoft 指引](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)安装运行时。验收需要能够启动桌面应用的 Windows 会话，使用 `npm run verify`。测试程序、正式构建和本机资源的区别见[桌面启动说明](subsystems/desktop.md)。
