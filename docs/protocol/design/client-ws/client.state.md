# Client 可见状态

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、Web client / SDK
状态：draft
验证：状态设计；落地时需要同步 protocol schema、SDK selector、worker/browser 测试和端到端验证

本文描述 client 能从 `client.common.ws.v1`、`client.page.ws.v1` 和 `client.media.ws.v1` 看到的状态，以及 SDK 应该如何裁剪成组件可消费的 view。

## Common Snapshot State

`client.common.ws.v1` 下发站点全局状态：

```ts
type ClientCommonGlobalSnapshot = {
  revision: number;
  updatedAt: string;

  sessions: {
    totalCount: number;
    recent: ClientCommonSessionDetail[];
  };

  activePages: {
    totalCount: number;
    top: ClientCommonActivePageDetail[];
  };

  owner: {
    focus: ClientOwnerFocus | null;
  };
};
```

字段语义：

- `sessions.totalCount` 是当前有效 browser session 总数。
- `sessions.recent` 是 server 固定规则返回的 session 明细集合，不是全量 session 列表。
- `activePages.totalCount` 是当前有效 active page 总数。
- `activePages.top` 是 server 固定规则返回的 active page 明细集合，不是全量 page 列表。
- `owner.focus` 是 owner 当前 focus 状态。
- common WS 是 tab 级连接；`sessions` 按 `sessionId` 聚合多个 tab。

### Session Detail

```ts
type ClientCommonSessionDetail = {
  sessionId: string;
  tabCount: number;
  user?: ClientCommonUser;
  pages: ClientCommonSessionPage[];
  lastSeenAt: string;
};

type ClientCommonSessionPage = {
  canonicalUrl: string;
  title?: string;
  url?: string;
  tabCount: number;
  lastSeenAt: string;
};

type ClientCommonUser = {
  userId: string;
  username?: string;
  userAvatar?: string;
};
```

### Active Page Detail

```ts
type ClientCommonActivePageDetail = {
  canonicalUrl: string;
  title?: string;
  url?: string;
  sessionCount: number;
  lastSeenAt: string;
};
```

### Owner Focus

```ts
type ClientOwnerFocus = {
  app?: {
    id?: string;
    name?: string;
    category?: string;
    icon?: string;
  };
  window?: {
    title?: string;
  };
  updatedAt: string;
};
```

`owner.focus` 属于 common 状态。Owner media / stream 状态由 media 协议定义。

## Page Snapshot State

`client.page.ws.v1` 下发当前 page 状态：

```ts
type ClientPageSnapshot = {
  revision: number;
  updatedAt: string;
  page: {
    canonicalUrl: string;
    url?: string;
    title?: string;
  };
  sessions: {
    totalCount: number;
    recent: ClientPageSessionDetail[];
  };
};
```

字段语义：

- `sessions.totalCount` 是当前 page 的有效 browser session 总数。
- `sessions.recent` 是 server 固定规则返回的页面 session 明细集合，不是全量 session 列表。

```ts
type ClientPageSessionDetail = {
  sessionId: string;
  tabCount: number;
  progress?: {
    percent?: number;
    scrollY?: number;
  };
  lastSeenAt: string;
};
```

## Media State

`client.media.ws.v1` 下发当前 tab 可见的 media state：

```ts
type ClientMediaStateFrame = {
  protocol: "client.media.ws.v1";
  type: "state";
  revision: number;
  updatedAt: string;
  media: ClientMediaNowPlaying | null;
  stream: {
    source: ClientMediaStreamSource;
  };
};

type ClientMediaStreamSource = {
  state: "ready" | "disabled" | "offline" | "idle";
};

type ClientMediaNowPlaying = {
  current: LiveListenMedia;
  clock?: LiveListenClock;
  playback: "playing" | "paused";
  updatedAt: string;
};
```

字段语义：

- `stream.source.state` 表示当前 stream source 是否可请求。
- `stream.source.state = "ready"` 时，client 才能发送 `stream.request`。
- 当前 tab 自己的 stream 状态由 SDK 根据本地 pending request 和 stream runtime frame 维护。
- `media` 是 now playing 展示事实。

## Component Views

SDK 不应把协议 snapshot 原样暴露给所有组件。组件通过 selector 消费裁剪后的 view。

### Global Online Count

用于 header 这类只显示站点在线人数的组件。

```ts
type GlobalOnlineCountView = {
  sessionCount: number;
};
```

来源：

```text
common.sessions.totalCount
```

### Active Pages

用于活跃页面列表。

```ts
type ActivePagesView = {
  activePageCount: number;
  activePages: Array<{
    canonicalUrl: string;
    title?: string;
    url?: string;
    sessionCount: number;
  }>;
};
```

来源：

```text
common.activePages.totalCount
common.activePages.top
```

### Owner Focus

用于展示 owner 当前 focus app/window。

```ts
type OwnerFocusView = ClientOwnerFocus | null;
```

来源：

```text
common.owner.focus
```

### Global Session Preview

用于需要展示站点在线用户预览的组件。Header count 不需要这个 view。

```ts
type GlobalSessionPreviewView = {
  sessionCount: number;
  sessions: Array<{
    sessionId: string;
    user?: ClientCommonUser;
  }>;
};
```

来源：

```text
common.sessions.totalCount
common.sessions.recent
```

### Global Session Activity

用于需要展示 session 当前页面集合的详情组件。

```ts
type GlobalSessionActivityView = {
  sessions: Array<{
    sessionId: string;
    user?: ClientCommonUser;
    pages: ClientCommonSessionPage[];
  }>;
};
```

来源：

```text
common.sessions.recent
```

### Page Readers

用于当前页面读者列表 / avatar stack / 阅读进度展示。

```ts
type PageReadersView = {
  canonicalUrl: string;
  sessionCount: number;
  sessions: Array<{
    sessionId: string;
    progress?: {
      percent?: number;
      scrollY?: number;
    };
  }>;
};
```

来源：

```text
page.page.canonicalUrl
page.sessions.totalCount
page.sessions.recent
```

### Media Source

用于 stream 控制按钮判断当前是否可请求 stream。

```ts
type MediaSourceView = {
  state: "ready" | "disabled" | "offline" | "idle";
  canRequest: boolean;
};
```

来源：

```text
media.stream.source.state
```

规则：

```text
canRequest = media.stream.source.state === "ready"
```

### Media Current Stream

用于展示当前 tab 是否正在请求或接收 stream。

```ts
type MediaCurrentStreamView =
  | { state: "observer" }
  | { state: "requesting"; requestId: string }
  | { state: "active"; streamId: string; generation: number };
```

来源：

```text
local pending stream.request
stream.accepted / stream.rejected / stream.stopped / stream.ended / stream.error
```

### Media Now Playing

用于展示 owner 当前播放内容。

```ts
type MediaNowPlayingView = ClientMediaNowPlaying | null;
```

来源：

```text
media.media
```

### Media Stream Control

用于 “一起听 / 停止” 控制组件。

```ts
type MediaStreamControlView = {
  source: MediaSourceView;
  current: MediaCurrentStreamView;
};
```

来源：

```text
media.stream.source
local media stream runtime
```
