# MakeupMirror 协作入口

面向用户的回复使用简体中文，文件使用 UTF-8。先读 [LESSONS.md](LESSONS.md) 和[代码标准](docs/code-standards.md)。先确认公开验收接口并写会失败的测试，再实现最小改动并回归；记录失败原因和回归结果。

1. 产品目标、非目标和验收见[项目设计](docs/project-brief.md)与[需求](docs/requirements-mvp.md)。涉及桌面壳、本机数据或 AI 出站时，先读[架构](docs/architecture.md)。
2. 涉及子系统时，先看[子系统索引](docs/subsystems/README.md)。行为或边界变化时同步更新所属文档；面向使用者的流程更新[使用手册](docs/reference.md)。
3. 统一门禁为 `npm run verify`；`make verify` 委托同一个命令。Windows CI 也运行同一门禁。未运行的检查应明确列出。

入口为 [main.go](main.go) 和 [frontend/src/main.ts](frontend/src/main.ts)，Windows amd64 产物为 `dist/MakeupMirror.exe`。当前技术栈是 Go、Wails、WebView2、TypeScript 与 Vite。业务照片、授权文件、外部模型与密钥不得进入 Git 或 CI。
