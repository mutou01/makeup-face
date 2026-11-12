# 真人照片口红试妆

[工作台](../../frontend/src/photo-preview.ts)用用户选择的照片取代原先的内置卡通头像。「分析面部」将 WebView2 解码后的照片绘制到长边至多 1024 像素的工作画布；[本机分析](../../frontend/src/face-analysis.ts)在这张画布上运行 MediaPipe Face Landmarker，最多检测两张脸。缺少模型、未检测到脸、检测到多张脸或唇部轮廓无效时保留原图。姿态、遮挡和跨人群准确性尚未验收。

[唇部遮罩](../../frontend/src/lipstick.ts)按 [MediaPipe 的唇部关键点拓扑](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarks_connections.ts)用外唇减去内唇。[合成](../../frontend/src/makeup-preview.ts)总是从工作原图重算；关闭口红或强度归零时恢复唇区像素，[腮红](blush-preview.md)不受影响。最大强度仍保留部分原唇纹理。

运行 `npm run setup:face-model` 将固定版本运行组件和模型装入本机 `%LOCALAPPDATA%/MakeupMirror/face-runtime/v1`。也可用 `--model <本机文件>` 从已下载文件安装。资产来源、版本、长度和哈希由[清单](../../face-runtime.json)固定；[资源服务](../../face_runtime.go)只提供白名单内通过哈希验证的文件。模型和运行组件不嵌入 EXE，运行时不会从网络获取。当前只验证本机使用，完整分发许可待核。

`npm run verify` 用真实 WebView2、可控照片与外部模型夹具验证选图、模型缺失、单人、无人、多人、颜色、强度和唇区像素不变量。真人测试可设置 `MAKEUPMIRROR_REAL_PHOTO`、`MAKEUPMIRROR_REAL_FACE_DIR`（绝对路径）以及 `MAKEUPMIRROR_REAL_LIP_BOUNDS`（人工标注的左、上、右、下归一化坐标），再运行 `npm run test:desktop`。真人照仅在本机用于验收，仓库和 CI 不含样张。

2026-11-12 本机使用 [NASA 真人肖像 S99-00858](https://commons.wikimedia.org/wiki/File:Commander_Eileen_Collins_-_GPN-2000-001177.jpg) 验收。原始文件 SHA-256 为 `752846bd7bc6496b66ee4aebf1799635b676ba15b2c06adb6cf7be6da1eb91bb`；人工范围为 `0.37,0.265,0.48,0.318`。实际 WebView2 与真实模型生成 819 × 1024 工作画布；范围内变化 821 像素，范围外 0；关闭后像素相同，页面未观察到外部 HTTP 请求。这是一张样本的验证，不能据此推断姿态、遮挡或人群覆盖率。
