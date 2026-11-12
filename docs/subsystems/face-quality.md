# 照片质量门禁

单人照片经本机模型检测后，先检查[取景和姿态](../../frontend/src/face-quality.ts)，通过才生成妆容。未通过会保留原图，显示具体重拍建议，不能应用妆容预设。重开已分析项目也走同一门禁，不会自动修改项目文件。

在工作分辨率上，脸部关键点框距边缘至少为短边的 2%（最少 2 像素），宽高至少各 96 像素且各占相应边长的 12%。[MediaPipe 的头部转换矩阵](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#task-output)提供姿态：侧转超过 25° 或俯仰超过 20° 时拒绝；无法读取取景或姿态也会给出提示。这些是首版门槛，未用多样化样本校准，不能用于判断遮挡。

[桌面测试](../../tests/desktop.test.mjs)通过 `make verify` 覆盖太小、贴边、侧转、俯仰、姿态缺失和正常图。夹具只替换模型输出，应用真实检查和显示错误。
