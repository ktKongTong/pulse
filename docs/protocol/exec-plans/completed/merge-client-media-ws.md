# Merge Web Client Media WS Into Client WS Plan

归属：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、`packages/v2/realtime-react`
代码范围：web client ClientWS/MediaWS 合并；device/native 侧暂不合并
状态：completed（2026-06-19）
验证：protocol schema、worker WS tests、web SDK tests、typecheck

完成验证：

- `pnpm --filter @ktfun/pulse-protocol typecheck/test` 通过。
- `pnpm --filter @pulse/realtime-worker-v2 typecheck/test` 通过（12 个 client-ws 测试，含 `/api/v1/client/media/ws` 已删除断言）。
- `pnpm --filter @ktfun/pulse typecheck/test` 通过（7 个 SDK 测试，覆盖单 socket hello/stream/audio/retry）。
- `pnpm --filter @pulse/example typecheck` 通过。

## Summary

目标：把 web client 侧 `ClientWS` 和 `MediaWS` 合并为单条 `/api/v1/client/ws`，删除旧 `/api/v1/client/media/ws` 和 `client.media.ws.v1`。

默认边界：

- 第一阶段只做 web client + worker + protocol package 可运行闭环。
- device/native 侧 `device ws` 与 `device media ws` 暂不合并。
- Page WS 仍保留独立 `/api/v1/client/page/ws?canonicalUrl=...`，但前置依赖从 active common WS 改为 active client WS。

## Key Changes

- Protocol package:
  - 新增统一协议常量 `CLIENT_WS_PROTOCOL = "client.ws.v2"`。
  - 合并 `ClientCommon*Frame` 与 `ClientMedia*Frame` 为 `ClientWs*Frame` schema。
  - 单条 client WS 的 server frames 包含：`hello_ack`、global `snapshot`、media `state`、`stream.accepted/rejected/stopped/transition/ended/error`、`audio.chunk`、`error`。
  - 单条 client WS 的 client frames 包含：`hello`、`stream.request`、`stream.stop`、`ack`。
  - 删除旧 `CLIENT_COMMON_WS_PROTOCOL`、`CLIENT_MEDIA_WS_PROTOCOL` 以及旧 client media WS frame exports；保留 `ClientCommonGlobalSnapshot`、`ClientMediaNowPlaying`、`ClientMediaStreamSource` 这类数据类型语义。

- Worker:
  - `/api/v1/client/ws` 由 `GlobalDO` 作为唯一 web client socket owner。
  - 删除 `clientRoutes.get("/media/ws", ...)`，旧 `/api/v1/client/media/ws` 不再可用。
  - `GlobalDO` 在同一 socket 上处理 hello、global snapshot fanout、media state fanout、stream request/stop/ack 和 audio metadata/binary 转发。
  - `MediaDO` 不再持有 client WebSocket；只保留 device media socket、media state、stream context、buffer、pending command。
  - `MediaDO` 的 client 集合改为 tab key 元数据集合；需要给 client 发 media frame 或 audio chunk 时，通过 `GlobalDO` 方法转发到 active client socket。
  - `GlobalDO` close/error/supersede 时同时 revoke page WS 和 media stream client 身份；最后一个 stream client 离开时仍由 `MediaDO` 发 `stream.stop` 给 device。

- Web SDK:
  - 用单个 `ClientWsTransport` 替换 `CommonWsTransport` + `MediaWsTransport`。
  - `PulseRealtimeV2Client.connect()` 只建立一条 socket，`hello_ack` 后即完成连接。
  - `requestStream()`、`stopStream()`、`ackStream()` 都复用同一 socket。
  - `connectPage()` 仍先确保 client WS active，再打开 page WS。
  - `common.connection` 与 `media.connection` 暂时保留为 public snapshot 兼容视图，但都由同一底层 client WS 派生；不再有独立 media retry/error 状态。
  - 重试预算合并为一个 client-level retry，失败码使用 `client_ws_reconnect_exhausted`。

- Docs:
  - 更新 `docs/protocol/design/client-ws/`：把 common/media 两份 client WS 合同合并为单一 Client WS 合同。
  - 更新 server/client state 文档，明确 client media socket 不再存在，media stream client 是 `GlobalDO` active client socket 上的状态。
  - 同步 `docs/protocol/specs/endpoint-contracts.md` 和兼容策略，记录这是 breaking change，不保留旧 media endpoint。

## Test Plan

- Protocol:
  - `pnpm --filter @ktfun/pulse-protocol typecheck`
  - 覆盖 `ClientWsClientFrameSchema` 与 `ClientWsServerFrameSchema`：hello、snapshot、media state、stream request/accepted、audio.chunk、error。

- Web SDK:
  - `pnpm --filter @ktfun/pulse test -- src/client.test.ts`
  - 断言 `connect()` 只打开 `wss://.../api/v1/client/ws`。
  - 断言 hello 使用 `client.ws.v2`。
  - 断言 `stream.request`、`stream.stop`、`ack` 都发到同一 socket。
  - 断言 media `state` 和 audio metadata + binary 在同一 socket 上更新 snapshot / 调用 `onAudioChunk`。
  - 断言 socket close 只触发 client-level retry，不再出现独立 common/media retry。

- Worker:
  - `pnpm --filter @pulse/realtime-worker-v2 test -- test/client-ws.test.ts`
  - 断言单 client WS 连接后能收到 global snapshot 和 media state。
  - 断言 device media ready 后，client 在同一 WS 发 `stream.request`，device media WS 收到 `stream.requested` command。
  - 断言 device audio chunk 经 `MediaDO -> GlobalDO -> client WS` 到达同一 client socket。
  - 断言 client WS close 会撤销 page 和 media stream client。
  - 断言 `/api/v1/client/media/ws` 已删除。
  - 最后跑 `pnpm --filter @pulse/realtime-worker-v2 typecheck`。

## Assumptions

- 这次不合并 native/device 侧两条 WS；`common/src/.../MediaWS.kt` 只在后续 native/device 阶段处理。
- 旧 web media endpoint 直接删除，不做双写、不做兼容桥。
- 使用新协议名 `client.ws.v2`，因为这是 breaking wire change。
- 音频转发先接受 `MediaDO -> GlobalDO` 的 DO 方法调用成本；如果后续发现 chunk 频率成本不可接受，再单独设计 colocated media/client DO。
