# PulseBar KMP Native 下一阶段收尾计划

归属：`common`、`macosApp`
代码范围：`common/src/commonMain`、`common/src/macosMain`、`macosApp/PulseBarNative`
状态：active
验证：`pnpm check:native`；Swift/Xcode 引用变更还需要 Xcode build

本文只描述当前仍需推进或验证的收尾工作。Phase 1/2 的历史计划与完成记录见 [KMP Native Refactor Phase 1/2 历史记录](../completed/kmp-native-refactor-phases-1-2.md)。

## 当前已完成基线

以下事项不再作为 future plan 描述：

- Phase 1 legacy cleanup 已完成：旧 compat / migration 路径不再是当前架构目标。
- `composeApp/**` 当前不存在，desktop app 的有效 native 组合是 `common` + `macosApp`。
- config 已由 Kotlin `PulseBarConfigStore` 使用 AndroidX Typed DataStore 持久化，文件为 `config.v1.json`。
- usage / raw journal / checkpoint 继续由 Room/SQLite 负责。
- `core/log/PulseLogger.kt` 和 `core/log/PulseLogger.macos.kt` 已存在。
- query/command 基础已落地：`PulseBarBridge.macos.kt` 的 `readMenuState()` 是纯读，返回 `latestMenuState`；副作用入口是 `tick()` 和显式 command。
- Swift Export Flow / suspend 支持已切到 Kotlin 2.4.0-Beta2 相关形态，当前仍保留必要的 Swift Export workaround。

## 当前架构边界

Kotlin 侧负责：

- config schema、DataStore config store 和 config normalization。
- usage / raw journal / checkpoint 的 Room/SQLite 持久化。
- Live Listen Kotlin 状态机和 wire shape。
- 可复用 presentation helper / presentation-core。
- `PulseLogger` 日志 facade。
- Swift Export API 和 bridge 入口。

Swift 侧负责：

- AppKit / SwiftUI 壳层。
- `NSStatusItem`、window、panel、menu 生命周期。
- CoreAudio capture、TCC、AppleScript、frontmost app 等平台接入。
- Swift-only service 和薄 observable binding adapter。

共享的是 presentation-core，不是具体容器态。因此 common 中不应定义带明确 AppKit / SwiftUI / Windows shell 语义的 `MenuBarState`、`DashboardState`、`SidebarSelectionState` 等容器状态。

## Active Scope：下一阶段收尾

### 1. Presentation-core 收口验证

目标：确认可复用 UI-facing 状态推导尽量由 Kotlin 提供，Swift 只保留平台容器和 view binding。

检查项：

- connection / endpoint derived state 是否集中在 `common/src/commonMain/.../core/presentation` 或相邻 shared core。
- endpoint 状态文案、severity、action availability 不应在多个 Swift view 中重复实现。
- top usage rows、stats summary、media control availability 等可复用 selector 应有 Kotlin 测试或明确验证路径。
- shared 层不得泄漏 dashboard navigation、panel、sheet、menu 等平台容器语义。

建议验证：

- `common/src/commonTest/` 覆盖关键 selector。
- `pnpm check:native`。

### 2. Swift store 瘦身

目标：让 `MonitorStore`、`LiveListenCaptureStore` 保持为 SwiftUI observable adapter，而不是重新聚合所有业务规则的大对象。

检查项：

- Swift store 可以管理 AppKit 生命周期、Task 生命周期、页面 transient state。
- Swift store 不应长期拥有 config schema、endpoint 派生规则或跨页面业务状态机。
- config 表单状态如果存在于 Swift，应是 UI draft；提交与读取以 Kotlin config DTO / store 为准。
- `NativeBridgeWorker` 或类似串行化 helper 不应掩盖 Kotlin 侧 command/tick 边界。

### 3. 日志覆盖补齐

目标：在已有 `PulseLogger` 基础上补齐主链路日志，而不是新增零散 `println`、`NSLog` 或 `/tmp` debug 文件。

优先覆盖：

- `config.store`：DataStore load/save/update、validation failure、endpoint 列表摘要。
- `stats.refresh`：refresh requested/skipped/forced、snapshot source/version。
- `sync.endpoint`：probe、replay、request/result/error、connect/disconnect/disable intent。
- `live_listen.session`：device session open/close/reconnect、capture permission、stream start/stop/failure。
- `platform.adapter`：AppleScript failure、frontmost app fallback、status item/panel lifecycle。

约束：

- 不记录 API key 明文。
- payload 默认只记录摘要。
- 媒体 title / artist / URL 默认不在 info 级别打印。

### 4. Bridge adapter 边界检查

目标：确认 `Bridge` 目录只承担 Swift/Kotlin interop、Swift Export workaround 和轻量类型 adapter，不混入 UI store 或业务编排。

检查项：

- `readMenuState()` 保持纯读，只返回当前 `latestMenuState`。
- `tick()` 是周期性副作用入口；retry、media、interaction 等用户动作通过显式 command。
- Swift bridge adapter 不直接持久化 config / usage / raw journal。
- enum return 继续遵守 KT-83730 string-name workaround，直到上游修复并完成 clean rebuild 验证。

### 5. Live Listen 跨域检查

Live Listen 同时跨：

- `common/core/livelisten`
- `common/macosMain/LiveListenClient`
- `macosApp/PulseBarNative/Services/LiveListen`
- `docs/protocol` 和 `packages/realtime-protocol`

任何 wire schema、WebSocket message、HTTP endpoint contract 或兼容策略变更，都必须同步检查 protocol 文档和测试。仅改 UI 或本地 capture wiring 时，也要确认没有隐式改变 protocol payload。

## 验收标准

- `architecture.md` 和 `file-organization.md` 与当前代码目录一致。
- active plan 不再把 Phase 1 legacy cleanup、DataStore、logging facade、query/command 基础描述成未来工作。
- `readMenuState()` 在文档中只被描述为纯读；副作用归 `tick()` 或 command。
- config 持久化规则统一为 Typed DataStore `config.v1.json`；usage/raw journal/checkpoint 统一为 Room/SQLite。
- `macosApp/PulseBarNative` 被描述为已按 `App/Bridge/Design/Screens/Services/State` 组织。
- Swift Export workaround 和 Live Listen 跨域注意保留。
- 运行 `pnpm check:native`。Swift/Xcode 引用有变更时运行 Xcode build。
