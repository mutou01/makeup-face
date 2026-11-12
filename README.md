# MakeupMirror

MakeupMirror 是本机妆容工作台。当前版本可以选择、校验并预览本机照片，也可以在内置合成图上试涂口红。真实照片试妆、其他妆容图层、本机项目管理和可选 AI 解释在后续 MVP 实现。

开发环境：Windows x64、系统 WebView2、Go 1.26.11 或兼容的新版本、Node.js 24。项目使用 [proj-template](https://github.com/mutou01/proj-template/tree/0cd58426f9346e81261a197d5fd72f5b5eaee19f) 的文档与门禁结构，保留[模板许可](TEMPLATE-LICENSE.txt)。

```powershell
npm run setup
npm run verify
npm start
```

`verify` 会生成 `dist/MakeupMirror.exe`，并通过独立测试构建启动真实 WebView2 窗口。已经构建时也可直接双击普通 EXE。

- [使用手册](docs/reference.md)
- [项目设计与评估方法](docs/project-brief.md)
- [需求与 MVP 验收](docs/requirements-mvp.md)
- [系统架构与桌面选型](docs/architecture.md)
- [日志与供应商设计](docs/subsystems/foundation.md)
