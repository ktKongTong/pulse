# Protocol Endpoint Contract 规范

归属：`packages/v2/realtime-protocol`
代码范围：`apps/realtime-worker-v2/src/routes`、`packages/v2/realtime-protocol/src`
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

## Web client endpoints

| Method | Path | Protocol | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/client/session` | `client.ws.v2` | claim server session，返回 `sessionId` |
| `GET` | `/api/v1/client/ws` | `client.ws.v2` | tab 级唯一 client WS：global snapshot、media state、stream request、audio |
| `GET` | `/api/v1/client/page/ws?canonicalUrl=...` | `client.page.ws.v1` | 单页面 presence / reading / focus |

### Breaking change: client WS 合并

`client.ws.v2` 合并并替代了旧 `client.common.ws.v1` 与 `client.media.ws.v1`。旧 `GET /api/v1/client/media/ws` endpoint 已删除：

- 不保留旧 endpoint，不做双写，不做兼容桥。
- 旧 client 必须升级到 `client.ws.v2`；旧 server 不再接受 `client.common.ws.v1` / `client.media.ws.v1` hello。
- 这是 wire-level breaking change，因此升协议名到 `client.ws.v2`。

Page WS endpoint 不变；其前置依赖从 active common WS 改为 active client WS（同 tab 的 `/api/v1/client/ws`）。

## Device endpoints

| Method | Path | Protocol | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/device/ws?deviceId=...` | `device.ws.v2`（连接）+ `presence.v2` + `device.media.v1`（业务） | 统一 device WS：device session、presence/focus、media state、stream command、audio |

### Breaking change: device WS 合并

`device.ws.v2` 合并并替代了旧 `device.connection.v1`（common WS 连接协议）与 `device.media.connection.v1`（media WS 连接协议）。旧 `GET /api/v1/device/media/ws` endpoint 已删除：

- 不保留旧 endpoint，不做双写，不做兼容桥。
- `presence.v2` 和 `device.media.v1` 业务帧保持现有 shape，承载在统一 device WS 上。
- 这是 wire-level breaking change，因此升连接协议名到 `device.ws.v2`。
