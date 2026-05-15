# 全局规范

这里放不属于单个实现域的共享规范。

- [模块边界](./module-boundaries.md)
- [文档结构](./docs-structure.md)
- [文档验证门槛](./docs-verification-gates.md)
- [文档诊断](./docs-diagnostics.md)
- [文档清理](./docs-gardening.md)

如果文档描述当前 API、目标设计、草案或 UX 方向，不应放在 `docs/specs/`；Realtime React 相关文档已移到 `docs/design/realtime-react/`。

如果规范主要约束 worker，实现归 `docs/pulse-worker/`；如果主要约束 desktop app，实现归 `docs/desktop-app/`；如果定义 wire behavior，归 `docs/protocol/`。如果规范约束文档系统本身，归 `docs/specs/`。
