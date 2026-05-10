# PulseBar KMP Native 重构计划

## 1. 背景

PulseBar 当前的 macOS native 结构已经不是单纯的 SwiftUI 壳加一个共享模块。

- `common` 通过 Swift Export 暴露共享 API 给 `macosApp`
- usage / raw journal / checkpoint 已经迁移到 Kotlin + Room
- config 持久化虽然也在 Kotlin，但仍然依赖 `NSUserDefaults + JSON + legacy fallback`
- Swift 侧仍然承担大量可复用的状态编排、DTO 映射、轮询节流与 UI-facing 状态推导

当前的真正问题不是"Swift 在自己存 config"，而是：

- Legacy / 兼容 / 迁移实现还大量存在
- `PulseBarBridge` 过重，读接口携带副作用（`readMenuState()` 同时触发 usage 更新、reporter capture、reporter sync、interaction reconcile）
- Swift 与 Kotlin 同时承担 presentation shaping
- shared 层缺少明确的 state / orchestration 边界
- 日志分散，排查问题时依赖零散文件和 ad-hoc debug 文案

本次重构的目标不是继续在现有结构上补丁式修复，而是把 native app 的可复用非 UI 逻辑系统性收口到 Kotlin，同时明确哪些状态应该共享、哪些状态必须保留在平台壳层。

## 2. 重构目标

本次重构锁定四条主目标：

1. 清理旧残留，实现硬切换
   不保留任何 legacy、compat、migration 路径。旧 JSON 文件、`NSUserDefaults` 旧 key、raw journal 旧结构、usage 迁移代码全部移除。

2. config 迁移到 Kotlin Typed DataStore
   Room 继续作为 usage / raw journal / checkpoint 的唯一数据库。config 改为 Kotlin 侧 Typed DataStore（`androidx.datastore:datastore-core` + `kotlinx-serialization-json` 作为 `Serializer<T>`）。

3. 引入 query / command 分离
   `PulseBarBridge` 的读接口必须是纯读；所有副作用（usage accumulate / reporter capture / reporter sync / interaction reconcile）收敛到显式的 `tick()` / command 入口。

4. 可复用逻辑迁移到 Kotlin，但不共享平台容器态
   共享 domain/data 与 presentation-core，平台各自保留 menubar/dashboard/window/panel/menu 等 UI shell state。

本次重构完成后，系统边界应当如下：

- Kotlin 负责：
  - config schema 与 config store
  - usage / raw journal / checkpoint
  - sync / replay / refresh / aggregation / orchestration
  - reusable presentation-core state
  - 统一 logging facade
- Swift 负责：
  - AppKit / SwiftUI 壳层
  - NSStatusItem / NSPanel / NSMenu / Window 生命周期
  - CoreAudio capture / TCC / AppleScript / frontmost app 等平台接入
  - 薄的 observable binding adapter

## 3. 架构边界

### 3.1 Shared Domain / Data

以下内容应收口到 Kotlin shared 层：

- config
- usage stats
- sync state
- interaction state
- persistence / sync / polling / replay orchestration

Live Listen session state 暂不纳入本轮（见 §8 非目标）。

### 3.2 Shared Presentation Core

以下内容允许共享，但不能带具体平台容器语义：

- connection item derived state
- endpoint detail derived state
- stream status text / severity / action availability
- top usage rows / stats summary
- config editor state
- refresh policy / throttling
- media control derived availability

这一层的目标是"可复用的 presentation logic"，不是"共享 UI 页面结构"。

共享 presentation-core 的代码落在固定包 `io.github.kt.pulsebar.core`（当前空的 `presence/` 目录删除或合并）。

### 3.3 Platform View State

以下内容保留在平台侧：

- macOS menubar 的 section 结构
- macOS dashboard 的导航、panel、sheet、menu
- 未来 Windows / desktop shell 的具体窗口结构
- 所有与平台控件生命周期直接绑定的 transient state
- CoreAudio capture、TCC、AppleScript、frontmost app 等平台 probe 的具体实现

平台 probe（AppleScript 浏览器标题、媒体 provider 探测、frontmost app 识别等）可以保留为 native 实现，但必须躲在 Kotlin 定义的 `expect`/接口后面，让 Phase 3 的 presentation-core 依赖抽象而非具体平台 API。

因此，本次重构 **不** 在 common 中定义：

- `MenuBarState`
- `DashboardState`
- `SidebarSelectionState`
- 任何带明确 AppKit / SwiftUI / Windows shell 语义的状态模型

共享的是 presentation-core，不是容器态。

## 4. 当前主要问题

### 4.1 Legacy 路径仍然存在

当前仍有以下遗留实现，全部位于 `common/src/macosMain/.../export/`：

- `PulseBarPreferencesStore.importLegacyFilesIfNeeded()`
- `PulseBarPreferencesStore.importLegacyConfig()` 读 `~/Library/Application Support/PulseBar/config.json`
- `PulseBarPreferencesStore.importLegacyUsage()` 读 `usage-stats.json`
- `PulseBarPreferencesStore.migrateRoomUsageIfNeeded()` 遍历所有 `pulsebar.usage.*` / `pulsebar.stats.*` defaults
- `PulseBarPreferencesStore.mirrorLegacyEndpoint()` / `legacyEndpointConfig()`
- `PulseBarRawJournalStore.migrateToRoomIfNeeded()`
- 迁移开关 key：`pulsebar.migration.legacy-json-import`, `pulsebar.migration.room.usage-v1`, `pulsebar.migration.room.raw-journal-v1`
- 常量：`LEGACY_ENDPOINT_ENABLED_KEY`, `LEGACY_ENDPOINT_NAME_KEY`, `LEGACY_ENDPOINT_TRANSPORT_KEY`, `LEGACY_ENDPOINT_URL_KEY`, `LEGACY_ENDPOINT_API_KEY`, `LEGACY_ENDPOINT_WORKSPACE_ID_KEY`, `LEGACY_ENDPOINT_SITE_ID_KEY`, `LEGACY_ENDPOINT_BATCH_WINDOW_KEY`

这些逻辑已经严重增加复杂度，并持续污染 store 层边界。

### 4.2 Config 层未完成共享化

config 持久化虽然在 Kotlin，但当前仍然：

- 依赖 `NSUserDefaults`
- 使用 JSON string 保存 endpoints
- 保留旧 key 兼容逻辑
- 由 Swift 持有独立的 `SettingsDraft` / `EndpointSettingsDraft` / `TransportOption` 编辑态

这会导致 config schema 分裂在 Kotlin DTO 与 Swift draft 两侧。

### 4.3 Bridge 过重且违反 query/command 分离

`PulseBarBridge` 当前同时承担：

- config façade
- snapshot 读取
- usage 更新
- interaction 协调
- reporter capture / sync
- media command
- native platform glue

更严重的是，`readMenuState()` 这样的读接口同时触发状态更新、持久化和网络副作用。这是当前 Swift 侧所有节流逻辑（`lastStatsRefreshAt` / `lastInteractionRefreshAt` / `lastSyncRefreshAt` / `refreshInFlight`）的根源——UI 每次"读"都等价于触发一次完整系统 tick。

### 4.4 Swift 侧承担了过多可复用逻辑

`NativeMonitorModel` 当前不仅是 UI adapter，还承担：

- refresh/polling policy
- throttling
- config mapping (Kotlin config ↔ `SettingsDraft`)
- dashboard/menubar 状态聚合
- endpoint / live listen 派生状态
- debug trigger 编排（`/tmp/pulse-live-listen-start|stop` 文件轮询）

这些逻辑大部分不是 AppKit 专属，应该迁入 Kotlin。

### 4.5 日志分散且不可统一查询

当前日志主要分成三类：

- `PulseBarEndpointReporter` 写 `~/Library/Logs/PulseBarNative/http.log`
- Live Listen Swift 侧写 `/tmp/pulse-live-listen-native-debug.log`
- 其他零散 `NSLog` / `println` / debug 文案

结果是：

- 无法统一按 category / endpoint / request 查问题
- menubar/dashboard 状态为什么这样，难以回溯
- capture / sync / config / permission 问题缺少统一时间线

## 5. 分阶段实施

每个阶段完成后打 git tag（`refactor/phase-N-complete`），以便在后续阶段出现回归时可快速 bisect / 回退。

### Phase 1：清理旧残留 + 统一日志 facade

#### 目标

先把系统从"混合兼容态"清到"只有当前实现"的状态，同时上线 Kotlin 统一 logging facade 作为后续阶段的可观测底座。

#### 具体动作

- 删除（全部位于 `common/src/macosMain/.../export/`）：
  - `PulseBarPreferencesStore.importLegacyFilesIfNeeded()` / `importLegacyConfig()` / `importLegacyUsage()`
  - `PulseBarPreferencesStore.migrateRoomUsageIfNeeded()`
  - `PulseBarPreferencesStore.mirrorLegacyEndpoint()` / `legacyEndpointConfig()`
  - `PulseBarRawJournalStore.migrateToRoomIfNeeded()`
  - 所有 `LEGACY_ENDPOINT_*` 常量
  - 迁移开关 key：`pulsebar.migration.legacy-json-import`, `pulsebar.migration.room.usage-v1`, `pulsebar.migration.room.raw-journal-v1`
  - `PulseBarBridge.init` 里对上述三个 `*IfNeeded()` 的调用
- 同步决定 `composeApp/` 的命运：保留参考意义已经很低，建议在本 Phase 直接从 `settings.gradle.kts` 移除并删除整个模块目录，让 `common` + `macosApp` 成为唯一生效的 native 组合。
- 明确：
  - 不再读取任何 legacy JSON 文件（`~/Library/Application Support/PulseBar/config.json`, `usage-stats.json`）
  - 不再从旧 `NSUserDefaults` key 恢复 usage / raw journal / config
  - 不再保留迁移开关
  - 旧数据直接丢弃，不做兼容
  - **这是破坏性变更**：首次启动新构建时，用户已配置的 `endpointUrl` / `workspaceId` / `siteId` / `apiKey` 会消失，presence 上报会停止直到用户重新填写。本 repo 目前是单用户开发工具，可以接受；在 release note 中明确提示。
- 上线统一 logging facade：
  - 位置：`common/src/commonMain/.../core/log/PulseLogger.kt`（平台实现通过 `expect`/`actual`）
  - 类别按 §6.2 定义：`app.lifecycle`, `config.store`, `stats.refresh`, `sync.endpoint`, `live_listen.session`, `platform.adapter`
  - 双通道输出：macOS 侧 `expect` 实现同时写 `os_log`（按 category subsystem 分）和 `~/Library/Logs/PulseBarNative/<category>.log`
  - 统一字段见 §6.3
  - 本 Phase 不强求把所有 `println` / `NSLog` 全部迁移完；先迁 `PulseBarEndpointReporter` 的 `writeHttpLog` 和 Live Listen Swift 侧的 `/tmp/pulse-live-listen-native-debug.log` 两个热点
  - 删除 `/tmp/pulse-live-listen-start|stop` 触发文件和 `/tmp/pulse-live-listen-native-debug.log` 路径硬编码——调试入口换成 Kotlin logger + 一条 distributed notification

#### 产出

- 代码中不存在 legacy / compat / migration 分支
- `composeApp` 已从 workspace 移除
- Kotlin logging facade 已存在且 reporter / live listen 两条链路已接入
- 文档中明确"硬切换，不保留兼容"

#### 验收

- fresh environment 启动正常
- 有 legacy 文件 / 旧 defaults 的环境也能启动，但不会导入旧数据（`~/Library/Application Support/PulseBar/*.json` 存在也被忽略）
- Room 仍正常负责 usage / raw journal / checkpoint
- `~/Library/Logs/PulseBarNative/` 下能看到按 category 分类的日志文件
- `./gradlew :common:compileKotlinMacosArm64` 成功，`scripts/dev-pulse-native.sh` 能跑起来
- 打 tag `refactor/phase-1-complete`

### Phase 2：Config 迁移到 Kotlin Typed DataStore

#### 目标

把 config 层从 `NSUserDefaults + JSON` 切到 Kotlin Typed DataStore，并让 Kotlin 成为 config schema 的唯一 owner。

#### 技术选型说明

- 使用 `androidx.datastore:datastore-core`（KMP，支持 `macosArm64`）
- Serializer 走 `kotlinx-serialization-json`（仓库已有依赖），不引入 protoc 工具链
- AndroidX 文档里的 "Proto DataStore" 指 typed DataStore，不强制 Protobuf；JSON serializer 完全满足需求
- 文件路径：`$HOME/Library/Application Support/PulseBar/config.v1.json`（通过 `okio.Path` + `FileSystem.SYSTEM` 落盘）

#### 具体动作

- 在 `common/build.gradle.kts` 引入 `androidx.datastore:datastore-core` 和 `okio`
- 在 `common/src/commonMain/.../core/config/` 新建：
  - `PulseBarConfigSchema.kt`：`@Serializable` data classes，覆盖 endpoint list / polling / heartbeat / media / interaction / idle / app / page / media 配置；版本号字段 `schemaVersion: Int`
  - `PulseBarConfigSerializer.kt`：实现 `Serializer<PulseBarConfigSchema>`
  - `PulseBarConfigStore.kt`：封装 `DataStore<PulseBarConfigSchema>` 并暴露 `Flow<PulseBarConfigSchema>` 和 `suspend update { ... }`
- `PulseBarPreferencesStore` 瘦身：只保留 usage / counter 的 Room 调用，config 读写全部改走 `PulseBarConfigStore`
- `PulseBarBridge.readConfig` / `updateConfig` 切换到新 store（保持现有 `expect class` 签名，内部切换实现）
- 移除 config 对 `NSUserDefaults` 的任何依赖（`NSUserDefaults` 仍可用于 debug-only 标记，但不作为 config owner）
- 保留 Room，不迁 usage / raw journal / checkpoint
- Swift 侧：
  - 删除 `SettingsDraft` / `EndpointSettingsDraft` / `TransportOption` 中"作为 config schema"的字段语义；这些类型要么完全删除，要么退化为纯 UI 表单状态并在提交时 1:1 映射到 Kotlin 侧的 config DTO
  - `NativeMonitorModel` 的 `settingsDraft` 改为订阅 Kotlin `Flow<PulseBarConfigSchema>` 的投影
- 所有 config load / save 通过 §6 logging facade 的 `config.store` category 打点

#### 产出

- DataStore 成为 config 唯一持久化源
- Room 继续是 operational DB
- config schema 不再分裂在 Swift / Kotlin 两侧
- Swift 不再拥有可复用 config schema

#### 验收

- config 可读写、可重启恢复（新写入 `config.v1.json`，重启后 endpoints / polling / interaction 设置完整恢复）
- endpoint CRUD 不回归（增删改、重命名、workspace / site / apiKey 更新）
- connect / disconnect / disable 语义不回归（三种状态都能在 sync state 里正确体现）
- 搜 `grep -r NSUserDefaults common/src/macosMain` 不再匹配到 config 读写路径
- 搜 `grep -r "SettingsDraft\|EndpointSettingsDraft\|TransportOption" macosApp/` 结果只剩 UI 表单上下文
- 打 tag `refactor/phase-2-complete`

### Phase 3：Query/Command 分离 + 收口到 Shared Presentation Core

#### 目标

把 `PulseBarBridge` 的读写职责切开，并把可复用状态编排迁到 Kotlin。

#### 3.1 Query/Command 分离

把现有 `readMenuState()` 拆成：

- `readMenuStateSnapshot(): PulseBarMenuState` — **纯读**，只返回当前已经物化的状态，不触发任何副作用、不做 IO、不联网
- `tick()` — 副作用入口：
  - `interactionClient.updateConfig(...)` + `reconcilePlayback(...)`
  - `readSnapshot()`（包含 AppleScript probe）
  - `updateUsage(...)`
  - `reporter.capture(...)` + `reporter.sync(...)`
- `forceRefresh()` / `retryEndpoint()` / `mediaCommand()` / `seekMedia()` / `acceptInteraction()` / `dismissInteraction()` 等作为显式 command 保留

`tick()` 由 Kotlin 侧 orchestrator 根据 refresh policy 调度（详见 §9 concurrency appendix），不再由 Swift 每次"读"时隐式触发。

#### 3.2 迁移到 Kotlin 的内容

- config editor state
- refresh / polling policy（Swift 侧 `lastStatsRefreshAt` / `lastInteractionRefreshAt` / `lastSyncRefreshAt` / `refreshInFlight` 全部迁入 Kotlin orchestrator）
- stats aggregation
- connection / endpoint derived state（status text / severity / action availability）
- menubar / dashboard 所需的共享内容块数据（top usage rows / stats summary / media control availability）
- debug trigger 编排（文件轮询下线后，通过 distributed notification 或 Kotlin logger 承担）

#### 3.3 保留在平台侧的内容

- menubar 的 section 组合（`MenuBarContentView`）
- dashboard 的 navigation / panel / sheet / menu（`NativeSettingsView`, `PulseBarDashboardView`, `PulseBarStatusItemController`）
- AppKit 生命周期（`NSStatusItem`, `NSPanel`, `NSMenu`, `Window`）
- CoreAudio capture / TCC / AppleScript / frontmost app 探测——但通过 `expect interface` 抽象后再被 Kotlin orchestrator 调用

#### 产出

- `PulseBarBridge` 不再是胖入口：读 API 是纯读，副作用 API 显式命名
- Kotlin 侧新增 presentation-core 模块（包 `io.github.kt.pulsebar.core`），暴露 `StateFlow<PresentationState>` 给 Swift
- `NativeMonitorModel` 缩成薄 adapter：订阅 shared presentation-core、转发 intents、管理 AppKit 生命周期
- shared 层提供统一的 reusable state，而不是 Swift 本地手工派生

#### 验收

- menubar 与 dashboard 使用同一套 Kotlin presentation-core 数据源
- 两者 UI 结构仍可独立演化
- future Windows / desktop shell 可复用 shared core，而不被 macOS 容器结构绑定
- 搜 `NativeMonitorModel.swift` 里的 `nonisolated private static func map*` 映射函数数量显著下降（因为大部分映射已经在 Kotlin 侧完成）
- `common/src/commonTest/` 下存在 presentation-core selector 的单元测试（见下）
- 打 tag `refactor/phase-3-complete`

#### 3.4 测试要求（本 Phase 新增）

- 一旦 derived state / selector 迁到 Kotlin（`commonMain`），在 `common/src/commonTest/` 下补 JVM-runnable 单元测试，覆盖：
  - connection status derivation（disabled / disconnected / misconfigured / checking / available / unavailable 的组合）
  - top usage rows / stats summary 聚合
  - media control availability
  - config editor state 变换
- 测试通过 `./gradlew :common:jvmTest` 就能跑，不需要 Mac 也不需要启动 app

## 6. KMP 日志与可观测性方案

### 6.1 目标

日志方案必须能回答三类问题：

- 为什么当前 UI 状态是这样
- 为什么某个 endpoint / live listen 没连上
- 为什么某次 capture / sync / media control 失败

日志的主要 owner 应为 Kotlin。Swift 只保留平台接入日志。

### 6.2 日志分类

- `app.lifecycle` — app start/stop、shared store start、initial config load
- `config.store` — DataStore load/save/update、endpoint editor apply、config validation failure
- `stats.refresh` — refresh requested / skipped reason、stats query result count、menubar first-open forced refresh
- `sync.endpoint` — probe / replay / request / result / error、connect / disconnect / disable intent
- `live_listen.session` — device-session connect/open/close/reconnect、stream start/stop、capture permission 与 capture 生命周期
- `platform.adapter` — AppleScript failure、frontmost app fallback、status item / panel lifecycle、native permission 或 CoreAudio 问题

### 6.3 输出策略

- Kotlin 侧提供统一 logging facade（`PulseLogger`）
- 输出双通道：
  - `os_log` subsystem `io.github.kt.pulsebar` + category = 上述类别
  - `~/Library/Logs/PulseBarNative/<category>.log` 按日 rotate
- 统一字段：
  - `timestamp`
  - `category`
  - `event`
  - `endpointId`
  - `workspaceId`
  - `deviceId` / `roomId`
  - `reason` / `error`
  - `correlationId`——一次用户触发（如点击 Retry / 打开 menubar）分裂出的 probe / replay / capture 打同一个 id，便于时间线串联
- 对高频日志做采样 / 去重：
  - reconnect loop
  - replay interval skip
  - periodic refresh skip
- 不记录敏感信息：
  - API key 明文
  - 全量 payload 正文默认不打，只打摘要
  - 媒体 title / artist / URL 默认只在 `debug` 级别打印，默认 `info` 级别不打

### 6.4 当前应用建议写哪些日志

#### 配置层（`config.store`）

- config 首次加载
- config 更新前后 schema version
- endpoint 列表变更摘要
- DataStore 读写失败

#### 刷新与状态层（`stats.refresh`）

- menubar 打开触发 refresh
- dashboard 激活触发 refresh
- stats refresh skipped / forced
- 当前 shared state snapshot version / source

#### 同步层（`sync.endpoint`）

- endpoint probe request / result
- replay start / complete / skipped（带 `correlationId`）
- queue pending count 变化
- 连接状态切换

#### Live Listen（`live_listen.session`）

- device-session ws open / close / reconnect
- capture permission 状态
- capture start / stop / failure
- stream start / stop command

#### 平台接入层（`platform.adapter`）

- AppleScript 执行失败
- frontmost app 识别 fallback
- status item / panel show/hide

## 7. 验收标准

- Legacy import / migration 全部移除（`grep` 不再匹配 `importLegacyFilesIfNeeded` / `migrateRoomUsageIfNeeded` / `migrateToRoomIfNeeded` / `LEGACY_ENDPOINT_*`）
- config 迁移到 Kotlin Typed DataStore，`config.v1.json` 成为唯一持久化文件
- Room 继续负责 usage / raw journal / checkpoint
- Swift 不再拥有可复用 config schema（`SettingsDraft` 及其附属类型要么删除要么退化为纯 UI 表单）与大量共享状态派生逻辑
- `PulseBarBridge` 读 API 是纯读，副作用 API 显式命名
- shared 层提供 presentation-core（`io.github.kt.pulsebar.core` 包），但不提供具体 menubar / dashboard 容器态
- 日志可以覆盖 config / sync / live listen / refresh / media control 主链路，按 `correlationId` 可串
- `common/src/commonTest/` 存在 presentation-core selector 测试
- 三个 git tag 齐备：`refactor/phase-1-complete`, `refactor/phase-2-complete`, `refactor/phase-3-complete`

## 8. 非目标

本轮不做以下内容：

- 把 menubar / dashboard 容器结构直接共享到 common
- 用 DataStore 替换 Room
- 消除所有 Swift 文件
- 将 CoreAudio / TCC / AppKit / AppleScript 全部改写为纯 Kotlin 无平台 adapter 形式——可以躲在 `expect`/接口后面，但具体实现仍然是 native Swift/Obj-C
- Live Listen session 编排迁入 Kotlin shared：当前 Live Listen 牵涉 WebRTC / PartyTracks / CoreAudio，是合法的平台化场景，本轮仅让其通过 §6 logging facade 打点，不改动其状态机拓扑。后续 Phase 4 单独评估。

## 9. 附录：Concurrency / Cancellation 模型

Phase 3 会把 orchestration 从 Swift 拉到 Kotlin，必须同时定义生命周期：

- **Root scope**：`PulseBarBridge` 持有一个 `CoroutineScope(SupervisorJob() + Dispatchers.Default)`；`PulseBarBridge` 被释放时 `scope.cancel()`
- **Tick loop**：Kotlin orchestrator 维护 `Flow<Unit>` tick（固定间隔 + forced refresh 合流），每个 tick 触发一次 `tick()`。Swift 不再手动轮询
- **Presentation state**：`StateFlow<PresentationState>`，Swift 用一个 Combine bridge 订阅（手写 `AsyncStream` → `@Published`，因为当前工具链没有 SKIE）
- **Cancellation 边界**：`PulseBarBridge` 是唯一入口，`PulseBarStatusItemController` / `NativeMonitorModel` 只持有该 bridge 的引用；app 退出或 bridge 重建时整棵 scope 一次性 cancel
- **Backpressure**：tick 执行时间超过 interval 时丢弃中间 tick（`conflate()`），不排队
- **现有 `NativeBridgeWorker` DispatchQueue 串行化**：Phase 3 完成后可以移除——所有副作用都在 Kotlin `Dispatchers.Default` 上串行，Swift 只读 `StateFlow` 快照
- **线程约束**：所有 AppKit / SwiftUI 更新仍必须在 `@MainActor`，Combine bridge 负责 hop

## 10. 结论

本次重构应当采用：

- **Room for operational data**
- **Kotlin Typed DataStore (JSON serializer) for config**
- **Kotlin for domain/data + presentation-core + logging facade**
- **Swift for platform shell + platform adapters**

重构顺序必须先清 legacy + 上日志底座，再迁 config，最后做 query/command 分离并收 presentation-core。每个 Phase 打 tag，便于回退。否则复杂度只会继续叠加，而不会真正下降。

## 11. 附录：Swift Export 已知问题

### Swift Export enum-return 崩溃 (KT-83730)

Kotlin 函数 / 类属性向 Swift 返回 Kotlin 枚举时，Swift Export 生成的
`init(__externalRCRefUnsafe:)` 会把 Kotlin 传入的 C ref 指针和一组缓存的
per-case C helper 指针做 `switch` 匹配；当前工具链里这个匹配经常失败并
fall through 到 `default: fatalError()`。

详见 `docs/app/swift-export-enum-bug.md` 以及上游跟踪
<https://youtrack.jetbrains.com/issue/KT-83730>。

当前 workaround：需要让 Swift 拿到 Kotlin 枚举值时，Kotlin 侧返回
`enumValue.name` 字符串，Swift 端 `switch` 解析。代码示例见
`ConnectionStatus.kt` 的 `resolveDraftConnectionStatus` 和
`NativeSettingsView.swift` 的 `resolveConnectionStatus`。

影响的潜在热点（目前未触发但同一代码路径一旦走到就会崩）：

- `PulseBarLiveListenStats.connectionState`
- `PulseBarEndpointConfig.transport`
- `PulseBarConfig.interactionExecutionMode` / `interactionPlaybackMode`

Live Listen 面板若真的开始读 `stats.connectionState`，需要改读 bridge 已经
导出的 `connectionStateName: String` 并本地解析。

上游修复后回退 workaround 的检查流程：全量 clean rebuild 一次，跑
`scripts/check-pulse.sh`，确认没有 `Fatal error` 后再去掉字符串绕路。

### Flow / suspend 支持（Kotlin 2.4）— 已完成

**Status**: ✅ DONE — Kotlin 2.4.0-Beta2, commit TBD.

Kotlin 2.4.0-Beta2 的 Swift Export [ships Flow → AsyncSequence interop by default](https://kotlinlang.org/docs/whatsnew-eap.html#swift-export-support-for-exporting-coroutine-flows)（KT-64572）。迁移之前使用的 callback 形状（`observe*(onUpdate:) -> PulseBarCancellable`）全部改成 `val xxx: Flow<T>` 属性，Swift 侧用 `for try await ... asAsyncSequence()` 在 `@MainActor` `Task` 里消费。

**实际做了的事**：

1. `gradle/libs.versions.toml`: `kotlin = "2.3.20"` → `"2.4.0-Beta2"`, `ksp = "2.3.6"` → `"2.3.7"`（KSP2 从 2.3.0 起和 Kotlin 版本解耦）。无需加 dev repo，2.4.0-Beta2 已经进 mavenCentral。
2. `common/src/commonMain/.../export/PulseBarExport.kt`:
   - 删除 `interface PulseBarCancellable`。
   - `expect class PulseBarBridge` 把六个 `observe*(...): PulseBarCancellable` 换成 `val menuState: Flow<...>` / `val config` / `val syncState` / `val interactionState` / `val todayStats` / `val liveListenStats`。
3. `common/src/macosMain/.../export/PulseBarBridge.macos.kt`:
   - `actual val menuState = menuStateFlow.asStateFlow()`
   - `actual val syncState = syncStateFlow.asStateFlow().filterNotNull()` 等。
   - 删掉内部 `collect(flow, onUpdate)` 辅助。
4. `common/src/jvmMain/.../export/PulseBarBridge.jvm.kt`：noop stubs 改成 `emptyFlow()`。
5. Swift 侧：
   - 删除 `macosApp/PulseBarNative/State/MonitorBridgeSubscriptions.swift`（同时从 `project.pbxproj` 删四处引用）。
   - `MonitorStore.start()` 每条订阅改为：
     ```swift
     let menuTask: Task<Void, Never> = Task { @MainActor [weak self] in
         do {
             for try await state in bridge.menuState.asAsyncSequence() {
                 self?.applyMenuStateUpdate(state)
             }
         } catch {}
     }
     observerTasks.append(menuTask)
     ```
   - `deinit` 用 `for t in observerTasks { t.cancel() }` 替代 `PulseBarCancellable.cancel()`。
   - `LiveListenBridge.observeLiveListenStats(onSnapshot:, cancellableReceived:)` → `liveListenStatsStream() -> AsyncStream<PulseBarLiveListenStats>`，`PulseBarBridge` extension 里用 `AsyncStream { continuation in ... Task { for try await ... asAsyncSequence() ... }.onTermination = cancel }` 桥接。
   - `LiveListenCaptureModel.subscribeStats` 从回调 + `statsCancellable: PulseBarCancellable?` 改为 `statsTask: Task<Void, Never>?` + `for await`。

**踩到的坑**：

- `Task { @MainActor in for try await ... }` 的 closure inference 对 `Failure == Never` vs `any Error` 判错。
  修法：显式标 `let t: Task<Void, Never> = Task { @MainActor in do { for try await ... } catch {} }`，`try` 的异常由 `catch {}` 吞掉（cooperative cancel 不经 throw 路径）。
- KotlinTypeAdapters.swift 一个 pre-existing `default will never be executed` 警告，与本次无关，不处理。
- 第一次 Gradle Kotlin Native distribution 下载 ~200MB，完整 `xcodebuild` 首次大约 21 min；之后 incremental 5s。

**没动的**：

- `@preconcurrency import PulseBarShared` 还留着。Beta2 Sendable 推断还没完全可靠，留 `@preconcurrency` 是安全侧。等 2.4 GA 再一起清。
- `extension PulseBarBridge: @retroactive @unchecked Sendable {}` 还留着，同理。

KT-83730（enum return 崩溃）是独立的线，本次迁移期间没再验证，仍保留 String-name workaround。
