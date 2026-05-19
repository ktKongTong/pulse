# Device 侧状态机设计

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、`common`、`macosApp`
状态：draft
验证：设计文档；落地时需要同步 protocol schema、worker/native 测试和端到端验证

本文定义 device 侧 media 状态机，用来约束 native 本地状态表达，以及 `device.media.v1 / stream.state.updated` 的状态语义。

## 状态空间

```text
DeviceMediaState = DeviceServerConnection x MediaPermission x MediaPlayback x CaptureRuntime
```

```text
connection  device 与 server 的双 WS 连接是否可用
permission  device owner 当前是否允许把 media 暴露给 server
playback    当前是否存在可播放中的 media
capture     device 当前是否正在采集或准备发送音频
```

## 状态轴

### DeviceServerConnection

```ts
type DeviceServerConnection =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "failed";
```

```text
connected     common WS 和 media WS 都已建立并完成 hello/auth
disconnected  当前没有可用连接，也没有自动重连任务
reconnecting  连接暂时断开，native 正在等待自动重连
failed        连接进入不可自动恢复的失败，需要手动干预或配置变化
```

规则：

- `1003 invalid device frame`、`1008 policy violation`、鉴权失败、协商失败进入 `failed`，不进入 `reconnecting`。
- `connected` 只表示连接可用，不表示当前一定可供流。
- `reconnecting` 可以短暂保留采集；`disconnected` 和 `failed` 不允许稳定保留采集。

### MediaPermission

```ts
type MediaPermission = "allow" | "disallow";
```

```text
allow      owner policy 允许把当前 media 暴露给 server
disallow   owner policy 或权限约束不允许暴露当前 media
```

以下情况不改变 `permission`，只改变 `playback`：

```text
当前没有 media
当前 media 暂停
当前 media 播放结束
媒体 app 未启动
```

典型 `disallow` 原因：

```text
live_listen_disabled
capture_permission_missing
capture_permission_revoked
capture_source_unavailable
capture_source_lost
unsupported_app
native_error
```

### MediaPlayback

```ts
type MediaPlayback = "playing" | "paused";
```

```text
playing  当前存在可播放中的 media
paused   当前没有播放中的 media，包括暂停、停止、无媒体、媒体 app 未启动
```

`paused` 统一表示“当前没有 playable media”。

### CaptureRuntime

```ts
type CaptureRuntime = "capturing" | "no-capture";
```

```text
capturing   native 本地 capture/tap 已启动，正在采集或准备发送音频
no-capture  当前没有采集任务
```

`capturing` 是运行事实，不代表连接一定可用。

## 对协议的映射

`device.media.v1 / stream.state.updated` 直接承载后三条轴：

```ts
type StreamState = {
  permission: "allow" | "disallow";
  playback: "playing" | "paused";
  capture: "capturing" | "no-capture";
  streamFormat?: StreamFormat;
  reason?: StreamBlockedReason | "native_error";
  message?: string;
};
```

映射规则：

- `connection` 不放进 `stream.state.updated`，由 device/common/media WS 连接事实表达。
- `permission`、`playback`、`capture` 直接映射到 `stream.state.updated.state`。
- `reason` 用于解释 `disallow`、`paused` 或错误原因。

## 可供流判定

device 可供流当且仅当：

```text
connection = connected
permission = allow
playback = playing
```

此时 `capture` 可以是：

```text
no-capture   当前可供流，但还没有开始采集
capturing    当前已经开始采集并供流
```

以下任一条件成立时，device 不能继续供流：

```text
connection != connected
permission = disallow
playback = paused
```

## 稳定组合

### connected, allow, playing, no-capture

可供流，但当前还没有实际采集。

### connected, allow, playing, capturing

正在采集并供流。

### connected, allow, paused, no-capture

owner 允许一起听，但当前没有 playable media。收到供流请求时必须以 `no_playable_media` 拒绝。

### connected, disallow, playing, no-capture
### connected, disallow, paused, no-capture

当前不允许向外供流。`playing` 与否只影响 now playing，不改变阻断结论。

### reconnecting, allow, playing, capturing

允许短暂存在，用于本地继续采集并等待恢复；超过本地重连或 buffer 能力后，必须退出 `capturing`。

### disconnected, *, *, no-capture
### failed, *, *, no-capture

离线或失败时不采集。

## 必须立即纠正的组合

### connected, disallow, *, capturing

必须立即停止 capture，并上报对应阻断原因。

### connected, allow, paused, capturing

必须立即停止 capture，并上报 `no_playable_media`。

### disconnected, *, *, capturing
### failed, *, *, capturing

不允许稳定存在。必须立即停止 capture。

## 状态转换

### 连接建立成功

```text
disconnected -> reconnecting -> connected
failed -> reconnecting -> connected
```

连接完成后，device 进入当前真实的 `permission/playback/capture` 组合，并发送当前 `stream.state.updated` snapshot。

### 连接暂时断开

```text
connected -> reconnecting
```

如果当前是 `capturing`，可以短暂保持；超过本地重连或 buffer 能力后：

```text
reconnecting, *, *, capturing -> reconnecting, *, *, no-capture
```

### 连接不可恢复失败

```text
connected/reconnecting -> failed
```

进入 `failed` 时必须停止 capture。

### playback 从 `paused` 变成 `playing`

```text
connected, allow, paused, no-capture -> connected, allow, playing, no-capture
connected, disallow, paused, no-capture -> connected, disallow, playing, no-capture
```

这只改变 `playback`，不自动启动 capture。

### playback 从 `playing` 变成 `paused`

```text
connected, allow, playing, no-capture -> connected, allow, paused, no-capture
connected, allow, playing, capturing -> connected, allow, paused, no-capture
connected, disallow, playing, no-capture -> connected, disallow, paused, no-capture
```

如果之前在 `capturing`，必须立即停止 capture，并上报 `no_playable_media`。

### permission 从 `allow` 变成 `disallow`

```text
connected, allow, *, no-capture -> connected, disallow, *, no-capture
connected, allow, *, capturing -> connected, disallow, *, no-capture
```

如果之前在 `capturing`，必须立即停止 capture，并上报对应 policy/permission reason。

### permission 从 `disallow` 变成 `allow`

```text
connected, disallow, playing, no-capture -> connected, allow, playing, no-capture
connected, disallow, paused, no-capture -> connected, allow, paused, no-capture
```

这只恢复“可供流资格”，不自动启动 capture。

### capture 启动

```text
connected, allow, playing, no-capture -> connected, allow, playing, capturing
```

### capture 停止

```text
connected, allow, playing, capturing -> connected, allow, playing, no-capture
connected, allow, paused, capturing -> connected, allow, paused, no-capture
connected, disallow, *, capturing -> connected, disallow, *, no-capture
reconnecting, *, *, capturing -> reconnecting, *, *, no-capture
```

## Invariants

```text
capturing => permission = allow
capturing => playback = playing
capturing => connection ∈ { connected, reconnecting }
connection ∈ { disconnected, failed } => capture = no-capture
playback = paused => 当前不可供流
permission = disallow => 当前不可供流
```

任何实现、测试或 UI 如果违反这些约束，就是 bug。
