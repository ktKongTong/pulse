# Live Listen Native Media State

本文描述 Pulse Native 侧的 media 状态空间。这里的 media 状态不是一个单独字符串，而是四个正交事实的组合：

```text
NativeMediaState = WsConnection x MediaPermission x MediaPlayback x CaptureRuntime
```

四个轴分别回答四个不同问题：

```text
ws              Native 和 Live Listen server 的 device-session WS 是否可用
mediaPermission Native 是否允许把当前 media 暴露给一起听
mediaPlayback   当前 media 是否正在播放
capture          Native 是否正在采集并准备发送音频
```

这四个轴必须分开。任何 UI、协议字段、server 判断都不能用其中一个轴替代另一个轴。

## 状态轴

### 1. WS Connection

```ts
type NativeWsConnection =
  | "on"
  | "off"
  | "half-off"
  | "error";
```

含义：

```text
on       device-session WS 已连接，server 可以下发 stream.start/resume/stop
off      没有可用 WS，且当前没有自动重连任务
half-off WS 暂时断开，但 Native 仍认为连接应恢复，正在等待自动重连
error    WS 因不可自动恢复的错误失败，例如鉴权失败、协议错误、server 主动拒绝
```

当前实现映射：

```text
LiveListenPublisherConnectionState.connected     -> on
idle / stopped                                   -> off
connecting / reconnecting                        -> half-off
failed                                           -> error
```

`1003 invalid device frame`、`1008 policy violation`、`1000 normal closure` 不应进入 `half-off` 自动重连。它们应进入 `error` 或 `off`，等待用户或配置变化触发显式重连。

### 2. Media Permission

```ts
type MediaPermission = "allow" | "disallow";
```

含义：

```text
allow     device owner 允许 Native 把 media stream 暴露给 Live Listen
disallow  device owner 不允许 Native 把 media stream 暴露给 Live Listen
```

`allow` 不是“WS 已连接”，也不是“当前真的有可播放 media”。`allow` 只描述 owner policy / device policy。它不关心当前是否实际可以 stream。

因此这些情况不能改变 `mediaPermission`：

```text
Spotify 没启动
当前没有 media
当前 media 暂停
当前 media 播放结束
```

这些都属于 `mediaPlayback = paused`，不是 permission 被 disallow。

`disallow` 只由明确的 policy 或授权阻断触发：

```text
Live Listen 功能被禁用
device owner 不允许 media stream
当前 app/source 不支持 Live Listen
用户或系统授权不允许暴露当前 media
capture/source 权限阻断 media stream
```

协议映射：

```text
allow + playing     availability.state = "available"
allow + paused      availability.state = "unavailable", reason = "no_playable_media"
disallow + any      availability.state = "unavailable", reason = policy/permission reason
```

`availability.state = "available"` 是 server admission 结果，不是 permission 原样映射。它必须同时满足：

```text
ws = on
mediaPermission = allow
mediaPlayback = playing
```

所以没有 playing media 时不能上报 available，但这不代表 owner 不允许 media stream。

典型 `disallow` reason：

```text
live_listen_disabled
capture_permission_missing
capture_permission_revoked
capture_source_unavailable
capture_source_lost
unsupported_app
```

### 3. Media Playback

```ts
type MediaPlayback = "playing" | "paused";
```

含义：

```text
playing 当前 media 正在播放
paused  当前没有播放中的 media，包括暂停、停止、没有 media、media app 未启动
```

这里刻意只保留两态。Native 可以在内部区分 stopped / unknown / no app，但对 Live Listen admission 来说，这些都不能触发 capture，统一进入 `paused`。

协议映射：

```text
playing  availability.available.media.playbackState = "playing"
paused   availability.unavailable(reason = "no_playable_media")
```

`no_playable_media` 归属于 playback 轴的 paused 状态。它表示 owner 允许 stream，但当前没有正在播放的 media 可被 stream。

`media.updated` 可以上报 paused media 用于 UI 展示最近媒体，但 paused media 不能让 `availability` 变成 available。

### 4. Capture Runtime

```ts
type CaptureRuntime = "capturing" | "no-capture";
```

含义：

```text
capturing   Native 本地 capture/tap 已启动，正在采集 PCM 或准备发送 chunk
no-capture  Native 本地 capture/tap 未启动
```

`capturing` 不等于 WS `on`，也不等于 server `live`。例如网络短断时，Native 可以短暂处于：

```text
ws=half-off, mediaPermission=allow, mediaPlayback=playing, capture=capturing
```

这表示 Native 还在采集，并等待 WS 恢复后补发 ring buffer。这个状态必须有边界：超过 reconnect/buffer 能力后要停止 capture 或丢弃队列，不能无限采集。

## 合法状态与不可达组合

理论上四轴笛卡尔积有：

```text
4 x 2 x 2 x 2 = 32
```

但不是所有组合都应该长期存在。状态空间是笛卡尔积，业务规则定义哪些组合可达、哪些组合只能瞬时存在、哪些组合必须被纠正。

### 稳定合法组合

```text
on, allow, playing, no-capture
```

Native 已连接，当前 media 可一起听且正在播放，但还没有 web listener demand。此时 server `/state` 应显示：

```text
native.state = connected
availability.state = available
stream.intent = stopped
snapshot.state = idle
```

```text
on, allow, playing, capturing
```

有 web listener demand，server 已下发 start/resume，Native 正在采集。此时 server 可进入 `starting` 或 `live`。

```text
on, disallow, paused, no-capture
```

Owner 不允许 media stream，当前也没有播放。Web 点击一起听必须被 reject，不允许触发 capture。

```text
on, allow, paused, no-capture
```

Owner 允许 media stream，但当前没有 playing media。Web 点击一起听必须被 reject，reason 是 `no_playable_media`。

```text
half-off, allow, playing, capturing
```

WS 短断，Native 正在自动重连，capture 可以短暂继续。该状态只能在 ring buffer / reconnect grace 内存在。

```text
off, disallow, paused, no-capture
```

Native 没有 server 连接，owner 不允许 stream，且没有播放。server admission 必须 reject。

```text
off, allow, paused, no-capture
```

Owner 允许 stream，但 Native 没有 server 连接且没有播放。server admission 必须 reject；如果是 server 看到的状态，reason 应优先表达 `device_offline`。

```text
error, *, *, no-capture
```

WS 进入不可自动恢复错误。Native 必须停止 capture，清空 pending queue，等待手动 reconnect 或配置变化。

### 必须纠正的组合

```text
on, disallow, paused, capturing
```

Owner 已不允许 media stream，且 capture 仍在跑。Native 必须立即 stop capture，并发送 policy/permission 对应 reason：

```text
stream.stopped(reason = live_listen_disabled | capture_permission_revoked | capture_source_lost)
availability.updated(unavailable, reason = live_listen_disabled | capture_permission_revoked | capture_source_lost)
```

```text
on, allow, paused, capturing
```

Owner 仍允许 media stream，但 media 已暂停或不存在，capture 仍在跑。Native 必须立即 stop capture，并发送：

```text
stream.stopped(reason = "no_playable_media")
availability.updated(unavailable, reason = "no_playable_media")
```

```text
error, *, *, capturing
```

协议错误、鉴权错误、server policy close 后还在 capture。Native 必须停止 capture，不允许继续把 PCM 塞进队列。

```text
off, *, *, capturing
```

没有 WS 且没有重连意图时还在 capture。Native 必须停止 capture。

```text
half-off, disallow, paused, capturing
```

WS 正在重连，但 owner 已不允许 stream。Native 必须停止 capture，不能等重连成功后再处理。

```text
half-off, allow, paused, capturing
```

WS 正在重连，owner 仍允许 stream，但 media 已暂停或不存在。Native 必须停止 capture，不能等重连成功后再处理。

```text
available with mediaPlayback = paused
```

协议矛盾。`availability.available` 要求当前 media 可一起听并正在播放；paused media 不能使 availability 为 available。应纠正为：

```text
availability.unavailable(reason = "no_playable_media")
```

## 事件与转换

### Native 启动或 endpoint 配置有效

触发：

```text
Native app 启动
Settings 中存在 enabled Live Listen endpoint
用户点击 Reconnect Server
```

转换：

```text
ws: off/error -> half-off -> on
```

连接成功后 Native 必须发送 `device.hello`。hello 必须携带当前 media admission：

```text
owner allow + 有 playing media:
  mediaPermission = allow
  mediaPlayback = playing
  availability = available(media.playbackState = playing)

owner allow + 无 playing media:
  mediaPermission = allow
  mediaPlayback = paused
  availability = unavailable(no_playable_media)

owner disallow:
  mediaPermission = disallow
  mediaPlayback = playing 或 paused
  availability = unavailable(policy/permission reason)
```

原因：

Server 必须在 listener join 前知道是否能开始一起听。Native 连接本身不能代表可以 capture。

### WS 正常关闭

触发：

```text
Native 主动 stop
server normal close
用户关闭 endpoint
```

转换：

```text
ws: on/half-off -> off
capture: capturing -> no-capture
```

原因：

没有 device-session 时 server 无法控制 Native；如果没有自动重连意图，继续 capture 没有消费者。

### WS 可恢复断开

触发：

```text
网络短断
server 临时不可达
非 policy/protocol close
```

转换：

```text
ws: on -> half-off
capture: capturing 可短暂保持
```

条件：

```text
mediaPermission = allow
mediaPlayback = playing
capture = capturing
重连仍在 backoff/reconnect grace 内
pending queue 未超过上限
```

原因：

短断时继续 capture 可以保留连续音频。但这个状态必须受 ring buffer 和重连策略限制。

### WS 不可恢复错误

触发：

```text
1003 invalid device frame
1008 policy violation
401/403 鉴权失败
协议版本不兼容
endpoint 配置错误
```

转换：

```text
ws: on/half-off -> error
capture: capturing -> no-capture
queue: clear
```

原因：

这些错误靠自动重连不会恢复。继续重连只会制造重连风暴；继续 capture 只会堆本地内存。

### Media 从 paused/no media 变成 playing

触发：

```text
用户开始播放 Spotify
当前支持的 media app 开始播放
Native refresh 检测到 media identity/playbackState 变化
```

转换：

```text
mediaPlayback: paused -> playing
mediaPermission: 不变
capture: 不变
```

Native 上报：

```text
media.updated(media.playbackState = playing)
availability.updated(available, media.playbackState = playing)
```

原因：

这只改变 playback 轴。只有当 mediaPermission 已经是 allow 且 ws 是 on 时，server admission 才会变成可接受 listener。capture 仍由 server listener demand 触发。

### Media 从 playing 变成 paused/no media

触发：

```text
用户暂停 Spotify
用户退出 Spotify
当前 track 结束且没有下一首
media app/source 消失
Native refresh 检测到 media identity/playbackState 变化
```

转换：

```text
mediaPlayback: playing -> paused
mediaPermission: 不变
capture: capturing -> no-capture
```

Native 上报：

```text
media.updated(media.playbackState = paused)        // 如果仍有 media 对象
availability.updated(unavailable, no_playable_media)
stream.stopped(no_playable_media)                  // 如果 capture 正在运行
```

原因：

没有播放中的 media 时，继续 capture 没有业务意义。Server 应结束当前 stream，并 reject 后续 listener；这不表示 owner 撤销了 stream permission。

### Web listener 请求一起听

触发：

```text
Web 点击一起听
Web 通过常驻 /api/v1/live-listen/media-session WS 发送 listen.request
```

Server admission：

```text
只在 ws=on 且 mediaPermission=allow 且 mediaPlayback=playing 时 accepted
其他组合全部 rejected
```

Accepted 后转换：

```text
capture: no-capture -> capturing
```

机制：

```text
server sets stream.intent = running
server sends stream.start/resume to Native
Native starts capture only after command
```

原因：

Web listener demand 是 capture 的唯一自动启动原因。Native 不因 media playing 自己启动 capture。

### 所有 listener 离开或过期

触发：

```text
Web 主动 leave
session close 超过 reconnect grace
room listenerCount 归零
```

转换：

```text
capture: capturing -> no-capture
stream.intent: running -> stopped
```

Server 下发：

```text
stream.stop(reason = last_listener_disconnected)
```

原因：

没有 listener demand 时不应继续采集。

### Capture 权限或 source 失败

触发：

```text
系统音频权限缺失
权限运行中被撤销
target app/source 消失
capture tap 创建失败
```

转换：

```text
mediaPermission: allow -> disallow
capture: capturing -> no-capture
```

Native 上报：

```text
availability.updated(unavailable, capture_permission_missing | capture_permission_revoked | capture_source_unavailable | capture_source_lost)
stream.stopped(capture_permission_revoked | capture_source_lost)
```

原因：

这是 owner/device policy 或 capture runtime 的失败，不是 playback 失败，也不是 web listener 的失败。Server 要结束 stream，并给 Web 发送 `stream.error` 或 `stream.ended`。

## Server 字段映射

Server snapshot 不是 native 四轴状态本身，但它必须能表达四轴事实：

```text
ws              -> snapshot.native.state
mediaPermission -> unavailable policy/permission reason, 或 native 内部 owner policy
mediaPlayback   -> availability.media.playbackState 或 no_playable_media
capture          -> snapshot.native.state + snapshot.stream.actualState
```

推荐映射：

```text
ws=on, capture=no-capture
  native.state = connected

ws=on, capture=capturing
  native.state = streaming

ws=half-off
  native.state = reconnecting

ws=off
  native.state = offline

ws=error
  native.state = failed
```

```text
mediaPermission=allow, mediaPlayback=playing
  availability = available(media.playbackState = playing)

mediaPermission=allow, mediaPlayback=paused
  availability = unavailable(no_playable_media)

mediaPermission=disallow
  availability = unavailable(live_listen_disabled | permission/source/policy reason)
```

`snapshot.state` 是 room lifecycle，不是 native media state：

```text
idle      没有正在进行的一起听 room session
starting  listener 已 accepted，等待 native capture/audio
live      room 正在向 listener 提供音频
error     room session 失败
```

因此以下组合是合理的：

```text
snapshot.state = idle
native.state = connected
availability.state = available
media.playbackState = playing
stream.intent = stopped
```

它表示“可以一起听，但还没人请求”，不是 live。

## UI 显示规则

Native UI 不应该显示一个混合状态。它应该展示四轴：

```text
Server    connected / reconnecting / disconnected / error
Permission allowed / not allowed
Playback  playing / paused
Capture   capturing / idle
```

按钮规则：

```text
Reconnect Server
  ws=off/error/half-off 时可用

Stop Capture
  capture=capturing 时可用

Capture sample
  只用于本地诊断，不影响 Live Listen room session
```

Web “一起听”按钮：

```text
enabled  only if mediaPermission=allow and mediaPlayback=playing and ws=on
disabled otherwise
```

即使 Web UI 判断错误，server 在处理 `listen.request` 时仍必须用同样规则 reject。

## Invariants

这些规则必须始终成立：

```text
available implies media.playbackState = playing
paused + permission allow implies unavailable(no_playable_media)
permission disallow is never caused by no_playable_media
error implies capture = no-capture
off implies capture = no-capture unless transitioning to half-off immediately
listener accepted implies ws on + permission allow + playback playing
capture starts only after server stream.start/resume
capture stops when media becomes paused
capture stops when permission becomes disallow
capture stops when all listeners leave
1003/1008 do not auto reconnect
```

任何实现、测试或 UI 如果违反这些 invariants，就是 bug。
