# Better Realtime React API

本文档定义 `@pulse/realtime-react` 推荐提供给业务侧的用户 API。

目标是让页面开发者直接按业务场景拿数据：

- 看站点实时状态，就拿 `GlobalStatus`
- 看 owner 当前状态，就拿 `OwnerStatus`
- 看页面实时状态，就拿 `PageStatus`
- 看聊天，就拿 `ChatRoom`
- 做页面 presence 上报、聊天室发送消息等动作，再调用对应的 action hooks

默认用户不应该先接触底层房间协议和订阅细节。

## 设计原则

- 场景优先。API 按 `global / owner / page / chat / stats / actions` 组织。
- 读写分离。读页面状态和写页面 presence 是两个 API。
- 普通 session 保持轻量。页面里的 session 只包含用户和阅读相关字段，不混入 owner/device/media 细节。
- owner 信息单独建模。当前焦点应用、当前媒体、最近活跃时间只出现在 owner 相关 API 中。
- 统一状态契约。读取型 hooks 默认返回 `{ data, loading, error, refetch }`。

## 快速开始

### Provider

```tsx
import { PulseRealtimeProvider } from "@pulse/realtime-react";

const config: PulseRealtimeConfig = {
  baseUrl: "https://pulse.example.com",
  workspaceId: "workspace_123",
  siteId: "site_docs",
  viewer: {
    kind: "user",
    userId: "user_42",
  },
};

export function App() {
  return (
    <PulseRealtimeProvider config={config}>
      <Routes />
    </PulseRealtimeProvider>
  );
}
```

### `PulseRealtimeConfig`

```ts
type PulseRealtimeConfig = {
  baseUrl: string;
  workspaceId: string;
  siteId: string;
  viewer?: {
    kind: "owner" | "user" | "anonymous";
    userId?: string;
  };
  advanced?: {
    debug?: boolean;
    presence?: {
      heartbeatMs?: number;
      readingThrottleMs?: number;
      readingDeltaPercent?: number;
    };
    storage?: {
      sessionKey?: string;
      tabKey?: string;
    };
  };
};
```

主配置只需要：

- `baseUrl`
- `workspaceId`
- `siteId`

`viewer` 用来标识当前访问者；只有在聊天室、命令追踪或用户态交互里才需要显式传入。

## 推荐 API

### 统一返回契约

```ts
type QueryState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### 读取模型

#### `SessionUser`

```ts
type SessionUser = {
  id: string;
  userId?: string;
  userName?: string;
  userAvatar?: string;
};
```

#### `PageSession`

```ts
type PageSession = SessionUser & {
  progress?: {
    percent?: number;
    scrollY?: number;
  };
};
```

#### `ActivePage`

```ts
type ActivePage = {
  id: string;
  title?: string;
  canonicalUrl?: string;
  sessionCount: number;
  sessionIds: string[];
};
```

#### `FocusStatus`

```ts
type FocusStatus = {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
  desc?: string;
  icon?: string | React.ReactNode;
};
```

#### `MediaStatus`

```ts
type MediaStatus = {
  providerId?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  linkUrl?: string;
  playbackState?: string;
  progressPercent: number;
  progressLabel: string;
  durationLabel: string;
};
```

#### `OwnerStatus`

```ts
type OwnerStatus = {
  focus?: FocusStatus;
  media?: MediaStatus;
  lastActivedAt: Date;
};
```

#### `GlobalStatus`

```ts
type GlobalStatus = {
  pv: number;
  uv: number;
  stayTimeInSec: number;
  sessions: SessionUser[];
  sessionCount: number;
  activePageCount: number;
  activePages: ActivePage[];
  ownerStatus: OwnerStatus | null;
};
```

#### `PageStatus`

```ts
type PageStatus = {
  pv?: number;
  uv?: number;
  stayTimeInSec: number;
  sessions: PageSession[];
  sessionCount: number;
  activePages: ActivePage[];
};
```

#### `ChatParticipant`

```ts
type ChatParticipant = {
  id: string;
  displayName: string;
  presence: "active" | "idle" | "locked" | "sleeping" | "offline" | "hidden";
  updatedAt: string;
  duplicateCount: number;
};
```

#### `ChatMessage`

```ts
type ChatMessage = {
  id: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
};
```

#### `ChatRoom`

```ts
type ChatRoom = {
  id: string;
  type: "public" | "private" | "temporary";
  participants: ChatParticipant[];
  participantCount: number;
  latestMessages: ChatMessage[];
  unreadMessageCount: number;
  messageCount: number;
};
```

### Realtime Hooks

#### `useGlobalStatus()`

```ts
function useGlobalStatus(): QueryState<GlobalStatus>;
```

适合：

- 全站状态卡片
- dashboard 顶部概览
- 需要同时拿站点 session、活跃页面和 owner 当前状态

#### `useOwnerStatus()`

```ts
function useOwnerStatus(): QueryState<OwnerStatus>;
```

适合：

- “当前正在做什么”卡片
- status 页 owner 状态区
- 不想关心全站 session，只关心 owner 时

#### `useOwnerFocusApp()`

```ts
function useOwnerFocusApp(): QueryState<FocusStatus>;
```

适合：

- 只展示当前焦点应用
- 自定义 owner 状态文案
- 焦点应用图标 / 标签渲染

#### `useOwnerMedia()`

```ts
function useOwnerMedia(): QueryState<MediaStatus>;
```

适合：

- 当前播放信息
- 锁屏风格媒体卡片
- 媒体进度条和标题行展示

#### `usePageStatus(canonicalUrl)`

```ts
function usePageStatus(canonicalUrl: string): QueryState<PageStatus>;
```

适合：

- 文章页在线读者
- 文档页阅读进度概览
- 页面右侧状态栏

#### `useChatRoom(options)`

```ts
function useChatRoom(options: {
  roomId: string;
  displayName: string;
  userId?: string;
}): QueryState<ChatRoom> & {
  sendMessage(content: string): void;
};
```

适合：

- 页面聊天室
- status chat
- 临时讨论面板

### 统计模型

#### `StatsQueryOptions`

```ts
type StatsQueryOptions = {
  period?: "day" | "week" | "month" | "year";
  anchorDay?: string;
  limit?: number;
};
```

#### `StatsBucket`

```ts
type StatsBucket = {
  period: "day" | "week" | "month" | "year";
  key: string;
  label: string;
  startDay: string;
  endDay: string;
};
```

#### `SiteStats`

```ts
type SiteStats = {
  pv: number;
  uv: number;
  readTimeSeconds: number;
  readTimeLabel: string;
};
```

#### `OwnerAppStat`

```ts
type OwnerAppStat = {
  key: string;
  label: string;
  totalFocusSeconds: number;
  totalFocusLabel: string;
  occurrences: number;
  sharePercent: number;
  shareLabel: string;
};
```

#### `OwnerStats`

```ts
type OwnerStats = {
  totalFocusSeconds: number;
  totalFocusLabel: string;
  activeAppCount: number;
  apps: OwnerAppStat[];
};
```

#### `PageStats`

```ts
type PageStats = {
  canonicalUrl: string;
  title: string;
  pv: number;
  uv: number;
  readTimeSeconds: number;
  readTimeLabel: string;
};
```

#### 统计返回结构

```ts
type StatsSeriesPoint<T> = {
  bucket: StatsBucket;
  value: T | null;
};

type StatsResult<T> = {
  history: StatsSeriesPoint<T>[];
  lifetime: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### 统计 Hooks

#### `useSiteStats(options?)`

```ts
function useSiteStats(options?: StatsQueryOptions): StatsResult<SiteStats>;
```

#### `useOwnerStats(options?)`

```ts
function useOwnerStats(options?: StatsQueryOptions): StatsResult<OwnerStats>;
```

#### `usePageStats(canonicalUrl, options?)`

```ts
function usePageStats(
  canonicalUrl: string,
  options?: StatsQueryOptions,
): StatsResult<PageStats>;
```

### 行为与写入 API

#### `useTrackPagePresence(page, options?)`

```ts
type TrackedPage = {
  title: string;
  url: string;
  canonicalUrl: string;
};

type PagePresenceTrackerOptions = {
  trackReading?: boolean;
};

function useTrackPagePresence(
  page: TrackedPage,
  options?: PagePresenceTrackerOptions,
): {
  presence: "active" | "idle" | "hidden" | "offline";
  visibility: "visible" | "hidden";
};
```

行为：

- 页面进入时自动上报 `page_view`
- 周期上报 `heartbeat`
- `trackReading = true` 时上报阅读进度
- 页面退出时上报 `session_end`
- 自动维护当前页面的 presence context

注意：

- 这是写入型 hook，不负责读取页面状态
- 页面状态请用 `usePageStatus(canonicalUrl)`

## 典型用例

### 用例 1：全站状态卡片

```tsx
import { useGlobalStatus } from "@pulse/realtime-react";

export function GlobalStatusCard() {
  const { data, loading, error } = useGlobalStatus();

  if (loading) return <p>Loading…</p>;
  if (error || !data) return <p>{error ?? "global status unavailable"}</p>;

  return (
    <section>
      <h2>{data.sessionCount} online</h2>
      <p>{data.activePageCount} active pages</p>
      <p>{data.ownerStatus?.focus?.name ?? "No active focus"}</p>
      <ul>
        {data.sessions.map((session) => (
          <li key={session.id}>{session.userName ?? session.id}</li>
        ))}
      </ul>
    </section>
  );
}
```

### 用例 2：owner 状态与媒体卡片

```tsx
import { useOwnerMedia, useOwnerStatus } from "@pulse/realtime-react";

export function OwnerNowCard() {
  const owner = useOwnerStatus();
  const media = useOwnerMedia();

  if (owner.loading) return <p>Loading…</p>;
  if (owner.error || !owner.data) return <p>{owner.error ?? "owner unavailable"}</p>;

  return (
    <section>
      <h2>{owner.data.focus?.name ?? "Idle"}</h2>
      <p>{owner.data.focus?.desc ?? "No description"}</p>
      <p>{media.data?.title ?? "Nothing playing"}</p>
      <p>{media.data?.progressLabel ?? "0:00"} / {media.data?.durationLabel ?? "0:00"}</p>
      <p>{owner.data.lastActivedAt.toLocaleString()}</p>
    </section>
  );
}
```

### 用例 3：文章页读取状态并上报 presence

```tsx
import { usePageStatus, useTrackPagePresence } from "@pulse/realtime-react";

export function ArticlePage() {
  const page = {
    title: "How Presence Rooms Work",
    url: window.location.href,
    canonicalUrl: `${window.location.origin}/article/presence-rooms`,
  };

  useTrackPagePresence(page, { trackReading: true });

  const { data, loading, error } = usePageStatus(page.canonicalUrl);

  if (loading) return <p>Loading…</p>;
  if (error || !data) return <p>{error ?? "page status unavailable"}</p>;

  return (
    <aside>
      <p>{data.sessionCount} readers online</p>
      <p>{data.stayTimeInSec}s stay time</p>
      <ul>
        {data.sessions.map((session) => (
          <li key={session.id}>
            {session.userName ?? session.id} · {session.progress?.percent ?? 0}%
          </li>
        ))}
      </ul>
      <ul>
        {data.activePages.map((page) => (
          <li key={page.id}>
            {page.title ?? page.canonicalUrl ?? page.id} · {page.sessionCount}
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

### 用例 4：聊天面板

```tsx
import { useChatRoom } from "@pulse/realtime-react";

export function ChatPanel() {
  const { data, loading, error, sendMessage } = useChatRoom({
    roomId: "chat:status",
    displayName: "KT",
  });

  if (loading) return <p>Loading…</p>;
  if (error || !data) return <p>{error ?? "chat unavailable"}</p>;

  return (
    <section>
      <p>{data.participantCount} online</p>
      <button onClick={() => sendMessage("hello")}>Send</button>
      {data.latestMessages.map((message) => (
        <p key={message.id}>
          {message.senderDisplayName}: {message.content}
        </p>
      ))}
    </section>
  );
}
```

### 用例 5：站点 / owner / 页面统计

```tsx
import { useOwnerStats, usePageStats, useSiteStats } from "@pulse/realtime-react";

export function StatsPanel() {
  const site = useSiteStats({ period: "day", limit: 14 });
  const owner = useOwnerStats({ period: "day", limit: 14 });
  const page = usePageStats("https://docs.example.com/article/presence-rooms", {
    period: "day",
    limit: 14,
  });

  if (site.loading || owner.loading || page.loading) return <p>Loading…</p>;
  if (site.error || owner.error || page.error) {
    return <p>{site.error ?? owner.error ?? page.error}</p>;
  }

  return (
    <section>
      <p>Site PV: {site.lifetime?.pv ?? 0}</p>
      <p>Owner Focus: {owner.lifetime?.totalFocusLabel ?? "0s"}</p>
      <p>Page Read Time: {page.lifetime?.readTimeLabel ?? "0s"}</p>
    </section>
  );
}
```

## Advanced / Escape Hatches

以下接口保留给高级场景，不作为页面业务代码默认入口：

- `usePulseRealtimeClient()`
- raw room hooks / raw room subscription
- debug hooks
- selectors / lower-level client API

默认页面代码应优先使用本文定义的 `global / owner / page / chat / stats / actions` API。
