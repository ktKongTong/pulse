# Device WebSocket 协议草案

归属：`packages/v2/realtime-protocol`
代码范围：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、`common`、`macosApp`
状态：draft
验证：协议 schema、worker WS tests、KMP common compile、native/worker local integration

## Transport

Device 与 server 建立单条长期 WebSocket：

| WS | 协议 | 职责 |
| --- | --- | --- |
| `device WS` | `device.ws.v2`（连接生命周期）+ `presence.v2` + `device.media.v1`（业务） | device connection、presence、focus、media state、stream command、audio streaming |

`device.ws.v2` 合并并替代了旧 `device.connection.v1`（common WS 连接协议）与 `device.media.connection.v1`（media WS 连接协议）；旧 `/api/v1/device/media/ws` endpoint 已删除（breaking change，不保留兼容桥）。`presence.v2` 和 `device.media.v1` 业务帧保持现有 shape，只是承载在统一 device WS 上。

协议文件：

- [Device](./device.md)
- [Interaction](./interaction.md)
- [Media](./media.md)

## 连接状态

对外暴露一个 device/server 连接状态：

```ts
type DeviceServerConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed";
```

状态规则：

| 状态 | 条件 |
| --- | --- |
| `disconnected` | app 未启动连接，或 device WS 被主动关闭 |
| `connecting` | 正在建立、鉴权或重连 device WS |
| `connected` | device WS 已建立、完成 hello/hello_ack 且 listen job stable |
| `failed` | device WS 建立/鉴权失败，或重连超过策略门槛 |

启动规则：

1. native app 启动后建立 device WS（`/api/v1/device/ws?deviceId=...`）。
2. device WS 完成 upgrade 后，device 发送 `device.ws.v2` hello，同时携带 device metadata、presence capabilities、media capabilities、audio capabilities 和 supported protocols。
3. server 返回 `device.ws.v2` hello ack，确认连接级 metadata/capability/protocol negotiation，返回 `deviceSessionId` 和 media streaming capability。
4. hello ack 后，device 立即发送当前 `stream.state.updated` snapshot；如果当前存在 now playing item，也立即发送 `media.updated` snapshot。
5. device 进入 `connected` 状态后，开始 single listen job，处理 presence outbound、heartbeat、media outbound、PCM 和 server inbound command。

## Frame Envelope

文本 message 统一使用：

```ts
type DeviceWsTextFrame = {
  protocol: string;
  type: string;
  payload: unknown;
};
```

规则：

- `protocol` 是业务协议或连接生命周期协议（`device.ws.v2` / `presence.v2` / `device.media.v1`）。
- `type` 是该 protocol 内的消息类型。
- `payload` 只放该 `protocol/type` 的数据。
- server 按 `protocol` 字段分发：`presence.v2` 走 presence 逻辑，`device.media.v1` 走 media 逻辑，binary frame 走 audio 逻辑。
