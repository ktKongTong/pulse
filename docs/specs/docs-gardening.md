# 文档清理

归属：global
代码范围：`docs`、`README.md`、`AGENTS.md`
状态：active
验证：旧路径残留搜索和 prompt-to-artifact 审计

文档清理的目标是让文档规范持续可用。

## 必查项

- 文档迁移后搜索旧路径。
- 搜索本机绝对路径残留，例如 `/Users/.../pulse`。
- `README.md`、`docs/README.md`、`docs/index.md` 必须互相对齐。
- `AGENTS.md` 保持短入口。
- 过期计划从 `active/` 移到 `completed/`。
- active plan 不能把已完成事项继续描述成 future work。
- 目标设计如果不是当前实现，第一段必须明确说明。
- `architecture.md` 只能描述当前架构；历史问题审计、PRD、执行计划不能放在 architecture 目录下。

## 旧路径搜索

```bash
rg -n "docs/app|docs/realtime-current-state|docs/live-listen|docs/protocol-evolution|docs/module-boundaries|docs/realtime-react"
rg -n "/Users/[^[:space:]]+/pulse" docs README.md AGENTS.md
rg -n "正在.*迁移|仍然依赖|future plan|还没实现" docs
```
