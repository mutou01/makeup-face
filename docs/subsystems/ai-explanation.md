# 可选 AI 解释

默认关闭。可在「AI 解释设置」填写一个支持聊天补全的 HTTPS 接口（完整地址以 `/chat/completions` 结尾）、模型编号和密钥。保存设置和打开工作台不发外部请求。

[本机设置](../../internal/provider/settings.go)位于 `%LOCALAPPDATA%/MakeupMirror/provider.json`，仅存启用状态、接口、模型和凭据引用。密钥由 [Windows 凭据管理器](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords)保存，不写入项目或设置文件、不回填。密钥绑定到原接口，更换接口需要重新填写；「清除已保存密钥」同时关闭 AI 解释。

`make verify` 的桌面测试在临时目录和内存凭据库验收默认关闭、拒绝 HTTP、保存后不回填、更换接口保护和清除密钥。正式构建使用 Windows 凭据库，测试不会写入用户的真实凭据。
