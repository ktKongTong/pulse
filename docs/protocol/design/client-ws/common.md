# Client Common WS

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、Web client / SDK
状态：draft
验证：协议设计；落地时需要补 schema、worker/browser 测试和端到端验证

`client.common.ws.v1` 是 tab 级 common WebSocket。每个 tab 自己建立 common WS，用于证明该 tab 对应的 client session/tab 仍然有效，并接收站点全局实时 snapshot。

## Connection

```text
GET /api/v1/client/ws
```

连接上下文由 endpoint、鉴权和 server 运行环境决定。

一个 tab 目标上只有一条 common WS：

```text
one tab -> one client.common.ws.v1
```

`sessionId` 由 server claim endpoint 签发并写入本地存储。多个 tab 可以共享同一个 `sessionId`，但每个 tab 必须使用自己的 `tabId` 建立 common WS。

## Responsibilities

- common 协议协商。
- 接收 server 签发的 browser session identity。
- 绑定当前 tab 的 `sessionId/tabId`。
- 接收站点全局 snapshot。
- 暴露当前站点在线 session 概览。
- 暴露当前站点 active page 概览。

## Session Claim

首次打开且本地没有 `sessionId` 时，SDK claim server session：

```text
POST /api/v1/client/session
```

```ts
type ClientSessionClaimRequest = {
  protocol: "client.common.ws.v1";
  sdkVersion: string;
};

type ClientSessionClaimResponse = {
  protocol: "client.common.ws.v1";
  sessionId: string;
  user?: ClientCommonUser;
};
```

规则：

- `sessionId` 由 server 签发。
- `user` 由 server 根据 auth/cookie/session 解析。
- client 不在 common WS 中上报 `userId`、`username` 或 `userAvatar`。
- claim 成功后，SDK 将 `sessionId` 写入本地存储。

## Page Room Relationship

后续 page room WS 是 page truth source：

```text
page room WS -> page presence / reading / focus facts
             -> server page aggregate
             -> server global aggregate
             -> client.common.ws.v1 snapshot
```

因此：

- `activePages` 来自 page room 状态聚合。
- `sessions.recent[].pages` 来自 page room 的 tab/page 状态聚合。
- common WS 不直接上报 active page 列表。
- common WS 不和 page room 双写同一份页面事实。

如果同一个 browser session 同时打开多个页面：

- 这个 session 可以同时贡献多个 active page。
- 同一个 session 对同一个 page 只贡献一次 `sessionCount`。
- session 可以同时有多个 focus page，用于表达多 tab / 多窗口下的页面焦点集合。

Page WS 必须对应同一个 tab 的 active common WS。也就是说，page WS 的 `(sessionId, tabId)` 必须已经在 common WS 中 active。

## Client -> Server

```ts
type ClientCommonClientFrame = ClientCommonHelloFrame;
```

### Hello

```ts
type ClientCommonHelloFrame = {
  protocol: "client.common.ws.v1";
  type: "hello";
  supportedProtocols: ["client.common.ws.v1"];
  sdkVersion: string;
  sessionId: string;
  tabId: string;
};
```

规则：

- `sessionId` 标识一个 browser session，不标识单个 tab。
- 多 tab 共享同一个 `sessionId`。
- `tabId` 标识当前 tab。
- `sessionId` 必须来自 server claim。
- 同一个 `(sessionId, tabId)` 同时只允许一条 active common WS。
- `hello` 之后 server 才发送 `hello_ack` 和首帧 `snapshot`。
- common WS 不定义 heartbeat frame。

## Server -> Client

```ts
type ClientCommonServerFrame =
  | ClientCommonHelloAckFrame
  | ClientCommonSnapshotFrame
  | ClientCommonErrorFrame;
```

### Hello Ack

```ts
type ClientCommonHelloAckFrame = {
  protocol: "client.common.ws.v1";
  type: "hello_ack";
  selectedProtocol: "client.common.ws.v1";
  connectionId: string;
  session: {
    sessionId: string;
    tabId: string;
    user?: ClientCommonUser;
  };
};
```

`connectionId` 由 server 生成，标识当前 accepted WS connection。

### Snapshot

```ts
type ClientCommonSnapshotFrame = {
  protocol: "client.common.ws.v1";
  type: "snapshot";
  snapshot: ClientCommonGlobalSnapshot;
};
```

`ClientCommonGlobalSnapshot` 是 `/api/v1/client/ws` 的唯一 snapshot payload。

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

字段规则：

- `revision` 是 server 对 global snapshot 的单调版本。
- `updatedAt` 是 snapshot 生成时间。
- `sessions.totalCount` 是当前有效 browser session 总数，按 `sessionId` 去重。
- `sessions.recent` 是 server 按固定规则返回的 session 明细集合，不是全量 session 列表。
- `activePages.totalCount` 是当前有效 active page 总数，按 canonical page 去重。
- `activePages.top` 是 server 按固定规则返回的 active page 明细集合，不是全量 page 列表。
- `owner.focus` 是 owner 当前 focus app/window 状态；没有有效 focus 时为 `null`。

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

选择规则：

- `sessions.recent` 只返回仍有效的 session。
- 不返回 offline tombstone。
- session 离开动画由 client 对比前后 snapshot 自行派生。
- server 固定排序：按 `lastSeenAt desc`。

没有 `offline` 状态。session 不再有效时直接从 `sessions.recent` 消失。

多 tab 规则：

- `pages` 是该 session 当前存在 page WS 的页面集合，按 `canonicalUrl` 去重。
- 同一个 session 两个 tab 都打开同一页面时，该页面只出现一次，并通过 `tabCount` 表达 tab 数。
- `pages` 按 `lastSeenAt desc` 排序。
- client tab 的 focus / visibility 不进入 server protocol，不参与 server snapshot 和排序。

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

选择规则：

- `activePages.top` 来自 page room 聚合。
- server 固定排序：先 `sessionCount desc`，再 `lastSeenAt desc`。
- `sessionCount` 按 `sessionId` 去重，不按 tab 去重。
- 同一个 session 两个 tab 都打开同一页面，该页面 `sessionCount` 仍只加 1。
- 同一个 session 打开两个不同页面，可以同时让两个页面各自 `sessionCount` 加 1。

### Error

```ts
type ClientCommonErrorFrame = {
  protocol: "client.common.ws.v1";
  type: "error";
  code:
    | "invalid_frame"
    | "hello_required"
    | "unsupported_protocol"
    | "invalid_session"
    | "connection_superseded"
    | "internal_error";
  message: string;
  fatal: true;
};
```

错误规则：

- `invalid_frame`：client 发送的 frame 不是合法 JSON、schema 不符合当前协议，或缺少必填字段。server 发送 error 后关闭 WS。
- `hello_required`：`hello_ack` 前收到非 `hello` frame。`fatal=true`，server 发送 error 后关闭 WS。
- `unsupported_protocol`：`hello.supportedProtocols` 不包含 `client.common.ws.v1`。`fatal=true`，server 发送 error 后关闭 WS。
- `invalid_session`：`hello.sessionId` 缺失、未签发或已失效。`fatal=true`，server 发送 error 后关闭 WS。
- `connection_superseded`：同一 `(sessionId, tabId)` 下 server 接受了新的 common WS，旧 connection 被替换。`fatal=true`，server 发送 error 后关闭旧 WS。
- `internal_error`：server 内部错误。`fatal=true`，server 关闭 WS；client 可按普通重连策略处理。

## Lifecycle

session claim：

```text
client -> POST /api/v1/client/session
server -> { sessionId, user? }
SDK stores sessionId
```

连接建立：

```text
client opens /api/v1/client/ws
client -> hello(sessionId, tabId)
server -> hello_ack(connectionId, session)
server -> snapshot
```

后续状态更新：

```text
page room state changes
server updates global aggregate
server -> snapshot
```

common WS 断开或休眠：

```text
tab common WS close/error
server marks this (sessionId, tabId) common connection inactive
server revokes page WS owned by the same (sessionId, tabId)
other tabs under the same sessionId are unaffected
```

同时创建 common WS：

```text
the same tab opens two /api/v1/client/ws connections with the same sessionId/tabId
server accepts the newer connection as active
server sends connection_superseded to the older connection
server keeps only one active common connection per (sessionId, tabId)
```

Snapshot 处理：

```text
client stores lastAppliedRevision
client applies snapshot only when snapshot.revision > lastAppliedRevision
client discards snapshot when snapshot.revision <= lastAppliedRevision
```

`revision` 必须是 server global snapshot 的单调版本，不是单条 WS connection 的局部版本。
