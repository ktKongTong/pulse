# Client WS Server State

归属：`apps/realtime-worker`
代码范围：`apps/realtime-worker` Durable Object、`packages/realtime-protocol`
状态：draft
验证：服务端状态设计；落地时需要补 DO hibernation、worker 测试和端到端验证

本文描述 client WS 相关 Durable Object 内需要维护的 properties。WebSocket 对象通过 Cloudflare Durable Object Hibernation API 管理；DO 只保存可恢复的 connection metadata 和可派生 snapshot 的业务事实。

## GlobalDO

`GlobalDO` 承载站点全局状态和 common WS fanout。

Properties：

- `commonConnections`：当前 active common WS metadata，按 `(sessionId, tabId)` 唯一；由 hibernated socket attachment 恢复。
- `tabPages`：当前 tab 关联的 PageDO 集合，按 `(sessionId, tabId)` 索引 `canonicalUrl`。
- `pageAggregates`：从 PageDO 汇总来的 active page 聚合，按 `canonicalUrl` 去重。
- `ownerFocus`：owner 当前 focus app/window 状态；无有效 focus 时为空。
- `revision`：global snapshot 单调版本。
- `updatedAt`：global snapshot 最近更新时间。

规则：

- 每个 tab 自己建立 common WS。
- 同一个 `(sessionId, tabId)` 同时只允许一个 active common WS；新连接被接受后，旧连接收到 `connection_superseded` 并关闭。
- common WS close/error 后，GlobalDO 移除对应 `(sessionId, tabId)`，并通过 `tabPages` 撤销同 tab 的 page connection。
- 同一个 `sessionId` 下其他 tab 的 common WS 不受影响。
- session 是否仍有效由 `commonConnections` 中是否还有同 `sessionId` 的 active tab 决定。
- `ClientCommonGlobalSnapshot.sessions` 由 `commonConnections` 和 PageDO 汇总状态派生，不作为独立事实源保存。
- `ClientCommonGlobalSnapshot.activePages` 由 `pageAggregates` 派生。
- GlobalDO 不持久化页面跳转 transition 状态；transition 只用于到达 frame 的即时合并和抖动抑制。

## PageDO

`PageDO` 承载单个 canonical page 的实时状态和 page WS fanout。

Properties：

- `canonicalUrl`：当前 PageDO 的页面 identity。
- `pageConnections`：当前 active page WS metadata，按 `(sessionId, tabId)` 唯一；由 hibernated socket attachment 恢复。
- `tabProgress`：当前 page 上按 `(sessionId, tabId)` 保存的最新 tab 状态。
- `pageMeta`：server 当前认为有效的页面 metadata。
- `revision`：page snapshot 单调版本。
- `updatedAt`：page snapshot 最近更新时间。

规则：

- PageDO 接受 page WS 前必须通过 GlobalDO `attachPage(sessionId, tabId, canonicalUrl)`。
- `attachPage` 在 GlobalDO 内同时检查 active common WS，并把 `canonicalUrl` 记录到 `tabPages`。
- `attachPage` 失败时，PageDO 拒绝 page WS。
- page WS close/leave 后，PageDO 通过 GlobalDO `detachPage(sessionId, tabId, canonicalUrl)` 清理 `tabPages`。
- common WS close/error 时，GlobalDO 按 `tabPages` 通知对应 PageDO revoke 同 `(sessionId, tabId)` 的 page WS。
- PageDO 收到 revoke 后关闭 page WS，并移除该 tab 对当前 page 的贡献。
- 同一个 session 在同一个 page 上有多个 tab 时，`sessions.totalCount` 只计一次，`tabCount` 表达 tab 数。
- `ClientPageSnapshot.sessions` 由 `tabProgress` 按 `sessionId` 聚合派生。
- reading progress 取 server 认为最新有效的 tab progress，按 `observedAt` 和 `seq` 选择。
- PageDO 在 page update / leave / close / revoke 后向 GlobalDO 提交当前 page aggregate。
- 当前 page 没有有效 session 时，GlobalDO 删除对应 `canonicalUrl` 的 `pageAggregates` 记录。
- PageDO 不独立判断 session 生命周期；common WS 是 page WS 的有效性前置条件。

## Hibernation Attachment

每条 accepted WS 的 attachment 至少包含：

```ts
type ClientWsAttachment = {
  protocol: "client.common.ws.v1" | "client.page.ws.v1";
  connectionId: string;
  sessionId: string;
  tabId: string;
  canonicalUrl?: string;
  acceptedAt: string;
  lastSeenAt: string;
};
```

规则：

- common WS attachment 不包含 `canonicalUrl`。
- page WS attachment 必须包含 `canonicalUrl`。
- DO 被唤醒后，通过 attachment 重建 `commonConnections` 或 `pageConnections`。
- attachment 只保存恢复连接索引需要的 metadata，不保存 snapshot。
