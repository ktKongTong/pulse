# Pulse Realtime Protocols

本文档描述 Pulse 当前的两条上行通信协议：

1. `PulseBar(macOS) -> server` 使用 `presence.v2`
2. `Web(blog/demo) -> server` 使用 `web.v1`

以及它们如何在服务端 Durable Object 中被归一化为统一的房间快照模型。

文中不会重复列出所有字段定义源码，而是重点说明：

- 每一端本地状态从哪里来
- 发出去的协议长什么样
- 服务端如何聚合
- demo/web 客户端最终消费的内部模型是什么

源码入口：

- `presence.v2` TS mirror
  - [presence-v2.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/presence-v2.ts)
- `web.v1`
  - [web-v1.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/web-v1.ts)
- 统一房间流协议
  - [realtime-v2.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/realtime-v2.ts)
- Live Listen audio-only 房间协议
  - [live-listen-v1.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/live-listen-v1.ts)
  - [Live Listen MVP](/Users/kt/Documents/Playground/pulse/docs/live-listen-mvp.md)
- Worker 路由
  - [index.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/index.ts)
- Worker 房间聚合
  - [device-do.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/device-do.ts)
  - [base-room.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/base-room.ts)
  - [global-status-room.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/global-status-room.ts)
  - [page-status-room.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/page-status-room.ts)
  - [chat-room.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/chat-room.ts)
  - [room-view-helpers.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/room-view-helpers.ts)
  - [session-do.ts](/Users/kt/Documents/Playground/pulse/apps/realtime-worker/src/session-do.ts)
- macOS KMP bridge
  - [PulseBarBridge.macos.kt](/Users/kt/Documents/Playground/pulse/common/src/macosMain/kotlin/io/github/kt/pulsebar/export/PulseBarBridge.macos.kt)
- web client hooks
  - [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts)

## 1. Overall topology

当前系统有三层状态：

1. `producer-local state`
   - macOS 端自己的前台应用/页面/媒体状态
   - 浏览器端自己的页面/阅读/可见性状态
2. `ingest protocol state`
   - `presence.v2`
   - `web.v1`
3. `server-derived room state`
   - `RoomSnapshot`
   - `RoomReader`
4. `room-scoped websocket session capability`
   - `GlobalStatusRoom / PageStatusRoom / ChatRoom` 继承的 session 抽象
   - 每个 room 一条 websocket，自身完成 hibernation attachment 与 fan-out

也就是：

```text
macOS local state ----presence.v2----\
                                       -> Durable Object room state -> room-scoped realtime.ws.v2 socket
web local state ------web.v1---------/
```

这意味着：

- `presence.v2` 和 `web.v1` 是“上行写协议”
- `realtime.v1-stream` 是“下行读协议”
- 服务端不是简单转发，而是做去重、过期、房间归属、全局聚合
- `RoomDO` 会直接向本 room 内的 websocket 连接广播 snapshot，不再经过独立 `SessionDO` hub

## 2. PulseBar -> Server: `presence.v2`

### 2.1 PulseBar 内部源模型

macOS 端当前采集的内部状态入口在：

- [PulseBarBridge.macos.kt](/Users/kt/Documents/Playground/pulse/common/src/macosMain/kotlin/io/github/kt/pulsebar/export/PulseBarBridge.macos.kt)

本地核心模型是：

- `PulseBarSnapshot`
  - `appName`
  - `bundleId`
  - `pageTitle?`
  - `observedAtIso8601`
  - `media?`
- `PulseBarMedia`
  - `providerId`
  - `source`
  - `itemType`
  - `title`
  - `artist`
  - `album?`
  - `albumArtist?`
  - `artworkUrl?`
  - `progressSeconds`
  - `durationSeconds`
  - `linkUrl?`
  - `trackId?`
  - `isPlaying`
  - `trackNumber?`
  - `discNumber?`
  - `collectionId?`
  - `collectionTitle?`
  - `collectionLinkUrl?`

状态采集来源：

- frontmost app: `NSWorkspace` + `System Events` 回退
- browser title: AppleScript
- media providers: AppleScript + provider registry

当前媒体 provider 采集策略：

- `Spotify`
- `Apple Music`
- `NeteaseMusic / 网易云音乐`
- `QQMusic / QQ音乐`

但不是让用户手动选择平台，而是自动探测：

- 只要某个平台能返回合法的 now playing，就进入候选集合
- 没装或不支持时静默跳过
- 不会弹系统 `Choose Application`

当前媒体源仲裁规则：

1. `frontmost media app && playing`
2. `任意 playing provider`
3. `上一次已经选中的 provider`
4. `frontmost media app`
5. 其他候选

这样可以避免：

- 后台暂停的 `Spotify` 长期压住前台正在播放的 `Apple Music`
- 用户在平台之间切换后又被“旧 provider”抢回去

### 2.2 发送时机

`presence.v2` 不是纯轮询上报，而是“读取稳定快照时同步 + 显著媒体变化主动推送”。

当前触发点：

- `readMenuState()` 产生新快照后会走 reporter `sync(...)`
- `mediaCommand(...)` 成功后立即 `forceSync(...)`
- `seekMedia(...)` 成功后立即 `forceSync(...)`
- 同轨播放中如果检测到显著进度跳变，也会主动当作新 snapshot 发出

这意味着：

- 普通播放秒数不会疯狂刷事件
- 但 `seek`、`play/pause`、`next/previous` 这种显著变化会立刻传到服务端

### 2.3 `presence.v2` 协议职责

`presence.v2` 负责表达“设备此刻的正交状态”。

关键结构：

- `PresenceIngestRequest`
  - `workspaceId`
  - `deviceId`
  - `sessionId`
  - `events[]`
- `PresenceEvent`
  - `eventId`
  - `seq`
  - `kind = snapshot | heartbeat | session_end`
  - `state?`
- `PresenceStatePayload`
  - `availability`
  - `focus`
  - `presenceKind`
  - `mediaSessions[]`
  - `device`
  - `capabilities`

设计重点：

- 不是扁平 `ACTIVE/AWAY`，而是把 `availability`、`focus`、`presenceKind` 分离
- `media` 不与 Spotify 绑定，而是通用 `mediaSessions[]`
- 设备协议可以同时承载 app、page、media

### 2.4 PulseBar 内部状态 -> `presence.v2` 的变换

变换逻辑发生在 KMP bridge 内，而不是 Swift UI 层。

从本地快照到线上的主要映射：

- `PulseBarSnapshot.appName/bundleId`
  -> `state.focus.app.name/id`
- `PulseBarSnapshot.pageTitle`
  -> `state.focus.page.title`
- `PulseBarMedia`
  -> `state.mediaSessions[0]`
- `PulseBarMedia.providerId`
  -> `state.mediaSessions[0].provider.id`
- `PulseBarMedia.itemType`
  -> `state.mediaSessions[0].item.type`
- `PulseBarMedia.trackId / linkUrl / artworkUrl`
  -> `state.mediaSessions[0].item.id / linkUrl / artworkUrl`
- `PulseBarMedia.albumArtist / trackNumber / discNumber / collection*`
  -> `state.mediaSessions[0].extensions.values.provider.*`
- `media.isPlaying`
  -> `presenceKind = media | interactive`
- 当前实现默认把设备 availability 视作 `active`
  - v2 结构支持更完整的 `idle/locked/sleeping/offline`
  - 但 native realtime bridge 目前主要发 `active` 快照

### 2.5 服务端如何处理 `presence.v2`

入口：

- `POST /v2/presence/ingest`

Worker 行为：

1. 校验 `workspaceId`
2. 交给 `global` room 对应的 DO
3. DO 做：
   - dedupe key: `workspaceId + deviceId + eventId`
   - upsert 当前 `device:<deviceId>` reader
   - `session_end` 时移除 reader
4. 生成新的 `RoomSnapshot`
5. 向 SSE / WS 订阅者广播

设备 reader 在房间模型中的样子：

- `source = device`
- `displayName` 通常来自 app 名或设备名
- `app`
- `media`
- `device`
- `page?`

其中 `media` 已经不是只有最小 now playing 字段，而是会保留 richer metadata：

- `providerId`
- `source`
- `itemType`
- `trackId`
- `title`
- `artist`
- `album`
- `albumArtist`
- `artworkUrl`
- `linkUrl`
- `progressSeconds`
- `durationSeconds`
- `playbackState`
- `trackNumber`
- `discNumber`
- `collectionId`
- `collectionTitle`
- `collectionLinkUrl`

## 3. Web -> Server: `web.v1`

### 3.1 浏览器内部源模型

浏览器侧内部状态在：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts)

当前客户端维护的本地状态：

- `sessionId`
  - `localStorage` 持久化
- `page`
  - `title`
  - `url`
  - `canonicalUrl`
- `reading`
  - `progressPercent`
  - `scrollY`
- `presence`
  - `state = active | hidden | idle | offline`
  - `visibility = visible | hidden`

### 3.2 发送时机

`web.v1` 是页面行为协议，不表达设备 app/media，只表达页面与阅读状态。

当前发送策略：

- `page_view`
  - 路由进入立即发送
- `reading_progress`
  - 节流发送
  - 默认条件：
    - 至少 `2s`
    - 或阅读进度变化达到 `5%`
- `heartbeat`
  - 页面可见时每 `15s`
- `session_end`
  - `beforeunload` / `pagehide`

首页也会发 `web.v1`，但默认不追踪阅读进度；文章页会发阅读进度。

### 3.3 `web.v1` 协议职责

`web.v1` 的目标是表达“某个浏览器 session 在哪个页面、看到哪、当前是否活跃”。

关键结构：

- `WebIngestRequest`
  - `workspaceId`
  - `siteId`
  - `sessionId`
  - `userId?`
  - `events[]`
- `WebEvent`
  - `kind = page_view | reading_progress | heartbeat | session_end`
  - `page`
  - `reading?`
  - `presence`

它与 `presence.v2` 的边界很明确：

- `presence.v2` 讲设备/应用/媒体
- `web.v1` 讲页面/阅读/可见性

### 3.4 浏览器内部状态 -> `web.v1` 的变换

映射关系：

- 页面 URL / title / canonical
  -> `event.page`
- 阅读进度与滚动位置
  -> `event.reading`
- 当前 tab 可见性与活跃度
  -> `event.presence`

匿名访客默认：

- `userId` 不带
- server 侧生成显示名，例如 `Anonymous xxxx`

### 3.5 服务端如何处理 `web.v1`

入口：

- `POST /v1/web/ingest`

Worker 行为分两段：

1. 先写 `global` room
2. 再根据 `canonicalUrl` 写对应 `page:<canonicalUrl>` room

服务端附加逻辑：

- 先做 `Origin whitelist`
- 校验 `workspaceId/siteId`
- canonical URL 归一化：
  - 优先显式 `canonicalUrl`
  - 否则使用 `origin + pathname`
  - 去掉 `hash`
  - 去掉 `utm_* / fbclid / gclid`
- dedupe key:
  - `workspaceId + sessionId + eventId`
- page room 迁移：
  - session 从旧页面切到新页面时，先离开旧 room，再进入新 room

浏览器 reader 在房间模型中的样子：

- `source = web`
- `page`
- `reading`
- `device.sessionId`
- 不会有 `app`
- 不会有 `media`

## 4. Server internal model: `RoomSnapshot`

虽然上游有两种协议，但服务端最后统一写入一个房间模型：

- `RoomSnapshot`
  - `workspaceId`
  - `roomId`
  - `revision`
  - `onlineCount`
  - `activeReaders[]`
  - `updatedAt`

其中每个 reader 都是统一结构：

- `RoomReader`
  - `readerId`
  - `sessionId`
  - `userId?`
  - `source = device | web`
  - `displayName`
  - `presenceState`
  - `page?`
  - `reading?`
  - `device?`
  - `app?`
  - `media?`
  - `updatedAt`

所以统一后的区别不是“房间用不同 schema”，而是“同一个 schema 的不同字段是否有值”。

举例：

- macOS device reader:
  - `app` 有值
  - `media` 有值
  - `reading` 通常为空
- browser reader:
  - `page` 有值
  - `reading` 有值
  - `app/media` 通常为空

媒体 reader 的 richer 字段来源说明：

- 通用字段
  - `providerId`
  - `source`
  - `itemType`
  - `trackId`
  - `title`
  - `artist`
  - `album`
  - `artworkUrl`
  - `linkUrl`
  - `progressSeconds`
  - `durationSeconds`
  - `playbackState`
- provider-specific 字段
  - `albumArtist`
  - `trackNumber`
  - `discNumber`
  - `collectionId`
  - `collectionTitle`
  - `collectionLinkUrl`

也就是说：

- 协议层以 provider-agnostic 字段为骨架
- 但服务端 room 模型会继续带上 provider-specific metadata
- 前端 demo / blog widget 可以直接消费这些 richer 字段，不需要再次查 provider API

## 5. Downstream protocol: `realtime.v1-stream`

严格说这不是上游写协议，但它是统一下游读协议，决定了 Web 客户端如何消费状态。

Worker 对外提供：

- `GET /v1/realtime/ws?workspaceId=...&roomId=...`
- `GET /v1/site/history`
- `GET /v1/site/lifetime`
- `GET /v1/content/history`
- `GET /v1/content/lifetime`
- `GET /v1/owner/history`
- `GET /v1/owner/lifetime`

读出来的主体是：

- `RoomSnapshot`
- `RoomStreamEnvelope`

这里的 `kind` 当前主要是：

- `snapshot.updated`
- `sync.reset`
- `error`

## 6. End-to-end model transformations

### 6.1 Device path

```text
macOS probes
  -> PulseBarSnapshot / PulseBarMedia
  -> presence.v2 PresenceIngestRequest
  -> POST /v2/presence/ingest
  -> global room StoredRoomReader(source=device)
  -> RoomSnapshot
  -> SSE / WS / snapshot API
  -> demo: activeReaders / live media panel
```

更具体一点，媒体部分会经历两次“标准化”：

1. provider probe 标准化
   - `Spotify`、`Music`、`NeteaseMusic`、`QQMusic`
   - 各自的 AppleScript 返回值先映射成统一 `PulseBarMedia`
2. room 标准化
   - `PulseBarMedia`
   - `presence.v2 mediaSessions[0]`
   - `RoomReader.media`

其中 `itemType` 会被归一化到协议允许值：

- `track`
- `album`
- `playlist`
- `episode`
- `stream`
- `unknown`

例如 Apple Music 的 `file track` 会被规整成 `track`。

### 6.2 Web path

```text
browser route + scroll + visibility
  -> page/reading/presence local state
  -> web.v1 WebIngestRequest
  -> POST /v1/web/ingest
  -> global room StoredRoomReader(source=web)
  -> page:<canonicalUrl> room StoredRoomReader(source=web)
  -> RoomSnapshot
  -> SSE / WS / snapshot API
  -> demo: online readers / article page room / reading progress
```

## 7. Key behavioral differences

### `presence.v2`

适合：

- 设备状态
- 前台应用
- 媒体播放
- 需要表达更完整上下文的“rich presence”

特点：

- 状态轴更正交
- 结构更重
- 适合桌面端、系统级采集

### `web.v1`

适合：

- 页面阅读
- 浏览器活跃度
- 文章级房间存在感

特点：

- 结构更轻
- 以页面为中心
- 不引入设备级 app/media 语义

## 8. Current production defaults

关键默认值：

- `workspaceId = pulse-demo`
- `siteId = blog-demo`
- `web heartbeat = 15s`
- `web session TTL = 45s`
- device TTL:
  - `max(120s, heartbeat * 2)`

## 9. Current gaps

当前实现里还需要注意这些边界：

- `presence.v2` 的 KMP macOS bridge 已经接入上报，但还没有把完整的 `availability=idle/locked/sleeping` 全部送上去
- `web.v1` 当前没有认证 token，只做 `Origin whitelist`
- `page room` 和 `global room` 已经工作，但聊天室房间还没实现
- demo 对 `live media` 做了本地平滑 tick，这是 UI 层的插值，不是协议字段本身
- `Spotify` 与 `Apple Music` 的 richer metadata 当前已经接通
- `NeteaseMusic / QQMusic` 当前是 best-effort probe 入口
  - 架构上不再是“只支持 Spotify”
  - 但具体 provider 是否能稳定拿到 AppleScript 字段，仍取决于目标 app 是否暴露兼容接口

## 10. Recommended future documentation split

如果后续继续扩展，建议把本文拆成三份：

1. `device-protocol.md`
   - 专讲 `presence.v2`
2. `web-protocol.md`
   - 专讲 `web.v1`
3. `room-model.md`
   - 专讲 Durable Object 聚合与 `realtime.v1-stream`

当前这份文档先作为 phase 1 的统一协议说明。
