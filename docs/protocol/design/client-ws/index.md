# Client WebSocket 协议设计

归属：`packages/v2/realtime-protocol`
代码范围：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、Web client / SDK
状态：draft
验证：协议 schema、worker WS 测试、web SDK 测试

Client 侧 WebSocket 能力面：

| 协议 | Endpoint | 职责 |
| --- | --- | --- |
| `client.ws.v2` | `GET /api/v1/client/ws` | tab 级唯一 client 连接：站点全局 snapshot、media state、stream request、音频流事件 |
| `client.page.ws.v1` | `GET /api/v1/client/page/ws?canonicalUrl=...` | 单页面 presence / reading / focus 与页面 snapshot |

`client.ws.v2` 合并并替代了旧 `client.common.ws.v1` 与 `client.media.ws.v1`；旧 `/api/v1/client/media/ws` endpoint 已删除（breaking change，不保留兼容桥）。

当前已定义：

- [Client WS](./client-ws.md)
- [Client Page WS](./page.md)
- [Client 可见状态](./client.state.md)
- [Client WS Server State](./server.state.md)
- [Client Media Server State](./server.media.state.md)

## 关系

`activePages` 和 session 页面集合来自后续 page WS 的页面级 presence 聚合，不由 client WS 直接上报页面事实。Page WS 的前置依赖是同 tab 的 active client WS。
