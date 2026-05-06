# Live Listen Server State

本文描述 Live Listen server 侧状态模型。Server 不使用 `recovering`、`reconnecting`、`native-reconnecting` 这类混合状态名。它只保存和派生事实。

Server 侧状态由五组事实组成：

```text
ServerState =
  ListenerPresence
  x NativeLink
  x Admission
  x StreamDemand
  x AudioFlow
```

这些事实回答不同问题：

```text
ListenerPresence  当前有没有 listener demand
NativeLink        Native device-session WS 当前是否连接
Admission         现在是否允许新的 Web listener 加入
StreamDemand      Server 是否希望 Native 串流
AudioFlow         Server 是否正在收到可用音频
```

协议不提供顶层 room lifecycle 字符串。UI 和业务逻辑必须直接消费这些事实字段。

## 1. ListenerPresence

Listener presence 不是一个字符串状态，而是两个计数：

```ts
type ListenerPresence = {
  activeCount: number;
  graceCount: number;
};
```

含义：

```text
activeCount  当前 Web listener session WS 正在连接
graceCount   Web listener WS 已断开，但仍在 reconnect grace 窗口内
```

派生：

```ts
const listenerDemand = activeCount + graceCount > 0;
```

规则：

```text
activeCount > 0
  表示至少一个 listener 正在连接。

graceCount > 0
  表示至少一个 listener 临时断线，但 server 仍保留其 demand。

activeCount = 0 且 graceCount = 0
  表示没有 listener demand。
```

没有 `RoomMembership.recovering`。如果 listener 断线但仍在 grace 内，它仍然贡献 demand；如果 grace 过期，它不再贡献 demand。

## 2. NativeLink

Native link 只表达 server 当前是否握有一条可用 device-session WS。

```ts
type NativeLink = "connected" | "disconnected" | "error";
```

含义：

```text
connected     server 当前有可用 Native device-session WS
disconnected  server 当前没有 Native device-session WS
error         Native link 因协议、鉴权、policy 等不可自动恢复错误失败
```

Native 短断的 grace 不应叫 `reconnecting`。它应表达为 deadline fact：

```ts
type NativeLinkFacts = {
  state: NativeLink;
  disconnectedAt?: string;
  graceDeadlineAt?: string;
  lastError?: { code: string; message: string };
};
```

例子：

```text
Native WS 刚断开，但仍在 grace 内：
  nativeLink.state = disconnected
  nativeLink.graceDeadlineAt = now + nativeGraceMs

Native WS 重新连上：
  nativeLink.state = connected
  nativeLink.graceDeadlineAt = undefined

Native WS 因 1003 invalid frame 被关闭：
  nativeLink.state = error
  nativeLink.lastError = invalid_device_frame
```

Server 不知道 Native 是否“正在重连”。Server 只能知道当前连着还是没连，以及是否还愿意保留一个 grace window。

## 3. Admission

Admission 回答一个问题：新的 Web listener 现在能不能加入。

```ts
type Admission =
  | { state: "open" }
  | { state: "blocked"; reason: AdmissionBlockedReason };
```

`open` 条件：

```text
nativeLink.state = connected
native media stream permission = allow
native media playback = playing
```

`blocked` reason：

```text
device_offline                 Native link 不可用
live_listen_disabled            device owner 不允许 media stream
no_playable_media               owner 允许，但当前没有 playing media
capture_permission_missing      capture 权限缺失
capture_permission_revoked      capture 权限被撤销
capture_source_unavailable      capture source 不可用
capture_source_lost             capture source 运行中丢失
unsupported_app                 当前 app/source 不支持
native_error                    Native link 进入不可恢复错误
```

规则：

```text
Admission 是派生事实，不是独立生命周期。

no_playable_media 来自 playback paused，不来自 permission disallow。

live_listen_disabled 来自 owner/device policy，不来自 playback。

device_offline 来自 nativeLink disconnected，不来自 playback 或 permission。
```

Server 只在 `media-session` WS 收到 `listen.request` 后尝试 accept listener。`admission.state !== open` 时必须返回 `session.rejected`，保持 WS 继续观测，且不能改变 stream demand，也不能给 Native 发 `stream.start`。

## 4. StreamDemand

Stream demand 表示 server 是否希望 Native 串流。

```ts
type StreamDemand = "wanted" | "not-wanted";
```

派生：

```ts
streamDemand = activeCount + graceCount > 0 ? "wanted" : "not-wanted";
```

规则：

```text
wanted
  至少一个 active 或 grace listener 仍贡献 demand。

not-wanted
  没有 active listener，也没有 grace listener。
```

Stream demand 不由 Native 决定。Native media playing 也不能自动产生 demand。唯一自动 demand 来源是 Web listener session。

当 `streamDemand = wanted` 且 `admission = open`：

```text
Server 可以给 Native 发 stream.start 或 stream.resume。
```

当 `streamDemand = not-wanted`：

```text
Server 必须停止 stream intent，并给 Native 发 stream.stop。
```

## 5. AudioFlow

Audio flow 只描述音频事实，不描述 Native 连接事实。

```ts
type AudioFlow =
  | "none"
  | "starting"
  | "flowing"
  | "stalled"
  | "failed";
```

含义：

```text
none      当前没有 server 认可的音频流
starting  server 已要求 Native 开始/恢复串流，但还没收到音频 chunk
flowing   server 最近收到音频 chunk
stalled   demand 仍存在，但超过阈值未收到音频 chunk
failed    当前音频流不可恢复失败
```

规则：

```text
AudioFlow 不允许出现 native-reconnecting。

Native WS 断开只改变 NativeLink。

如果 demand 仍 wanted 且长时间没有 chunk，AudioFlow 可以从 flowing/starting 变成 stalled。

如果 Native 在 grace 内重连并继续发 chunk，AudioFlow 回到 flowing。

如果 Native grace 过期、capture source lost、权限撤销或 ring buffer 无法恢复，AudioFlow 进入 failed 或 none，具体取决于是否要向 Web 表达错误。
```

## 6. 状态转换

### Web listener session accepted

前置：

```text
admission = open
```

转换：

```text
activeCount += 1
streamDemand = wanted
audioFlow = starting
send stream.start/resume to Native
```

原因：

Web listener demand 是 server 要求 Native capture 的唯一自动来源。

### Web listener WS close

转换：

```text
activeCount -= 1
graceCount += 1
listener.reconnectDeadlineAt = now + listenerGraceMs
streamDemand remains wanted while graceCount > 0
```

原因：

短断 listener 在 grace 内仍然属于 demand，不需要把 room 状态改成 recovering。

### Listener grace expired

转换：

```text
graceCount -= 1
if activeCount + graceCount = 0:
  streamDemand = not-wanted
  audioFlow = none
  send stream.stop(last_listener_disconnected)
```

原因：

Grace 过期后 listener 不再贡献 demand。

### Native WS connected

转换：

```text
nativeLink = connected
nativeGraceDeadlineAt = undefined
```

随后根据 Native `device.hello.availability` 派生 admission：

```text
available + playing media -> admission = open
unavailable(no_playable_media) -> admission = blocked(no_playable_media)
unavailable(policy/permission reason) -> admission = blocked(reason)
```

如果 `streamDemand = wanted` 且 `admission = open`：

```text
send stream.start/resume
audioFlow = starting
```

### Native WS disconnected

转换：

```text
nativeLink = disconnected
nativeGraceDeadlineAt = now + nativeGraceMs
```

AudioFlow 处理：

```text
if streamDemand = wanted:
  audioFlow = stalled after no-chunk threshold
else:
  audioFlow = none
```

原因：

Native link 断开不是 stream runtime 状态。不要写成 `native-reconnecting`。

### Native grace expired

转换：

```text
nativeLink = disconnected
nativeGraceDeadlineAt = undefined
admission = blocked(device_offline)
```

如果仍有 stream demand：

```text
audioFlow = failed
emit stream.error 或 stream.ended，取决于产品语义
```

### Native reports no playable media

输入：

```text
availability.updated(unavailable, reason = no_playable_media)
```

转换：

```text
admission = blocked(no_playable_media)
audioFlow = none if stream was running
streamDemand remains derived from listener counts
```

如果当前有音频流：

```text
send stream.ended(no_playable_media) to Web
send stream.stop(no_playable_media) to Native if needed
```

原因：

这是 playback paused，不是 owner permission disallow。

### Native reports owner/policy disallow

输入：

```text
availability.updated(unavailable, reason = live_listen_disabled | capture_permission_* | unsupported_app | capture_source_*)
```

转换：

```text
admission = blocked(reason)
audioFlow = failed 或 none
```

如果当前有音频流：

```text
send stream.error(reason) 或 stream.ended(reason)
send stream.stop(reason)
```

原因：

这是 permission/policy/capture runtime 阻断，不是 playback paused。

### Native sends audio chunk

前置：

```text
streamDemand = wanted
nativeLink = connected
```

转换：

```text
audioFlow = flowing
lastChunkAt = now
latestSeq += 1
```

如果没有 demand：

```text
drop chunk
audioFlow remains none
```

## 7. Protocol Shape

Live Listen server snapshot 直接暴露事实字段：

```ts
type LiveListenServerSnapshot = {
  protocol: "live-listen.server.v1";
  workspaceId: string;
  roomId: string;
  updatedAt: string;
  listeners: {
    activeCount: number;
    graceCount: number;
    demand: "wanted" | "not-wanted";
  };
  nativeLink: {
    state: "connected" | "disconnected" | "error";
    disconnectedAt?: string;
    graceDeadlineAt?: string;
    lastError?: { code: string; message: string };
  };
  admission: {
    state: "open" | "blocked";
    reason?: string;
  };
  streamDemand: {
    state: "wanted" | "not-wanted";
    reason: "listener-demand" | "no-listeners" | "manual-stop";
    updatedAt: string;
  };
  audioFlow: {
    state: "none" | "starting" | "flowing" | "stalled" | "failed";
    streamId?: string;
    generation?: number;
    latestSeq: number;
    availableFromSeq: number;
    lastChunkAt?: string;
    failure?: { code: string; message: string };
  };
  media: {
    current: LiveListenMedia | null;
    playback: "playing" | "paused";
    updatedAt?: string;
  };
};
```

字段规则：

```text
listeners.demand 必须由 activeCount + graceCount 派生。
streamDemand.state 必须等于 listeners.demand，除非显式 manual-stop 结束当前 session。
admission 必须由 nativeLink + Native media permission + Native playback 派生。
audioFlow 只描述音频，不描述 native link。
media.playback 是展示事实，不等于 owner permission。
```

协议禁止概念：

```text
顶层 lifecycle 字符串
单个 listener count 代替 active/grace 两个计数
把 listener grace 命名成 recovering 状态
把 native grace 命名成 reconnecting 状态
把 native link 状态塞进 audio flow
把 stream demand 命名成 intent
把 admission 包装成 availability
```

这些字段要么混合了多个事实，要么把 deadline/grace 包装成假状态。

## 8. UI Derivations

UI 可以派生显示标签，但派生标签不进入协议：

```text
No listener
  listeners.demand = not-wanted

Waiting for audio
  listeners.demand = wanted
  audioFlow = starting

Listening
  listeners.demand = wanted
  audioFlow = flowing

Audio stalled
  listeners.demand = wanted
  audioFlow = stalled

Blocked
  admission = blocked

Native offline
  nativeLink = disconnected
```

这些是 UI label，不是 server state。

## 9. Invariants

```text
listener demand = activeCount + graceCount > 0
streamDemand is derived from listener demand
streamDemand=not-wanted implies audioFlow=none
admission=open implies nativeLink=connected
admission=open implies native permission allow and playback playing
no_playable_media means playback paused, not permission disallow
device_offline means nativeLink disconnected/error, not playback paused
Native WS disconnect changes NativeLink only
listener WS close changes ListenerPresence only
audioFlow never uses native-reconnecting/recovering/reconnecting as a value
server never sends stream.start when admission=blocked
server never sends stream.start when streamDemand=not-wanted
```

Any violation of these invariants is a protocol bug.
