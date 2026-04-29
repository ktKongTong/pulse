# Live Listen MVP

Live Listen 是 Pulse 的 audio-only 网页内一起听能力。MVP 目标不是接入 Spotify Jam，也不是让 Web 端登录第三方音乐服务，而是让 Pulse Native 从设备采集音频后推到 Cloudflare Realtime，Web 页面直接加入收听。

本文档只描述第一版 MVP 的协议、状态和模块边界，不实现 macOS 音频采集、Cloudflare Realtime token 细节或页面 UI。

## 1. Product shape

MVP 的用户体验：

1. Pulse Native 开启 Live Listen。
2. Native 发布一条 audio-only stream。
3. Web status 页面看到 `live` 状态。
4. 用户点击 `一起听`。
5. Web 加入同一个 Realtime session 并播放远端 audio track。
6. 页面继续展示当前歌曲、歌词、在线人数和 stream 状态。

MVP 明确不做：

- 视频。
- 多 host。
- listener 语音上行。
- Spotify OAuth / Web Playback SDK。
- Spotify Jam 创建或加入。
- 长期持久房间录制。

Spotify / Apple Music / 其他 provider 在这一版只作为 metadata 来源；音频源来自 host 设备。

## 2. Architecture

```text
Pulse Native
  ├─ captures host device audio
  ├─ publishes audio-only track to Cloudflare Realtime
  └─ sends heartbeat + media clock to Worker

Cloudflare Worker
  ├─ routes Live Listen API requests
  ├─ creates or reuses the Realtime audio session
  ├─ issues host/listener tokens
  └─ forwards room state work to Durable Object

LiveListenRoomDO
  ├─ owns room snapshot
  ├─ tracks host heartbeat
  ├─ stores Realtime session reference
  ├─ tracks listener registry
  ├─ stores latest media + stream clock
  └─ broadcasts snapshot changes

Web status page
  ├─ reads/subscribes Live Listen snapshot
  ├─ requests a listener token after user gesture
  ├─ joins Cloudflare Realtime session
  └─ renders audio + lyrics from stream clock
```

Cloudflare Realtime owns the media plane: WebRTC connection, SFU relay, remote audio track subscription.

`LiveListenRoomDO` owns Pulse business state: whether the room is live, which Native device is host, which Realtime session to join, how many listeners are active, and which media/clock snapshot should drive UI.

## 3. Protocol source

The shared TypeScript/Zod protocol lives in:

- [live-listen-v1.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/live-listen-v1.ts)

It is exported from:

- [index.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/index.ts)

Protocol names:

- `live-listen.v1`: HTTP request/response payloads and room snapshots.
- `live-listen.stream.v1`: SSE/WebSocket-style room state events.

## 4. Room snapshot

`LiveListenSnapshot` is the UI-facing source of truth:

```ts
type LiveListenSnapshot = {
  protocol: "live-listen.v1";
  roomId: string;
  workspaceId: string;
  state: "offline" | "starting" | "live" | "ended" | "error";
  listenerCount: number;
  hostDeviceId?: string;
  startedAt?: string;
  updatedAt: string;
  audio?: {
    transport: "cloudflare-realtime";
    sessionId: string;
    roomName?: string;
    publishTrackName?: string;
  };
  media?: LiveListenMedia;
  clock?: LiveListenClock;
  error?: { code: string; message: string };
};
```

The snapshot is intentionally separate from `RoomSnapshot` in `realtime.v2`. `RoomSnapshot` describes presence/page/chat rooms. `LiveListenSnapshot` describes an audio stream room with a host and listener set.

## 5. State machine

```text
offline
  -> starting   host/start

starting
  -> live       host heartbeat or publish-confirmed event
  -> error      Realtime session/token creation failed
  -> offline    host timeout

live
  -> ended      host/stop
  -> offline    host heartbeat timeout
  -> error      media plane failure reported by host

ended
  -> starting   host/start
  -> offline    cleanup timeout

error
  -> starting   host/start
  -> offline    cleanup timeout
```

Heartbeat timeout should be short enough for the page to feel live. A practical MVP value is 5-10 seconds.

## 6. Minimal HTTP API

The Worker API can be thin wrappers around `LiveListenRoomDO`.

```text
GET  /api/live-listen/state
GET  /api/live-listen/events
POST /api/live-listen/host/start
POST /api/live-listen/host/heartbeat
POST /api/live-listen/host/stop
POST /api/live-listen/listener/join
POST /api/live-listen/listener/leave
```

### `GET /api/live-listen/state`

Returns the current `LiveListenSnapshot`.

Used by the Web page for first paint and by Native for quick diagnostics.

### `GET /api/live-listen/events`

Streams `LiveListenStreamEnvelope` updates.

MVP can use SSE for UI state. Audio still goes through Cloudflare Realtime.

### `POST /api/live-listen/host/start`

Payload: `LiveListenHostStartRequest`.

The DO moves to `starting`, creates or binds a Cloudflare Realtime audio session, records `hostDeviceId`, and returns a `LiveListenTokenResponse` for the host.

### `POST /api/live-listen/host/heartbeat`

Payload: `LiveListenHostHeartbeatRequest`.

Native sends this every 500-1000ms while streaming. The payload may include latest `media` and `clock`.

The DO updates `updatedAt`, `media`, `clock`, and transitions `starting -> live` when the host is healthy.

### `POST /api/live-listen/host/stop`

Payload: `LiveListenHostStopRequest`.

The DO transitions to `ended`, clears host liveness, and broadcasts an updated snapshot.

### `POST /api/live-listen/listener/join`

Payload: `LiveListenListenerJoinRequest`.

The DO registers or refreshes the listener, increments business listener count, and returns a `LiveListenTokenResponse` for the listener.

The response can still be returned when state is `starting`; Web can join early and wait for the host audio track.

### `POST /api/live-listen/listener/leave`

Payload: `LiveListenListenerLeaveRequest`.

The DO removes the listener if present. Because browser unload is unreliable, listeners should also have a TTL refreshed by state subscription or explicit heartbeat in later versions.

## 7. Media clock

`LiveListenClock` aligns lyrics and progress UI with the audio stream:

```ts
type LiveListenClock = {
  mediaProgressSeconds: number;
  observedAt: string;
  streamLatencyMs?: number;
  sequence: number;
};
```

Web computes display progress from the latest clock:

```ts
const displayedProgressSeconds =
  clock.mediaProgressSeconds +
  (Date.now() - Date.parse(clock.observedAt)) / 1000 -
  (clock.streamLatencyMs ?? 1500) / 1000;
```

Lyrics should follow the audio users hear, not the host device's zero-latency playback position. If stream latency is unknown, use a fixed MVP estimate around 1.5 seconds.

## 8. Module boundaries

### Native

Native owns:

- system audio capture
- audio publication to Cloudflare Realtime
- host heartbeat
- media metadata sampling
- media clock sequence

Native does not own:

- listener count
- room state fan-out
- Web UI state derivation

### Worker / DO

Worker and DO own:

- room state machine
- Realtime session reference
- token issuance flow
- host liveness timeout
- listener registry
- snapshot broadcast

Worker and DO do not own:

- audio encoding
- audio frames
- lyric parsing
- provider-specific media control

### Web

Web owns:

- user gesture before audio playback
- joining Realtime as listener
- rendering audio state
- rendering lyrics from stream clock
- fallback UI when state is not `live`

Web does not own:

- creating host sessions
- deciding whether Native is alive
- deriving listener count from local component state

## 9. MVP verification

MVP is working when:

- Native can call `host/start` and receive a host Realtime token.
- Web can call `state` and see `starting` or `live`.
- Native heartbeat updates `media` and `clock`.
- Web can call `listener/join` after a click and receive a listener token.
- Multiple browsers can join the same Realtime session.
- `listenerCount` changes are reflected in snapshots.
- Stopping Native or killing heartbeat changes state to `offline` or `ended` within 5-10 seconds.
- Lyrics can be driven by `LiveListenClock` instead of owner media progress alone.
