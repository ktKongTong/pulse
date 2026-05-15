# Pulse Worker 文件组织

归属：`apps/realtime-worker`
代码范围：`apps/realtime-worker`
状态：active
验证：worker 目录移动后同步更新本文档

## 主要区域

- `apps/realtime-worker/src/api`
  - Worker API routing、request handler、Durable Object 集成和服务端状态管理。
- `apps/realtime-worker/src/api/do`
  - Durable Object 实现。
- `apps/realtime-worker/src/api/routes`
  - HTTP/WebSocket API route handler。
- `apps/realtime-worker/src/api/runtime`
  - runtime model 和 room view helper。
- `apps/realtime-worker/src/api/stats`
  - 统计查询。
- `apps/realtime-worker/src/routes`
  - React Router 页面 route module。
- `apps/realtime-worker/src/components`
  - worker-hosted UI 组件。
- `apps/realtime-worker/test`
  - Worker API 和 Durable Object 测试。

## 放置规则

- Worker runtime 状态转移放在对应 DO 或 route handler 附近。
- 可复用协议 shape 放 `packages/realtime-protocol`，不要放 worker app 内部。
- Browser-facing SDK facade 行为属于 `packages/realtime-react` 或全局 specs，除非实现就在 worker app 内。
