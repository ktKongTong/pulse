# Protocol 演进与兼容策略

本文档单独讨论 Pulse 的协议演进策略，不讨论具体字段本身，而讨论：

- 客户端和服务端版本不一致时如何处理
- 哪些变更可以兼容，哪些必须升版本
- SDK、wire protocol、server internal model 三层如何解耦
- 上行 HTTP ingest 和下行 realtime stream 如何分别做兼容

相关文档：

- [Client WebSocket 协议设计](../design/client-ws/index.md)
- [Device WebSocket 协议设计](../design/device-ws/index.md)

## 1. Three version layers

Pulse 需要明确区分三个不同的“版本”概念：

1. `SDK version`
   - 给前端或客户端工程依赖的库版本
   - 例如 room SDK / realtime client SDK 的 npm 版本
2. `wire protocol version`
   - 真正上网的协议版本
   - 例如：
     - `presence.v2`
     - `web.v1`
     - `realtime.ws.v2`
3. `server canonical model`
   - 服务端内部统一模型
   - 不应该直接与外部协议同名

核心原则：

```text
client sdk
  -> protocol adapter
  -> wire protocol
  -> server adapter
  -> canonical internal model
```

也就是说：

- SDK 版本不应该直接等于 wire protocol 版本
- 服务端内部模型不应该直接等于外部协议模型

## 2. Why canonical model is required

如果服务端直接把外部协议作为内部真相，那么：

- 每次 `v1 -> v2` 都会把服务端核心逻辑拖着重写
- 多协议并存时，状态会分叉
- 下游 room snapshot 无法稳定

正确做法是：

- `v1` 请求先 decode 成 canonical model
- `v2` 请求也 decode 成 canonical model
- 服务端内部永远只处理 canonical model
- 再从 canonical model encode 到下行协议

建议的内部模型命名：

- `CanonicalRoom`
- `CanonicalReader`
- `CanonicalPresence`
- `CanonicalMedia`
- `CanonicalChatMessage`

## 3. Incompatibility matrix

### 3.1 Server = v2, Client = v1

这是最常见、也必须支持一段时间的场景。

处理方式：

- 服务端继续保留旧协议入口
  - 例如 `POST /v1/...`
  - 同时新增 `POST /v2/...`
- `v1 -> canonical`
- `v2 -> canonical`

也就是：

```text
v1 client -> v1 adapter -> canonical
v2 client -> v2 adapter -> canonical
```

结论：

- 旧客户端仍可工作
- 新服务端负责向后兼容

### 3.2 Server = v1, Client = v2

旧服务端不会自动理解新协议。

正确处理只有两种：

1. `客户端回退`
   - 客户端先发现服务端只支持 `v1`
   - 自动降级发送 `v1`
2. `明确失败`
   - 如果新客户端依赖的能力只有 `v2` 才有
   - 直接返回 `unsupported_protocol`

不应该：

- 盲发 `v2`
- 靠“试试看”
- silent downgrade 到错误语义

结论：

- 旧服务端场景下，客户端负责兜底

## 4. Separate strategy for ingest and stream

上行和下行不应该用同一套协商机制。

### 4.1 Upstream ingest

上行适合用“显式版本入口”。当前已经暴露的 public path 包括：

- `POST /api/v1/web/ingest`
- `POST /api/v2/presence/ingest`
- `POST /api/v2/history/ingest`

`POST /api/v2/web/ingest` 只是未来版本示例，不是当前已暴露 endpoint。

或者 body 中显式：

```json
{
  "protocol": "web.v1"
}
```

服务端只需要：

- 识别版本
- 用对应 decoder
- 转 canonical
- 返回成功或 `unsupported_protocol`

上行不一定需要复杂握手，因为请求是离散的。

### 4.2 Downstream realtime

下行是长连接，适合显式握手协商。

推荐：

客户端通过 worker-hosted public path `GET /api/v1/realtime/ws?workspaceId=...&roomId=...` 连接后先发：

```json
{
  "type": "hello",
  "supportedProtocols": ["realtime.ws.v2"],
  "sdkVersion": "0.8.0"
}
```

服务端回：

```json
{
  "type": "hello_ack",
  "selectedProtocol": "realtime.ws.v2",
  "capabilities": {
    "presence": true,
    "chat": false,
    "multi_room": true,
    "rich_media": true
  }
}
```

后续所有消息都按 `selectedProtocol` 走。

## 5. Capability negotiation

协议版本相同，不代表能力完全一致。

例如：

- server 支持 `presence`
- 不支持 `chat`
- 或不支持 `rich_media`

所以除了版本协商，还需要 capability 协商。

建议服务端在握手或 meta 接口返回：

```json
{
  "capabilities": {
    "presence": true,
    "chat": false,
    "multi_room": true,
    "rich_media": true
  }
}
```

客户端 SDK 负责：

- 对不支持的 capability 显式失败
- 让 UI 层做降级

而不是由页面组件自己猜。

## 6. Additive vs breaking changes

### 6.1 Additive changes

以下变化通常不需要升主版本：

- 新增可选字段
- 新增扩展字段
- 新增 capability
- 新增 room type
- 新增 enum 值，但旧端有 fallback

前提：

- 客户端/服务端都忽略未知字段
- 未知 enum 值可以映射到 `unknown`
- payload 缺失字段时有默认行为

例子：

- 给 `RoomReader.media` 新增 `albumArtist`
- 新增 `collectionTitle`
- 新增 `rich_media` capability

### 6.2 Breaking changes

以下变化必须升主版本：

- 字段语义改变
- 必填字段变化
- payload 结构重排
- room 事件模型改变
- 握手流程改变
- 鉴权方式改变
- room id 规则整体改变

例子：

- `reading.progressPercent` 从 `0-100` 改成 `0-1`
- `snapshot` 改成 delta patch
- `presenceState` 从字符串改成对象
- `roomId` 命名从 `page:<url>` 改成 `presence:page:<url>`
- 合并 `client.common.ws.v1` 与 `client.media.ws.v1` 为单条 `client.ws.v2`，删除 `/api/v1/client/media/ws` endpoint：握手表改变、client 帧与 server 帧合并、旧 endpoint 不保留，属于 wire-level breaking change
- 合并 `device.connection.v1` 与 `device.media.connection.v1` 为单条 `device.ws.v2`，删除 `/api/v1/device/media/ws` endpoint：统一 hello 携带 device + presence + media capabilities，`presence.v2` / `device.media.v1` 业务帧 shape 不变但承载在统一 device WS 上，属于 wire-level breaking change

## 7. Recommended version policy for Pulse

### 7.1 Upstream

当前推荐保持两条独立写协议：

- `presence.v2`
  - 给设备
- `web.v1`
  - 给浏览器

它们独立演进，不需要同步升版本。

例如：

- 浏览器 breaking change -> `web.v2`
- 设备 breaking change -> `presence.v3`

### 7.2 Downstream

下行统一成一个可协商协议：

- `realtime.ws.v2`

### 7.3 Internal model

服务端内部只维护 canonical model。

目标：

- 上游协议可以多版本并存
- 下游协议可以多版本协商
- 服务端状态聚合逻辑保持稳定

## 8. Compatibility matrix

### New server + old client

- 服务端继续支持旧协议
- 客户端正常工作
- 可选返回 deprecation warning

### Old server + new client

- 客户端先探测服务端能力
- 若支持较低版本，则 fallback
- 若不支持，则明确失败

### Same protocol version, different capability set

- 通过 capability negotiation 区分
- SDK 负责把不支持的能力转成可理解的错误
- UI 负责降级

## 9. Discovery endpoint

建议保留一个最小 meta 接口：

`GET /api/v1/meta`

返回：

```json
{
  "serverVersion": "2026.04.09",
  "ingestProtocols": {
    "presence": ["presence.v2"],
    "web": ["web.v1"]
  },
  "streamProtocols": ["realtime.ws.v2"],
  "capabilities": {
    "presence": true,
    "chat": false,
    "multi_room": true,
    "rich_media": true
  }
}
```

这个接口的意义：

- 新客户端连旧服务端时可做 fallback
- SDK 可提前知道能力边界
- 不需要先发一轮错误请求再试错

## 10. SDK responsibility boundary

Room SDK 不能消灭协议演进问题，但可以集中处理复杂度。

SDK 应该负责：

- 握手协商
- fallback
- v1/v2 decoder/encoder
- room subscription API 兼容层
- capability gating

SDK 不应该负责：

- 决定业务语义
- 擅自吞掉 breaking mismatch
- 在 UI 层静默伪造能力可用

## 11. Recommended next step

如果继续实现，建议下一步落：

1. `GET /api/v1/meta`
2. `realtime.ws.v2` room-scoped 握手协议
3. client room sdk 的 room transport registry
4. 服务端 adapter 层显式分离：
   - `presence.v2 -> canonical`
   - `web.v1 -> canonical`
   - `canonical -> realtime.ws.v2`
