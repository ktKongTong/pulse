# Client WebSocket 协议设计

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、Web client / SDK
状态：draft
验证：协议设计；落地时需要补 schema、worker/browser 测试和端到端验证

Client 侧 WebSocket 能力面：

| 协议 | Endpoint | 职责 |
| --- | --- | --- |
| `client.common.ws.v1` | `GET /api/v1/client/ws` | tab 级 common 连接、站点全局 snapshot |
| `client.page.ws.v1` | `GET /api/v1/client/page/ws?canonicalUrl=...` | 单页面 presence / reading / focus 与页面 snapshot |
| `client.media.ws.v1` | `GET /api/v1/client/media/ws` | client media observer、stream request、音频流事件 |

当前已定义：

- [Client Common WS](./common.md)
- [Client Page WS](./page.md)
- [Client Media WS](./media.md)
- [Client 可见状态](./client.state.md)
- [Client Server State](./server.state.md)
- [Client Media Server State](./server.media.state.md)

## 关系

`activePages` 和 session 页面集合来自后续 page WS 的页面级 presence 聚合，不由 common WS 直接上报页面事实。
