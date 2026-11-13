# 本机人脸定位

正式 Windows 版在 WebView2 中用 MediaPipe Face Landmarker 的 CPU 模式分析单张照片，工作图最长边为 1024 像素。最多检测两张脸以拦截多人。分析不访问供应商；网页策略也只允许同源资源。照片质量未通过、没有人脸、检测到多人或模型不可用时仍可看原图。

[模型驱动](../../frontend/runtime/face-driver.mjs)返回 MediaPipe 顺序的 478 个坐标和列优先的 4 × 4 姿态矩阵。通过取景、姿态、画质和唇部检查后，Go 验证网格，并把结果与当前照片绑定。显式保存用原照 SHA-256 绑定网格；重开直接恢复已保存的合法网格，包括旧版云端分析留下的网格。旧项目没有网格时可手动重新分析。正式版不再读取旧人脸供应商配置或凭据，也不会自动改写或删除它们。

## 开发与打包

- 构建正式 EXE：`npm run build`。
- 准备[锁定清单](../../face-runtime.json)中的六个资源：从清单的 Google 地址获取 `face_landmarker.task`，从官方 `@mediapipe/tasks-vision` 同版归档提取运行文件。按清单的 `source` 找到文件后，将六个文件放在同一目录。已有旧测试资源的开发机可复用校验通过的目录。
- 执行 `npm run package:offline -- <资源目录>`，生成 `dist/MakeupMirror-offline`。默认输出目录必须不存在；也可在资源目录后指定另一个新目录。打包脚本校验文件名、尺寸和 SHA-256，随包附上许可说明，不复制其他文件。正式程序从自身旁的 `face-runtime` 按同一清单校验后加载。
- 交付包应整目录解压并启动其中的 EXE；用户不用安装 Python、CUDA 或单独的模型管理器。模型、真人照片与密钥不进入 Git 或 CI。日常门禁用隔离夹具覆盖离线流程及资源篡改；真模型和授权样张在本机单独验收。

模型约 3.6 MiB，完整运行资源约 32.3 MiB。最低内存、低配机耗时、遮挡和不同拍摄条件下的准确率仍需实测。来源见 [MediaPipe 官方说明](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models)和[随包许可](../mediapipe-notices.txt)。
