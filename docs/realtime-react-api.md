# Realtime React API

本文档整理 `@pulse/realtime-react` 当前对业务侧暴露的公开面，重点回答三件事：

1. 有哪些推荐使用的 hooks / client API
2. 每个 API 返回什么数据、有哪些主要属性
3. 在页面里应该怎么用

源码入口：

- [index.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/index.ts)
- [provider.tsx](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/provider.tsx)
- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts)
- [client.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/client.ts)
- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts)
- [stats-facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/stats-facades.ts)

## 1. 推荐入口

业务侧默认按下面顺序消费：

1. `PulseRealtimeProvider`
2. facade hooks
3. raw hooks
4. `usePulseRealtimeClient()`
5. 低层 `realtime / interactions / subscriptions / fetch`

推荐原则：

- 页面组件优先用 facade hooks，拿稳定语义数据，不自己做 `reduce / sort / fallback`
- 只有在 facade 还没覆盖到的场景，才直接消费 raw snapshot hooks
- 只有在组件外、命令式流程或高级调试场景，才直接碰 `client`

## 2. Provider 和 Config

### `PulseRealtimeProvider`

定义：

- [provider.tsx](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/provider.tsx#L9)

属性：

- `config: PulseRealtimeConfig`
- `children: ReactNode`

行为：

- 基于 `config` 创建 `PulseRealtimeClient`
- provider 卸载时自动 `client.dispose()`

### `usePulseRealtimeClient()`

定义：

- [provider.tsx](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/provider.tsx#L35)

返回：

- `PulseRealtimeClient`

限制：

- 必须在 `PulseRealtimeProvider` 内调用

### `PulseRealtimeConfig`

定义：

- [types.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/types.ts#L1)

属性：

- `baseUrl: string`
- `workspaceId: string`
- `siteId: string`
- `debug?: boolean`
- `readingHeartbeatMs?: number`
- `readingProgressThrottleMs?: number`
- `readingProgressDeltaPercent?: number`
- `sessionStorageKey?: string`
- `tabStorageKey?: string`
- `interactionActor?: { kind: "owner" | "user" | "anonymous"; userId?: string }`

默认值：

- [types.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/types.ts#L17)

## 3. Hooks

### 3.1 Presence / Room

#### `useGlobalPresenceFacade(options?)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L98)

参数：

- `options?: { nowMs?: number }`

返回：

- `facade: GlobalPresenceFacade`
- `snapshot: GlobalRoomSnapshot | null`
- `error: string | null`

适用场景：

- status 页
- dashboard 全局房间概览
- 当前 owner / live media / active pages 概览

#### `usePagePresenceFacade(canonicalUrl)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L107)

参数：

- `canonicalUrl: string`

返回：

- `facade: PagePresenceFacade`
- `snapshot: PageRoomSnapshot | null`
- `error: string | null`

适用场景：

- 文章页 / 内容页的 page room 展示
- 页面在线人数
- 页面 reader 列表
- 原始 `readingStats` 展示

#### `useChatRoomFacade(options)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L153)

参数：

- `roomId: string`
- `displayName: string`
- `userId?: string`

返回：

- `snapshot: ChatRoomSnapshot | null`
- `events: ChatEventEnvelope[]`
- `error: string | null`
- `sendMessage(content: string): void`
- `facade: ChatRoomFacade`

适用场景：

- chat panel
- participant / duplicate-name / message list 展示

### 3.2 Raw Hooks

#### `useGlobalPresenceSnapshot()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L38)

返回：

- `snapshot: GlobalRoomSnapshot | null`
- `error: string | null`

说明：

- 这是 raw hook
- 推荐只在调试或新增 facade 前的过渡场景使用

#### `usePagePresenceSnapshot(canonicalUrl)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L68)

返回：

- `snapshot: PageRoomSnapshot | null`
- `error: string | null`

### 3.2.1 Raw Snapshot 具体形状

#### `RoomReader`

定义：

- [realtime-v2.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/realtime-v2.ts#L78)

属性：

- `readerId: string`
- `sessionId: string`
- `userId?: string`
- `source: "device" | "web"`
- `displayName: string`
- `presenceState: "active" | "idle" | "locked" | "sleeping" | "offline" | "hidden"`
- `page?: { title?: string; url?: string; canonicalUrl?: string }`
- `reading?: { progressPercent?: number; scrollY?: number }`
- `device?: { deviceId?: string; sessionId: string; platform?: string; name?: string }`
- `app?: { name?: string; id?: string; category?: string }`
- `media?: { providerId?: string; source?: string; itemType?: string; trackId?: string; title?: string; artist?: string; album?: string; albumArtist?: string; artworkUrl?: string; linkUrl?: string; progressSeconds?: number; durationSeconds?: number; playbackState?: string; trackNumber?: number; discNumber?: number; collectionId?: string; collectionTitle?: string; collectionLinkUrl?: string }`
- `updatedAt: string`

#### `GlobalRoomSnapshot`

定义：

- [realtime-v2.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/realtime-v2.ts#L121)

属性：

- `workspaceId: string`
- `roomId: string`
- `revision: number`
- `updatedAt: string`
- `roomKind: "global"`
- `onlineCount: number`
- `activeReaders: RoomReader[]`
- `pageConcurrencyMap: Record<string, number>`
- `ownerCurrent?: { deviceId?: string; displayName?: string; currentApp?: RoomReader["app"]; currentMedia?: RoomReader["media"]; lastActiveAt?: string } | null`

#### `PageRoomSnapshot`

定义：

- [realtime-v2.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-protocol/src/realtime-v2.ts#L139)

属性：

- `workspaceId: string`
- `roomId: string`
- `revision: number`
- `updatedAt: string`
- `roomKind: "page"`
- `onlineCount: number`
- `activeReaders: RoomReader[]`
- `readingStats: { avgProgress: number; maxProgress: number; sampleCount: number }`

#### `useChatRoom(options)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L113)

返回：

- `snapshot: ChatRoomSnapshot | null`
- `events: ChatEventEnvelope[]`
- `error: string | null`
- `sendMessage(content: string): void`

### 3.3 Interaction / Debug

#### `useRealtimeConnectionStatus()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts)

返回：

- `status: "idle" | "connecting" | "ready" | "reconnecting" | "closed" | "error"`
- `selectedProtocol: string | null`
- `capabilities: RealtimeCapabilities | null`
- `lastError: string | null`
- `lastMessageType: RealtimeServerMessage["type"] | null`
- `activeMode: "ws" | "unknown"`
- `transportCount: number`

说明：

- 这是一个面向 UI 展示的轻量 hook，用来直接显示当前 ws 连接状态
- 状态是对当前所有活跃 room transport 的聚合结果，不区分单个 room
- 当还没有任何活跃订阅时，`status = "idle"` 且 `transportCount = 0`

#### `selectRealtimeConnectionStatus(debugState)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts)

返回：

- 与 `useRealtimeConnectionStatus()` 相同的轻量状态对象

说明：

- 用于非 React 场景，或你已经拿到了 `RoomSubscriptionDebugState` 想复用同一套状态聚合逻辑
- 典型输入来源是 `useRealtimeDebugState()` 返回值或 `client.subscriptions.onDebugState(...)`

#### `useInteractionStates()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L382)

返回：

- `items: InteractionState[]`
- `error: string | null`

特点：

- 自动按 `updatedAt` 倒序整理
- 相同 `requestId` 会合并为最新状态

#### `useRealtimeDebugState()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L340)

返回：

- `transport`
- `activeMode`
- `subscriptions`
- `lastSnapshotMeta`
- `meta`
- `transports`

对应类型：

- [room-subscription-manager.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/room-subscription-manager.ts#L65)

### 3.4 History / Lifetime

#### `useSiteHistory(options?)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L217)

返回：

- `data: SiteHistoryPoint[]`
- `loading: boolean`
- `error: string | null`

#### `useOwnerHistory(options?)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L259)

返回：

- `data: OwnerHistoryPoint[]`
- `loading: boolean`
- `error: string | null`

#### `useContentHistory(canonicalUrl, options?)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L328)

返回：

- `data: ContentHistoryPoint[]`
- `loading: boolean`
- `error: string | null`

#### `useStatsHistoryFacade(options?)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L301)

返回：

- `facade: StatsHistoryFacade`
- `siteHistory`
- `ownerHistory`
- `loading: boolean`
- `error: string | null`

适用场景：

- 同时展示 site + owner retained aggregates
- bucket 选择、selected site metrics、selected owner metrics

#### `useSiteLifetime()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L373)

返回：

- `data: SiteLifetime | null`
- `loading`
- `error`

#### `useSiteLifetimeFacade()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L406)

返回：

- `data`
- `loading`
- `error`
- `facade: SiteMetricsFacade`

#### `useOwnerLifetime()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L412)

返回：

- `data: OwnerLifetime | null`
- `loading`
- `error`

#### `useOwnerLifetimeFacade()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L445)

返回：

- `data`
- `loading`
- `error`
- `facade: OwnerMetricsFacade`

#### `useContentLifetime(canonicalUrl)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L451)

返回：

- `data: ContentLifetime | null`
- `loading`
- `error`

### 3.5 Presence Tracking

#### `usePresenceState()`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L484)

返回：

- `presence: WebPresence["state"]`
- `visibility: WebPresence["visibility"]`

说明：

- 浏览器本地状态推导
- 不负责订阅房间

#### `usePagePresence(page, options?)`

定义：

- [hooks.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/hooks.ts#L542)

参数：

- `page: { title: string; url: string; canonicalUrl: string }`
- `options?: { trackReading?: boolean }`

行为：

- 上报 `page_view`
- 周期上报 `heartbeat`
- 需要时上报 `reading_progress`
- 页面退出时上报 `session_end`
- 自动设置 presence context

适用场景：

- 业务页面接入浏览器 presence / 阅读进度时的默认入口

## 4. `PulseRealtimeClient` API

定义：

- [client.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/client.ts#L15)

### 属性

- `config`
- `http: Fetch`
- `realtime`
- `interactions`
- `subscriptions`
- `selectors`

### 方法

- `dispose()`
- `ingestWebEvents(events, options?)`
- `ingestWebEventsBeacon(events, options?)`
- `setPresenceContext(context)`
- `createTrackRecommendation(args)`
- `subscribeInteractionStream(onUpdate, onError?)`

### `selectors`

- `globalPresence(snapshot, options?)`
- `pagePresence(snapshot)`
- `chatRoom(snapshot)`

说明：

- 这是纯 selector 层
- 适合 hook 之外的命令式流程，或已有 snapshot 时的二次整理

## 5. Facade 形状

### `GlobalPresenceFacade`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L42)

主要属性：

- `summary.onlineCount`
- `summary.webReaderCount`
- `summary.deviceReaderCount`
- `readers.all`
- `readers.web`
- `readers.device`
- `activePages`
- `owner.reader`
- `owner.deviceName`
- `owner.deviceId`
- `owner.appId`
- `owner.appLabel`
- `liveMedia`
- `interactions.appleMusicReader`
- `room`
- `status`
- `raw`

展开：

- `summary = { onlineCount, webReaderCount, deviceReaderCount }`
- `readers.all/web/device` 的元素是 `ReaderListItem`
- `activePages` 每项是 `{ canonicalUrl, title, count }`
- `owner = { reader, deviceName, deviceId, appId, appLabel }`
- `interactions = { appleMusicReader }`
- `room = { roomId, revision, updatedAt } | null`
- `status = StatusViewModel`
- `raw = GlobalRoomSnapshot | null`

#### `ReaderListItem`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L41)

属性：

- `readerId: string`
- `displayName: string`
- `source: "device" | "web"`
- `presenceState: RoomReader["presenceState"]`
- `updatedAt: string`
- `progressPercent: number`
- `pageTitle: string`
- `canonicalUrl: string | null`
- `appId?: string`
- `appLabel?: string`
- `mediaProviderId?: string`
- `raw: RoomReader`

#### `StatusViewModel`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L27)

属性：

- `deviceName: string`
- `deviceId: string | null`
- `appId: string`
- `appLabel: string`
- `siteOnlineCount: number`
- `activePages: Array<{ canonicalUrl: string; title: string; count: number }>`
- `media: StatusMediaModel | null`

#### `StatusMediaModel`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L16)

属性：

- `providerId?: string`
- `artworkUrl?: string`
- `title?: string`
- `artist?: string`
- `artistLine: string`
- `progressPercent: number`
- `progressLabel: string`
- `durationLabel: string`

### `StatusViewModel`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L18)

主要属性：

- `deviceName`
- `deviceId`
- `appId`
- `appLabel`
- `siteOnlineCount`
- `activePages`
- `media`

### `PagePresenceFacade`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L73)

主要属性：

- `summary.onlineCount`
- `readers`
- `readingStats`
- `room`
- `raw`

展开：

- `summary.onlineCount: number`
- `readers: ReaderListItem[]`
- `readingStats: { avgProgress: number; maxProgress: number; sampleCount: number } | null`
- `room: { roomId, revision, updatedAt } | null`
- `raw: PageRoomSnapshot | null`

### `ChatRoomFacade`

定义：

- [facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/facades.ts#L102)

主要属性：

- `summary.participantCount`
- `summary.messageCount`
- `participants`
- `participantNameCounts`
- `messages`
- `senderNameCounts`
- `room`
- `raw`

### `StatsHistoryFacade`

定义：

- [stats-facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/stats-facades.ts#L44)

主要属性：

- `buckets`
- `selectedBucketKey`
- `selectedBucket`
- `selectedSite`
- `selectedOwner`

### `OwnerMetricsFacade`

定义：

- [stats-facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/stats-facades.ts#L22)

主要属性：

- `totalFocusSeconds`
- `activeAppCount`
- `appPresence[]`

`appPresence[]` 每项有：

- `key`
- `label`
- `totalSeconds`
- `count`
- `shareLabel`
- `sharePercent`
- `durationLabel`
- `raw`

### `SiteMetricsFacade`

定义：

- [stats-facades.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/stats-facades.ts#L29)

主要属性：

- `pv`
- `uv`
- `readTimeSeconds`
- `readTimeLabel`
- `raw`

## 6. Utility API

### Media

定义：

- [media.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/media.ts#L6)

公开函数：

- `useNowTick(intervalMs = 250)`
- `resolveDisplayedProgressSeconds(media, updatedAt, nowMs)`
- `resolveProgressPercent(progressSeconds, durationSeconds)`
- `formatClock(rawSeconds)`

### Branding

定义：

- [branding.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/branding.ts#L1)

公开函数：

- `resolveDefaultAppBranding(appId, label)`
- `resolveDefaultProviderBranding(providerId?)`

返回结构：

- `{ assetUrl: string | null }`

### Session

定义：

- [session.ts](/Users/kt/Documents/Playground/pulse/packages/realtime-react/src/session.ts#L3)

公开函数：

- `getOrCreateSessionId(config)`
- `getOrCreateTabId(config)`

## 7. 使用用例

### 用例 1：状态页直接消费全局 facade

适合：

- status 页
- 只想拿“当前设备 / 当前 app / 当前媒体 / 活跃页面”

```tsx
import { useNowTick, useGlobalPresenceFacade } from "@pulse/realtime-react";

export function StatusPage() {
  const now = useNowTick(120);
  const { facade, error } = useGlobalPresenceFacade({ nowMs: now });

  if (error) return <p>{error}</p>;

  return (
    <section>
      <h1>{facade.status.appLabel}</h1>
      <p>{facade.status.deviceName}</p>
      <p>{facade.status.siteOnlineCount} online</p>
      <p>{facade.status.media?.title ?? "No media"}</p>
    </section>
  );
}
```

### 用例 2：文章页接入页面 presence 和阅读进度

适合：

- 内容详情页
- 希望自动上报 `page_view / heartbeat / reading_progress / session_end`

```tsx
import { usePagePresence, usePagePresenceFacade } from "@pulse/realtime-react";

export function ArticlePage() {
  const page = {
    title: "How Presence Rooms Work",
    url: window.location.href,
    canonicalUrl: `${window.location.origin}/article/presence-rooms`,
  };

  usePagePresence(page, { trackReading: true });
  const { facade } = usePagePresenceFacade(page.canonicalUrl);

  return (
    <aside>
      <p>{facade.summary.onlineCount} readers</p>
      <p>{facade.readers.length} reader rows</p>
      <p>{facade.readingStats?.sampleCount ?? 0} reading samples</p>
    </aside>
  );
}
```

### 用例 3：聊天面板

适合：

- 页面级聊天室
- 需要 participant + message facade，并能发送消息

```tsx
import { useChatRoomFacade } from "@pulse/realtime-react";

export function StatusChat() {
  const { facade, sendMessage, error } = useChatRoomFacade({
    roomId: "chat:status",
    displayName: "KT",
  });

  if (error) return <p>{error}</p>;

  return (
    <section>
      <p>{facade.summary.participantCount} online</p>
      <button onClick={() => sendMessage("hello")}>Send</button>
      {facade.messages.map((item) => (
        <p key={item.msgId}>{item.senderDisplayName}: {item.content}</p>
      ))}
    </section>
  );
}
```

### 用例 4：历史统计页

适合：

- retained aggregate 面板
- 同时展示 site/owner bucket

```tsx
import { useState } from "react";
import { useStatsHistoryFacade } from "@pulse/realtime-react";

export function StatsPanel() {
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const { facade, loading, error } = useStatsHistoryFacade({
    period: "day",
    selectedBucketKey,
  });

  if (loading) return <p>Loading…</p>;
  if (error) return <p>{error}</p>;

  return (
    <section>
      {facade.buckets.map((bucket) => (
        <button key={bucket.key} onClick={() => setSelectedBucketKey(bucket.key)}>
          {bucket.label}
        </button>
      ))}
      <p>{facade.selectedSite.readTimeLabel}</p>
      <p>{facade.selectedOwner.totalFocusSeconds}s focus</p>
    </section>
  );
}
```

### 用例 5：命令式调用 client

适合：

- hook 之外的命令式操作
- 自定义交互请求

```tsx
import { usePulseRealtimeClient } from "@pulse/realtime-react";

export function RecommendButton() {
  const client = usePulseRealtimeClient();

  return (
    <button
      onClick={() =>
        client.createTrackRecommendation({
          provider: "apple-music",
          uri: "apple-music:track:123",
          title: "Track",
        })
      }
    >
      Recommend
    </button>
  );
}
```

## 8. 当前建议

推荐业务层默认只直接使用：

- `PulseRealtimeProvider`
- `usePulseRealtimeClient`
- `useGlobalPresenceFacade`
- `usePagePresenceFacade`
- `useChatRoomFacade`
- `useStatsHistoryFacade`
- `useSiteLifetimeFacade`
- `useOwnerLifetimeFacade`
- `usePagePresence`

不推荐业务页面直接依赖：

- raw snapshot hooks
- `Fetch`
- `RoomSubscriptionManager`
- `createRealtimeApiClient`
- `createInteractionClient`
- 顶层 `ingestWebEvents / fetchRealtimeMeta / createTrackRecommendation / subscribeInteractionStream`

原因：

- 这些更像底层 building block
- 页面直接碰它们时，容易把 transport / retry / aggregation 细节重新泄漏回业务层
