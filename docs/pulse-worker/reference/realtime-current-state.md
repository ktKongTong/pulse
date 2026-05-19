# Realtime Current State

这份文档只描述当前仓库里已经存在的实现状态，不讨论理想架构，也不沿用旧设计。

阅读顺序建议：

1. 看这份文档，先建立“当前到底跑起来的是什么”
2. 再看 [Client WebSocket 协议设计](../../protocol/design/client-ws/index.md) 和 [Device WebSocket 协议草案](../../protocol/design/device-ws/index.md) 理解目标协议
3. 再看 [Protocol Compatibility](../../protocol/specs/compatibility.md) 理解后续版本策略

源码事实来源：

- Worker 入口: [`apps/realtime-worker/src/api/index.ts`](../../../apps/realtime-worker/src/api/index.ts)
- Worker shell mount: [`apps/realtime-worker/worker/app.ts`](../../../apps/realtime-worker/worker/app.ts)
- WS/session 基类: [`apps/realtime-worker/src/api/do/session.ts`](../../../apps/realtime-worker/src/api/do/session.ts)
- Global room: [`apps/realtime-worker/src/api/do/room/global-status-room.ts`](../../../apps/realtime-worker/src/api/do/room/global-status-room.ts)
- Page room: [`apps/realtime-worker/src/api/do/room/page-status-room.ts`](../../../apps/realtime-worker/src/api/do/room/page-status-room.ts)
- Chat room: [`apps/realtime-worker/src/api/do/room/chat-room.ts`](../../../apps/realtime-worker/src/api/do/room/chat-room.ts)
- Device hot state: [`apps/realtime-worker/src/api/do/device/device-do.ts`](../../../apps/realtime-worker/src/api/do/device/device-do.ts)
- Room binding routing: [`apps/realtime-worker/src/api/rpc/room-stub.ts`](../../../apps/realtime-worker/src/api/rpc/room-stub.ts)
- Web client transport registry: [`packages/realtime-react/src/room-subscription-manager.ts`](../../../packages/realtime-react/src/room-subscription-manager.ts)
- Web page tracking hook: [`packages/realtime-react/src/hooks.ts`](../../../packages/realtime-react/src/hooks.ts)
- Protocol schemas: [`presence-v2.ts`](../../../packages/realtime-protocol/src/presence-v2.ts), [`web-v1.ts`](../../../packages/realtime-protocol/src/web-v1.ts), [`realtime-v2.ts`](../../../packages/realtime-protocol/src/realtime-v2.ts), [`interaction-v1.ts`](../../../packages/realtime-protocol/src/interaction-v1.ts)

## Protocol Inventory

| Protocol | Direction | Current public path | Current status |
| --- | --- | --- | --- |
| `presence.v2` | macOS/native -> worker | `POST /api/v2/presence/ingest` | Implemented |
| `presence.v2` history | macOS/native -> worker | `POST /api/v2/history/ingest` | Implemented |
| `web.v1` | browser -> worker | `POST /api/v1/web/ingest` | Implemented |
| `realtime.ws.v2` | worker -> browser ws | `GET /api/v1/realtime/ws?workspaceId=...&roomId=...` | Implemented |
| `interaction.v1` | web/native -> worker | No public route | Schema exists, worker public route missing |
| `interaction.ws.v1` | worker -> device ws | No public route; inbox DO exists | DO exists, worker public route missing |
| `interaction.stream.v1` | worker -> web SSE | No public route; hub DO exists | DO exists, worker public route missing |
| `realtime.v1-stream` | historical/generic stream envelope schema | No public route | Schema/history only, not served by current worker |

## Worker Topology

当前 worker 里跟 realtime 相关的 Durable Object 分成 5 类：

- `DeviceDO`
  - 只接设备侧 `presence.v2` / `history ingest`
  - 持有单设备热状态 `currentState`
  - 更新 `deviceDailyStats`
  - 只会把热状态推到 `GlobalStatusRoom`

- `GlobalStatusRoom`
  - 房间 id 固定为 `global`
  - 持有：
    - `readersMemory`
    - `deviceStates`
    - `pendingSiteMetrics`
    - `pendingContentMetrics`
    - `pendingOwnerPresence`
  - 负责：
    - site/page/owner 统计查询
    - global snapshot
    - global websocket

- `PageStatusRoom`
  - 房间 id 形如 `page:<canonicalUrl>`
  - 持有：
    - `readersMemory`
    - room-local `presenceContext` attachment
  - 负责：
    - page snapshot
    - page websocket
  - 不负责：
    - 汇总统计查询
    - 设备态

- `ChatRoom`
  - 房间 id 形如 `chat:<roomId>`
  - 持有：
    - `chatParticipants`
    - `chatMessages`
    - `typingUsers`
    - room-local `chatMembership` attachment
  - 负责：
    - `chat_join`
    - `chat_leave`
    - `chat_send`
    - chat snapshot
    - chat websocket

- `SessionDO`
  - 不是单独绑定的业务 DO
  - 是 room websocket/session 的抽象基类
  - 只负责：
    - websocket upgrade
    - hibernation attachment
    - `hello/hello_ack`
    - snapshot 下发
    - 连接恢复和 close/error 生命周期

- `BaseRoom`
  - 不是业务房间类型
  - 是 `SessionDO` 之上的最小 room 骨架
  - 当前只负责：
    - `db/meta/logger/flushIntervalMs`
    - room metadata 初始化
    - 首帧 snapshot 下发
    - room-local snapshot broadcast
    - 抽象出各具体 room 的 `restore/persist/alarm/snapshot`
  - 不再持有具体 room 的 reader/device/chat 业务状态

当前 worker binding 路由：

- `global` -> `GLOBAL_STATUS_ROOM`
- `page:*` -> `PAGE_STATUS_ROOM`
- `chat:*` -> `CHAT_ROOM`

对应 binding 以 Worker runtime 配置和 `room-stub.ts` 路由为准。当前仓库没有可引用的 `apps/realtime-worker/wrangler.jsonc` 文档事实源，不能把它写成当前配置入口。

## Public Routes

这里列的是客户端和外部消费者可见的 worker-hosted public path。API route module 内部怎么挂载是 worker 实现细节，不属于协议 contract。

当前 public route：

- `GET /api/v1/meta`
- `GET /api/v1/realtime/ws?workspaceId=...&roomId=...`
- `GET /api/v1/site/history`
- `GET /api/v1/site/lifetime`
- `GET /api/v1/content/history`
- `GET /api/v1/content/lifetime`
- `GET /api/v1/owner/history`
- `GET /api/v1/owner/lifetime`
- `POST /api/v2/presence/ingest`
- `POST /api/v2/history/ingest`
- `POST /api/v1/web/ingest`
- `ALL /api/v1/device-interactions/*`
  - 当前直接返回 `410 endpoint_disabled`

`/api/v1/meta` 当前返回的能力声明：

- `ingestProtocols.presence = ["presence.v2"]`
- `ingestProtocols.web = ["web.v1"]`
- `streamProtocols = ["realtime.ws.v2"]`
- `capabilities.presence = true`
- `capabilities.multiRoom = true`
- `capabilities.chat = true`
- `capabilities.richMedia = true`
- `capabilities.interaction = true`

注意：

- 这里的 `multiRoom = true` 表示“当前 SDK/系统可以同时观察多个 room”，但实现方式是“多个 room 各开一条 websocket”，不是单 ws 多 room 复用。
- `interaction = true` 和 `interactionProtocols` 当前只是 meta 声明；当前 `index.ts` 并没有把 interaction 的 public route 接出来。

## Web Client Runtime

`@pulse/realtime-react` 当前不是单 websocket 架构，而是 room-scoped transport registry：

- 每个唯一 room 一条 `RealtimeTransport`
- 同一个 room 被多个消费者使用时，本地复用同一条 ws
- 不同 room 之间各自独立连接、独立重连、独立断开

当前入口关系：

- `useGlobalPresenceSnapshot()` -> 订阅 `global`
- `usePagePresenceSnapshot(canonicalUrl)` -> 订阅 `page:<canonicalUrl>`
- `useChatRoom({ roomId })` -> 订阅 `chat:<roomId>`
- `usePagePresence()/useTrackPagePresence()` -> 负责浏览器 `web.v1` 上行和 `presence_context` 下行配套

`RoomSubscriptionManager` 当前行为：

- `subscribePresence()` / `subscribeRawRoom()`：
  - 建立或复用目标 room transport
- `subscribeChatRoom()`：
  - 先保证 `chat:<roomId>` transport 存在
  - transport ready 后发送 `chat_join`
- `setPresenceContext()`：
  - 保存当前页面上下文
  - 发给 `global`
  - 如果对应 page transport 已经存在，也发给当前 page room
- `dispose()`：
  - 先对所有活跃 chat room 发送 `chat_leave`
  - 再断开所有 transport

## State Flow 1: `presence.v2`

`presence.v2` 当前的真实流转是：

1. macOS/native 组装 `PresenceIngestRequest`
2. `POST /api/v2/presence/ingest` 进入 worker
3. worker 在 [`apps/realtime-worker/src/api/index.ts`](../../../apps/realtime-worker/src/api/index.ts) 校验 `workspaceId`
4. 请求路由到 `DeviceDO`
5. `DeviceDO.handlePresenceIngest()`：
   - 更新 `currentState`
   - 更新 `deviceDailyStats`
   - 把 `expiresAtMs / lastCountedAtMs` 写回热状态
6. `DeviceDO.notifyRoomDO()`：
   - 只把状态推给 `GlobalStatusRoom.pushDeviceUpdate()`
7. `GlobalStatusRoom.pushDeviceUpdate()`：
   - 刷旧状态累计时长
   - 写入新的 `deviceStates`
   - 重新调度 alarm
   - 广播新的 global snapshot
8. 订阅 `global` room 的浏览器 transport 收到新的 `snapshot`
9. `useGlobalPresenceSnapshot()` 更新 UI

可以概括成：

```text
native presence.v2
  -> DeviceDO.currentState
  -> GlobalStatusRoom.deviceStates
  -> global ws snapshot
  -> realtime-react global hook
```

## State Flow 2: `web.v1`

浏览器页面当前的上行链路是：

1. 页面组件调用 `usePagePresence()` 或 `useTrackPagePresence()`
2. hook 生成稳定的 `sessionId` 和 `tabId`
3. hook 立刻调用 `client.setPresenceContext(...)`
4. hook 发送一次 `page_view`
5. 之后持续：
   - 定时发送 `heartbeat`
   - 达到阈值时发送 `reading_progress`
   - `pagehide/beforeunload/unmount` 发送 `session_end`

worker 收到 `web.v1` 后会双写：

1. `POST /api/v1/web/ingest` 进入 worker
2. worker 先把 payload 写给 `GlobalStatusRoom.handleWebIngest(..., "global", ttlMs)`
3. 如果最后一个事件里有页面 URL 且不是 `session_end`
   - 再 fire-and-forget 写给 `PageStatusRoom.handleWebIngest(..., page:<canonicalUrl>, ttlMs)`

`GlobalStatusRoom.handleWebIngest()` 当前会做：

1. 根据 `sessionId + tabId` 形成 `readerId = web:<sessionId>:<tabId>`
2. 如已有旧 reader，先结算它在 global 里的时长
3. 对 `page_view` 追加：
   - site uv/pv/read time pending metrics
   - content uv/pv/read time pending metrics
4. 写入/更新 `readersMemory`
5. 如果有状态变化，广播新的 global snapshot

`PageStatusRoom.handleWebIngest()` 当前会做：

1. 同样按 `web:<sessionId>:<tabId>` 写入 `readersMemory`
2. 不做 site/content aggregate
3. 只负责 page room 自己的实时 snapshot

可以概括成：

```text
browser web.v1
  -> GlobalStatusRoom.readersMemory + pending metrics
  -> PageStatusRoom.readersMemory
  -> global/page ws snapshots
  -> global/page hooks
```

## State Flow 3: `realtime.ws.v2`

当前 websocket 流转：

1. 浏览器根据 roomId 生成 ws URL：
   - `/api/v1/realtime/ws?workspaceId=...&roomId=global`
   - `/api/v1/realtime/ws?workspaceId=...&roomId=page:<canonicalUrl>`
   - `/api/v1/realtime/ws?workspaceId=...&roomId=chat:<roomId>`
2. worker 按 roomId 选择 binding：
   - `global` -> `GLOBAL_STATUS_ROOM`
   - `page:*` -> `PAGE_STATUS_ROOM`
   - `chat:*` -> `CHAT_ROOM`
3. Room DO 自己 `acceptWebSocket()`
4. 客户端发：
   - `hello`
5. 服务端回：
   - `hello_ack`
   - 当前 room 的首帧 `snapshot`
6. 之后 room 内状态变化，room 直接广播后续 `snapshot`

注意当前 worker 只用 `realtime.ws.v2`：

- 不支持 `subscribe/unsubscribe`
- 一条 ws 只绑定一个 room
- `snapshot` envelope 里也没有 `subscriptionId`

当前 connection attachment ownership：

- `GlobalStatusRoom`
  - `workspaceId / roomId / connectionId / selectedProtocol`
  - `presenceContext`
- `PageStatusRoom`
  - `workspaceId / roomId / connectionId / selectedProtocol`
  - `presenceContext`
- `ChatRoom`
  - `workspaceId / roomId / connectionId / selectedProtocol`
  - `chatMembership`

## State Flow 4: `presence_context`

`presence_context` 当前只用于 status room：

1. `usePagePresence()` 调用 `client.setPresenceContext({ sessionId, tabId, page... })`
2. `RoomSubscriptionManager` 会：
   - 发给 `global`
   - 如果当前 page transport 已存在，也发给 `page:<canonicalUrl>`
3. `GlobalStatusRoom` / `PageStatusRoom` 把它保存进自己的 connection attachment
4. 之后如果 ws close/error：
   - room 会根据 attachment 中的 `presenceContext`
   - 反查 `web:<sessionId>:<tabId>`
   - 从自己的 `readersMemory` 里删除
   - 广播一帧新的 snapshot

所以 `presence_context` 的作用不是“直接更新实时状态”，而是“给断线清理提供 room-local 身份映射”。

## State Flow 5: chat join / leave / send / disconnect

`ChatRoom` 当前只支持 chat 三类消息：

1. `chat_join`
   - 浏览器侧 `subscribeChatRoom()` 建立 chat transport
   - transport ready 后发送 `chat_join`
   - `ChatRoom` 保存 connection state 里的 `chatMembership`
   - `joinChat()` 把 participant 写进 `chatParticipants`
   - 广播新的 chat snapshot

2. `chat_send`
   - 要求 connection 上已有 `chatMembership`
   - `postChatMessage()`：
     - 更新 participant 活跃时间
     - 写入 `chatMessages` 表
     - 更新内存 `chatMessages`
     - 广播新的 chat snapshot

3. `chat_leave`
   - 最后一个本地 chat 订阅者取消时，客户端发送 `chat_leave`
   - 服务端清除该 connection 的 `chatMembership`
   - `leaveChat()` 把 participant 和 typing state 移除
   - 广播新的 chat snapshot

4. ws 直接断开
   - 客户端 `dispose()` 会先发一轮 `chat_leave` 再断 transport
   - 如果是网络错误导致 ws 直接断开，`ChatRoom.webSocketClose()` / `webSocketError()` 会在服务端侧执行 `leaveChat()`
   - 也就是说，当前 chat room 有两条退房路径：
     - 客户端显式 `chat_leave`
     - 服务端在 ws close/error 时的强制 `leaveChat()`

重要现状：

- 当前协议里定义了 `chat_event`
- 当前客户端也监听 `chat_event`
- 但当前 worker 没有任何地方真的发送 `chat_event`
- 所以 chat 目前是“靠完整 snapshot 刷新”，不是“snapshot + incremental event”

## State Flow 6: stats query

当前统计查询全部走 global room，public path 是：

- `GET /api/v1/site/history`
- `GET /api/v1/site/lifetime`
- `GET /api/v1/content/history`
- `GET /api/v1/content/lifetime`
- `GET /api/v1/owner/history`
- `GET /api/v1/owner/lifetime`

真实流转：

1. 浏览器或 UI 调 stats query
2. worker 全部路由到 `GlobalStatusRoom`
3. `GlobalStatusRoom` 先 `flushAggregates()`
   - 把 pending site/content/owner metrics 刷进 sqlite
4. 再用 `stats-query.ts` 从 sqlite rows 构造返回值

所以：

- Page room 不承担统计查询
- Content stats 虽然按 `canonicalUrl` 取，但底层仍由 `GlobalStatusRoom` 从 `pageDailyStats` 读

## State Flow 7: interaction current state

`interaction` 当前是“协议和 DO 已经存在，但 public route 未接上”的状态。

已经存在：

- 协议 schema：
  - `interaction.v1`
  - `interaction.ws.v1`
  - `interaction.stream.v1`
- DO：
  - `InteractionHub`
  - `InteractionInbox`
- Web client API：
  - `createTrackRecommendation()`
  - `subscribeInteractionStream()`

当前缺口：

- `packages/realtime-react/src/interaction-client.ts`
  - 调的是 `/api/v1/interaction/requests`
- `packages/realtime-react/src/interactions.ts`
  - 订的是 `/api/v1/interaction/stream/sse`
- 但当前 `apps/realtime-worker/src/api/index.ts`
  - 没有暴露这两个 public route
- `v1/device-interactions/*`
  - 当前被直接 `410 endpoint_disabled`

结论：

- interaction 协议和 DO 不是“没做”
- 但 current worker public surface 还没把这条链路接通
- 当前 `meta` 把 `interaction` 宣告为可用，和 public route 现状存在偏差

## Development Status

### 已打通

- `presence.v2` 设备热状态上报
- `web.v1` 页面活跃/阅读上报
- `realtime.ws.v2` room-scoped websocket
- `GlobalStatusRoom / PageStatusRoom / ChatRoom` 分房间 DO
- `@pulse/realtime-react` 的多 transport room registry
- chat room 的 join / leave / send / 断线退房
- site/content/owner stats query

### 已定义但当前未打通

- `interaction.v1` public route
- `interaction.ws.v1` public device ws route
- `interaction.stream.v1` public SSE route
- `chat_event` 实际发送
- `realtime.v1-stream` public route

### 当前有意保持简单的地方

- 没有 auth token；web 侧主要靠 `workspaceId` + `Origin whitelist`
- 一条 ws 只绑定一个 room
- page room 只做实时 presence，不做单独 aggregate
- chat 主要靠 snapshot 刷新，不做增量 event 流

### 当前文档判断标准

这份文档只以当前代码为准。

如果后续以下任意一个发生变化，需要同步更新本文件：

- `index.ts` public route
- `RoomSubscriptionManager` transport 策略
- `GlobalStatusRoom / PageStatusRoom / ChatRoom` 的 state ownership
- `DeviceDO` 推送目标
- `interaction` public route 是否接通
