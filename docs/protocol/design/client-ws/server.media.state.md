# Client Media Server State

归属：`apps/realtime-worker-v2`
代码范围：`apps/realtime-worker-v2` Durable Object、`packages/v2/realtime-protocol`
状态：draft
验证：协议 schema、worker typecheck、worker WS 测试

本文描述 v2 `MediaDO` 的当前目标状态。`MediaDO` 接收 device media WS 的媒体事实，接收 `GlobalDO` 路由过来的 client `stream.request` / `stream.stop` / `ack`，并通过 `GlobalDO` 把 media `state`、stream runtime 帧和 `audio.chunk` 转发给 client tabs。`MediaDO` 不再持有 client WebSocket；client socket 由 `GlobalDO` 唯一持有。

## MediaDO Properties

```ts
type MediaDOState = {
  device: DeviceMediaConnection | null;
  deviceStreamState: DeviceStreamState | null;
  currentMedia: ClientMediaNowPlaying | null;
  streamContext: StreamContext | null;
  pendingCommand: PendingDeviceCommand | null;
  streamRequestRejectedAt?: string;
  revision: number;
  updatedAt: string;
};

type MediaDORuntime = {
  streamClients: Map<ClientTabKey, StreamClientMeta>;
  deviceSocket: WebSocket | null;
  pendingDeviceSessions: Map<WebSocket, string>;
  pendingChunk: AudioChunkMeta | null;
  buffer: RingBuffer<BufferedAudioChunk>;
};

type ClientTabKey = `${string}:${string}`;
```

## Environment

```text
MEDIA_RING_BUFFER_DURATION_MS
MEDIA_DEVICE_COMMAND_TIMEOUT_MS
MEDIA_CHUNK_STALL_TIMEOUT_MS = 10000
```

规则：

- `MEDIA_RING_BUFFER_DURATION_MS` 控制 server audio ring buffer 的保留时长。
- `MEDIA_DEVICE_COMMAND_TIMEOUT_MS` 控制 device `stream.requested` / `stream.stop` command 过期时间。
- ring buffer 容量按 `MEDIA_RING_BUFFER_DURATION_MS / chunk.durationMs` 计算，不按固定 chunk 数计算。
- `MEDIA_CHUNK_STALL_TIMEOUT_MS` 预留给后续 chunk stall 检测；当前 client-visible state 不暴露 stall/error。

## Device Media Connection

```ts
type DeviceMediaConnection = {
  connectionId: string;
  deviceId: string;
  deviceSessionId: string;
  connectedAt: string;
  capabilities: {
    streaming: boolean;
  };
};
```

来源：

- device media WS `hello` 被接受后设置。
- `deviceSessionId` 必须由 device common WS 签发且仍 active。
- device media WS close/error 后清空 `device` 和 `pendingCommand`，将已有 `deviceStreamState` / `currentMedia` 的 playback 归一为 `paused`，并广播新的 media state。
- device common WS heartbeat lease 过期后，server 主动关闭 common WS，并按同一 `deviceSessionId` 撤销 media WS；media state 归一规则与 media WS close/error 相同。
- 同一时间只保留一个 active device media WS；新 device media WS 会覆盖当前 socket。

## Device Stream State

```ts
type DeviceStreamState = {
  permission: "allow" | "disallow";
  playback: "playing" | "paused";
  capture: "capturing" | "no-capture";
  streamFormat?: StreamFormat;
  reason?: StreamBlockedReason;
  message?: string;
};
```

规则：

- `deviceStreamState` 只来自 `stream.state.updated`。
- `stream.state.updated` 会清除 `streamRequestRejectedAt`，让 source 从 rejected/disabled 状态重新按最新 device fact 派生。
- `permission/playback/capabilities` 只决定 source 是否 `ready`；它们不直接创建 stream request。

## Current Media

```ts
type ClientMediaNowPlaying = {
  current: LiveListenMedia;
  clock?: LiveListenClock;
  playback: "playing" | "paused";
  updatedAt: string;
};
```

规则：

- `currentMedia` 来自 device `media.updated`。
- now playing 变化不创建 `streamId/generation`。
- 无变化的 media fact 不应触发 revision/broadcast。

## Client Connections

MediaDO 不持有 client WebSocket。client socket 由 GlobalDO 唯一持有，MediaDO 只维护 stream client 的 tab 元数据。

`streamClients` 表示已被 server accepted 的 client tab。只有 `streamClients` 接收 audio chunk。

```ts
type StreamClientMeta = {
  sessionId: string;
  tabId: string;
  lastAckSeq?: number;
};
```

规则：

- `(sessionId, tabId)` 必须有 active client WS（由 GlobalDO 校验），MediaDO 才接受其 `stream.request`。
- client WS close/error 后，GlobalDO 调用 MediaDO `removeClientStream(sessionId, tabId)` 移除该 tab 的 stream client 身份；若已无 stream client，MediaDO 停止 device stream。
- device media WS close/error 后，MediaDO 清空 `streamClients`、`streamContext` 和 buffer，并通过 GlobalDO 广播新的 media state。
- 不保留 client stream grace；断开就不再贡献 stream requested。

## Stream Context

```ts
type StreamContext = {
  streamId: string;
  generation: number;
  latestSeq: number;
  availableFromSeq: number;
  codec: StreamCodec;
  format?: StreamFormat;
  openedAt: string;
  updatedAt: string;
};
```

字段来源：

- `streamId`：MediaDO 首次 accepted client `stream.request` 时生成。
- `generation`：初始为 `1`；device ack 可确认同一个 generation。
- `latestSeq`：有效 `audio.chunk` 到达后更新。
- `availableFromSeq`：ring buffer 当前最早 chunk seq。
- `codec/format`：优先来自 device stream state / command ack。
- `openedAt/updatedAt`：MediaDO 设置。

规则：

- `streamContext` 不是 client-visible failed/stalled 状态机。
- 当最后一个 `streamClient` 离开时，MediaDO 发送 `stream.stop` command，清空 `streamContext` 和 buffer。
- device `stream.stopped` 或 `error` 结束当前 stream，MediaDO 通过 GlobalDO 向 stream clients 投递 `stream.ended` / `stream.error`，清空 `streamClients`、`streamContext` 和 buffer。

## Pending Device Command

```ts
type PendingDeviceCommand = {
  commandId: string;
  type: "stream.requested" | "stream.stop";
  streamId?: string;
  generation?: number;
  expiresAt: string;
};
```

规则：

- 同一时间只允许一个 pending command。
- 如果 pending command 存在时还要发送新 command，视为实现冲突：关闭 device media WS，清理 pending command。
- ack 的 `commandId/type` 必须匹配 pending command；不匹配视为实现冲突，关闭 device media WS。
- `stream.requested` rejected：移除 `streamClients`，设置 `streamRequestRejectedAt`，广播 `source.state = "disabled"`。
- `stream.requested` timeout：按 rejected 处理，并关闭 device media WS。
- `stream.stop` timeout：关闭 device media WS，清理 pending command。
- command timeout 由 DO alarm 驱动。

## Source Derivation

```text
disabled:
  streamRequestRejectedAt exists

offline:
  device is null
  or deviceStreamState is null

idle:
  device exists
  and source is not disabled/offline
  and (
    device.capabilities.streaming = false
    or deviceStreamState.permission = disallow
    or deviceStreamState.playback = paused
  )

ready:
  device exists
  and device.capabilities.streaming = true
  and deviceStreamState.permission = allow
  and deviceStreamState.playback = playing
```

规则：

- 只有 `ready` 可接受 client `stream.request`。
- `disabled` 只表示 device rejected/timeout 后的不可接受状态。
- device 后续发送 `stream.state.updated` 会清除 `disabled`。

## Audio Chunk

```ts
type AudioChunkMeta = {
  streamId: string;
  generation: number;
  seq: number;
  sentAt: string;
  durationMs: number;
  byteLength: number;
  codec: StreamCodec;
};
```

规则：

- device 必须先发 JSON `audio.chunk` metadata，再紧跟 binary frame。
- binary `byteLength` 必须等于 metadata `byteLength`；不匹配时关闭 device media WS。
- MediaDO 通过 `GlobalDO.sendAudioChunk(targets, frame, bytes)` 把 audio chunk 投递给 `streamClients` 对应的 client socket；MediaDO 自身不持有 client socket。
- MediaDO 维护 ring buffer，并用实际 `durationMs` 计算容量。
- client ack 只更新对应 stream client 的消费位置；ack 不改变 stream source。
