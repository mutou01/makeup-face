# MakeupMirror

MakeupMirror 是本机妆容工作台。当前版本支持单人照片试妆：按场景和妆感浏览三套本地推荐，一键应用后可分别调整口红、腮红和眼影。照片副本和设置可手动保存到本机项目并重开；可选 AI 解释在后续 MVP 实现。

开发环境：Windows x64、系统 WebView2、Go 1.26.11 或兼容的新版本、Node.js 24。项目使用 [proj-template](https://github.com/mutou01/proj-template/tree/0cd58426f9346e81261a197d5fd72f5b5eaee19f) 的文档与门禁结构，保留[模板许可](TEMPLATE-LICENSE.txt)。

```powershell
npm run setup
npm run setup:face-model
npm run verify
npm start
```

`verify` 会生成 `dist/MakeupMirror.exe`，并通过独立测试构建启动真实 WebView2 窗口。已经构建时也可直接双击普通 EXE。

`setup:face-model` 是一次性本机准备，只下载模型，不发送照片。应用运行时不联网取模型；缺少模型时仍可预览原图。真人样张和模型权重不随代码或 EXE 分发。

- [使用手册](docs/reference.md)
- [项目设计与评估方法](docs/project-brief.md)
- [需求与 MVP 验收](docs/requirements-mvp.md)
- [系统架构与桌面选型](docs/architecture.md)
- [日志与供应商设计](docs/subsystems/foundation.md)
