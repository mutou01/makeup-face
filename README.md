# MakeupMirror

MakeupMirror 是本机妆容工作台。当前版本支持单人照片试妆：按场景和妆感浏览三套本地推荐，一键应用后可分别调整口红、腮红和眼影。照片副本和设置可手动保存到本机项目并重开；AI 解释默认关闭，可选配置一家 HTTPS 供应商。

开发环境：Windows x64、系统 WebView2、Go 1.26.11 或兼容的新版本、Node.js 24。项目使用 [proj-template](https://github.com/mutou01/proj-template/tree/0cd58426f9346e81261a197d5fd72f5b5eaee19f) 的文档与门禁结构，保留[模板许可](TEMPLATE-LICENSE.txt)。

```powershell
npm run setup
npm run verify
npm start
```

`verify` 会生成 `dist/MakeupMirror.exe`，并通过独立测试构建启动真实 WebView2 窗口。已经构建时也可直接双击普通 EXE。

无需安装本机模型。要分析新照片，请配置[兼容的 HTTPS 人脸网格接口](docs/subsystems/cloud-face.md)，每次确认后才发送当前照片的缩放副本。已保存关键点的项目可离线重开。

可另配[云端图片编辑接口](docs/subsystems/image-preview.md)，按预设生成妆容参考图，与原图对比并单独导出。

- [使用手册](docs/reference.md)
- [项目设计与评估方法](docs/project-brief.md)
- [需求与 MVP 验收](docs/requirements-mvp.md)
- [系统架构与桌面选型](docs/architecture.md)
- [日志与供应商设计](docs/subsystems/foundation.md)
