# 文档结构

归属：global
代码范围：`AGENTS.md`、`docs`
状态：active
验证：`find docs -type f | sort` 和旧路径残留搜索

Pulse 文档分成三个实现域和一个全局层。

## 实现域

- `docs/pulse-worker/` 归属 `apps/realtime-worker`。
- `docs/desktop-app/` 归属 `common` 和 `macosApp`。
- `docs/protocol/` 归属通信合同。

每个实现域应保留：

- `index.md`
- `architecture.md`
- `design/`
- `specs/`
- `reference/`，如果该域有当前事实、问题记录或参考材料
- `exec-plans/active/`
- `exec-plans/completed/`
- `decisions/`

实现域的操作规范、文件组织、运行方式、消息模型、兼容策略、endpoint contract 和验证门槛统一放在各自 `specs/` 目录。`design/` 只放目标方案、MVP 设计、产品结构和阶段性取舍。`reference/` 放当前事实、问题记录和参考材料。

## 全局层

- `docs/design/`：跨域设计原则。
- `docs/plans/`：跨域执行计划。
- `docs/specs/`：无单一实现归属的共享规范，也包括文档系统自身的结构、验证、诊断和清理规则。

## 文档头部

新的长期文档建议使用：

```text
归属：
代码范围：
状态：
验证：
```
