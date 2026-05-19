# Client Media Server State

归属：`apps/realtime-worker`
代码范围：`apps/realtime-worker` Durable Object、`packages/realtime-protocol`
状态：draft
验证：服务端状态设计；落地时需要补 MediaDO、device/client WS schema、worker/browser/native 测试和端到端验证

本文描述 `MediaDO` 内需要维护的 server state。`MediaDO` 同时接收 device media WS 上报的媒体事实，以及 client media WS 产生的 stream requested。

## MediaDO Properties

```ts
type MediaDOState = {
  deviceMediaConnection: DeviceMediaConnection | null;
  deviceDisconnectedAt?: string;
  deviceGraceDeadlineAt?: string;
  streamRequestRejectedAt?: string;
  deviceStreamState: DeviceStreamState | null;
  currentMedia: CurrentMedia | null;

  clientSockets: Map<ClientTabKey, MediaClientSocket>;
  streamClients: Map<ClientTabKey, MediaStreamClient>;
  graceStreamClients: Map<ClientTabKey, MediaGraceStreamClient>;

  streamContext: StreamContext | null;
  audioBuffer: AudioRingBuffer | null;
  pendingDeviceCommand: PendingDeviceCommand | null;
  nextAlarmAt?: string;

  revision: number;
  updatedAt: string;
};

type ClientTabKey = `${string}:${string}`;
```

## Environment

MediaDO runtime 参数从 env 读取：

```text
MEDIA_RING_BUFFER_DURATION_MS
MEDIA_DEVICE_COMMAND_TIMEOUT_MS
MEDIA_CHUNK_STALL_TIMEOUT_MS = 10000
```

规则：

- `MEDIA_RING_BUFFER_DURATION_MS` 控制 server audio ring buffer 可回放窗口。
- `MEDIA_DEVICE_COMMAND_TIMEOUT_MS` 控制 device `stream.requested` / `stream.resume` / `stream.stop` command 过期时间。
- `MEDIA_CHUNK_STALL_TIMEOUT_MS` 控制 audio chunk stalled 判定，默认 `10000ms`。

## Device Media Connection

`deviceMediaConnection` 是当前 accepted device media WS metadata。

```ts
type DeviceMediaConnection = {
  connectionId: string;
  deviceId: string;
  deviceSessionId: string;
  connectedAt: string;
  lastSeenAt: string;
  capabilities: {
    streaming: boolean;
  };
};
```

来源：

- device media WS `hello` 被 server 接受后设置。
- device media WS close/error 后清空，并设置 `deviceDisconnectedAt/deviceGraceDeadlineAt`。
- `deviceSessionId` 必须来自 device common WS `hello_ack`。
- device 在 `deviceGraceDeadlineAt` 前重新建立 media WS 时，MediaDO 可以基于现有 `streamContext` 发送 `stream.resume`。
- device grace 到期后仍未恢复时，MediaDO 将当前 `streamContext.audio.state` 置为 `failed`，并清理 device grace deadline。
- device grace 的过期由 DO alarm 驱动；最近一次需要唤醒的时间保存在 `nextAlarmAt`。

## Device Stream State

`deviceStreamState` 来自 device media WS 的 `stream.state.updated`。

```ts
type DeviceStreamState = {
  permission: "allow" | "disallow";
  playback: "playing" | "paused";
  capture: "capturing" | "no-capture";
  streamFormat?: StreamFormat;
  reason?: StreamBlockedReason | "native_error";
  message?: string;
  updatedAt: string;
};
```

规则：

- `permission` 表达 owner / device policy 是否允许 media streaming。
- `playback` 表达当前是否有 playable media。
- `capture` 表达 device 本地是否正在采集。
- `streamFormat` 是 device 当前输出音频格式事实。
- `deviceStreamState` 不表达 client stream requested。

## Current Media

`currentMedia` 来自 device media WS 的 `media.updated`。

```ts
type CurrentMedia = {
  media: LiveListenMedia | null;
  clock?: LiveListenClock;
  updatedAt: string;
};
```

规则：

- `currentMedia` 是 now playing 展示事实。
- 曲目、封面、标题、媒体时钟变化只更新 `currentMedia`。
- `currentMedia` 变化不创建新的 `streamId/generation`。

## Client Connections

`clientSockets` 是已连接的 client media WS 集合，按 `(sessionId, tabId)` 唯一。它表示该 tab 正在观测 media state，但不一定贡献 stream requested。

```ts
type MediaClientSocket = {
  connectionId: string;
  sessionId: string;
  tabId: string;
  connectedAt: string;
  lastSeenAt: string;
};
```

`streamClients` 是已发送 `stream.request` 且被 server accepted 的 client tab。只有它贡献 stream requested，并接收 audio chunk。

```ts
type MediaStreamClient = {
  connectionId: string;
  sessionId: string;
  tabId: string;
  acceptedAt: string;
  lastSeenAt: string;
  lastAckSeq?: number;
};
```

`graceStreamClients` 是 accepted stream client 短断后仍贡献 stream requested 的 client tab。

```ts
type MediaGraceStreamClient = {
  sessionId: string;
  tabId: string;
  previousConnectionId: string;
  disconnectedAt: string;
  reconnectDeadlineAt: string;
  lastAckSeq?: number;
  streamId?: string;
  generation?: number;
};
```

规则：

- `connectionId` 只标识一条 client media WS。
- `(sessionId, tabId)` 标识一个 client tab。
- 不定义独立 stream client id。
- 不定义 `resumeToken`。
- 不用 `active` boolean；连接、accepted stream client、grace stream client 分别由 `clientSockets` / `streamClients` / `graceStreamClients` 表达。
- 同一个 `(sessionId, tabId)` 同时只允许一条 active client media WS；新连接接受后替换旧连接。
- client media WS connected 后进入 `clientSockets`，但不改变 stream requested。
- client `stream.request` accepted 后进入 `streamClients`，才改变 stream requested。
- client 主动 `stream.stop` 后直接移除 `streamClients[(sessionId, tabId)]` 和 `graceStreamClients[(sessionId, tabId)]`，但保留 `clientSockets[(sessionId, tabId)]`。
- client media WS 非主动 close/error 时，先移除 `clientSockets[(sessionId, tabId)]`；如果该 tab 在 `streamClients` 中，再移动到 `graceStreamClients`。
- `graceStreamClients` 的过期由 DO alarm 驱动；最近一次需要唤醒的时间保存在 `nextAlarmAt`。
- client media WS 必须对应同 `(sessionId, tabId)` 的 active common WS。
- common WS close/error 后，GlobalDO 必须通知 MediaDO revoke 同 `(sessionId, tabId)` 的 client media WS。
- audio chunk fanout 只发给 `streamClients`。

## Stream Context

`streamContext` 只描述 server 当前认可的一条音频流。

```ts
type StreamContext = {
  streamId: string;
  generation: number;

  audio: {
    state: "waiting" | "flowing" | "stalled" | "failed";
    firstSeq?: number;
    latestSeq?: number;
    availableFromSeq?: number;
    firstChunkAt?: string;
    lastChunkAt?: string;
    failure?: {
      code: StreamFailureCode;
    };
  };

  format?: StreamFormat;

  openedAt: string;
  updatedAt: string;
};
```

字段来源：

- `streamId`：MediaDO 生成。
- `generation`：MediaDO 初始设置；device `stream.resume` ack 可切换到新的 generation。
- `audio.state`：MediaDO 根据 chunk、timeout、device ack/error 派生。
- `audio.firstSeq`：device `stream.requested` 或 `stream.resume` accepted ack 返回。
- `audio.latestSeq`：MediaDO 收到有效 `audio.chunk` 后更新。
- `audio.availableFromSeq`：MediaDO 根据 server ring buffer 更新。
- `audio.firstChunkAt`：当前 generation 第一帧有效 chunk 到达时设置。
- `audio.lastChunkAt`：每次有效 chunk 到达时更新。
- `audio.failure`：stream 不可继续时设置。
- `format`：device `stream.requested` accepted ack 返回；后续格式变化由 `stream.state.updated` 更新。
- `openedAt/updatedAt`：MediaDO 设置。

状态规则：

- 新建 `streamContext` 时，`audio.state = "waiting"`。
- 新建 `streamContext` 时，`audio.firstSeq/latestSeq/availableFromSeq` 均未设置。
- device `stream.requested` accepted ack 到达后，MediaDO 设置 `audio.firstSeq/latestSeq/availableFromSeq` 并创建 `audioBuffer`。
- 收到当前 `streamId/generation` 的有效 chunk 后，`audio.state = "flowing"`。
- stream requested 仍存在但超过 `MEDIA_CHUNK_STALL_TIMEOUT_MS` 未收到 chunk 时，`audio.state = "stalled"`。
- `waiting` 状态下，device 已 accepted `stream.requested` / `stream.resume` 后，超过 `MEDIA_CHUNK_STALL_TIMEOUT_MS` 仍未收到第一帧 `audio.chunk`，进入 `stalled`。
- `flowing` 状态下，距离上一帧 `audio.chunk` 超过 `MEDIA_CHUNK_STALL_TIMEOUT_MS`，进入 `stalled`。
- device 续流拒绝、device 主动停止、device media WS 不可恢复、buffer 无法恢复或协议错误时，`audio.state = "failed"`。
- device 初次 `stream.requested` rejected 不进入 `failed`，而是清理当前 stream request，并让 stream source 变为不可请求。
- stream requested 归零后，MediaDO 向 device 发送 `stream.stop`；stop resolved 后清理 `streamContext`。

## Audio Ring Buffer

`audioBuffer` 保存当前 `streamId/generation` 的 server 侧回放窗口。

```ts
type AudioRingBuffer = {
  streamId: string;
  generation: number;
  availableFromSeq: number;
  latestSeq: number;
  maxDurationMs: number;
};
```

规则：

- buffer 只服务 client resume / replay。
- buffer 不改变 device resume 语义。
- generation 变化后，旧 generation buffer 不再用于新 generation 播放队列。
- generation 切换时，MediaDO 必须重置 `audioBuffer` 到新的 `(streamId, generation)`。
- generation 切换前已发送给 client 的旧 generation chunk 仍由 client 按 stream transition 处理，不再从新 buffer 中 replay。

## Pending Device Command

`pendingDeviceCommand` 是 MediaDO 发给 device 的未决动作，不是 stream 状态。

```ts
type PendingDeviceCommand = {
  commandId: string;
  type: "stream.requested" | "stream.resume" | "stream.stop";
  streamId?: string;
  generation?: number;
  fromSeq?: number;
  sentAt: string;
  expiresAt: string;
};
```

规则：

- `stream.requested` 用于要求 device 为新 `streamId` 开始供流。
- `stream.resume` 用于要求 device 继续已有 `streamId/generation`。
- `stream.stop` 用于要求 device 停止当前供流。
- command resolved、expired 或被替换后清理 `pendingDeviceCommand`。
- `stream.stop` 不产生 `stopping` 状态。
- 同一时间只允许一个 `pendingDeviceCommand`。
- 如果 `pendingDeviceCommand` 存在时 MediaDO 尝试发送新的 device command，说明实现违反协议；server 必须关闭 device media WS，并将当前 `streamContext.audio.state` 置为 `failed`。
- 收到 ack 时，`commandId` 必须等于当前 pending command；不匹配的 ack 视为 stale ack 并丢弃。
- pending command 过期后，MediaDO 按该 command 的失败语义更新 `streamContext`，并清理 `pendingDeviceCommand`。

## Internal Derivations

MediaDO 内部只需要两个核心派生事实：

```text
streamRequested =
  streamClients.size + graceStreamClients.size > 0

canAcceptStreamRequest =
  deviceMediaConnection exists
  and deviceMediaConnection.capabilities.streaming = true
  and deviceStreamState.permission = allow
  and deviceStreamState.playback = playing
```

`streamRequested` 决定 server 是否要求 device 供流。`canAcceptStreamRequest` 只用于处理 client `stream.request`。

client `stream.source.state` 派生规则：

```text
no previous source state and deviceStreamState is null:
  offline

previous source state exists and deviceStreamState is null:
  keep previous source state

offline:
  deviceMediaConnection is null

disabled:
  deviceMediaConnection exists
  and (
    deviceStreamState.permission = disallow
    or streamRequestRejectedAt exists
  )

idle:
  deviceMediaConnection exists
  and deviceMediaConnection.capabilities.streaming = true
  and deviceStreamState.permission = allow
  and deviceStreamState.playback = paused

ready:
  canAcceptStreamRequest = true
```

## Transitions

### Client media WS connected

```text
precondition:
  active common WS exists for the same (sessionId, tabId)

effect:
  add clientSockets[(sessionId, tabId)]
  do not change stream requested
```

### Client stream request accepted

```text
precondition:
  canAcceptStreamRequest = true

effect:
  require clientSockets[(sessionId, tabId)] exists
  add streamClients[(sessionId, tabId)]
  remove graceStreamClients[(sessionId, tabId)]
  send stream.accepted to this client immediately
  if streamRequested changed false -> true:
    clear failed streamContext if present
    create streamContext
    set pendingDeviceCommand = stream.requested
    send device command stream.requested
  else:
    use current streamContext/audioBuffer for replay or subsequent audio fanout
```

### Client stream stop

```text
effect:
  remove streamClients[(sessionId, tabId)]
  remove graceStreamClients[(sessionId, tabId)]
  keep clientSockets[(sessionId, tabId)]
  if streamRequested = false:
    set pendingDeviceCommand = stream.stop
    send device command stream.stop
    clear streamContext after stop resolved
```

### Client stream request rejected

```text
precondition:
  canAcceptStreamRequest = false

effect:
  do not add streamClients
  do not change stream requested
  do not send device stream command
```

### Client media WS close

```text
remove clientSockets[(sessionId, tabId)]
if tab exists in streamClients and close was not caused by stream.stop:
  move streamClients[(sessionId, tabId)] to graceStreamClients[(sessionId, tabId)]
  update nextAlarmAt
else:
  do not create grace stream client
```

### Client media WS revoked by common

```text
trigger:
  GlobalDO reports common WS close/error for the same (sessionId, tabId)

effect:
  close client media WS for (sessionId, tabId)
  remove clientSockets[(sessionId, tabId)]
  remove streamClients[(sessionId, tabId)]
  remove graceStreamClients[(sessionId, tabId)]
  if streamRequested = false:
    set pendingDeviceCommand = stream.stop
    send device command stream.stop
```

### Stream grace expired

```text
remove graceStreamClients[(sessionId, tabId)]
if streamRequested = false:
  set pendingDeviceCommand = stream.stop
  send device command stream.stop
  clear streamContext after stop resolved
```

### Device stream requested accepted

```text
precondition:
  streamContext exists
  pendingDeviceCommand.type = stream.requested
  ack.commandId = pendingDeviceCommand.commandId

effect:
  set streamContext.generation = ack.generation
  set streamContext.audio.firstSeq = ack.firstSeq
  set streamContext.audio.latestSeq = ack.firstSeq - 1
  set streamContext.audio.availableFromSeq = ack.firstSeq
  set streamContext.audio.state = waiting
  set streamContext.format = ack.streamFormat
  create audioBuffer for (streamId, generation)
  clear pendingDeviceCommand
```

### Device stream requested rejected

```text
precondition:
  streamContext exists
  pendingDeviceCommand.type = stream.requested
  ack.commandId = pendingDeviceCommand.commandId

effect:
  remove streamClients for current stream
  remove graceStreamClients for current stream
  clear streamContext
  clear audioBuffer
  clear pendingDeviceCommand
  set streamRequestRejectedAt
  canAcceptStreamRequest = false until next device stream.state.updated
  notify clientSockets of media state change
```

### Device stream state updated

```text
update deviceStreamState
clear streamRequestRejectedAt
recompute canAcceptStreamRequest
if canAcceptStreamRequest becomes false while streamContext exists:
  mark streamContext.audio.state failed or clear it according to reason
  set pendingDeviceCommand = stream.stop if device is still connected and capture is active
  send stream.stop if device is still connected and capture is active
```

### Device media updated

```text
update currentMedia
notify clientSockets of media state change
```

### Device audio chunk

```text
accept only when:
  streamContext exists
  chunk.streamId = streamContext.streamId
  chunk.generation = streamContext.generation
  streamRequested = true
  streamContext.audio.latestSeq is set
  chunk.seq = streamContext.audio.latestSeq + 1

effect:
  append to audioBuffer
  update streamContext.audio.latestSeq
  update streamContext.audio.availableFromSeq
  update streamContext.audio.firstChunkAt if missing
  update streamContext.audio.lastChunkAt
  set streamContext.audio.state = flowing
  fan out chunk to streamClients
```

规则：

- `chunk.seq <= streamContext.audio.latestSeq` 的 chunk 视为重复或过期，丢弃。
- `chunk.seq > streamContext.audio.latestSeq + 1` 表示当前 stream 出现 gap，MediaDO 标记 `audio.state = stalled` 或 `failed`，并通知 client。
- binary audio frame 必须紧跟对应 `audio.chunk` metadata frame；不匹配按 device media 协议错误处理。

### Device media WS close

```text
clear deviceMediaConnection
set deviceDisconnectedAt
set deviceGraceDeadlineAt
update nextAlarmAt
canAcceptStreamRequest becomes false
if streamContext exists and streamRequested = true:
  streamContext.audio.state = stalled
```

### Device media WS reconnected during grace

```text
precondition:
  deviceGraceDeadlineAt exists
  now <= deviceGraceDeadlineAt
  streamContext exists
  streamRequested = true
  streamContext.audio.latestSeq is set

effect:
  clear deviceDisconnectedAt
  clear deviceGraceDeadlineAt
  set pendingDeviceCommand = stream.resume
  send stream.resume(streamId, generation, fromSeq = streamContext.audio.latestSeq + 1)
```

### Device grace expired

```text
clear deviceGraceDeadlineAt
if streamContext exists:
  set streamContext.audio.state = failed
  set streamContext.audio.failure = device_offline
  notify clientSockets of media state change
```

### Device resume accepted

```text
precondition:
  streamContext exists
  pendingDeviceCommand.type = stream.resume
  ack.commandId = pendingDeviceCommand.commandId

effect:
  update streamContext.generation if ack returns a newer generation
  set streamContext.audio.firstSeq = ack.firstSeq
  set streamContext.audio.latestSeq = ack.firstSeq - 1
  set streamContext.audio.availableFromSeq = ack.unavailableBeforeSeq ?? ack.firstSeq
  set streamContext.audio.state = waiting
  if generation changed:
    reset audioBuffer for new generation
    notify streamClients of stream generation transition
  else:
    keep audioBuffer when it still matches (streamId, generation)
  clear pendingDeviceCommand
```

### Device resume rejected

```text
precondition:
  streamContext exists
  pendingDeviceCommand.type = stream.resume
  ack.commandId = pendingDeviceCommand.commandId

effect:
  set streamContext.audio.state = failed
  set streamContext.audio.failure = ack.rejectedReason
  clear pendingDeviceCommand
  notify clientSockets of media state change
```

### Device stream stop resolved

```text
precondition:
  pendingDeviceCommand.type = stream.stop
  ack.commandId = pendingDeviceCommand.commandId

effect:
  clear pendingDeviceCommand
  clear streamContext
  clear audioBuffer
```

### Pending command expired

```text
if pendingDeviceCommand.type = stream.requested or stream.resume:
  set streamContext.audio.state = failed
  set streamContext.audio.failure = command_timeout

if pendingDeviceCommand.type = stream.stop:
  clear streamContext
  clear audioBuffer

clear pendingDeviceCommand
```

### DO alarm fired

```text
expire graceStreamClients whose reconnectDeadlineAt <= now
expire device grace when deviceGraceDeadlineAt <= now
expire pendingDeviceCommand when expiresAt <= now
set nextAlarmAt to the next remaining deadline, or clear it
```

## Invariants

```text
stream requested = streamClients.size + graceStreamClients.size > 0
clientSockets require active common WS for same (sessionId, tabId)
canAcceptStreamRequest=true implies deviceMediaConnection exists
canAcceptStreamRequest=true implies deviceStreamState.permission=allow
canAcceptStreamRequest=true implies deviceStreamState.playback=playing
streamContext exists only while server still recognizes a current stream
stream.resume never creates streamContext
stream.stop never creates a stopping state
stream.stop never creates graceStreamClients entry
currentMedia changes do not change streamId/generation
audio chunk must match current streamId/generation
audio chunk seq must be accepted monotonically
device connection state does not live inside streamContext
stream client identity is (sessionId, tabId), not an extra stream client id
at most one pendingDeviceCommand exists
nextAlarmAt covers client grace, device grace, and pending command expiry
```
