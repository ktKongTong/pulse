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

Live Listen 的目标方案目前见 [Live Listen MVP 设计](../design/live-listen/mvp.md)；状态模型设计见 [Server 状态](../design/live-listen/server-state.md)、[Native Media 状态](../design/live-listen/native-media-state.md) 和 [Web Media 状态](../design/live-listen/web-media-state.md)。
