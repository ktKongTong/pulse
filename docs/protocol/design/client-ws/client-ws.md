# Client WS

归属：`packages/v2/realtime-protocol`
代码范围：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、Web client / SDK
状态：draft
验证：协议 schema、worker WS 测试、web SDK 测试

`client.ws.v2` 是 web client 侧唯一的 client WebSocket。每个 tab 建立一条 client WS，同时承载站点全局 snapshot、media state、stream 请求和音频流事件。它合并并替代了旧的 `client.common.ws.v1` 与 `client.media.ws.v1`；旧 `/api/v1/client/media/ws` endpoint 已删除，不保留兼容桥。

## Connection

```text
GET /api/v1/client/ws
```

连接前置：

- `sessionId` 必须来自 server-issued client session（`POST /api/v1/client/session`）。
- `tabId` 标识当前 tab。
- 同一个 `(sessionId, tabId)` 同时只允许一条 active client WS。

一个 tab 目标上只有一条 client WS：

```text
one tab -> one client.ws.v2
```

## Responsibilities

- client 协议协商。
- 接收 server 签发的 browser session identity。
- 绑定当前 tab 的 `sessionId/tabId`。
- 接收站点全局 snapshot。
- 接收 media state（now playing + stream source）。
- 发起 `stream.request` / `stream.stop` / `ack`，接收 stream runtime 帧和 audio chunk。

## Client -> Server

```ts
type ClientWsClientFrame =
  | ClientWsHelloFrame
  | ClientWsStreamRequestFrame
  | ClientWsStreamStopFrame
  | ClientWsAckFrame;
```

### Hello

```ts
type ClientWsHelloFrame = {
  protocol: "client.ws.v2";
  type: "hello";
  supportedProtocols: ["client.ws.v2"];
  sdkVersion: string;
  sessionId: string;
  tabId: string;
};
```

规则：

- `hello` 之后 server 才发送 `hello_ack`、首帧 `snapshot` 和当前 `state`。
- 同一个 `(sessionId, tabId)` 同时只允许一条 active client WS；新连接被接受后，旧连接收到 `connection_superseded` 并关闭。
- client WS 不定义 heartbeat frame。

### Stream Request

```ts
type ClientWsStreamRequestFrame = {
  protocol: "client.ws.v2";
  type: "stream.request";
  requestId: string;
};
```

规则：

- 只有 `state.stream.source.state = "ready"` 时，client 才应该发送 `stream.request`。
- server 只在 `source.state = "ready"` 时接受 `stream.request`。
- accepted 后，当前 tab 成为 stream client，开始接收 `audio.chunk`。
- rejected 后，当前 tab 保持 observer。

### Stream Stop

```ts
type ClientWsStreamStopFrame = {
  protocol: "client.ws.v2";
  type: "stream.stop";
};
```

规则：

- `stream.stop` 只停止当前 tab 的 stream client 身份。
- server 回复 `stream.stopped`，当前 tab 回到 observer。
- 如果 server 内部已无 stream client，MediaDO 请求 device 停止供流。

### Ack

```ts
type ClientWsAckFrame = {
  protocol: "client.ws.v2";
  type: "ack";
  streamId: string;
  generation: number;
  seq: number;
};
```

规则：

- `ack.seq` 表示当前 tab 已消费到的 audio chunk seq。
- server 更新对应 stream client 的消费位置；ack 不改变 stream source。

## Server -> Client

```ts
type ClientWsServerFrame =
  | ClientWsHelloAckFrame
  | ClientWsSnapshotFrame
  | ClientWsStateFrame
  | ClientWsStreamAcceptedFrame
  | ClientWsStreamRejectedFrame
  | ClientWsStreamStoppedFrame
  | ClientWsAudioChunkFrame
  | ClientWsStreamTransitionFrame
  | ClientWsStreamEndedFrame
  | ClientWsStreamErrorFrame
  | ClientWsErrorFrame;
```

### Hello Ack

```ts
type ClientWsHelloAckFrame = {
  protocol: "client.ws.v2";
  type: "hello_ack";
  selectedProtocol: "client.ws.v2";
  connectionId: string;
  session: {
    sessionId: string;
    tabId: string;
    user?: ClientCommonUser;
  };
};
```

### Snapshot

```ts
type ClientWsSnapshotFrame = {
  protocol: "client.ws.v2";
  type: "snapshot";
  snapshot: ClientCommonGlobalSnapshot;
};
```

`ClientCommonGlobalSnapshot` 是站点全局 snapshot payload，定义见 [Client 可见状态](./client.state.md)。`revision` 是 server global snapshot 的单调版本。

### State

```ts
type ClientWsStateFrame = {
  protocol: "client.ws.v2";
  type: "state";
  revision: number;
  updatedAt: string;
  media: ClientMediaNowPlaying | null;
  stream: {
    source: ClientMediaStreamSource;
  };
};

type ClientMediaStreamSource = {
  state: "ready" | "disabled" | "offline" | "idle";
};

type ClientMediaNowPlaying = {
  current: LiveListenMedia;
  clock?: LiveListenClock;
  playback: "playing" | "paused";
  updatedAt: string;
};
```

`stream.source.state` 规则：

- `ready`：device online，streaming supported，permission allow，playback playing。只有该状态可以发送 `stream.request`。
- `disabled`：device 拒绝或超时了上一次 `stream.requested`，且之后还没有新的 device `stream.state.updated`。
- `offline`：没有 active device media WS。
- `idle`：device online，但当前 source 不可请求。
- device media WS 已连接但尚未收到首个 `stream.state.updated` 时，server 保持上一帧 source state；如果没有上一帧，则为 `offline`。

`state` 只描述 stream source 和 now playing。当前 tab 是否正在请求或接收 stream，由 SDK 根据本地 pending request 以及 `stream.accepted/rejected/stopped/ended/error` 等运行帧维护。

### Stream Accepted

```ts
type ClientWsStreamAcceptedFrame = {
  protocol: "client.ws.v2";
  type: "stream.accepted";
  requestId: string;
  stream: {
    streamId: string;
    generation: number;
    replay?: {
      fromSeq: number;
      availableFromSeq: number;
      latestSeq: number;
    };
  };
};
```

规则：

- `stream.accepted` 表示当前 tab 已成为 stream client。
- `stream.accepted` 只表示 server 已接受当前 tab 的 stream request，不表示 device 已经开始推送音频。
- `stream.replay` 只在 server 已有可 replay 的 ring buffer 时出现。
- 如果 device 后续拒绝初次 `stream.requested`，server 发送新的 `state`，且在下一次 device `stream.state.updated` 前 `stream.source.state = "disabled"`；当前 tab 回到 observer。
- `stream.error` 只用于已存在音频流后的运行错误，不用于初次 `stream.requested` 被 device 拒绝。

### Stream Rejected

```ts
type ClientWsStreamRejectedFrame = {
  protocol: "client.ws.v2";
  type: "stream.rejected";
  requestId: string;
  source: ClientMediaStreamSource;
};
```

### Stream Stopped

```ts
type ClientWsStreamStoppedFrame = {
  protocol: "client.ws.v2";
  type: "stream.stopped";
};
```

`stream.stopped` 只用于响应当前 tab 主动发送的 `stream.stop`。底层 stream 结束或失败使用 `stream.ended` / `stream.error`。

### Audio Chunk

```ts
type ClientWsAudioChunkFrame = {
  protocol: "client.ws.v2";
  type: "audio.chunk";
  streamId: string;
  generation: number;
  seq: number;
  sentAt: string;
  durationMs: number;
  codec: "pcm16-wav" | "opus" | "aac" | "mp3";
  byteLength: number;
  mediaStartPositionMs: number;
  replayed: boolean;
};
```

规则：

- `audio.chunk` 只发送给 stream client。
- `audio.chunk` 是 JSON metadata frame，其后必须紧跟一个 binary audio frame。
- binary audio frame 的长度必须等于 `byteLength`。
- client 必须按 `streamId/generation/seq` 校验和排序。
- generation 变化后，client 丢弃旧 generation 播放队列。

### Stream Transition / Ended / Error

```ts
type ClientWsStreamTransitionFrame = {
  protocol: "client.ws.v2";
  type: "stream.transition";
  streamId: string;
  fromGeneration: number;
  toGeneration: number;
  firstSeq: number;
};

type ClientWsStreamEndedFrame = {
  protocol: "client.ws.v2";
  type: "stream.ended";
  streamId: string;
  generation: number;
};

type ClientWsStreamErrorFrame = {
  protocol: "client.ws.v2";
  type: "stream.error";
  streamId?: string;
  generation?: number;
};
```

- `stream.transition` 表示同一个 `streamId` 切到新的 generation。
- `stream.ended` / `stream.error` 表示底层 stream 正常结束或失败。server 向该 `streamId/generation` 下的所有 stream clients 发送该 frame，移除这些 stream clients，client WS 保持打开。

## Error

```ts
type ClientWsErrorFrame = {
  protocol: "client.ws.v2";
  type: "error";
  code:
    | "invalid_frame"
    | "hello_required"
    | "unsupported_protocol"
    | "invalid_session"
    | "connection_superseded"
    | "internal_error";
  message: string;
  fatal: true;
};
```

错误规则：

- `invalid_frame`：frame 不是合法 JSON、schema 不符合当前协议，或缺少必填字段。
- `hello_required`：`hello_ack` 前收到非 `hello` frame。
- `unsupported_protocol`：`hello.supportedProtocols` 不包含 `client.ws.v2`。
- `invalid_session`：`sessionId` 缺失、无效、未签发、已过期。
- `connection_superseded`：同一 `(sessionId, tabId)` 下 server 接受了新的 client WS，旧 connection 被替换。
- `internal_error`：server 内部错误。
- 所有 error 都是 fatal；server 发送 error 后关闭 WS。

## Lifecycle

连接建立：

```text
client -> POST /api/v1/client/session
server -> { sessionId, user? }
client opens /api/v1/client/ws
client -> hello(sessionId, tabId)
server -> hello_ack(connectionId, session)
server -> snapshot
server -> state
```

client WS 断开或休眠：

```text
tab client WS close/error
server marks this (sessionId, tabId) client connection inactive
server revokes page WS owned by the same (sessionId, tabId)
server removes the tab from media stream clients; if no stream client remains, MediaDO stops the device stream
other tabs under the same sessionId are unaffected
```

Snapshot 处理：

```text
client stores lastAppliedRevision
client applies snapshot only when snapshot.revision > lastAppliedRevision
client discards snapshot when snapshot.revision <= lastAppliedRevision
```

`revision` 必须是 server global snapshot 的单调版本，不是单条 WS connection 的局部版本。

## Server 转发关系

`GlobalDO` 是 web client socket 的唯一 owner。`MediaDO` 不再持有 client WebSocket；它保留 device media socket、media state、stream context、buffer 和 pending command。需要给 client 发 media `state`、stream runtime 帧或 `audio.chunk` 时，`MediaDO` 通过 `GlobalDO` 方法转发到 active client socket：

- media state 变化 → `GlobalDO.broadcastClientFrame(state)` fanout 给所有 client connection。
- stream accepted/rejected/stopped/ended/error → `GlobalDO.sendClientFrame(sessionId, tabId, frame)`。
- audio chunk → `GlobalDO.sendAudioChunk(targets, frame, bytes)` 投递给 stream client tabs。

client 在同一条 WS 上发 `stream.request` / `stream.stop` / `ack`，由 `GlobalDO` 路由到 `MediaDO`。server 状态细节见 [Client WS Server State](./server.state.md) 与 [Client Media Server State](./server.media.state.md)。
