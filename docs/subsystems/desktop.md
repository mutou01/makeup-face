# 桌面启动

[Go 入口](../../main.go)启动 Wails 窗口，从 EXE 内嵌资源加载 Vite 的构建输出。[前端入口](../../frontend/src/main.ts)提供[本机原图预览](photo-input.md)、[合成图口红试妆](lipstick-preview.md)和中文说明。普通构建不提供项目写入、供应商接口或调试端口。

[构建脚本](../../scripts/build-app.mjs)生成 Windows amd64 程序。真实窗口验收使用另一个带 `desktop_smoke` 标签的构建；它仅通过[测试选项](../../desktop_smoke_options.go)打开本机调试端口和独立的临时配置目录。[启动测试](../../tests/desktop.test.mjs)使用 Playwright 连接该窗口，检查可见内容，结束时停止子进程并移除临时目录。

照片验收用测试构建注入一次性的合成文件选择结果，复用真实窗口、Go 校验和预览资源流程；Windows 原生选择器的实际交互不由该注入测试覆盖。普通 EXE 不读取这个测试配置。

本机复跑：`npm run setup` 后执行 `npm run verify`。发布或手工启动只使用 `dist/MakeupMirror.exe`，不使用 `dist/MakeupMirror-smoke.exe`。业务子系统的未来边界见[架构](../architecture.md)。

2026-11-12 初始化验收：在导入模板和实现应用之前，`npm run test:desktop` 因缺少可执行文件失败。构建后，同一测试在本机 WebView2 `157.0.4341.46` 通过。把临时构建产物中的「如何开始」改名后，窗口仍能打开，但原测试因说明标题不再可见而失败；随后恢复产物。普通 EXE 约 9.49 MiB，未计系统 WebView2，也不含人脸模型。
