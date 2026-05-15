# Protocol Endpoint Contract 规范

归属：`packages/realtime-protocol`
代码范围：`apps/realtime-worker/src/api`、`packages/realtime-protocol/src`
状态：active
验证：受影响的 worker API 测试和 protocol 测试

Endpoint contract 文档只描述对外有意义的行为：

- method 和 path
- query 参数
- request body
- response body
- WebSocket subprotocol 或 message protocol
- 错误行为
- 兼容预期

Durable Object 存储布局等实现细节放 `docs/pulse-worker/`，除非它影响 wire contract。
