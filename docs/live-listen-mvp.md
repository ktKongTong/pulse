# Live Listen 协议说明（单房间单 DO + 可恢复流）

Live Listen 是 Pulse 的网页内一起听能力。新的协议目标是：**一个 Live Listen 房间只对应一个 Durable Object；Web Listener 只建立一条 WebSocket；Native 通过同一个房间 DO 完成控制、媒体状态上报与音频上传；Room DO 持有可恢复的 stream intent、媒体历史和 ring buffer**。

核心链路：

```text
Web Listener  <->  LiveListenRoomDO  <->  Pulse Native
```

`LiveListenRoomDO` 是唯一热路径对象。它同时负责：

```text
Web listener sessions
Native device session
Native availability
room media state
recent media history
stream desired state
stream generation
audio ring buffer
audio fan-out
progress / clock alignment
observer telemetry
```

## 1. 设计原则

### 1.1 Web Listener 单连接

Web Listener 只连接一个 WebSocket：

```text
WS /api/v1/live-listen/session?workspaceId=koft&roomId=live-listen:owner
```

语义：

```text
WS open   = 请求一起听
accepted  = listener 注册成功，server 会确保 Native 开始或恢复串流
rejected  = 当前不能一起听，server 返回原因并关闭连接
WS close  = listener 暂时断线，先进入 recovering，不立即 leave
```

Web 不需要额外发送 join、leave，不需要额外订阅 events，也不需要额外连接媒体接收通道。

### 1.2 Native 单房间连接

Native 连接同一个房间 DO：

```text
WS /api/v1/live-listen/device-session?workspaceId=koft&roomId=live-listen:owner&deviceId=owner
Authorization: Bearer <device-api-key>
```

同一条 Native WS 内：

```text
server -> JSON control frame: stream.start / stream.resume / stream.stop
native -> JSON status frame: device.hello / availability.updated / media.updated / stream.heartbeat / ack / error
native -> binary frame: audio chunk
```

Native 断线后，Room DO 不丢失 stream intent。Native 重连后通过 `device.hello` 恢复。

### 1.3 Room owns media

媒体信息不再属于某个设备全局状态，而是属于 `LiveListenRoomDO`。

Room 持有：

```text
currentMedia       当前可展示媒体
recentMedia        最近 3-5 首
mediaClock         当前播放进度和 stream 延迟估计
playbackState      playing / paused / stopped / unknown
sourceDeviceId     哪台设备最后上报
updatedAt          媒体状态更新时间
```

这样 Web 页面即使 Native 不在线，也可以展示最近听过的歌曲，而不是未知空状态。

### 1.4 Stream intent 持久化在 Room

串流是否应该运行，不由某一次 WebSocket command 决定，而由 Room 的 desired state 决定。

```ts
type StreamIntent = {
  desiredState: "stopped" | "running";
  reason: "listener-demand" | "manual-stop" | "device-unavailable";
  updatedAt: string;
};
```

只要还有 active/recovering listener，Room 的 desired state 就应该保持 `running`。Native 重连后，Room 根据 desired state 下发 `stream.resume` 或 `stream.start`。

## 2. ID 设计

### `workspaceId`

工作区 ID，用于隔离租户。

当前 MVP 默认：

```text
koft
```

### `roomId`

Live Listen 业务房间 ID。Web Listener 只需要知道这个 ID。

当前 MVP 默认：

```text
live-listen:owner
```

### `deviceId`

Native 设备 ID。Web Listener 不需要传。

当前 MVP 默认：

```text
owner
```

`deviceId` 只在 Native 连接和 Room 内部状态里出现，用于标识当前 host 设备。

### `streamId` 与 `generation`

`streamId` 标识一次房间 stream lease。

`generation` 标识同一个 stream lease 内的采集代次。

```text
streamId    stream_abc
generation 1, 2, 3...
```

规则：

```text
Native 短断并成功补发          generation 不变
Native 断太久无法补齐          generation + 1
用户全部离开后重新开始         新 streamId，generation 从 1 开始
采集源发生不可连续切换         generation + 1
```

所有 audio chunk 都必须带 `streamId + generation + seq`。

## 3. Public API

### Web Listener

```text
WS /api/v1/live-listen/session?workspaceId=koft&roomId=live-listen:owner&participantId=listener_abc&resumeToken=resume_xxx&fromSeq=120
```

query：

```text
workspaceId     optional，默认 Worker env.WORKSPACE_ID
roomId          optional，默认 live-listen:owner
participantId   optional，首次连接可省略，server 生成
resumeToken     optional，重连恢复用
streamId        optional，重连恢复指定 stream
sourceGeneration optional，重连恢复指定 generation
fromSeq         optional，请求从哪个音频 seq 补发
```

### Pulse Native

```text
WS /api/v1/live-listen/device-session?workspaceId=koft&roomId=live-listen:owner&deviceId=owner
Authorization: Bearer <device-api-key>
```

### Observer

```text
WS /api/v1/live-listen/observe?workspaceId=koft&roomId=live-listen:owner
```

### Diagnostics

可选只读 HTTP：

```text
HTTP /api/v1/live-listen/state?workspaceId=koft&roomId=live-listen:owner
```

只返回 snapshot，不改变状态，不触发 Native。

## 4. Room snapshot

协议名：

```text
live-listen.v1
```

```ts
type LiveListenSnapshot = {
  protocol: "live-listen.v1";
  workspaceId: string;
  roomId: string;
  state:
    | "offline"
    | "available"
    | "starting"
    | "live"
    | "buffering"
    | "recovering"
    | "ended"
    | "error";
  listenerCount: number;
  recoveringListenerCount: number;
  hostDeviceId?: string;
  native: LiveListenNativeState;
  availability: LiveListenAvailability;
  media: LiveListenRoomMediaState;
  stream: LiveListenStreamState;
  updatedAt: string;
  error?: { code: string; message: string };
};
```

### Native state

```ts
type LiveListenNativeState = {
  state: "offline" | "connected" | "streaming" | "reconnecting" | "failed";
  deviceId?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  lastSeenAt?: string;
  reconnectDeadlineAt?: string;
  lastError?: { code: string; message: string };
};
```

### Availability

```ts
type LiveListenAvailability =
  | {
      state: "available";
      deviceId: string;
      media?: LiveListenMedia;
      updatedAt: string;
    }
  | {
      state: "unavailable";
      reason:
        | "device_offline"
        | "live_listen_disabled"
        | "no_playable_media"
        | "capture_permission_missing"
        | "capture_permission_revoked"
        | "capture_source_unavailable"
        | "capture_source_lost"
        | "live_listen_disabled_during_stream"
        | "unsupported_app";
      message?: string;
      updatedAt: string;
    };
```

### Room media state

```ts
type LiveListenRoomMediaState = {
  current?: LiveListenMedia;
  recent: LiveListenRecentMedia[];
  playbackState: "playing" | "paused" | "stopped" | "unknown";
  clock?: LiveListenClock;
  sourceDeviceId?: string;
  updatedAt?: string;
};

type LiveListenRecentMedia = LiveListenMedia & {
  firstSeenAt: string;
  lastSeenAt: string;
  lastProgressSeconds?: number;
  sourceDeviceId?: string;
};
```

`recent` 最多保留 3-5 首。MVP 推荐 5 首。

### Stream state

```ts
type LiveListenStreamState = {
  intent: {
    desiredState: "stopped" | "running";
    reason: "listener-demand" | "manual-stop" | "device-unavailable";
    updatedAt: string;
  };
  actualState:
    | "idle"
    | "starting"
    | "streaming"
    | "buffering"
    | "native-reconnecting"
    | "stopping"
    | "failed";
  streamId?: string;
  generation?: number;
  codec: "pcm16-wav";
  latestSeq: number;
  availableFromSeq: number;
  targetLatencyMs: number;
  bufferedChunks: number;
  bufferedSeconds: number;
  lastChunkAt?: string;
  lastGap?: {
    reason: "native_reconnect_buffer_miss" | "server_ring_buffer_miss" | "generation_changed";
    streamId: string;
    generation: number;
    missingUntilSeq?: number;
    occurredAt: string;
  };
};
```

## 5. 什么时候可以请求一起听

Web 可以随时尝试建立 session WS，但 Room 只有在 availability 为 `available` 时才接受。

### 设备不在线

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.rejected",
  "reason": "device_offline",
  "snapshot": {
    "state": "offline",
    "media": {
      "recent": []
    }
  }
}
```

如果 Room 里有最近歌曲，仍随 rejected 返回：

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.rejected",
  "reason": "device_offline",
  "snapshot": {
    "state": "offline",
    "media": {
      "recent": [
        { "provider": "spotify", "title": "Song A", "artist": "Artist A", "lastSeenAt": "2026-05-03T12:00:00.000Z" },
        { "provider": "spotify", "title": "Song B", "artist": "Artist B", "lastSeenAt": "2026-05-03T11:56:00.000Z" }
      ]
    }
  }
}
```

UI 可以展示“设备离线，最近听过”。

### 设备在线但禁用 Live Listen

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.rejected",
  "reason": "live_listen_disabled",
  "snapshot": {
    "availability": {
      "state": "unavailable",
      "reason": "live_listen_disabled"
    }
  }
}
```

### 设备在线但无媒体

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.rejected",
  "reason": "no_playable_media"
}
```

### 设备在线但无法采集

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.rejected",
  "reason": "capture_permission_missing"
}
```

### 设备在线、允许请求、有可采集媒体

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.accepted",
  "participantId": "listener_abc",
  "resumeToken": "resume_xxx",
  "serverTime": "2026-05-03T12:00:00.000Z",
  "snapshot": {
    "protocol": "live-listen.v1",
    "workspaceId": "koft",
    "roomId": "live-listen:owner",
    "state": "starting",
    "listenerCount": 1,
    "recoveringListenerCount": 0,
    "availability": { "state": "available", "deviceId": "owner", "updatedAt": "2026-05-03T12:00:00.000Z" },
    "updatedAt": "2026-05-03T12:00:00.000Z"
  }
}
```

如果这是第一个 active listener，Room 设置：

```text
stream.intent.desiredState = running
stream.intent.reason = listener-demand
```

然后向 Native 下发 `stream.start` 或 `stream.resume`。

## 6. Web Listener session 协议

协议名：

```text
live-listen.session.v1
```

Session event 类型：

```ts
type LiveListenSessionEvent =
  | "session.accepted"
  | "session.rejected"
  | "session.resumed"
  | "snapshot.updated"
  | "audio.chunk"
  | "replay.miss"
  | "stream.gap"
  | "stream.transition"
  | "stream.ended"
  | "stream.error";
```

### 6.1 首次连接

```text
WS /api/v1/live-listen/session?workspaceId=koft&roomId=live-listen:owner
```

server：

1. 检查 Room availability。
2. 不可用则发送 `session.rejected` 并关闭。
3. 可用则创建 `participantId` 和 `resumeToken`。
4. 注册 listener 为 `connected`。
5. 返回 `session.accepted`。
6. 如果需要，启动或恢复 Native stream。

### 6.2 Web 短断

WS close 不等于立即 leave。

Room 将 listener 标记为 recovering：

```ts
type ListenerSession = {
  participantId: string;
  state: "connected" | "recovering" | "gone";
  socket?: WebSocket;
  joinedAt: string;
  lastSeenAt: string;
  disconnectedAt?: string;
  reconnectDeadlineAt?: string;
  lastAckSeq?: number;
};
```

推荐参数：

```text
listenerReconnectGraceMs = 15000-30000
roomEmptyGraceMs         = 10000-20000
```

在 listener reconnect grace 内：

```text
listenerCount 可以继续按 active 计算
stream.intent.desiredState 继续保持 running
Native 不停止
Room ring buffer 继续积累
```

### 6.3 Web 重连恢复

```text
WS /api/v1/live-listen/session?workspaceId=koft&roomId=live-listen:owner&participantId=listener_abc&resumeToken=resume_xxx&streamId=stream_abc&sourceGeneration=2&fromSeq=240
```

如果恢复成功：

```json
{
  "protocol": "live-listen.session.v1",
  "type": "session.resumed",
  "participantId": "listener_abc",
  "streamId": "stream_abc",
  "generation": 2,
  "requestedFromSeq": 240,
  "latestSeq": 260,
  "availableFromSeq": 231,
  "snapshot": { "protocol": "live-listen.v1", "state": "live" }
}
```

Room 随后补发 ring buffer 内缺失的 chunk。

如果无法补齐：

```json
{
  "protocol": "live-listen.session.v1",
  "type": "replay.miss",
  "streamId": "stream_abc",
  "generation": 2,
  "requestedFromSeq": 100,
  "availableFromSeq": 231,
  "latestSeq": 260
}
```

### 6.4 音频 chunk

```json
{
  "protocol": "live-listen.session.v1",
  "type": "audio.chunk",
  "workspaceId": "koft",
  "roomId": "live-listen:owner",
  "streamId": "stream_abc",
  "generation": 2,
  "seq": 241,
  "sentAt": "2026-05-03T12:00:03.000Z",
  "durationMs": 1000,
  "codec": "pcm16-wav",
  "byteLength": 192044,
  "data": "UklGR...",
  "replayed": false
}
```

Web 播放规则：

```ts
const start = Math.max(audioContext.currentTime, nextStartTime);
source.start(start);
nextStartTime = start + decodedBuffer.duration;
```

如果 `streamId` 或 `generation` 改变，Web 必须清空旧播放队列，从新 generation 重新排队。

### 6.5 Stream gap

如果 Native 或 server buffer 无法补齐，Room 发送：

```json
{
  "protocol": "live-listen.session.v1",
  "type": "stream.gap",
  "reason": "native_reconnect_buffer_miss",
  "streamId": "stream_abc",
  "generation": 2,
  "missingUntilSeq": 260,
  "nextGeneration": 3
}
```

Web 收到后：

```text
停止等待旧 chunk
清空或切分当前播放队列
等待新 generation audio.chunk
歌词和进度重新对齐
```

### 6.6 Web close 超时

如果 listener 超过 reconnect grace 仍未回来：

```text
listener.state = gone
listenerCount - 1
```

如果没有 active/recovering listener：

```text
启动 roomEmptyGraceMs
超时后 stream.intent.desiredState = stopped
server -> Native stream.stop
```

## 7. Native device session 协议

协议名：

```text
live-listen.device.v1
```

Native 连接：

```text
WS /api/v1/live-listen/device-session?workspaceId=koft&roomId=live-listen:owner&deviceId=owner
Authorization: Bearer <device-api-key>
```

### 7.1 Device hello

Native 每次连接或重连后，第一帧必须是 `device.hello`：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "device.hello",
  "deviceId": "owner",
  "sentAt": "2026-05-03T12:00:00.000Z",
  "lastStreamId": "stream_abc",
  "lastGeneration": 2,
  "lastSeq": 240,
  "capabilities": {
    "binaryAudio": true,
    "localRingBuffer": true,
    "localRingBufferSeconds": 30
  },
  "availability": {
    "state": "available",
    "media": {
      "provider": "spotify",
      "title": "For you〜月の光が降り注ぐテラス",
      "artist": "ふんわり漂う雲"
    }
  }
}
```

Room 收到后：

```text
更新 native state
更新 availability
更新 room media current/recent
如果 stream.intent.desiredState == running，则下发 stream.resume 或 stream.start
如果 desiredState == stopped，则保持 idle
```

### 7.2 Availability updated

Native 可随时上报 availability：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "availability.updated",
  "deviceId": "owner",
  "sentAt": "2026-05-03T12:00:10.000Z",
  "availability": {
    "state": "unavailable",
    "reason": "capture_permission_missing"
  }
}
```

Room 会同步更新 snapshot，并广播给 Web/Observer。

### 7.3 Media updated

Native 上报当前媒体：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "media.updated",
  "deviceId": "owner",
  "sentAt": "2026-05-03T12:00:11.000Z",
  "media": {
    "provider": "spotify",
    "title": "For you〜月の光が降り注ぐテラス",
    "artist": "ふんわり漂う雲",
    "album": "月光",
    "artworkUrl": "https://example.com/artwork.jpg",
    "durationSeconds": 218,
    "playbackState": "playing"
  },
  "clock": {
    "mediaProgressSeconds": 42,
    "observedAt": "2026-05-03T12:00:11.000Z",
    "streamLatencyMs": 3000,
    "sequence": 42
  }
}
```

Room 行为：

```text
更新 media.current
更新 playbackState
更新 clock
把新歌曲 upsert 到 media.recent
最多保留 5 首
广播 snapshot.updated
```

### 7.4 Stream start

如果需要开始新的 stream：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "command",
  "commandId": "cmd_start_1",
  "sentAt": "2026-05-03T12:00:00.000Z",
  "expiresAt": "2026-05-03T12:00:10.000Z",
  "command": {
    "type": "stream.start",
    "streamId": "stream_abc",
    "generation": 1,
    "capture": {
      "mode": "current-media-app",
      "preferredProvider": "spotify",
      "fallback": "selected"
    },
    "audio": {
      "codec": "pcm16-wav",
      "chunkDurationMs": 1000,
      "targetLatencyMs": 3000
    }
  }
}
```

### 7.5 Stream resume

如果 Native 重连，且 Room 仍然希望 stream 运行：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "command",
  "commandId": "cmd_resume_1",
  "sentAt": "2026-05-03T12:00:20.000Z",
  "expiresAt": "2026-05-03T12:00:30.000Z",
  "command": {
    "type": "stream.resume",
    "streamId": "stream_abc",
    "generation": 2,
    "fromSeq": 241,
    "audio": {
      "codec": "pcm16-wav",
      "chunkDurationMs": 1000,
      "targetLatencyMs": 3000
    }
  }
}
```

Native 行为：

```text
如果本地 ring buffer 有 fromSeq 之后的 chunk，先 flush，再继续 live
如果本地 ring buffer 不足，回复 resumed_with_gap
如果采集已经停止，回复 rejected 或 restarted
```

Ack：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "ack",
  "commandId": "cmd_resume_1",
  "status": "resumed",
  "streamId": "stream_abc",
  "generation": 2,
  "firstSeq": 241,
  "sentAt": "2026-05-03T12:00:20.100Z"
}
```

有缺口：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "ack",
  "commandId": "cmd_resume_1",
  "status": "resumed_with_gap",
  "streamId": "stream_abc",
  "generation": 3,
  "firstSeq": 260,
  "missingBeforeSeq": 260,
  "sentAt": "2026-05-03T12:00:20.100Z"
}
```

Room 收到 `resumed_with_gap` 后发送 `stream.gap` 给 Web，并切到新 generation。

### 7.6 Native 上传音频

Native 使用 binary frame 上传音频 chunk。

二进制 frame 前必须有当前 active stream context。Room 根据当前 Native session 的 active `streamId + generation` 赋 seq。

```text
native -> LiveListenRoomDO
binary frame = one pcm16-wav chunk
```

Room 收到 binary frame 后：

```text
seq += 1
write server ring buffer
fan-out audio.chunk to Web sessions
update stream.latestSeq / availableFromSeq / lastChunkAt
emit observer telemetry
```

### 7.7 Stream heartbeat

Native 可上报采集和发送状态：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "stream.heartbeat",
  "deviceId": "owner",
  "streamId": "stream_abc",
  "generation": 2,
  "sentAt": "2026-05-03T12:00:25.000Z",
  "lastSeq": 245,
  "capture": {
    "rms": 0.12,
    "peak": 0.41,
    "queuedChunks": 2,
    "droppedChunks": 0,
    "reconnectCount": 1
  },
  "clock": {
    "mediaProgressSeconds": 56,
    "observedAt": "2026-05-03T12:00:25.000Z",
    "streamLatencyMs": 3000,
    "sequence": 56
  }
}
```

### 7.8 Stream stop

最后一个 active/recovering listener 离开并超过 room empty grace：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "command",
  "commandId": "cmd_stop_1",
  "sentAt": "2026-05-03T12:05:00.000Z",
  "expiresAt": "2026-05-03T12:05:10.000Z",
  "command": {
    "type": "stream.stop",
    "streamId": "stream_abc",
    "reason": "last_listener_disconnected"
  }
}
```

Native 收到后停止采集并清空当前 stream 的本地临时队列。

## 8. Native 断线恢复

### 8.1 Native WS close

Room 不立即停止 stream。

Room 行为：

```text
native.state = reconnecting
native.disconnectedAt = now
native.reconnectDeadlineAt = now + nativeReconnectGraceMs
stream.intent.desiredState 保持 running
stream.actualState = native-reconnecting 或 buffering
Web sessions 保持 accepted
```

推荐：

```text
nativeReconnectGraceMs = 30000-60000
nativeRingBufferSeconds = 30
```

### 8.2 Native 本地行为

Native 不应因为 WS 短断立刻停止采集。

```text
WS disconnected
capture continues
chunk enters Native local ring buffer
try reconnect with backoff
send device.hello(lastStreamId, lastGeneration, lastSeq)
wait for stream.resume / stream.stop
```

如果超过本地 grace 或 ring buffer 无法继续承载，Native 可以停止采集，但重连后必须如实报告。

### 8.3 Native 重连成功

Room 根据 desired state 决定：

```text
if desiredState == running and same stream can continue:
  send stream.resume
elif desiredState == running but cannot continue:
  send stream.start with generation + 1
else:
  send no stream command or stream.stop
```

Native 不需要等待用户重新点击，也不需要重新收到旧的 start。恢复由 Room 的 desired state 驱动。

## 9. Web 断线恢复

### 9.1 Web WS close

Room 不立即删除 listener。

```text
listener.state = recovering
listener.disconnectedAt = now
listener.reconnectDeadlineAt = now + listenerReconnectGraceMs
```

推荐：

```text
listenerReconnectGraceMs = 15000-30000
```

### 9.2 Web 重连

Web 带：

```text
participantId
resumeToken
streamId
generation
fromSeq
```

Room：

```text
验证 resumeToken
恢复 listener socket
从 server ring buffer 补发 fromSeq
如果补发失败，发送 replay.miss
```

Web 重连不应重复触发 Native start，除非这是当前唯一 listener 且 stream intent 已经 stopped。

## 10. Ring buffer

### Server ring buffer

属于 `LiveListenRoomDO`。

解决 Web 到 server 的短暂网络问题。

```text
ringBufferSeconds = 30
maxBufferedChunks = 30
```

### Native ring buffer

属于 Pulse Native。

解决 Native 到 server 的短暂网络问题。

```text
nativeRingBufferSeconds = 30
maxQueuedChunks = 30
```

### Gap 处理

任何一层 buffer miss 都必须显式上报：

```text
server_ring_buffer_miss
native_reconnect_buffer_miss
generation_changed
```

不能静默跳过，否则歌词、进度和音频会错位。

## 11. Media history

Room 保留最近 3-5 首歌曲，用于提升 Native 离线或不可请求时的 UI 表达。

### 写入规则

Native 上报 `media.updated` 或 `availability.updated` 带 media 时：

```text
if media identity 与 current 不同:
  current 写入 recent 顶部
else:
  更新 current lastSeenAt / lastProgressSeconds
recent 去重
recent 最多保留 5 首
```

media identity 推荐：

```text
provider + trackId
provider + uri
provider + title + artist + album
```

按可用字段从强到弱匹配。

### 离线展示

Native 离线时 snapshot 仍可包含：

```json
{
  "media": {
    "current": null,
    "recent": [
      { "provider": "spotify", "title": "Song A", "artist": "Artist A", "lastSeenAt": "2026-05-03T12:00:00.000Z" },
      { "provider": "spotify", "title": "Song B", "artist": "Artist B", "lastSeenAt": "2026-05-03T11:56:00.000Z" }
    ],
    "playbackState": "unknown"
  }
}
```

UI 可以展示：

```text
设备离线
最近听过：Song A / Song B / Song C
```

而不是空白或未知。


## 12. 运行中权限变化与音频切换

### 12.1 Native 运行中关闭 Live Listen

如果 Native 正在串流时用户关闭 Live Listen、撤销采集权限、关闭采集源，或 Native 主动停止允许推送，这不是普通网络断线，也不是可恢复 reconnect。

Native 必须立即发送 `availability.updated`：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "availability.updated",
  "deviceId": "owner",
  "sentAt": "2026-05-03T12:10:00.000Z",
  "availability": {
    "state": "unavailable",
    "reason": "live_listen_disabled",
    "message": "Live Listen was disabled on the device."
  }
}
```

如果当前存在 active stream，Native 还应发送 `stream.stopped`：

```json
{
  "protocol": "live-listen.device.v1",
  "type": "stream.stopped",
  "streamId": "stream_abc",
  "generation": 2,
  "reason": "live_listen_disabled",
  "sentAt": "2026-05-03T12:10:00.000Z"
}
```

Room 收到后必须：

```text
availability = unavailable
stream.intent.desiredState = stopped
stream.actualState = stopped 或 failed
停止接受当前 generation 的 audio chunk
保留 media.current 和 media.recent
广播 snapshot.updated
向所有 Web Listener 发送 stream.ended 或 stream.error
```

Web Listener 收到：

```json
{
  "protocol": "live-listen.session.v1",
  "type": "stream.ended",
  "reason": "live_listen_disabled",
  "message": "The host disabled Live Listen."
}
```

Web 客户端可以在本地决定如何停止播放、清空队列、展示提示或保留最近歌曲 UI。这属于客户端播放体验，不进入服务端协议。

MVP 推荐：Room 发送 `stream.ended` 后关闭 Web session WS。用户再次点击一起听时重新走 availability 判断。

### 12.2 Stop reason

```ts
type LiveListenStreamStopReason =
  | "last_listener_disconnected"
  | "live_listen_disabled"
  | "capture_permission_revoked"
  | "capture_source_lost"
  | "native_shutdown"
  | "manual_stop";
```

区别：

```text
live_listen_disabled       用户关闭 Live Listen 开关
capture_permission_missing 开始前没有权限
capture_permission_revoked 运行中权限被撤销
capture_source_lost        运行中目标 app/source 消失
native_shutdown            Native 正常退出
manual_stop                Host 主动停止当前 stream
```

### 12.3 Generation 切换

`generation` 变化表示音频连续性已经断裂，Web 不能把新旧音频直接拼接。

触发场景：

```text
Native 重连但本地 ring buffer 无法补齐
采集源发生不可连续切换
Native 重启采集 pipeline
Room 收到 resumed_with_gap
Room 决定从新 generation 恢复
```

Room 必须在新 generation 音频前发送 `stream.transition`。这个事件只描述事实：stream generation 已经变化；它不携带 UI 过渡策略。

```json
{
  "protocol": "live-listen.session.v1",
  "type": "stream.transition",
  "reason": "generation_changed",
  "streamId": "stream_abc",
  "fromGeneration": 2,
  "toGeneration": 3
}
```

随后发送新 generation 的 audio chunk：

```json
{
  "protocol": "live-listen.session.v1",
  "type": "audio.chunk",
  "streamId": "stream_abc",
  "generation": 3,
  "seq": 1,
  "codec": "pcm16-wav",
  "data": "UklGR..."
}
```

Web 客户端收到 generation 变化事实后，应在本地决定播放队列、歌词和进度条如何切换。是否做平滑过渡、冻结歌词、展示 buffering，都属于客户端体验策略，不进入服务端协议。

### 12.4 Gap 与 transition 的关系

如果只是 server ring buffer miss，但 stream generation 仍连续：

```text
Room -> replay.miss
Web -> 从最新 seq 继续，必要时短暂 buffering
```

如果 Native buffer miss 或 generation 改变：

```text
Room -> stream.gap
Room -> stream.transition
Web -> 本地处理播放队列和展示过渡
```

`stream.gap` 描述数据缺口；`stream.transition` 描述 generation 变化事实。客户端负责决定如何展示这个变化。

## 12. 状态机

```text
offline
  -> available     Native connected and availability=available

available
  -> starting      first Web Listener accepted
  -> offline       Native disconnected and no recoverable session

starting
  -> live          Native ack stream.start and audio chunks arrive
  -> buffering     Native disconnected during startup but within grace
  -> available     all listeners leave before stream starts
  -> error         Native rejected or start timeout

live
  -> buffering     Native disconnected or Web audio queue waiting for chunks
  -> recovering    Native reconnecting but desiredState still running
  -> available     all listeners gone and stream.stop completed
  -> error         unrecoverable stream failure

buffering
  -> live          chunks resume
  -> recovering    Native still disconnected but within grace
  -> error         buffer/reconnect timeout

recovering
  -> live          Native resumed without gap
  -> live          Native restarted with new generation and Web accepted gap
  -> error         Native reconnect timeout

error
  -> available     Native reports available again
  -> offline       Native offline
```

## 13. 成本与部署

Live Listen 热路径只使用一个 `LiveListenRoomDO`。

不再把一次一起听拆成多个同时活跃的 DO，是为了减少：

```text
DO 实例数
跨 DO 消息转发
音频 chunk 重复序列化
状态一致性协调
调试复杂度
```

当前 MVP 约束：

```text
单 host
单 room
少量 listener
1 秒 audio chunk
3-5 秒可接受延迟
不做服务端转码
```

因此最短链路是：

```text
Native -> LiveListenRoomDO -> Web
```

只有未来出现以下需求时，再考虑拆媒体 DO：

```text
一个房间 listener 数量超过单 DO fan-out 能力
需要多 region relay
需要 server-side transcode/mix
需要多个 Native producer
需要把音频传输迁移到非 WebSocket 协议
```

## 14. Observer telemetry

Observer 连接：

```text
WS /api/v1/live-listen/observe?workspaceId=koft&roomId=live-listen:owner
```

示例：

```json
{
  "protocol": "live-listen.observe.v1",
  "type": "telemetry",
  "snapshot": {
    "workspaceId": "koft",
    "roomId": "live-listen:owner",
    "state": "live",
    "listenerCount": 2,
    "recoveringListenerCount": 0,
    "nativeState": "streaming",
    "availability": { "state": "available", "deviceId": "owner" },
    "streamId": "stream_abc",
    "generation": 2,
    "latestSeq": 129,
    "availableFromSeq": 100,
    "bufferedChunks": 30,
    "bytesIn": 24581632,
    "bytesOut": 49163264,
    "chunksIn": 129,
    "chunksOut": 258,
    "replayChunks": 3,
    "replayMisses": 0,
    "lastChunkBytes": 192044,
    "lastChunkAt": "2026-05-03T12:00:03.000Z"
  }
}
```

Observer 不计入 listener，不影响 start/stop。

## 15. 角色视角

### Web Listener

只做：

```text
connect session WS
receive accepted / rejected
receive snapshot.updated
receive audio.chunk
reconnect with participantId + resumeToken + fromSeq
close session WS
```

### Pulse Native

只做：

```text
connect device-session WS
send device.hello
report availability
report media.updated
receive stream.start / stream.resume / stream.stop
send binary audio chunk
send stream.heartbeat
keep local ring buffer during short disconnect
```

### LiveListenRoomDO

负责：

```text
accept/reject listener
recover listener
track native session
hold room media state
hold recent media history
hold stream intent
send start/resume/stop
receive binary audio
assign seq
generation management
server ring buffer
fan-out audio
emit gap/replay/miss
observer telemetry
```

## 16. MVP 验收标准

新协议通过，当满足：

- Web 点击“一起听”只建立一个 session WS。
- 设备离线、禁用、无媒体、无采集权限时，Web 收到 `session.rejected`。
- rejected response 仍可携带最近 3-5 首歌曲。
- 设备可用时，Web 收到 `session.accepted` 和 `resumeToken`。
- Web 短断后在 grace 内用 `participantId + resumeToken + fromSeq` 恢复。
- Native 连接后第一帧发送 `device.hello`。
- Native 短断时 Room 保持 `stream.intent.desiredState = running`。
- Native 重连后 Room 自动下发 `stream.resume` 或新 generation 的 `stream.start`。
- Native 不需要重新等待用户点击或旧的一次性 start command。
- Native 本地 ring buffer 可补发短断期间 chunk。
- buffer miss 时 Room 明确发送 `stream.gap` 或 `replay.miss`。
- Room 持有 current media、clock、recent media history。
- Live Listen 热路径只需要一个 `LiveListenRoomDO`。
