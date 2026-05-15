# KMP Native Refactor Phase 1/2 历史记录

归属：`common`、`macosApp`
代码范围：`common/src/commonMain`、`common/src/macosMain`、`macosApp/PulseBarNative`
状态：completed
验证：历史记录；当前验证入口见 `docs/desktop-app/specs/verification.md`

本文保留 KMP Native 重构早期阶段的历史信息，避免 active plan 继续把已完成事项描述成未来计划。

## 完成事项摘要

### Phase 1：legacy cleanup 与日志底座

Phase 1 的目标是让 desktop app 从混合兼容态收口到当前实现，并建立统一日志入口。

当前完成状态：

- legacy cleanup 已完成，不再作为 active 迁移计划维护。
- `composeApp/**` 当前不存在。
- `core/log/PulseLogger.kt` 已存在。
- `core/log/PulseLogger.macos.kt` 已存在。
- 日志后续工作从“引入 facade”转为“补齐覆盖和主链路打点”。

历史验收意图：

- 不把旧兼容路径继续作为架构常态。
- Desktop native 有效组合收口到 `common` + `macosApp`。
- 日志从零散 debug 文案逐步转向共享 facade。

### Phase 2：config DataStore

Phase 2 的目标是让 Kotlin 成为 config schema 与 config persistence 的 owner。

当前完成状态：

- `common/src/commonMain/kotlin/io/github/kt/pulsebar/core/config/PulseBarConfigStore.kt` 已使用 AndroidX DataStore。
- config 落盘文件是 `$HOME/Library/Application Support/PulseBar/config.v1.json`。
- DataStore 使用 JSON serializer，但架构上属于 Kotlin Typed DataStore。
- usage / raw journal / checkpoint 没有迁到 DataStore，继续由 Room/SQLite 负责。

历史验收意图：

- config 可读写并可重启恢复。
- endpoint CRUD、connect/disconnect/disable 语义不因 config owner 切换而回归。
- Swift 侧 config draft 如果存在，应是 UI 表单状态，不是持久化 schema owner。

### Query/command 基础

早期计划要求 bridge 读接口与副作用入口分离。当前基础已经落地：

- `PulseBarBridge.macos.kt` 的 `readMenuState()` 是纯返回 `latestMenuState`。
- 周期性副作用入口是 `tick()`。
- 用户动作通过显式 command 表达。

后续 active 工作不再重复规划这一基础改造，而是检查边界是否持续成立。

## 仍在 active plan 追踪的事项

见 `../active/kmp-native-refactor.md`：

- presentation-core 收口验证。
- Swift store 瘦身。
- 日志覆盖补齐。
- bridge adapter 边界检查。
- Live Listen 跨域检查。

## 历史注意事项

### Swift Export enum-return workaround

KT-83730 仍是独立注意点。需要让 Swift 拿到 Kotlin enum 值时，Kotlin 侧优先返回 `enumValue.name` 字符串，Swift 端再解析。

详见：

- `docs/desktop-app/reference/swift-export-enum-bug.md`
- <https://youtrack.jetbrains.com/issue/KT-83730>

### Flow / suspend 支持

Kotlin 2.4.0-Beta2 的 Swift Export Flow → AsyncSequence interop 已作为当前实现事实保留。后续如果升级 Kotlin 或移除 workaround，需要 clean rebuild 并按 desktop app 验证门槛检查。
