# MakeupMirror 使用手册

当前交付支持 Windows amd64、本机原图预览、单人照片试妆和本地推荐。其他功能仍在 [MVP 计划](requirements-mvp.md)中。

1. 试用者需要 Windows amd64 和 WebView2。开发者从源码构建时还需要 Go 1.26.11 和 Node.js 24。
2. 解压离线交付包，保留 `MakeupMirror.exe` 与同目录的 `face-runtime`。开发者可按[打包说明](subsystems/cloud-face.md)生成该目录。
3. 双击离线包中的 `MakeupMirror.exe`。本机分析无需配置账号、密钥或云端接口。
4. 点「选择本机照片」查看原图，支持 JPEG、PNG 和 WebP。取消或选到不合格的文件时会保留原预览。「清除预览」只移除应用中的预览，不删除文件。
5. 点「分析面部」，由本机 MediaPipe 定位，照片不会发送到网络。若收到[取景、姿态、曝光或清晰度提示](subsystems/face-quality.md)，可继续查看原图并按提示重拍；通过后可分别调整口红、腮红和眼影。勾选「查看原图」不改变妆容参数。

「妆容推荐」可按场景和妆感查看三套预设及理由。分析面部后可点击对应的「应用」按钮，载入可用图层的颜色和强度，再分别微调；切换筛选不会改动试妆。详见[推荐说明](subsystems/recommendations.md)。

要稍后继续试妆，请在「本机项目」选择空目录新建，导入照片并点击「保存项目」。已保存关键点的项目可离线恢复照片、妆容和偏好。旧项目若没有关键点，可先看原图，重新分析须再次确认发送。关闭会丢弃未保存改动。详见[本机项目说明](subsystems/project-workspace.md)。

点「导出预览」可将当前显示的原图或妆后图另存为 PNG。请选择新文件名；导出的 PNG 不包含原图元数据。

「移除项目照片」会清除项目中的照片副本和妆容；原件、已保存的推荐偏好以及目录内的其他文件会保留。

如需补充解释，在「AI 解释设置」填写支持聊天补全的 HTTPS 接口、模型编号和密钥，勾选启用后保存。推荐卡片会显示发送范围；点击「生成」才联系供应商。失败时仍可查看本地理由。详见[AI 解释说明](subsystems/ai-explanation.md)。

要生成整图参考，可配置「生图供应商设置」中的 HTTPS 接口，或在「本次生图供应商」选择 Codex，使用本机已登录的 ChatGPT 账号。选图后在「云端妆容参考图」选预设，核对目标后逐次确认发送。生成图可与原图并列对比，或点击「导出生图 PNG」单独保存。生成结果不会替换本机试妆。详见[生图说明](subsystems/image-preview.md)。

使用米醋时，地址填写 `https://www.micuapi.ai/v1/images/edits`，模型填写 `gpt-image-2`，密钥使用有图片编辑权限的令牌。若直连不可达，可使用已启用的 Windows 本机 HTTP 代理。Codex 支持官方 Windows 命令行和 npm 安装。

应用缺少 WebView2 时，按 [Microsoft 指引](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)安装运行时。验收需要能够启动桌面应用的 Windows 会话，使用 `npm run verify`。测试程序、正式构建和本机资源的区别见[桌面启动说明](subsystems/desktop.md)。

排查操作失败时，可在[本机诊断](subsystems/diagnostics.md)刷新本次会话记录，或手动导出不含照片、路径和凭据的 JSON。应用不会自动保存或上传诊断。
