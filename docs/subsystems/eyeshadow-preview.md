# 上眼睑眼影

在单人照片上点击「分析面部」，眼影与口红、腮红共用一次[云端定位](cloud-face.md)的结果，并在本机合成。眼影独立开关、改色和调强度；双眼定位不充分时隐藏眼影，保留可用图层。

[眼影遮罩](../../frontend/src/eyeshadow.ts)使用 [MediaPipe 的上眼睑和下眉缘关键点](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarks_connections.ts)。眼角确定局部方向，上眼睑向眉缘一侧生成羽化色带，并在两条边界留出间距；眼角逐渐淡出。眼影不进入口红、腮红遮罩。[合成器](../../frontend/src/makeup-preview.ts)从同一张工作原图重算，关闭眼影不会改变其他两层，关闭所有妆容则恢复工作原图。这是基于关键点的几何近似，未用遮挡或大侧脸样本校准。

`make verify` 在真实桌面窗口验证三层开关、眼影调色和强度、眼球和眉毛的保护点以及遮罩之外的像素。使用[真人测试](lipstick-preview.md)时设置 `MAKEUPMIRROR_REAL_EYESHADOW_BOUNDS` 为两个用分号隔开的上眼睑框，每个框是左、上、右、下的归一化坐标。真人样张和模型权重不提交。

2026-11-12 在同一张 NASA 样张上复跑。人工框为 `0.359,0.203,0.406,0.224;0.449,0.204,0.504,0.227`；框内分别变化 37、38 个像素，框外为 0。关闭眼影后与仅开启口红和腮红的画布逐像素相同。此结果只代表该样张。
