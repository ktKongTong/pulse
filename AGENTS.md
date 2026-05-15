# Pulse Agent 入口

这个文件只做入口地图，不承载完整架构说明。长期有效的知识必须放到
`docs/` 对应归属目录里。

## 文档归属

- `docs/pulse-worker/`
  - 归属代码：`apps/realtime-worker`
  - 负责 Worker runtime、Durable Object、React Router 页面、本地开发、Worker 测试和服务端诊断。
- `docs/desktop-app/`
  - 归属代码：`common`、`macosApp`
  - 负责 KMP 共享层、Room/SQLite、Swift Export、SwiftUI 壳层、native service、权限、构建运行和 macOS 诊断。
- `docs/protocol/`
  - 归属代码：`packages/realtime-protocol`，以及各端对协议的实现和消费。
  - 负责 wire schema、WebSocket 消息、HTTP endpoint contract、兼容策略和跨端协议变更。
- `docs/design/`、`docs/plans/`、`docs/specs/`
  - 负责跨 worker、desktop app、protocol 的全局设计、计划和共享规范。

## 开始方式

1. 先读 `docs/index.md`，判断任务归属。
2. 再读对应归属目录下的 `index.md` 和 `architecture.md`；操作规范、文件组织、消息模型、兼容策略和验证门槛优先看对应 `specs/` 目录。
3. 如果任务会改变通信格式，即使代码改动只发生在 worker 或 desktop，也必须同时查看 `docs/protocol/`。
4. 如果存在对应 `exec-plans/active/` 文档，按计划执行；如果计划已经过期，先移动或标记为历史材料。

## 硬规则

- `AGENTS.md` 保持短入口，不写长篇架构。
- `architecture.md` 只能描述当前真实架构，不能塞旧问题清单、PRD 或历史审计。
- 单域文档放到对应归属目录；跨域文档才放全局 `design/plans/specs`。
- 文档迁移必须同步修链接；旧路径残留视为文档规范失效。
- 完成任务前必须跑对应归属的验证门槛，或者明确记录为什么不能跑。
