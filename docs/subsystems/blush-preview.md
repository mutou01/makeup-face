# 双颊腮红

在单人照片上点「分析面部」即可使用已有模型定位双颊。腮红有独立开关、颜色与强度，换图时默认关闭。双颊定位无效时不显示腮红控件，仍可编辑其他可用图层。

[双颊遮罩](../../frontend/src/blush.ts)用眼角确定脸部方向，以双颊和轮廓关键点约束羽化椭圆的范围，并明确排除唇区。关键点编号参考 [MediaPipe 标准脸模型](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj)。[合成器](../../frontend/src/makeup-preview.ts)每次从同一张原图重算，因此关闭腮红不会改变其他层，关闭所有图层后恢复工作分辨率原图。几何遮罩不等同皮肤分割；大侧脸、遮挡和人群覆盖仍待验证。

运行 `make verify` 验证独立开关、改色、强度和区域外保真。使用[真人测试](lipstick-preview.md)时可再设置 `MAKEUPMIRROR_REAL_BLUSH_BOUNDS`：两个用分号隔开的脸颊框，每个框为左、上、右、下四个归一化坐标。

2026-11-12 在同一张 NASA 真人样张上复跑。人工框为 `0.326,0.239,0.402,0.293;0.454,0.241,0.534,0.299`；左右框分别变化 424、413 个像素，框外为 0。关闭腮红后与仅涂口红的画布逐像素一致。此结果只代表该样张。
