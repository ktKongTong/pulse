# Live Listen MVP

Live Listen 是 Pulse 的 audio-only 网页内一起听能力。当前 MVP 不接入 Spotify Jam，也不让 Web 端登录第三方音乐服务；音频由 Pulse Native 从 host 设备或指定 App 采集，经 Worker / Durable Object 的 WebSocket relay 发送给 Web 页面播放。

当前方向已经从 WebRTC / PartyTracks / Cloudflare Realtime 切换为 **WebSocket + Cloudflare Durable Objects relay**：以约 3-5 秒可控延迟换取更稳定的音质、更少的丢包/爆音，以及更容易观测和回放的传输链路。

本文档描述当前 MVP 的协议、状态、自动启停和模块边界，不描述最终 UI 细节，也不描述跨平台音频采集实现。

## 1. Product shape

MVP 的目标体验：

1. Web status 页面展示当前歌曲、歌词、在线状态。
2. 用户点击 `一起听`。
3. Web 向 Worker 注册 listener，并连接 `MediaRoomDO` 的 consumer WebSocket。
4. Worker 判断房间需要串流后，通过设备通道向 Pulse Native 下发 `stream.start` 请求。
5. Pulse Native 在授权允许且当前存在可采集 media 的情况下，自动选择目标音频源并开始推流。
6. Pulse Native 将捕获到的音频切成约 1 秒的可解码 chunk，通过 producer WebSocket 发送到 `MediaRoomDO`。
7. `MediaRoomDO` 将二进制音频 chunk fan-out 给所有 consumer。
8. Web 使用 Web Audio API 解码 chunk，并按 `nextStartTime` 排队播放，形成连续音频。
9. 当最后一个 listener 离开并超过 grace period 后，Worker 通知 Pulse Native 停止串流。

MVP 明确不做：

- 视频。
- 多 host 同时推流。
- listener 语音上行。
- Spotify OAuth / Web Playback SDK。
- Spotify Jam 创建或加入。
- 长期持久房间录制。
- 服务端解码、转码、混音或音频内容分析。

Spotify / Apple Music / 其他 provider 在这一版只作为 metadata 来源；音频源来自 host 设备或指定 App 的系统音频采集。

## 2. Architecture

```text
Web status page
  ├─ renders current media / lyrics / listener UI
  ├─ user clicks 一起听
  ├─ POST listener/join to LiveListenRoomDO
  ├─ opens consumer WebSocket to MediaRoomDO
  └─ decodes binary audio chunks via Web Audio API

Cloudflare Worker
  ├─ routes Live Listen HTTP APIs
  ├─ routes MediaRoom WebSocket upgrades
  ├─ authenticates device/control endpoints
  ├─ forwards room state work to LiveListenRoomDO
  └─ forwards media sockets to MediaRoomDO

LiveListenRoomDO
  ├─ owns business room snapshot
  ├─ tracks listener registry + TTL
  ├─ decides when stream is needed
  ├─ sends stream.start / stream.stop intent to device channel
  ├─ tracks host heartbeat + stream lease
  └─ broadcasts room state changes

Device channel / DeviceDO
  ├─ maintains Pulse Native control connection
  ├─ delivers server-driven stream commands
  ├─ receives device command ack/status
  └─ tolerates short reconnects without losing active stream intent

Pulse Native
  ├─ persists Live Listen permissions and auto-approve policy
  ├─ listens for stream.start / stream.stop requests
  ├─ captures selected app/system audio
  ├─ sends heartbeat + media clock to Worker
  └─ pushes encoded audio chunks to MediaRoomDO as producer

MediaRoomDO
  ├─ accepts producer and consumer WebSockets
  ├─ validates room role and connection metadata
  ├─ keeps short in-memory ring buffer for late/reconnecting consumers
  ├─ fan-outs binary audio chunks to consumers
  └─ cleans up disconnected sockets
```

`LiveListenRoomDO` owns Pulse business state: whether the room needs streaming, which Native device is responsible, how many listeners are active, and which media/clock snapshot should drive UI.

`MediaRoomDO` owns only the media relay plane: producer/consumer WebSockets, binary chunk fan-out, and short reconnect buffer. It does not understand Spotify, lyrics, commands, auth policy, or media semantics.

## 3. Protocol source

Shared TypeScript/Zod protocol lives in:

- `packages/realtime-protocol/src/live-listen-v1.ts`

It is exported from:

- `packages/realtime-protocol/src/index.ts`

Protocol names:

- `live-listen.v1`: HTTP request/response payloads, room snapshots, listener join/leave, host heartbeat.
- `live-listen.stream.v1`: room state events.
- `live-listen.device.v1`: server-to-device control commands for automatic stream start/stop.
- `live-listen.media.v1`: MediaRoom control messages and binary audio chunk metadata.

The current `ws-stream` branch has an MVP implementation before all shapes are formalized in `realtime-protocol`; this document is the target protocol for the next implementation pass.

## 4. Room snapshot

`LiveListenSnapshot` remains the UI-facing source of truth, but its `audio.transport` changes from Cloudflare Realtime to WebSocket relay.

```ts
type LiveListenSnapshot = {
  protocol: "live-listen.v1";
  roomId: string;
  workspaceId: string;
  state: "offline" | "requested" | "starting" | "live" | "draining" | "ended" | "error";
  listenerCount: number;
  hostDeviceId?: string;
  startedAt?: string;
  updatedAt: string;
  audio?: {
    transport: "cloudflare-do-websocket";
    roomId: string;
    consumerUrl: string;
    producerUrl?: string;
    codec: "audio/wav; codecs=pcm_s16le" | "audio/aac" | "audio/mpeg";
    chunkDurationMs: number;
    initialBufferMs: number;
    reconnectBufferMs: number;
  };
  media?: LiveListenMedia;
  clock?: LiveListenClock;
  stream?: {
    requestedBy?: string;
    requestedAt?: string;
    leaseExpiresAt?: string;
    hostAckAt?: string;
    producerConnectedAt?: string;
    lastChunkAt?: string;
    lastSequence?: number;
    stopAfterNoListenersAt?: string;
  };
  error?: { code: string; message: string };
};
```

`RoomSnapshot` in `realtime.v2` still describes presence/page/chat rooms. `LiveListenSnapshot` describes an audio stream room with a host device, listener registry, and media relay state.

## 5. State machine

```text
offline
  -> requested   listener/join when no active stream exists
  -> starting    host manually starts stream or server has existing auto-approved device

requested
  -> starting    stream.start command delivered to device
  -> error       no eligible device / authorization missing / command rejected
  -> offline     listener set becomes empty before device ack

starting
  -> live        producer WebSocket connected and host heartbeat healthy
  -> requested   device reconnect expected, stream intent still valid
  -> error       device rejected, capture failed, or producer failed
  -> offline     listener set empty and startup grace expired

live
  -> draining    listenerCount becomes 0
  -> requested   producer disconnects but stream lease is still valid
  -> error       capture/media plane failure reported by host
  -> ended       host/device stop accepted

draining
  -> live        listener rejoins before no-listener grace expires
  -> ended       no listeners for grace period, server sends stream.stop
  -> requested   producer disconnects during grace but listener returns

ended
  -> requested   listener/join
  -> offline     cleanup timeout

error
  -> requested   listener/join retries after cooldown
  -> offline     cleanup timeout
```

Recommended MVP timers:

- `hostHeartbeatIntervalMs`: 1000-2000ms.
- `hostHeartbeatTimeoutMs`: 8-12s.
- `startupGraceMs`: 15s.
- `noListenerGraceMs`: 15-30s.
- `deviceReconnectGraceMs`: 30-60s.
- `consumerReconnectGraceMs`: 10-20s.
- `mediaReconnectBufferMs`: 3000-5000ms.

## 6. Minimal HTTP / WebSocket API

```text
GET  /api/live-listen/state
GET  /api/live-listen/events                 # room state WebSocket
POST /api/live-listen/listener/join
POST /api/live-listen/listener/leave
POST /api/live-listen/listener/heartbeat     # optional explicit listener TTL refresh
POST /api/live-listen/host/heartbeat
POST /api/live-listen/host/stop
GET  /api/live-listen/device/connect         # Native control WebSocket
GET  /api/v1/media-room/:roomId?role=producer
GET  /api/v1/media-room/:roomId?role=consumer
```

Legacy `host/start`, PartyTracks, and Cloudflare Realtime endpoints can remain during migration, but the WebSocket relay path should be the default for Live Listen.

### `POST /api/live-listen/listener/join`

Payload: `LiveListenListenerJoinRequest`.

Behavior:

1. Registers or refreshes the listener record.
2. Increments business `listenerCount`.
3. If no active stream exists, transitions `offline -> requested`.
4. Creates or refreshes a stream lease.
5. Enqueues a `stream.start` command to the device channel when needed.
6. Returns `LiveListenSnapshot` or token-like envelope with `audio.consumerUrl`.

The response may be returned while state is `requested` or `starting`; Web should connect consumer WebSocket immediately and buffer until producer chunks arrive.

### `POST /api/live-listen/listener/leave`

Payload: `LiveListenListenerLeaveRequest`.

Behavior:

1. Removes listener when possible.
2. If `listenerCount` becomes 0, transitions `live -> draining`.
3. Schedules `stream.stop` after `noListenerGraceMs`.
4. If another listener joins before grace expires, cancels stop and transitions back to `live` or `requested`.

Because browser unload is unreliable, listener records must also expire by TTL. `leave` is best effort, not the only cleanup path.

### `POST /api/live-listen/listener/heartbeat`

Optional in MVP but recommended after automatic streaming lands.

Payload:

```ts
type LiveListenListenerHeartbeatRequest = {
  protocol: "live-listen.v1";
  workspaceId: string;
  roomId: string;
  participantId: string;
  sentAt: string;
  lastReceivedSequence?: number;
  bufferedSeconds?: number;
};
```

Used by the server to distinguish real listeners from abandoned tabs and to avoid stopping stream during short consumer WebSocket reconnects.

### `GET /api/live-listen/device/connect`

Native opens a persistent authenticated WebSocket control channel.

Query/header inputs:

- `workspaceId`
- `deviceId`
- `Authorization: Bearer <device api key>`
- optional `capabilities` in initial hello message

Server sends JSON command envelopes; Native sends JSON ack/status envelopes. This channel is control plane only. It must not carry audio bytes.

### `GET /api/v1/media-room/:roomId?role=producer|consumer`

Media WebSocket endpoint.

- `role=producer`: Pulse Native sends binary audio chunks.
- `role=consumer`: Web browser receives binary audio chunks.
- Text messages are control/status only (`ping`, `stats`, `connected`, `buffer-reset`, `producer-status`).
- Binary messages are audio chunks only.

`MediaRoomDO` should keep the media plane simple: no auth policy decisions, no metadata derivation, no long-term persistence.

## 7. Server-driven stream lifecycle

### Stream request trigger

The server requests a Native stream when all conditions are true:

1. A listener calls `listener/join` or refreshes an active listener lease.
2. `listenerCount > 0`.
3. No healthy producer is currently connected, or the stream lease is near expiry.
4. An eligible device is connected or recently reconnectable.
5. The room is not in cooldown after repeated failures.

### `stream.start` command

Server-to-device envelope:

```ts
type LiveListenDeviceCommandEnvelope = {
  protocol: "live-listen.device.v1";
  commandId: string;
  workspaceId: string;
  deviceId: string;
  roomId: string;
  sentAt: string;
  expiresAt: string;
  command: LiveListenStartStreamCommand | LiveListenStopStreamCommand;
};

type LiveListenStartStreamCommand = {
  type: "stream.start";
  reason: "listener_joined" | "listener_reconnected" | "server_recover";
  autoApprove: true;
  mediaRoom: {
    roomId: string;
    producerUrl: string;
    chunkDurationMs: number;
    codec: "audio/wav; codecs=pcm_s16le";
    targetInitialBufferMs: number;
  };
  capture: {
    mode: "current-media-app" | "app" | "system";
    preferredProvider?: "spotify" | "apple_music";
    preferredBundleId?: string;
    fallback: "system" | "reject";
  };
  streamLeaseMs: number;
};
```

Native should dedupe by `commandId` and by active `roomId`. If a stream for the same room is already running with compatible capture settings, it should respond `already_running` and continue.

### `stream.start` ack/status

Device-to-server:

```ts
type LiveListenDeviceCommandAck = {
  protocol: "live-listen.device.v1";
  commandId: string;
  workspaceId: string;
  deviceId: string;
  roomId: string;
  sentAt: string;
  status: "accepted" | "rejected" | "already_running" | "failed";
  reason?:
    | "not_authorized"
    | "auto_approve_disabled"
    | "no_media_source"
    | "capture_permission_missing"
    | "network_unavailable"
    | "internal_error";
  message?: string;
  activeSource?: {
    kind: "application" | "system";
    bundleId?: string;
    pid?: number;
    name?: string;
  };
};
```

`accepted` means Native will attempt capture and producer connection. It does not mean audio chunks are already flowing. The room becomes `live` only after producer WebSocket connects and host heartbeat/chunk status confirms progress.

### `stream.stop` command

Server-to-device:

```ts
type LiveListenStopStreamCommand = {
  type: "stream.stop";
  reason: "no_listeners" | "host_replaced" | "room_ended" | "server_shutdown";
  graceMs: number;
};
```

Native should stop capture, close producer WebSocket, flush final chunk if safe, and ack stop completion.

### Native stream status

Native sends status messages over the device control channel or `host/heartbeat`:

```ts
type LiveListenNativeStreamStatus = {
  protocol: "live-listen.device.v1";
  workspaceId: string;
  deviceId: string;
  roomId: string;
  sentAt: string;
  state: "idle" | "capturing" | "connecting" | "streaming" | "recovering" | "stopping" | "failed";
  source?: {
    kind: "application" | "system";
    bundleId?: string;
    pid?: number;
    name?: string;
  };
  producer?: {
    connected: boolean;
    url: string;
    chunksSent: number;
    bytesSent: number;
    lastSequence: number;
    lastChunkAt?: string;
    bufferedFrames?: number;
  };
  media?: LiveListenMedia;
  clock?: LiveListenClock;
  error?: { code: string; message: string };
};
```

## 8. Native authorization and auto-approve policy

Automatic server-driven streaming requires persistent local authorization on Pulse Native. The server may request streaming, but the device decides whether it is allowed.

Native must persist:

```ts
type LiveListenNativeAuthorization = {
  enabled: boolean;
  autoApproveLiveListen: boolean;
  allowedWorkspaceIds: string[];
  allowedRoomIds?: string[];
  allowedOrigins?: string[];
  capturePolicy: {
    allowCurrentMediaApp: boolean;
    allowSpecificApps: boolean;
    allowSystemAudioFallback: boolean;
    preferredBundleIds: string[];
  };
  permissionState: {
    systemAudioCapture: "unknown" | "authorized" | "denied";
    appleEvents: "unknown" | "authorized" | "denied";
  };
  updatedAt: string;
};
```

Rules:

- Native must never auto-start if `enabled=false` or `autoApproveLiveListen=false`.
- Native must reject if macOS system audio capture permission is missing.
- Native should prefer the current media provider app, e.g. Spotify, when `capture.mode="current-media-app"`.
- If the preferred app is not capturable, Native may fall back to system audio only when policy allows it.
- Authorization should survive app restart and OS reboot.
- Revoking authorization should immediately stop an active stream and reject future commands.

Storage should use the Native app's persistent local store. The existing Native preference is SQLite for durable local state; this authorization should not be a volatile in-memory flag.

## 9. Phase 2 buffering and reconnection semantics

Phase 1 的 WebSocket relay 已验证稳定性优于 WebRTC，但它只解决“正常在线传输”的音质问题。Phase 2 的目标是把短暂网络波动纳入协议：**Native 侧和 Server 侧都必须有 ring buffer**，并且所有 chunk 都必须带 `epoch + sequence`。

两层 buffer 的职责不同：

- Native ring buffer 解决 `device -> server` 的短暂断线。Native 断网时 Spotify/Apple Music 仍继续播放，Native 必须继续 capture 并把 chunk 写入本地 ring buffer，重连后补发给 server。
- Server / `MediaRoomDO` ring buffer 解决 `server -> consumer` 的短暂断线。某个 Web listener 断线时，其它 listener 仍继续收听；断线 listener 重连后从 server buffer 按自己的 cursor 补齐。

这两层不能互相替代。只有 server buffer 时，device 断网期间的音频永远没有到达 server；只有 Native buffer 时，单个 consumer 断线会影响所有 consumer 的播放策略。

### Chunk identity

每个 producer stream session 必须有稳定的 epoch 和递增 sequence：

```ts
type LiveListenProducerSession = {
  producerId: string;
  epoch: string;
  startedAt: string;
  codec: "audio/wav; codecs=pcm_s16le" | "audio/aac" | "audio/mpeg";
  sampleRate: number;
  channels: number;
  chunkDurationMs: number;
  nextSequence: number;
};

type LiveListenMediaChunkHeader = {
  protocol: "live-listen.media.v1";
  roomId: string;
  producerId: string;
  epoch: string;
  sequence: number;
  capturedAt: string;
  durationMs: number;
  payloadBytes: number;
  codec: LiveListenProducerSession["codec"];
};
```

Chunk identity is `(epoch, sequence)`.

Rules:

- `epoch` changes whenever Native starts a new capture session from scratch.
- `sequence` increments by 1 for every chunk in the same epoch.
- Reconnecting producer should keep the same epoch if local capture never stopped.
- Server must emit `stream-reset` to consumers when epoch changes.
- Server must emit `buffer-gap` when sequence continuity cannot be recovered.

MVP framing can be either:

1. one binary frame containing a small header prefix plus audio payload, or
2. JSON metadata frame followed by one binary payload frame.

Phase 2 should prefer a single framed binary message to avoid metadata/payload pairing ambiguity.

### Native ring buffer

Native ring buffer is required for device-side network interruption.

```ts
type NativeMediaRingBuffer = {
  epoch: string;
  firstSequence: number;
  nextSequence: number;
  durationMs: number;
  maxDurationMs: number;
  chunks: LiveListenBufferedChunk[];
};

type LiveListenBufferedChunk = {
  header: LiveListenMediaChunkHeader;
  data: ArrayBuffer;
};
```

Recommended Phase 2 values:

```ts
const NATIVE_RING_BUFFER_MS = 30_000;
const NATIVE_RING_BUFFER_MAX_BYTES = 16 * 1024 * 1024;
const PRODUCER_RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000];
```

Native behavior:

- While capture is active, every chunk is appended to Native ring buffer before network send.
- If producer WebSocket is connected, Native sends live chunks as usual.
- If producer WebSocket disconnects, Native keeps capturing and buffering until `NATIVE_RING_BUFFER_MS` or byte limit is reached.
- On reconnect, Native announces its buffer window before replaying chunks.
- If server asks for a sequence older than `firstSequence`, Native reports `producer-gap` and resumes from `firstSequence` or latest live position.
- If local capture stops, a future stream uses a new `epoch`; old chunks must not be mixed into the new epoch.

Producer reconnect hello:

```ts
type LiveListenProducerHello = {
  type: "producer.hello";
  protocol: "live-listen.media.v1";
  roomId: string;
  producerId: string;
  epoch: string;
  firstBufferedSequence: number;
  nextSequence: number;
  bufferedDurationMs: number;
  codec: LiveListenProducerSession["codec"];
  chunkDurationMs: number;
};
```

Server response:

```ts
type LiveListenProducerResume =
  | {
      type: "producer.resume";
      epoch: string;
      fromSequence: number;
    }
  | {
      type: "producer.reset";
      reason: "epoch_mismatch" | "server_state_lost";
    }
  | {
      type: "producer.gap";
      expectedSequence: number;
      acceptedFromSequence: number;
    };
```

Example: Native disconnects for 20s while music keeps playing.

1. Native producer socket closes.
2. Native continues capture and stores 20 chunks in local ring buffer.
3. Native reconnects with `producer.hello(firstBufferedSequence=101, nextSequence=126)`.
4. Server last received `105`, responds `producer.resume(fromSequence=106)`.
5. Native replays `106...125`, then continues live `126+`.
6. Consumers receive a delayed but continuous sequence if buffers are sufficient.

If Native buffer starts at `115` but server expected `106`, server accepts `115+` and sends `buffer-gap` to affected consumers.

### Server / MediaRoomDO ring buffer

Server ring buffer is required for consumer-side network interruption and per-listener recovery.

```ts
type MediaRoomRingBuffer = {
  roomId: string;
  epoch: string;
  firstSequence: number;
  latestSequence: number;
  durationMs: number;
  chunks: LiveListenBufferedChunk[];
};
```

Recommended Phase 2 values:

```ts
const SERVER_RING_BUFFER_MS = 10_000;
const SERVER_RING_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
```

Server behavior:

- Every accepted producer chunk is stored in the room ring buffer before fan-out.
- Each consumer has an independent cursor; one consumer reconnecting must not affect other consumers.
- On consumer connect, server compares `(epoch, lastSequence)` with its buffer window.
- If the requested sequence exists, server replays missing chunks to that consumer only.
- If the requested sequence is older than `firstSequence`, server sends `buffer-gap` to that consumer and then sends the newest buffer window.
- If epoch differs, server sends `stream-reset` to that consumer and starts from current buffer.

Consumer reconnect query:

```text
/api/v1/media-room/room-test-1?role=consumer&participantId=web-123&epoch=e1&lastSequence=421
```

Consumer ack message:

```ts
type LiveListenConsumerAck = {
  type: "consumer.ack";
  protocol: "live-listen.media.v1";
  participantId: string;
  epoch: string;
  lastReceivedSequence: number;
  lastScheduledSequence?: number;
  bufferedSeconds?: number;
  sentAt: string;
};
```

Consumer recovery messages:

```ts
type LiveListenConsumerControl =
  | {
      type: "consumer.resume";
      epoch: string;
      fromSequence: number;
    }
  | {
      type: "buffer-gap";
      epoch: string;
      expectedSequence?: number;
      firstAvailableSequence: number;
      latestSequence: number;
    }
  | {
      type: "stream-reset";
      previousEpoch?: string;
      nextEpoch: string;
      firstAvailableSequence: number;
    };
```

### Multi-consumer state management

Room state and listener state must be separate.

Room-level state says whether the stream is needed and whether producer is healthy. Listener-level state says whether a specific browser participant is connected, reconnecting, stale, or left.

```ts
type ListenerRecord = {
  participantId: string;
  state: "connected" | "reconnecting" | "stale" | "left";
  connectionId?: string;
  joinedAt: string;
  lastSeenAt: string;
  leaseExpiresAt: string;
  epoch?: string;
  lastDeliveredSequence?: number;
  lastAckedSequence?: number;
  bufferedSeconds?: number;
};
```

Counts should be explicit:

```ts
type LiveListenListenerCounts = {
  connectedListenerCount: number;
  activeListenerCount: number;
  reconnectingListenerCount: number;
};
```

Rules:

- UI `listenerCount` should represent `activeListenerCount`, not raw WebSocket count.
- Stop policy uses `activeListenerCount`.
- `connectedListenerCount` may temporarily drop while `activeListenerCount` remains positive.
- If one of multiple consumers disconnects, only that listener moves to `reconnecting`; room remains `live` for other consumers.
- If the only consumer disconnects, room may enter `draining`, but stop is delayed until listener TTL and no-listener grace both expire.
- A reconnecting listener returning with the same `participantId` resumes its cursor if possible.
- A reconnecting listener that cannot be resumed receives `buffer-gap` or `stream-reset`; other connected listeners continue uninterrupted.

Example with three listeners:

```text
A, B, C connected at sequence 500
A network drops for 5s
B and C continue receiving 501, 502, 503...
A state = reconnecting, lease still active
A reconnects with lastSequence=500
Server ring buffer contains 501+
Server replays 501+ to A only
A catches up; B/C are unaffected
```

Example where A reconnects too late:

```text
A reconnects with lastSequence=500
Server firstAvailableSequence=540
Server sends buffer-gap to A
A drops local queue, starts from newest buffer window
B/C continue uninterrupted
```

### Producer state model

```ts
type ProducerState = {
  state: "disconnected" | "connecting" | "connected" | "replaying" | "live" | "gap";
  producerId: string;
  epoch?: string;
  lastReceivedSequence?: number;
  lastReceivedAt?: string;
  nativeBuffer?: {
    firstSequence: number;
    nextSequence: number;
    durationMs: number;
  };
};
```

`MediaRoomDO` should update producer state from `producer.hello`, accepted chunks, close/error events, and resume/gap decisions.

### Consumer playback buffer

Web behavior remains:

```ts
const start = Math.max(audioContext.currentTime, nextStartTime);
source.start(start);
nextStartTime = start + decodedBuffer.duration;
```

Recommended initial buffer:

- Local/dev: 3000ms.
- WAN/mobile: 4000-5000ms.

If `nextStartTime - currentTime` drops below 500ms, UI may show `recovering` but should not disconnect immediately.

If `buffer-gap` or `stream-reset` is received, Web should:

1. stop scheduling old epoch chunks,
2. reset `nextStartTime` to `audioContext.currentTime + initialBufferSeconds`,
3. start scheduling from the new buffer window.

### Device reconnect grace

If the device control WebSocket disconnects but producer is still connected, the stream may continue. If producer disconnects but the device reconnects within `deviceReconnectGraceMs`, server should resend `stream.start` with reason `server_recover` rather than immediately ending the room.

If producer reconnects with the same epoch and sufficient Native buffer, server should recover by sequence replay. If Native cannot replay the missing range, server should mark producer state `gap` and notify consumers with `buffer-gap`.

## 10. Listener count and stop policy

Listener presence is business state owned by `LiveListenRoomDO`, not by `MediaRoomDO` socket count alone.

Rules:

- `listener/join` creates/refreshes a listener lease.
- Consumer WebSocket connect is supporting evidence, not the source of truth.
- Listener heartbeat or state subscription refresh should extend TTL.
- Browser `leave` and WebSocket close are best effort.
- Stop stream only after `listenerCount=0` for `noListenerGraceMs`.
- If a listener rejoins during grace, cancel the pending stop.

Recommended MVP values:

```ts
const LISTENER_TTL_MS = 30_000;
const LISTENER_HEARTBEAT_MS = 10_000;
const NO_LISTENER_GRACE_MS = 20_000;
```

This prevents stopping Native during page reloads, browser sleep/wake, Wi-Fi handoff, or mobile network transitions.

## 11. Media clock and lyrics sync

`LiveListenClock` aligns lyrics and progress UI with the audio users hear:

```ts
type LiveListenClock = {
  mediaProgressSeconds: number;
  observedAt: string;
  streamLatencyMs?: number;
  sequence: number;
};
```

Web computes display progress from latest clock:

```ts
const displayedProgressSeconds =
  clock.mediaProgressSeconds +
  (Date.now() - Date.parse(clock.observedAt)) / 1000 -
  (clock.streamLatencyMs ?? 4000) / 1000;
```

For the WebSocket relay path, `streamLatencyMs` should be based on:

```text
producer chunk duration
+ MediaRoomDO buffered duration sent on join
+ consumer queuedSeconds
+ decode/scheduling margin
```

MVP can use a fixed estimate around 3-5 seconds. Lyrics should follow the audio users hear, not the host device's zero-latency playback position.

## 12. Module boundaries

### Native

Native owns:

- persistent Live Listen authorization and auto-approve policy
- current media/app source selection
- macOS system/app audio capture
- audio chunking and producer WebSocket connection
- host heartbeat and stream status
- media metadata sampling
- media clock sequence

Native does not own:

- listener count
- room state fan-out
- deciding when a remote listener exists
- long-term audio storage
- Web UI state derivation

### Worker / DO

Worker owns:

- HTTP auth, origin checks, and request validation
- routing Live Listen APIs
- routing MediaRoom WebSocket upgrades
- device control command delivery
- deciding when listener demand requires stream start/stop

`LiveListenRoomDO` owns:

- room state machine
- listener registry and TTL
- stream lease
- host liveness timeout
- device stream command intent
- snapshot broadcast

`MediaRoomDO` owns:

- producer/consumer socket registry
- binary chunk fan-out
- short in-memory reconnect buffer
- socket cleanup

Worker and DO do not own:

- audio capture
- audio encoding quality decisions beyond protocol defaults
- lyric parsing
- provider-specific media control
- long-term recording

### Web

Web owns:

- user gesture before audio playback
- listener join/leave/heartbeat
- consumer WebSocket connection
- Web Audio decode and scheduling
- rendering stream state and metrics
- rendering lyrics from latency-adjusted stream clock

Web does not own:

- creating host sessions
- deciding whether Native is alive
- deriving listener count from local component state
- sending producer audio

## 13. Current implementation notes

Current `ws-stream` implementation includes:

- `MediaRoomDO` in `apps/realtime-worker/src/api/do/media-room/media-room-do.ts`.
- WebSocket route under `/api/v1/media-room/:roomId?role=producer|consumer`.
- A debug consumer page at `/media-room`.
- Status page `一起听` button using the MediaRoom consumer path.
- A Node producer script at `apps/realtime-worker/scripts/media-room-producer.mjs`.
- Pulse Native producer implementation that captures selected app/system PCM, wraps ~1 second chunks as WAV, and sends them by WebSocket.

Known gaps before automatic mode is complete:

- `listener/join` currently does not yet trigger `stream.start` to device.
- Device control channel needs a `stream.start` / `stream.stop` command path.
- Native authorization needs durable SQLite-backed storage and UI controls.
- Phase 2 needs `epoch + sequence` chunk framing.
- Phase 2 needs Native ring buffer for device-side network interruption.
- Phase 2 needs `MediaRoomDO` ring buffer for consumer-side reconnect.
- Phase 2 needs per-listener cursor / ack / reconnect state.
- Listener heartbeat / TTL refresh should be connected to the status page.
- `LiveListenSnapshot.audio` should reflect `cloudflare-do-websocket` instead of legacy Realtime fields.

## 14. MVP verification

Automatic Live Listen is working when:

- Web status page shows current media and an `一起听` button.
- Clicking `一起听` registers a listener and connects a consumer WebSocket.
- If no stream is active, `LiveListenRoomDO` transitions to `requested` and sends `stream.start` to the connected device.
- Pulse Native auto-approves only when local persistent authorization allows it.
- Native selects Spotify/current media app when available and starts app-specific capture.
- Native connects as producer to `MediaRoomDO` and sends binary audio chunks.
- `MediaRoomDO` broadcasts chunks to all connected consumers.
- Web schedules decoded chunks with 3-5 seconds buffer and plays without audible gaps under normal network jitter.
- Reloading the Web page or briefly changing networks does not immediately stop Native streaming.
- If Native loses network for less than `NATIVE_RING_BUFFER_MS`, it replays buffered chunks after producer reconnect.
- If one listener disconnects while others stay online, only that listener enters `reconnecting`; other listeners continue receiving live chunks.
- If a listener reconnects within `SERVER_RING_BUFFER_MS`, server replays missing chunks to that listener only.
- If either Native or server buffer cannot cover the missing range, the affected consumers receive `buffer-gap` or `stream-reset` and resync without breaking the room.
- When all listeners are gone longer than `noListenerGraceMs`, server sends `stream.stop` and Native stops capture.
- Lyrics/progress are adjusted by stream latency rather than host zero-latency media progress.
