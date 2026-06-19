# v1 存在但 v2 不保留的设计

归属：`docs/protocol`
代码范围：`apps/realtime-worker`、`packages/realtime-react`、`packages/realtime-protocol`、`packages/live-listen-cli`、旧 `common/core/livelisten`

本文记录从 v1 切换到 v2 时，v1 中存在但 v2 不继续作为目标协议/主路径保留的设计。结论用于清理 v1 code，不用于定义 v2 新协议。

## 结论

v2 的目标主路径是：

- Worker：`apps/realtime-worker-v2`
- Web SDK：`packages/v2/realtime-react`
- Wire schema：`packages/v2/realtime-protocol`
- Native device media：`common/core/devicev2`
- Example/status UI：`apps/example`

旧 `apps/realtime-worker`、`packages/realtime-react`、`packages/realtime-protocol` 和 `packages/live-listen-cli` 可以从主工作区清理。旧 `common/core/livelisten` 中的 v1 状态机和客户端可以清理；仍被 v2 native UI 复用的配置、媒体状态和 telemetry model 已改名到 `common/core/stream`。

## v1-only 设计

| v1 设计 | v1 位置 | v2 状态 | 处理 |
| --- | --- | --- | --- |
| `realtime.ws.v2` 泛 room websocket | `apps/realtime-worker/src/api/routes/realtime.ts`、`packages/realtime-react/src/room-subscription-manager.ts` | 被 `client.ws.v2`、`client.page.ws.v1` 拆分替代（`client.common.ws.v1` 与 `client.media.ws.v1` 已合并为 `client.ws.v2`） | 删除 v1 generic room transport |
| `roomKind` 统一 snapshot | `packages/realtime-protocol/src/realtime-v2.ts` | v2 endpoint 按职责拆分，不再用一个 snapshot 承载 global/page/chat/media | 删除 |
| `chat:*` room | `apps/realtime-worker/src/api/do/room/chat-room.ts`、`packages/realtime-react/src/hooks.ts` | v2 当前不设计 chat | 删除 |
| HTTP web ingest | `apps/realtime-worker/src/api/routes/ingest.ts`、`packages/realtime-react/src/realtime-client.ts` | v2 common/page WS 承载客户端实时状态，不保留旧 HTTP ingest 兼容层 | 删除 |
| history ingest | `POST /v2/history/ingest` | v2 暂不迁移历史批量写入 | 删除 |
| stats/history HTTP API | `apps/realtime-worker/src/api/routes/stats.ts`、`apps/realtime-worker/src/api/stats/*` | v2 还没有统计历史产品路径 | 删除 v1 API；如未来需要，按 v2 state 重新设计 |
| `interaction.v1` / `interaction.ws.v1` / `interaction.stream.v1` | `packages/realtime-protocol/src/interaction-v1.ts`、`apps/realtime-worker/src/api/do/interaction/*`、`packages/realtime-react/src/interaction-client.ts` | v2 当前不迁移 interaction | 删除 |
| `MediaRoomDO` | `apps/realtime-worker/src/api/do/media-room/media-room-do.ts` | 核心串流职责已被 v2 `MediaDO` 替代 | 删除旧实验版 |
| `live-listen.device.v1` | `packages/realtime-protocol/src/live-listen-v1.ts`、`common/core/livelisten/LiveListenClient`、`apps/realtime-worker/src/api/do/live-listen/*` | 被 `device.common.connection.v1`、`device.media.connection.v1`、`device.media.v1` 替代 | 删除旧协议和客户端 |
| partytracks / live-listen host debug | `apps/realtime-worker/src/api/routes/partytracks.ts`、`packages/live-listen-cli`、`apps/realtime-worker/src/routes/live-listen.*` | v2 不作为主路径保留 | 删除 |
| v1 SDK high-level facade | `packages/realtime-react/src/user-api.ts`、`hooks.ts` | v2 SDK 用新的 selectors/hooks；缺的 facade 以后基于 v2 状态补 | 删除 v1 SDK |
| v1 branding asset helper | `packages/realtime-react/src/branding.ts` | example 已复制当前 UI 所需资产 | 删除 v1 SDK helper |
| v1 `/v1/meta` capability discovery | `apps/realtime-worker/src/api/routes/meta.ts` | v2 没有 generic capability discovery；主路径直接使用 v2 endpoint | 删除 |

## v2 已替代的能力

`MediaRoomDO` 不算缺失能力。v2 `MediaDO` 已经承担 media room 的核心职责：device/client 连接、stream request/stop command、binary chunk fan-out、ring buffer、listener 清理和 device command timeout。v1 的 observer telemetry、stats frame、`fromSeq` replay endpoint 没有迁移；这些属于 debug/实验能力，不阻塞主路径。

`live-listen.device.v1` 不再作为兼容协议保留。v2 device 侧已经拆成 common WS 和 media WS，media WS 使用 meta frame + binary chunk，而不是旧的单连接状态机。

## 保留的 native stream 模型

v2 native 仍复用下列概念，但它们不再代表 v1 wire protocol，也不再使用 `LiveListen*` 命名：

- `ConnectionConfig`
- `StreamStats`
- `Media`
- `MediaStateSnapshot`
- `StreamPermission`
- `PlaybackStatus`
- `StreamCaptureStatus`
- `StreamStopReason`

这些保留为 native stream UI / device v2 的内部 model。

## 清理边界

本次可以删除：

- `apps/realtime-worker`
- `packages/realtime-react`
- `packages/realtime-protocol`
- `packages/live-listen-cli`
- 旧 `common/core/livelisten` 中的 state machine、v1 wire frame、macOS websocket client 和对应测试

本次不删除：

- `apps/realtime-worker-v2`
- `apps/example`
- `packages/v2/realtime-protocol`
- `packages/v2/realtime-react`
- `common/core/devicev2`
- native UI 仍使用的 `common/core/stream` config/stats/media model
