# Merge Device Media WS Into Device WS Plan

归属：`packages/v2/realtime-protocol`、`apps/realtime-worker-v2`、`common`
代码范围：device 侧 DeviceWS/MediaWS 合并；web client 单 WS 基线保持不变
状态：completed（2026-06-19）
验证：protocol schema、worker WS tests、KMP common compile、native/worker local integration

完成验证：

- `pnpm --filter @ktfun/pulse-protocol typecheck/test` 通过。
- `pnpm --filter @pulse/realtime-worker-v2 typecheck/test` 通过（14 个 client-ws 测试，含 `/api/v1/device/media/ws` 已删除断言 + unified hello 断言）。
- `./gradlew :common:compileKotlinMacosArm64` 通过（KMP native target）。JVM target 仅有 pre-existing config 模块错误，与 ws 包无关。
- `pnpm --filter @ktfun/pulse typecheck/test` 通过（web SDK 未受影响）。

## Summary

目标：把 device 侧两条长期 WebSocket 合并为单条 `/api/v1/device/ws`。`DeviceDO` 成为唯一 device socket owner，继续负责 device session、heartbeat lease、presence 和 focus；`MediaDO` 保留媒体状态、stream context、command timeout、audio buffer 和 client fanout 编排，但不再接受或持有 device media WebSocket。

默认取舍：

- 旧 `/api/v1/device/media/ws` 和 `device.media.connection.v1` 直接删除，不做兼容桥。
- device media 业务协议 `device.media.v1` 保留，只是承载在统一 device WS 上。
- web client 单 WS 合并后的 worker 基线保持不变。
- native/KMP 侧同步切到单 socket，不再用 `CommonWS + MediaWS` 双 listen job 判断 connected。

## Key Changes

- Protocol:
  - 新增 `DEVICE_WS_PROTOCOL = "device.ws.v2"` 作为连接生命周期协议。
  - 统一 hello：一个 `device.ws.v2 hello` 同时携带 device metadata、presence capabilities、media capabilities、audio capabilities 和 supported protocols。
  - 统一 hello_ack：返回 `deviceSessionId`、connectionId、selectedProtocols、media streaming capability。
  - `presence.v2` 和 `device.media.v1` frame 继续保持现有业务 shape；`device.media.v1 command` 从同一 `/api/v1/device/ws` 下发。
  - 删除 `DEVICE_MEDIA_CONNECTION_PROTOCOL` / `device.media.connection.v1` 的连接握手合同；文档里标记旧 media endpoint 为 removed。

- Worker:
  - `DeviceDO` 在单 socket 上解析 `device.ws.v2 hello`，建立 active device session，并把同一 socket attachment 标记为 unified device connection。
  - `DeviceDO.webSocketMessage()` 按 frame protocol 分发：
    - `presence.v2`：沿用当前 focus/presence 更新逻辑。
    - `device.media.v1`：调用 `MediaDO` 的 device-frame handler。
    - binary frame：调用 `MediaDO` 的 audio binary handler。
  - `MediaDO` 删除 `fetch()`、pending-device attachment、device socket attachment 和 `acceptDevice()`；改为由 `DeviceDO` 调用 `acceptDeviceSession(...)` / `handleDeviceFrame(...)` / `handleDeviceBinary(...)` / `endDeviceSession(...)`。
  - `MediaDO.sendDeviceCommand(...)` 不再 `safeSend(this.deviceSocket, frame)`，改为调用 `DeviceDO.sendDeviceFrame(deviceId, frame)` 或等价方法，由 `DeviceDO` 发到当前 active unified device socket。
  - `DeviceDO` close/error/heartbeat lease expired 时同时清理 presence/focus，并调用 `MediaDO.revokeDeviceSession(deviceSessionId)`，使 media state 离线、pending command 清空、client stream 结束。
  - 删除 `deviceRoutes.get("/media/ws", ...)`，测试确认旧 endpoint 不再注册。

- Native/KMP:
  - 用一个 unified device transport 替换 `DeviceV2Client` 里的 `connectedCommonWS` + `connectedMediaWS` 双连接流程。
  - 复用 `WSManager` 的单 session/send/sendBinaryPair 能力；需要把原 `CommonWS.listen()` 的 presence outbound/heartbeat 和 `MediaWS.listen()` 的 command inbound/PCM outbound 组合到一个 unified listen loop。
  - `DeviceV2Client.initConnection()` 只连接 `Endpoint.getCommonWSUrl()`，发送 unified hello，hello_ack 后发送当前 media state snapshot，再进入 single listen job。
  - `publishFocusChanged()` 发到 unified presence outbound；`stopActiveStream()`、PCM chunk、media update 走同一 socket。
  - `DeviceWsState` 可以暂时保留 `common` / `media` 两个 public 子状态作为 UI 兼容视图，但底层 connection 状态来自同一个 `WSManager`；connected 条件改为 single listen job stable。
  - 删除 `Endpoint.getMediaWSUrl(deviceSessionId)` 的使用；后续可删除函数和旧 `MediaWS.connect()` 路径。

- Docs:
  - 更新 `docs/protocol/design/device-ws/`，把 transport 表改成单 device WS。
  - 更新 `docs/protocol/design/device-ws/device.md` / `media.md`：明确 media frame 仍是 `device.media.v1`，但不再有 media connection hello。
  - 更新 worker/native 文档中的 connected 语义：单 socket hello_ack + stable listen job 即 connected；media readiness 由 `stream.state.updated` 表达，不再由第二条 WS 成功表达。

## Test Plan

- Protocol:
  - `pnpm --filter @ktfun/pulse-protocol typecheck`
  - 覆盖 unified `DeviceWsClientFrameSchema` / `DeviceWsServerFrameSchema`：hello、hello_ack、presence snapshot/heartbeat/session_end、media state/media update/ack/audio.chunk/error、server command。

- Worker:
  - `pnpm --filter @pulse/realtime-worker-v2 test -- test/client-ws.test.ts`
  - 更新 helpers：`connectDevice()` 直接返回 unified device socket，不再调用 `connectDeviceMedia()`。
  - 断言 unified device hello 后返回 `device.ws.v2 hello_ack`，且 worker media state 进入 online/ready 依赖后续 `device.media.v1 stream.state.updated`。
  - 断言 client 单 WS 发 `stream.request` 后，server command 下发到 unified device socket。
  - 断言 device 在 unified socket 上发送 `ack`、`audio.chunk` JSON + binary，client 能收到 audio metadata + binary。
  - 断言 unified device socket close 会让 media source 变为 offline，并暂停 now playing。
  - 断言 `/api/v1/device/media/ws` 返回 not found 或不再存在。
  - 最后跑 `pnpm --filter @pulse/realtime-worker-v2 typecheck`。

- Native/KMP:
  - `./gradlew --no-daemon -Dorg.gradle.vfs.watch=false :common:compileKotlinJvm :common:compileKotlinMacosArm64`
  - 针对 `DeviceV2Client` 添加或更新 focused tests：单 socket connected、network offline cancel、server stream command handling、PCM binary pair send、stream stop cleanup。
  - 本地联调时启动 worker + native，验证 device connected、focus 上报、media ready、client request stream、audio chunk 到达。

## Assumptions

- 旧 native 版本不需要继续连 `/api/v1/device/media/ws`。
- `device.media.v1` 是业务协议名，继续保留；只删除 `device.media.connection.v1` 连接协议。
- 单 socket 上 binary audio frame 仍紧跟 `device.media.v1 audio.chunk` JSON metadata；server 按当前 pending chunk 规则校验 byteLength。
- Heartbeat 继续使用现有 60s presence heartbeat + 150s server lease，只是租约绑定统一 device socket。
- 如果单 socket 上 high-frequency audio 影响 presence/command latency，后续再单独设计 backpressure；本计划不引入第二 transport。
