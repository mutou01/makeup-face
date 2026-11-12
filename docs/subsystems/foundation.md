# 通用模块轻量设计：日志与 AI 供应商

日志仍为轻量设计；供应商按[可选 AI 解释](ai-explanation.md)实现单一接口，不引入通用供应商平台。

## 日志

诊断输出按允许的事件定义，例如 `analysis.finished`、`render.failed`、`storage.failed`；字段只允许时间、版本、阶段、结果、错误码、粗粒度耗时。第一版仅用内存中的有限事件缓冲区或开发控制台；发布默认不自动持久化或发送，诊断导出须由用户触发。采用显式字段映射，拒绝原图、文件名、完整路径、对象 URL、脸部坐标、肤色分析、API 密钥、未经筛选的异常对象与请求正文。

Go 侧优先用标准库 [`log/slog`](https://pkg.go.dev/log/slog) 或同样的结构化输出，不引入额外日志框架。若需要诊断落盘，对照 [Pino 的结构化日志](https://github.com/pinojs/pino)和[脱敏规则](https://github.com/pinojs/pino/blob/main/docs/redaction.md)设计文件轮换和删除策略。自动测试公开的诊断输出，注入具有特征的照片名、URL、令牌，确认所有出口都不含原值。

## AI 供应商

默认使用规则和本地模板产生说明。MVP 允许一个用户配置的 HTTPS 供应商，由 Go 组装请求，业务字段只允许固定场景、用户主动选择的偏好枚举和预设编号；照片、图像 URL、关键点、遮罩、肤色分析、身份向量、项目路径和自由文本不得跨边界。启用时显示将发送的字段和目标，单次由用户触发；切换项目或关闭功能时取消在途调用。请求禁止重定向。已保存的密钥只在 Go 中读取，使用 [Windows 凭据管理器](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords)，不放项目文件、不回填界面；不可用时不持久化明文。

候选接口 `explain(ExplainInput, AbortSignal) → ExplainResult`。只展示经过长度检查的纯文本，不渲染 HTML，不改变推荐排序或图层参数。超时、无效响应或配置缺失，立即回到本地文案；MVP 不自动重试或切换供应商。参考 [LiteLLM](https://github.com/BerriAI/litellm) 的[超时](https://github.com/BerriAI/litellm-docs/blob/main/docs/proxy/timeout.md)与[回退](https://github.com/BerriAI/litellm-docs/blob/main/docs/proxy/reliability.md)边界。验收用本地假服务捕获实际请求，验证允许字段、取消、失败回退和关闭时无网络调用。
