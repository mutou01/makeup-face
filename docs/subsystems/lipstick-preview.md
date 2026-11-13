# 真人照片口红试妆

[工作台](../../frontend/src/photo-preview.ts)把照片绘制到长边最多 1024 像素的工作画布。用户确认后由[云端接口](cloud-face.md)定位，已有项目则复用保存的关键点。没有有效单人网格时保留原图。遮挡和跨人群准确性尚未验收。

[唇部遮罩](../../frontend/src/lipstick.ts)按 [MediaPipe 的唇部关键点拓扑](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarks_connections.ts)用外唇减去内唇。[合成](../../frontend/src/makeup-preview.ts)总是从工作原图重算；关闭口红或强度归零时恢复唇区像素，[腮红](blush-preview.md)不受影响。最大强度仍保留部分原唇纹理。

`npm run verify` 用真实 WebView2、可控照片与模型夹具验证选图、单人、无人、多人、颜色、强度和唇区像素不变量。可选的历史对照仅在测试构建中运行：如已有经过[清单](../../face-runtime.json)核验的组件，可设置 `MAKEUPMIRROR_REAL_PHOTO`、`MAKEUPMIRROR_REAL_FACE_DIR` 及 `MAKEUPMIRROR_REAL_LIP_BOUNDS`，再运行 `npm run test:desktop`。正式构建没有该入口；真人照不上传，也不进入仓库或 CI。

2026-11-12 本机使用 [NASA 真人肖像 S99-00858](https://commons.wikimedia.org/wiki/File:Commander_Eileen_Collins_-_GPN-2000-001177.jpg) 验收。原始文件 SHA-256 为 `752846bd7bc6496b66ee4aebf1799635b676ba15b2c06adb6cf7be6da1eb91bb`；人工范围为 `0.37,0.265,0.48,0.318`。实际 WebView2 与真实模型生成 819 × 1024 工作画布；范围内变化 821 像素，范围外 0；关闭后像素相同，页面未观察到外部 HTTP 请求。这是一张样本的验证，不能据此推断姿态、遮挡或人群覆盖率。
