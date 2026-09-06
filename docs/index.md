# Pulse 文档入口

Pulse 文档按“归属 owner”组织。每个实现域根目录只保留入口和当前架构；文件组织、运行方式、验证门槛和稳定约束放各自 `specs/`；设计方案放 `design/`；执行计划和决策记录放对应目录。全局目录只放跨域内容。

## 实现域

- [Pulse Worker](./pulse-worker/index.md)
  - 归属代码：`apps/realtime-worker`
  - 负责 Worker runtime、Durable Object、React Router 页面、本地开发、Worker 测试和服务端诊断。
- [Desktop App](./desktop-app/index.md)
  - 归属代码：`common`、`macosApp`
  - 负责 KMP 共享层、Room/SQLite、Swift Export、SwiftUI 壳层、native service、权限和 macOS 构建调试。
- [Protocol](./protocol/index.md)
  - 归属代码：`packages/realtime-protocol` 以及各端协议实现。
  - 负责 wire schema、endpoint contract、WebSocket 消息、兼容策略和跨端协议变更。

## 全局目录

- [Design](./design/index.md)
  - 跨 worker、desktop app、protocol 的产品和工程设计原则。
- [Plans](./plans/index.md)
  - 跨多个归属域的执行计划。
- [Specs](./specs/index.md)
  - 不属于单个实现域的共享规范，包括 agent 工作流、文档结构、验证门槛、诊断和文档清理。

## 当前主要文档

- [模块边界](./specs/module-boundaries.md)
- [Realtime React 当前 API](./reference/realtime-react/current-api.md)
- [Realtime React 目标 API](./design/realtime-react/target-api.md)
- [Realtime Worker 当前状态](./pulse-worker/reference/realtime-current-state.md)
- [Device 侧状态机设计](./protocol/design/device.state.md)
- [Device WebSocket 协议草案](./protocol/design/device-ws/index.md)
- [Client WebSocket 协议设计](./protocol/design/client-ws/index.md)
- [协议兼容策略](./protocol/specs/compatibility.md)
- [PulseBar 菜单栏与主面板交互设计](./desktop-app/design/menubar-panel-ux.md)
- [macOS App 重构 PRD（历史草案）](./desktop-app/design/mac-app-rebuild-prd.md)
- [Windows 双进程架构决策](./desktop-app/decisions/windows-dual-process-architecture.md)
- [.NET ↔ Kotlin/JVM IPC Flow 语义验证结论](./dotnet-kotlin-ipc.md)

## 新文档头部

新的长期文档建议用下面四项开头：

```text
归属：
代码范围：
状态：
验证：
```

`状态` 使用 `active`、`draft` 或 `superseded`。如果文档描述目标设计而不是当前实现，必须在第一段明确写出。
