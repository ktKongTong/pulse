# Module Boundaries

Pulse 当前按四层分工，后续改动默认遵守以下边界。

## 1. `packages/realtime-protocol`

职责：

- 定义所有 wire contract
- 负责 schema / parser / discriminated union
- 作为 `worker`、`realtime-react`、`native` 的共享协议事实来源

不负责：

- 运行时聚合
- transport
- UI 语义

约束：

- 任何协议 shape 变更都必须同步更新测试和文档
- 其他层不得复制定义平行类型

## 2. `apps/realtime-worker`

职责：

- 接收 `presence.v2` / `web.v1` 上行
- 维护 `DeviceDO / RoomDO / RoomDO 继承的 SessionDO 能力`
- 生成 room snapshot、chat 状态和 stats 查询结果

子职责：

- `DeviceDO` 只处理设备 ingest、设备热状态、设备历史归档
- `RoomDO` 现在拆成 `GlobalStatusRoom / PageStatusRoom / ChatRoom` 三个具体 DO 类，分别处理自己的聚合、持久化、room-scoped websocket 与广播
- `SessionDO` 不再是独立 Durable Object；它现在只是 `RoomDO` 继承的 session/websocket 抽象能力
- `room-view-helpers.ts` 只保留纯 reader/page snapshot 组装 helper，不再承载房间行为分发

不负责：

- 定义协议
- 前端 transport 细节
- native 本地存储

## 3. `packages/realtime-react`

职责：

- 提供 Web 端 realtime client façade
- 封装 transport、订阅管理、hooks、client API
- 对应用层暴露稳定的消费接口

不负责：

- 定义协议
- 决定房间聚合规则
- 持有另一套服务端状态模型

约束：

- 页面组件只能通过 `client / subscriptions / hooks` 消费 realtime
- 页面组件默认优先消费 `realtime-react` 提供的 facade hooks/selectors；raw snapshot 只用于调试或新增 facade 前的过渡场景
- 组件层不直接解析 raw websocket message

## 4. `common` + `macosApp`

职责：

- `common` 提供 native 共享桥接、状态模型、Room 本地持久化
- `macosApp` 提供 SwiftUI 菜单栏壳和设置/状态展示

不负责：

- 服务端房间聚合
- 自定义协议定义

约束：

- config/debug 偏好仍放 `NSUserDefaults`
- usage/raw journal 的运行态持久化统一走 Room DAO
- `composeApp` 只作为迁移参考，不再视为当前产品能力来源

## Dependency Direction

默认依赖方向：

```text
packages/realtime-protocol
  -> apps/realtime-worker
  -> packages/realtime-react
  -> common/macosApp
```

禁止方向：

- `packages/realtime-react -> apps/realtime-worker`
- `common/macosApp -> apps/realtime-worker` 内部实现
- 任意层绕过 `packages/realtime-protocol` 自定义 wire shape

## Change Rules

- 协议改动必须伴随：
  - `packages/realtime-protocol` 测试
  - 至少一个 consumer 检查点
  - 文档更新
- `worker` 架构改动与协议改动分开提交
- native 本地存储改动与 UI polish 分开提交
