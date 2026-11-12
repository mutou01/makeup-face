# 本机照片校验

[校验入口](../../internal/photo/validate.go)接收文件名和一个本机字节流，不打开路径、不写文件、不访问网络。文件名只用于识别扩展名；JPEG、PNG、WebP 均检查扩展名与实际格式是否一致。读取最多 15 MiB 加 1 字节，超过 15 MiB 立即拒绝。静态容器结构和尺寸通过检查后，才完整解码以排除损坏像素。像素总数上限为 2400 万。

`Inspect` 只返回实际格式和编码宽高；`Read` 额外返回同一份已验证的原始字节，避免预览时重开文件。PNG 与 WebP 的动画容器会拒绝；过大、类型不符、损坏和读失败分别返回可区分的错误，不携带原文件名或路径。

[桌面服务](../../photo_preview.go)打开原生选择器，只读取用户选定的文件。[前端预览](../../frontend/src/photo-preview.ts)只获得同源、临时的预览地址，不获得本机路径。应用只在内存持有最近一次通过校验的原图，明确[保存项目](project-workspace.md)才写照片副本；预览响应要求不缓存。取消或校验拒绝时保留原图，替换和清除后旧地址不可再读。[口红试妆](lipstick-preview.md)使用同一张由 WebView2 解码的照片生成工作画布；姿态和遮挡仍待做独立质量门禁。

依赖为 Go 标准库和固定版本的 [Go WebP 解码器](https://pkg.go.dev/golang.org/x/image/webp@v0.48.0)。动画识别依据 [PNG 规范](https://www.w3.org/TR/png-3/#apng-frame-based-animation)与 [WebP 容器规范](https://developers.google.com/speed/webp/docs/riff_container)。运行 `go test ./internal/photo`，或在 Windows 运行完整 `npm run verify`。[测试](../../internal/photo/validate_test.go)使用独立编码的合成图和人工构造的损坏输入，无真实照片；空实现曾错误拒绝有效图，也未区分超限和读取失败。
