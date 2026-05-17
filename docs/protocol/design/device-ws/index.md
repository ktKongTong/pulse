# Device WebSocket 协议草案

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、`common`、`macosApp`
状态：draft
验证：协议草案；实现前需要补 schema、worker/native 测试和端到端验证

## Transport

Device 与 server 建立两条长期 WebSocket：

| WS | 职责 |
| --- | --- |
| `common WS` | device connection、presence、interaction、diagnostics、settings 等非 media 通信 |
| `media WS` | media connection、media state、stream command、audio streaming |

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
| `disconnected` | app 未启动连接，或两条 WS 都被主动关闭 |
| `connecting` | 正在建立、鉴权或重连任一必要 WS |
| `connected` | `common WS` 和 `media WS` 都已建立并完成鉴权 |
| `failed` | 任一必要 WS 建立/鉴权失败，或重连超过策略门槛 |

启动规则：

1. native app 启动后建立 `common WS`。
2. `common WS` 完成 upgrade 后，device 发送 `device.connection.v1` hello。
3. server 返回 `device.connection.v1` hello ack，确认连接级 metadata/capability/protocol negotiation，并返回 `deviceSessionId`。
4. device 建立 `media WS`。
5. `media WS` 使用与 common WS 相同的 `workspaceId/siteId/deviceId` endpoint 参数，并携带 common WS hello ack 返回的 `deviceSessionId` 建立连接。
6. `media WS` 完成 upgrade 后，device 发送 `device.media.connection.v1` hello。
7. `media WS` 完成 hello/auth/ack 后，对外状态才进入 `connected`。
8. 进入 `connected` 前，不发送正常业务 message，不启动 streaming。

允许 native 提前打开 `media WS` transport，但 `media WS` 的 hello 不能早于 common WS hello ack。

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

- `protocol` 是业务协议或连接生命周期协议。
- `type` 是该 protocol 内的消息类型。
- `payload` 只放该 `protocol/type` 的数据。
- 不使用 `family` 字段。
- 不定义 `device.common.ws.v1` 作为统一业务协议。
