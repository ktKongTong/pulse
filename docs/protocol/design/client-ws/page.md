# Client Page WS

归属：`packages/realtime-protocol`
代码范围：`packages/realtime-protocol`、`apps/realtime-worker`、Web client / SDK
状态：draft
验证：协议设计；落地时需要补 schema、worker/browser 测试和端到端验证

`client.page.ws.v1` 是页面级 WebSocket。每个页面连接一条 page WS，用于把当前 tab 在该页面上的 reading progress 和页面 metadata 提交给 server，并接收该页面的实时 snapshot。

## Connection

```text
GET /api/v1/client/page/ws?canonicalUrl=...
```

`canonicalUrl` 是 page room identity，必须在 endpoint 中提供。SDK 从本地存储读取 server-issued `sessionId` 后建立连接，并在 `hello` frame 中提交 `sessionId` 和 `tabId`。

Page WS 必须对应同 tab 的 active common WS。Server 接受 page WS 前要确认 `(sessionId, tabId)` 已有 active common WS。

一个 tab 对一个 canonical page 至多持有一条 page WS：

```text
one tab + one canonical page -> one client.page.ws.v1
```

## Client -> Server

```ts
type ClientPageClientFrame =
  | ClientPageHelloFrame
  | ClientPageUpdateFrame
  | ClientPageLeaveFrame;
```

### Hello

```ts
type ClientPageHelloFrame = {
  protocol: "client.page.ws.v1";
  type: "hello";
  supportedProtocols: ["client.page.ws.v1"];
  sdkVersion: string;
  sessionId: string;
  tabId: string;
  page?: {
    title?: string;
    url?: string;
  };
  transition?: {
    fromCanonicalUrl: string;
    navigationId: string;
    startedAt: string;
  };
};
```

规则：

- `sessionId` 必须来自 server-issued session。
- `tabId` 由 SDK 生成，标识当前 tab。
- `(sessionId, tabId)` 必须已经有 active common WS。
- `page` 只携带当前页面 metadata，不重复携带 `canonicalUrl`。
- `transition.fromCanonicalUrl` 用于表达当前 page WS 是从旧 canonical page 迁移而来。
- `navigationId` 标识一次页面迁移；新 page `hello.transition.navigationId` 与旧 page `leave.transition.navigationId` 相同。
- `hello` 之后 server 才发送 `hello_ack` 和首帧 `snapshot`。

### Page Update

```ts
type ClientPageUpdateFrame = {
  protocol: "client.page.ws.v1";
  type: "page.update";
  seq: number;
  observedAt: string;
  reading?: {
    percent?: number;
    scrollY?: number;
  };
  page?: {
    title?: string;
    url?: string;
  };
};
```

规则：

- `seq` 是当前 page WS connection 内单调递增的序号，重连后重新开始。
- `reading` 表示当前 tab 在当前 canonical page 上的最新阅读进度。
- `page` 用于更新当前页面 metadata。
- server 按 `observedAt` 和 `seq` 选择同一 session 在同一 page 上最新有效的 tab progress。
- client tab 的 focus / visibility 不进入 server protocol。

### Leave

```ts
type ClientPageLeaveFrame = {
  protocol: "client.page.ws.v1";
  type: "leave";
  seq: number;
  observedAt: string;
  transition?: {
    toCanonicalUrl: string;
    navigationId: string;
    startedAt: string;
  };
};
```

规则：

- `leave` 表示当前 tab 离开 endpoint 中的 canonical page。
- `transition.toCanonicalUrl` 用于表达旧 page WS 正在迁移到新的 canonical page。
- server 收到 `leave` 后可以移除该 tab 对当前 page 的 presence。
- 如果 `leave` 没有送达，server 仍通过 WS close/error 和自身 grace 策略清理。

## Server -> Client

```ts
type ClientPageServerFrame =
  | ClientPageHelloAckFrame
  | ClientPageSnapshotFrame
  | ClientPageErrorFrame;
```

### Hello Ack

```ts
type ClientPageHelloAckFrame = {
  protocol: "client.page.ws.v1";
  type: "hello_ack";
  selectedProtocol: "client.page.ws.v1";
  connectionId: string;
};
```

`connectionId` 由 server 生成，标识当前 accepted page WS connection。

### Snapshot

```ts
type ClientPageSnapshotFrame = {
  protocol: "client.page.ws.v1";
  type: "snapshot";
  snapshot: ClientPageSnapshot;
};

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

字段规则：

- `revision` 是 server 对该 page snapshot 的单调版本。
- `updatedAt` 是 snapshot 生成时间。
- `page.canonicalUrl` 是 endpoint canonical page。
- `sessions.totalCount` 是当前 page 的有效 browser session 总数，按 `sessionId` 去重。
- `sessions.recent` 是 server 按固定规则返回的页面 session 明细集合，不是全量 session 列表。

### Page Session Detail

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

规则：

- `tabCount` 是该 session 在当前 page 上有效 tab 数。
- `progress` 取该 session 在当前 page 上 server 选定的最新 reading progress。
- session 不再有效时直接从 `sessions.recent` 消失。
- server 固定排序：按 `lastSeenAt desc`。

## Error

```ts
type ClientPageErrorFrame = {
  protocol: "client.page.ws.v1";
  type: "error";
  code:
    | "invalid_frame"
    | "hello_required"
    | "unsupported_protocol"
    | "invalid_session"
    | "internal_error";
  message: string;
  fatal: true;
};
```

错误规则：

- `invalid_frame`：frame 不是合法 JSON、schema 不符合当前协议，或缺少必填字段。
- `hello_required`：`hello_ack` 前收到非 `hello` frame。
- `unsupported_protocol`：`hello.supportedProtocols` 不包含 `client.page.ws.v1`。
- `invalid_session`：`sessionId` 缺失、无效、未签发、已过期，或 `(sessionId, tabId)` 没有 active common WS。
- `internal_error`：server 内部错误。
- 所有 error 都是 fatal；server 发送 error 后关闭 WS。

## Lifecycle

连接建立：

```text
SDK reads or claims sessionId
tab opens /api/v1/client/ws and completes common hello(sessionId, tabId)
tab opens /api/v1/client/page/ws?canonicalUrl=...
client -> page hello(sessionId, tabId, page?)
server -> hello_ack(connectionId)
server -> snapshot
```

页面更新：

```text
client -> page.update(seq, reading?, page?)
server updates page aggregate
server updates global aggregate
server -> page snapshot
server -> common snapshot when global aggregate changes
```

页面迁移：

```text
old page WS -> leave(transition.toCanonicalUrl, navigationId)
new page WS -> hello(transition.fromCanonicalUrl, navigationId)
server treats the two frames as one page migration for the same session/tab when both arrive
```

common WS 断开：

```text
tab common WS close/error
server revokes page WS for the same (sessionId, tabId)
page room removes that tab from current page presence
```

Snapshot 处理：

```text
client stores lastAppliedRevision for this page WS
client applies snapshot only when snapshot.revision > lastAppliedRevision
client discards snapshot when snapshot.revision <= lastAppliedRevision
```

`revision` 必须是该 page snapshot 的单调版本，不是单条 WS connection 的局部版本。
