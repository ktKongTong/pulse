# Protocol 当前架构

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`common` 中的协议序列化、`apps/realtime-worker` 中的 endpoint 实现
状态：active
验证：protocol package 测试，以及受影响的 worker/native 测试

Pulse 协议是 native desktop、worker、browser 和 SDK consumer 之间的合同。协议必须独立于任一 runtime 文档存在。

## 分层

- Wire schema
  - versioned payload 和 websocket message。
- Endpoint contract
  - HTTP/WebSocket URL、query、request、response、错误行为。
- Runtime 投影
  - Worker DO state、desktop local state、React facade state 都是协议合同的投影，不是协议本身。

## 变更规则

任何协议变更都必须先列出受影响消费者：

- `packages/realtime-protocol`
- `apps/realtime-worker`
- `common`
- `macosApp`
- `packages/realtime-react`
