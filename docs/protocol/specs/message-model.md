# Protocol 消息模型

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol/src`
状态：active
验证：`pnpm --filter @pulse/realtime-protocol test`

Pulse WebSocket 协议使用明确的 `protocol` 字符串和 typed message envelope。每个协议族都应该记录：

- protocol identifier
- transport URL
- client-to-server messages
- server-to-client messages
- 必要标识符，例如 `workspaceId`、`roomId`、`deviceId` 或 session id
- reconnect/resume 行为
- 兼容规则

Client / device WebSocket 目标方案见 [Client WebSocket 协议设计](../design/client-ws/index.md) 和 [Device WebSocket 协议草案](../design/device-ws/index.md)；device 侧状态模型见 [Device 侧状态机](../design/device.state.md)。
