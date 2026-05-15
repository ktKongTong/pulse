# Live Listen Web Media State

本文描述 Web 侧的 Live Listen media 状态。Web 不是 media owner，也不是 server；Web 只需要回答三个问题：

```text
1. Web 和 Live Listen server 的 WS 是否可用
2. 当前是否允许发起一起听
3. 当前这个 Web tab 是否正在一起听
```

因此 Web 侧 media 状态只由三个正交事实组成：

```text
WebMediaState = WsConnection x Streamable x Streaming
```

对应协议/代码形状：

```ts
type WebLiveListenMediaState = {
  ws: "on" | "off" | "half-off" | "error";
  streamable:
    | { value: true }
    | { value: false; reason: WebStreamBlockedReason };
  streaming: boolean;
};
```

Web 不再暴露 `idle`、`starting`、`live`、`buffering`、`recovering`、`native-reconnecting` 之类混合状态。那些名字无法说明到底是 Web WS、server admission、Native link、owner playback，还是本地 listener intent 出了变化。

## 1. WS Connection

```ts
type WebWsConnection =
  | "on"
  | "off"
  | "half-off"
  | "error";
```

含义：

```text
on       当前 Web listener/observe WS 可用
off      当前没有 Web WS，且 Web 没有继续恢复这次一起听的意图
half-off Web WS 已断开，但当前 tab 仍处于 streaming=true，正在等待恢复或执行重连
error    鉴权、协议、schema、房间等不可自动恢复错误
```

规则：

```text
ws 只描述 Web -> server 这条连接。
ws 不描述 Native 是否连接。
ws 不描述 owner 是否正在播放。
ws 不描述 server 是否正在收到音频。
```

`half-off` 只允许表达一种情况：

```text
之前已经 streaming=true，Web WS 意外断开，但当前 tab 仍保留一起听意图。
```

如果用户没有在听，WS 断开不能进入 `half-off`，只能是：

```text
ws=off
streaming=false
```

不可自动恢复错误必须进入：

```text
ws=error
streaming=false
```

## 2. Streamable

```ts
type WebStreamable =
  | { value: true }
  | { value: false; reason: WebStreamBlockedReason };
```

含义：

```text
true   当前可以发起一起听
false  当前不能发起一起听，reason 说明阻断原因
```

`streamable` 是 server admission 投影到 Web 的结果。Web 不拆 server/native 的内部事实，不在 Web 状态里重新建模 Native permission、owner playback、capture runtime、server audio flow。

典型 reason：

```text
device_offline
live_listen_disabled
no_playable_media
capture_permission_missing
capture_permission_revoked
capture_source_unavailable
capture_source_lost
unsupported_app
native_error
connection_lost
snapshot_unavailable
auth_failed
protocol_error
```

规则：

```text
server admission=open
  -> streamable=true

server admission=blocked(reason)
  -> streamable=false(reason)

Web 没有可信 server snapshot，且当前没有 streaming=true
  -> streamable=false(snapshot_unavailable | connection_lost)

ws=error
  -> streamable=false(auth_failed | protocol_error | native_error 等具体原因)
```

`no_playable_media` 表示 owner 当前没有正在播放的 media。它不是 Web 的 permission，也不是 Native owner policy。

## 3. Streaming

```ts
type WebStreaming = boolean;
```

含义：

```text
true   当前这个 Web tab 正在一起听，或者因为连接短断仍保留一起听意图
false  当前这个 Web tab 没有一起听
```

规则：

```text
streaming=true, ws=on
  表示 Web listener WS 已连接，正在收听。

streaming=true, ws=half-off
  表示之前正在收听，WS 意外断开，Web 保留一起听意图并尝试恢复。

streaming=false
  表示当前 tab 没有一起听。此时不能进入 ws=half-off。
```

`streaming` 不等于 owner 正在播放。Owner 是否可 stream 已经由 `streamable` 表达。

`streaming` 也不等于 Web 本地一定正在出声。Web 侧如果需要 debug 音频播放质量，可以另外放 diagnostics，例如 bytes received、last frame time、audio element error，但这些不是 media 状态轴。

## 4. Command Pending 不属于 Media State

点击 Join、Leave、Reconnect 是用户命令，不是稳定 media 状态。

UI 可以有单独字段：

```ts
type WebLiveListenCommand =
  | "idle"
  | "joining"
  | "leaving"
  | "reconnecting";
```

这个字段只用于按钮 loading、禁用重复点击、展示当前操作。它不能替代 `ws`、`streamable`、`streaming`。

因此：

```text
joining      不是 media state
leaving      不是 media state
reconnecting 不是 media state
```

## 5. 状态转换

### 初始状态

```text
ws=off
streamable=false(snapshot_unavailable)
streaming=false
```

### 拿到可信 server snapshot，且 admission open

```text
ws=on
streamable=true
streaming=false
```

这表示可以一起听，但当前 tab 还没开始听。

### 拿到可信 server snapshot，但 admission blocked

```text
ws=on
streamable=false(reason)
streaming=false
```

例如 owner 没有播放：

```text
ws=on
streamable=false(no_playable_media)
streaming=false
```

Web 入口必须禁用，不能创建 listener session，不能触发 Native capture。

### 用户点击 Join

前置：

```text
ws=on
streamable=true
streaming=false
```

命令中：

```text
command=joining
```

成功后：

```text
ws=on
streamable=true
streaming=true
command=idle
```

失败后：

```text
streaming=false
command=idle
streamable=false(reason)
```

如果失败原因是可恢复网络错误：

```text
ws=off
streamable=false(connection_lost)
streaming=false
```

如果失败原因不可恢复：

```text
ws=error
streamable=false(auth_failed | protocol_error)
streaming=false
```

### 正在听时 Web WS 意外断开

前态：

```text
ws=on
streamable=true
streaming=true
```

转换：

```text
ws=half-off
streamable=false(connection_lost)
streaming=true
command=reconnecting
```

含义：

当前 tab 仍然处于一起听意图，但 Web WS 不可用。Web 可以按重连策略恢复 listener WS。

### half-off 恢复成功

```text
ws=on
streamable=true
streaming=true
command=idle
```

### half-off 恢复超时或用户取消

```text
ws=off
streamable=false(connection_lost)
streaming=false
command=idle
```

### 正在听时 server 返回不可恢复错误

```text
ws=error
streamable=false(reason)
streaming=false
command=idle
```

不可恢复 reason 包括：

```text
auth_failed
protocol_error
room_not_found
session_rejected
```

### 用户点击 Leave

前态：

```text
streaming=true
```

命令中：

```text
command=leaving
```

完成后：

```text
ws=off
streaming=false
command=idle
```

如果仍保留 observe WS 或定时 snapshot 刷新，可以继续从 server 更新 `streamable`；但 listener WS 已经关闭，`streaming` 必须是 false。

## 6. 合法组合

可以一起听但没听：

```text
ws=on
streamable=true
streaming=false
```

正在一起听：

```text
ws=on
streamable=true
streaming=true
```

不能一起听：

```text
ws=on
streamable=false(no_playable_media | device_offline | live_listen_disabled)
streaming=false
```

正在听但连接短断：

```text
ws=half-off
streamable=false(connection_lost)
streaming=true
```

不可恢复错误：

```text
ws=error
streamable=false(reason)
streaming=false
```

未连接且没在听：

```text
ws=off
streamable=false(snapshot_unavailable | connection_lost)
streaming=false
```

## 7. 不允许的组合

```text
ws=half-off
streaming=false
```

不允许。`half-off` 只表示正在听时连接短断；没有 streaming intent 时就是 `off`。

```text
ws=error
streaming=true
```

不允许。不可恢复错误必须结束当前 streaming。

```text
streamable=true
reason=*
```

不允许。`reason` 只存在于 `streamable=false`。

```text
streamable=false(no_playable_media)
streaming starts
```

不允许。没有播放中的 media 时，Web 不得创建 listener session，也不得触发 Native capture。

## 8. UI 映射

Join 按钮：

```text
enabled  = ws=on && streamable=true && streaming=false && command=idle
disabled = otherwise
```

Stop/Leave 按钮：

```text
visible/enabled = streaming=true
```

Reconnect 按钮：

```text
visible = ws=half-off || ws=error || streamable=false(connection_lost)
```

主文案：

```text
ws=on, streamable=true, streaming=false
  可以一起听

ws=on, streamable=true, streaming=true
  正在一起听

ws=on, streamable=false(no_playable_media), streaming=false
  当前没有播放中的媒体

ws=half-off, streaming=true
  连接断开，正在恢复一起听

ws=error
  一起听连接错误
```

这份状态模型只约束 Web 侧 UI 和 hook 输出。Native 四轴状态、server 五组事实分别由对应文档描述，Web 只消费 server 给出的结论，不重复展开内部状态机。
