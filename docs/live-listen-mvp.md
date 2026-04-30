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
GET  /api/live-listen/events  # WebSocket upgrade
POST /api/live-listen/host/start
POST /api/live-listen/host/heartbeat
POST /api/live-listen/host/stop
POST /api/live-listen/listener/join
POST /api/live-listen/listener/leave
ANY  /api/live-listen/partytracks/*  # PartyTracks SDK proxy
```

### `GET /api/live-listen/state`

Returns the current `LiveListenSnapshot`.

Used by the Web page for first paint and by Native for quick diagnostics.

### `GET /api/live-listen/events`

Upgrades to a hibernatable Durable Object WebSocket and sends `LiveListenStreamEnvelope` updates as JSON messages.

State sync uses DO WebSocket hibernation so idle subscribers do not keep the room object pinned in memory. Audio still goes through Cloudflare Realtime.

### `POST /api/live-listen/host/start`

Payload: `LiveListenHostStartRequest`.

The DO moves to `starting`, records `hostDeviceId`, and returns the current Live Listen snapshot/token envelope. Audio session negotiation is performed by the PartyTracks client SDK through the Worker proxy.

### `POST /api/live-listen/host/heartbeat`

Payload: `LiveListenHostHeartbeatRequest`.

Native sends this every 500-1000ms while streaming. The payload may include latest `media` and `clock`.

The DO updates `updatedAt`, `media`, `clock`, and transitions `starting -> live` when the host is healthy.

### `POST /api/live-listen/host/stop`

Payload: `LiveListenHostStopRequest`.

The DO transitions to `ended`, clears host liveness, and broadcasts an updated snapshot.

### `POST /api/live-listen/listener/join`

Payload: `LiveListenListenerJoinRequest`.

The DO registers or refreshes the listener, increments business listener count, and returns a `LiveListenTokenResponse` for the listener. The browser pulls the host track with PartyTracks metadata from the snapshot.

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

Worker owns:

- PartyTracks SDK proxy under `/api/live-listen/partytracks/*`
- Realtime SFU app credential injection
- HTTP auth, origin checks, and request validation

DO owns:

- room state machine
- Realtime session reference
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

## Host publisher MVP

Current implementation includes a browser host publisher at `/live-listen/host`. It is a practical MVP for the push side before native system-audio capture lands:

1. Enter the device API key.
2. Click `Start host`.
3. The page asks for a local audio input, creates `PartyTracks({ prefix: "/api/v1/live-listen/partytracks" })`, and calls `push(audioTrack$)`.
4. When PartyTracks emits `TrackMetadata`, the host sends `host/heartbeat` with `audio.track`.
5. Web listeners pull that track from the Live Listen snapshot.

Native still needs a real system-audio capture bridge. Once Native can produce an audio `MediaStreamTrack` or equivalent PartyTracks-compatible source, it should follow the same `host/start -> PartyTracks.push -> host/heartbeat(audio.track) -> host/stop` lifecycle.

## PartyTracks / Realtime SDK configuration

Live Listen uses Cloudflare Realtime through the `partytracks` SDK. The Worker exposes a proxy route at `/api/live-listen/partytracks/*` via `routePartyTracksRequest`; Native and Web clients configure `PartyTracks` with that prefix.

Required Worker vars for real SFU traffic:

- `REALTIME_SFU_APP_ID`
- `REALTIME_SFU_APP_TOKEN`

Optional TURN vars:

- `REALTIME_TURN_APP_ID`
- `REALTIME_TURN_APP_TOKEN`

The DO does not call Realtime directly and does not proxy audio frames.

## 9. MVP verification

MVP is working when:

- Native can call `host/start` and receive a host Realtime token.
- Web can call `state` and see `starting` or `live`.
- Web can open `events` as a WebSocket and receive `LiveListenStreamEnvelope` updates.
- Native heartbeat updates `media` and `clock`.
- Web can call `listener/join` after a click and receive a listener token.
- Multiple browsers can join the same Realtime session.
- `listenerCount` changes are reflected in snapshots.
- Stopping Native or killing heartbeat changes state to `offline` or `ended` within 5-10 seconds.
- Lyrics can be driven by `LiveListenClock` instead of owner media progress alone.
