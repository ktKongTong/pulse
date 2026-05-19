# Client Media WS

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、Web client / SDK
状态：draft
验证：协议设计；落地时需要补 schema、worker/browser 测试和端到端验证

`client.media.ws.v1` 是 client 侧 media WebSocket。连接建立后，当前 tab 只是 media observer；只有 `stream.request` 被 server accepted 后，当前 tab 才成为 stream client，并接收 audio chunk。

## Connection

```text
GET /api/v1/client/media/ws
```

连接前置：

- `sessionId` 必须来自 server-issued client session。
- `tabId` 标识当前 tab。
- 同 `(sessionId, tabId)` 必须已经有 active common WS。
- 同 `(sessionId, tabId)` 同时只允许一条 active client media WS。

## Client -> Server

```ts
type ClientMediaClientFrame =
  | ClientMediaHelloFrame
  | ClientMediaStreamRequestFrame
  | ClientMediaStreamStopFrame
  | ClientMediaAckFrame;
```

### Hello

```ts
type ClientMediaHelloFrame = {
  protocol: "client.media.ws.v1";
  type: "hello";
  supportedProtocols: ["client.media.ws.v1"];
  sdkVersion: string;
  sessionId: string;
  tabId: string;
};
```

规则：

- `hello` 成功后，server 将当前 socket 加入 `clientSockets[(sessionId, tabId)]`。
- `hello` 不产生 stream request。
- `hello` 后 server 发送 `hello_ack` 和当前 `state`。

### Stream Request

```ts
type ClientMediaStreamRequestFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.request";
  requestId: string;
};
```

规则：

- 只有 `state.stream.source.state = "ready"` 时，client 才应该发送 `stream.request`。
- server 只在 `stream.source.state = "ready"` 时接受 `stream.request`。
- accepted 后，server 将当前 tab 加入 `streamClients[(sessionId, tabId)]`。
- rejected 后，当前 tab 保持 observer。
- 同一 tab 已经是 stream client 时，重复 `stream.request` 返回当前 stream 的 `stream.accepted`，不增加 stream request。

### Stream Stop

```ts
type ClientMediaStreamStopFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.stop";
};
```

规则：

- `stream.stop` 只停止当前 tab 的 stream client 身份。
- server 移除 `streamClients[(sessionId, tabId)]` 和 `graceStreamClients[(sessionId, tabId)]`。
- media WS 保持打开，当前 tab 回到 observer。
- 如果 server 内部 `streamRequested = false`，MediaDO 请求 device 停止供流。

### Ack

```ts
type ClientMediaAckFrame = {
  protocol: "client.media.ws.v1";
  type: "ack";
  streamId: string;
  generation: number;
  seq: number;
};
```

规则：

- `ack.seq` 表示当前 tab 已消费到的 audio chunk seq。
- server 更新 `streamClients[(sessionId, tabId)].lastAckSeq`。

## Server -> Client

```ts
type ClientMediaServerFrame =
  | ClientMediaHelloAckFrame
  | ClientMediaStateFrame
  | ClientMediaStreamAcceptedFrame
  | ClientMediaStreamRejectedFrame
  | ClientMediaStreamStoppedFrame
  | ClientMediaAudioChunkFrame
  | ClientMediaStreamTransitionFrame
  | ClientMediaStreamEndedFrame
  | ClientMediaStreamErrorFrame
  | ClientMediaErrorFrame;
```

### Hello Ack

```ts
type ClientMediaHelloAckFrame = {
  protocol: "client.media.ws.v1";
  type: "hello_ack";
  selectedProtocol: "client.media.ws.v1";
  connectionId: string;
};
```

### State

```ts
type ClientMediaStateFrame = {
  protocol: "client.media.ws.v1";
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
- `disabled`：device online，但 permission disallow；或 device 拒绝了上一次 `stream.requested`，且之后还没有新的 device `stream.state.updated`。
- `offline`：没有 active device media WS。
- `idle`：device online，permission allow，但 playback paused / 当前没有 playable media。
- device media WS 已连接但尚未收到首个 `stream.state.updated` 时，server 保持上一帧 source state；如果没有上一帧，则为 `offline`。

`state` 只描述 stream source 和 now playing。当前 tab 是否正在请求或接收 stream，由 SDK 根据本地 pending request 以及 `stream.accepted/rejected/stopped/ended/error` 等运行帧维护。

### Stream Accepted

```ts
type ClientMediaStreamAcceptedFrame = {
  protocol: "client.media.ws.v1";
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
type ClientMediaStreamRejectedFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.rejected";
  requestId: string;
  source: ClientMediaStreamSource;
};
```

规则：

- `stream.rejected` 表示当前 tab 仍是 observer。
- `source.state` 是 server 拒绝时的当前 stream source state。

### Stream Stopped

```ts
type ClientMediaStreamStoppedFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.stopped";
};
```

规则：

- `stream.stopped` 表示当前 tab 不再是 stream client。
- `stream.stopped` 只用于响应当前 tab 主动发送的 `stream.stop`。
- 底层 stream 结束或失败使用 `stream.ended` / `stream.error`。
- media WS 保持打开。

### Audio Chunk

```ts
type ClientMediaAudioChunkFrame = {
  protocol: "client.media.ws.v1";
  type: "audio.chunk";
  streamId: string;
  generation: number;
  seq: number;
  sentAt: string;
  durationMs: number;
  codec: "pcm16-wav" | "opus" | "aac";
  byteLength: number;
  replayed: boolean;
};
```

规则：

- `audio.chunk` 只发送给 `streamClients`。
- `audio.chunk` 是 JSON metadata frame，其后必须紧跟一个 binary audio frame。
- binary audio frame 的长度必须等于 `byteLength`。
- client 必须按 `streamId/generation/seq` 校验和排序。
- generation 变化后，client 丢弃旧 generation 播放队列。

### Stream Transition

```ts
type ClientMediaStreamTransitionFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.transition";
  streamId: string;
  fromGeneration: number;
  toGeneration: number;
  firstSeq: number;
};
```

`stream.transition` 表示同一个 `streamId` 切到新的 generation。

### Stream Ended

```ts
type ClientMediaStreamEndedFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.ended";
  streamId: string;
  generation: number;
};
```

`stream.ended` 表示当前底层 stream 正常结束。server 向该 `streamId/generation` 下的所有 stream clients 发送该 frame，移除这些 stream clients，并保持各自 media WS 作为 observer 打开。

### Stream Error

```ts
type ClientMediaStreamErrorFrame = {
  protocol: "client.media.ws.v1";
  type: "stream.error";
  streamId?: string;
  generation?: number;
};
```

`stream.error` 表示当前底层 stream 失败。server 向该 `streamId/generation` 下的所有 stream clients 发送该 frame，移除这些 stream clients，并保持各自 media WS 作为 observer 打开。

## Error

```ts
type ClientMediaErrorFrame = {
  protocol: "client.media.ws.v1";
  type: "error";
  code:
    | "invalid_frame"
    | "hello_required"
    | "unsupported_protocol"
    | "invalid_session"
    | "internal_error";
  message: string;
  fatal: true;
};
```

错误规则：

- `invalid_frame`：frame 不是合法 JSON、schema 不符合当前协议，或缺少必填字段。
- `hello_required`：`hello_ack` 前收到非 `hello` frame。
- `unsupported_protocol`：`hello.supportedProtocols` 不包含 `client.media.ws.v1`。
- `invalid_session`：`sessionId` 缺失、无效、未签发、已过期，或 `(sessionId, tabId)` 没有 active common WS。
- `internal_error`：server 内部错误。
- 所有 error 都是 fatal；server 发送 error 后关闭 WS。
