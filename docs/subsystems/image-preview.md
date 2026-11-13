# 云端生图预览

「生图供应商设置」保存一个完整的 HTTPS 图片编辑地址，路径以 `/images/edits` 结尾，并配置模型编号和密钥。密钥保存在 Windows 凭据管理器；`image-provider.json` 仅保存设置和凭据引用，独立于人脸定位与文字解释。保存设置不发网络请求；更换地址不会沿用旧密钥。

也可在「本次生图供应商」选择 Codex。需要已安装支持图片编辑结果事件的 Codex，并通过 ChatGPT 登录。Windows 上优先查找 PATH 中的 `codex.exe`，也支持官方 npm 安装（即使 PATH 中只有 `codex.cmd`）。MakeupMirror 通过 [Codex App Server](https://developers.openai.com/codex/app-server) 的标准输入输出启动临时会话，使用当前账号的 Codex 用量。应用不读取或保存账号令牌，也不把登录态当作 HTTPS 接口的密钥。默认仍选择已配置的 HTTPS 供应商。

[桌面测试](../../tests/desktop.test.mjs)验证拒绝 HTTP、独立保存、密钥不回填和更换地址保护。测试使用隔离的内存凭据库，不写入用户真实凭据。

## 生成与对比

选图后，在「云端妆容参考图」选择一个预设。每次生成前都会显示完整接口、模型和预设；取消不发请求。用户确认后，[请求端](../../internal/provider/image.go)发送一张长边不超过 1024 像素、重编码去除元数据的 PNG 和固定预设描述，不发送文件名、关键点、项目内容或当前图层设置。密钥只用于鉴权；请求不自动重试或跟随重定向。

供应商须支持 [OpenAI 图片编辑协议](https://developers.openai.com/api/reference/resources/images/methods/edit)的单图多部分表单请求：接收 `image[]`、`model`、`prompt`、`n=1`、`size` 和 `output_format=png`，并在 `data[0].b64_json` 返回 PNG。应用按输入方向请求输出尺寸，限制等待时间、响应大小和解码尺寸，不访问供应商返回的链接。

[米醋图片编辑](https://docs.micuapi.ai/image/gpt-image)的固定地址 `https://www.micuapi.ai/v1/images/edits` 使用单文件字段 `image` 和预览质量档 `low`。该地址可使用 Windows 已启用的本机 HTTP 代理，以 HTTPS 隧道发送请求；遵循手动代理的排除列表。其他 HTTPS 供应商、图片链接和 AI 解释不走这条例外。真实改图已验证返回内嵌 PNG。网络不通、超时、密钥权限和限流分别提示；应用不展示供应商原始错误正文。

Codex 路径同样逐次确认，使用临时目录内的去元数据 PNG 和固定预设描述。会话使用只读权限，关闭终端、钩子、插件、浏览器、记忆和本机已配置的 MCP 服务器。应用只接收同一轮次的结构化图片事件，校验事件记录的唯一输入图片路径和 SHA-256，并验证有界的内嵌 PNG；不读取模型文本里的路径或链接。不自动切换供应商。临时输入由 MakeupMirror 清理，Codex 可能在自己的本机缓存中保留生成图。

Codex 未显式配置 HTTPS 代理时，应用可把 Windows 已启用且未排除 ChatGPT 的本机 HTTP 代理传给本次 Codex 进程，不修改系统设置或 Codex 配置。

生成图与原图并列显示。失败保留同一照片的上一次结果；换图、关闭项目或清除预览后会释放生成图。它是可能改变五官或背景的整图参考，不参与本机图层合成，也不自动保存进项目。可用「导出生图 PNG」按供应商返回的像素尺寸另存，不覆盖同名文件。

桌面测试用合成照片和本机模拟供应商检查实际表单、逐次确认、元数据清除、失败回退、预览失效及 PNG 导出。Codex 的桌面回归使用隔离的模拟进程，覆盖账号未登录和输入图片校验不符。真实账号验收应使用虚构或授权的样张单独运行，不在 CI 登录。单张出图验收不代表人物保真度或延迟达标。
