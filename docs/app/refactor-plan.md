# PulseBar KMP Native 重构计划

## 1. 背景

PulseBar 当前的 macOS native 结构已经不是单纯的 SwiftUI 壳加一个共享模块。

- `common` 通过 Swift Export 暴露共享 API 给 `macosApp`
- usage / raw journal / checkpoint 已经迁移到 Kotlin + Room
- config 持久化虽然也在 Kotlin，但仍然依赖 `NSUserDefaults + JSON + legacy fallback`
- Swift 侧仍然承担大量可复用的状态编排、DTO 映射、轮询节流与 UI-facing 状态推导

当前的真正问题不是“Swift 在自己存 config”，而是：

- Legacy / 兼容 / 迁移实现还大量存在
- `PulseBarBridge` 过重，读接口携带副作用
- Swift 与 Kotlin 同时承担 presentation shaping
- shared 层缺少明确的 state / orchestration 边界
- 日志分散，排查问题时依赖零散文件和 ad-hoc debug 文案

本次重构的目标不是继续在现有结构上补丁式修复，而是把 native app 的可复用非 UI 逻辑系统性收口到 Kotlin，同时明确哪些状态应该共享、哪些状态必须保留在平台壳层。

## 2. 重构目标

本次重构锁定三条主目标：

1. 清理旧残留，实现硬切换  
   不保留任何 legacy、compat、migration 路径。旧 JSON 文件、`NSUserDefaults` 旧 key、raw journal 旧结构、usage 迁移代码全部移除。

2. config 迁移到 Kotlin DataStore  
   Room 继续作为 usage / raw journal / checkpoint 的唯一数据库。config 改为 Kotlin 侧 Proto DataStore。

3. 可复用逻辑迁移到 Kotlin，但不共享平台容器态  
   共享 domain/data 与 presentation-core，平台各自保留 menubar/dashboard/window/panel/menu 等 UI shell state。

本次重构完成后，系统边界应当如下：

- Kotlin 负责：
  - config schema 与 config store
  - usage / raw journal / checkpoint
  - sync / replay / refresh / aggregation / orchestration
  - reusable presentation-core state
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
- Live Listen session state
- persistence / sync / polling / replay orchestration

### 3.2 Shared Presentation Core

以下内容允许共享，但不能带具体平台容器语义：

- connection item derived state
- endpoint detail derived state
- stream status text / severity / action availability
- top usage rows / stats summary
- config editor state
- refresh policy / throttling
- media control derived availability

这一层的目标是“可复用的 presentation logic”，不是“共享 UI 页面结构”。

### 3.3 Platform View State

以下内容保留在平台侧：

- macOS menubar 的 section 结构
- macOS dashboard 的导航、panel、sheet、menu
- 未来 Windows / desktop shell 的具体窗口结构
- 所有与平台控件生命周期直接绑定的 transient state

因此，本次重构**不**在 common 中定义：

- `MenuBarState`
- `DashboardState`
- `SidebarSelectionState`
- 任何带明确 AppKit / SwiftUI / Windows shell 语义的状态模型

共享的是 presentation-core，不是容器态。

## 4. 当前主要问题

### 4.1 Legacy 路径仍然存在

当前仍有以下遗留实现：

- `PulseBarPreferencesStore.importLegacyFilesIfNeeded()`
- `PulseBarPreferencesStore.migrateRoomUsageIfNeeded()`
- `PulseBarRawJournalStore.migrateToRoomIfNeeded()`
- legacy config JSON import
- legacy usage import
- raw journal defaults fallback
- legacy endpoint fallback / config mirror

这些逻辑已经严重增加复杂度，并持续污染 store 层边界。

### 4.2 Config 层未完成共享化

config 持久化虽然在 Kotlin，但当前仍然：

- 依赖 `NSUserDefaults`
- 使用 JSON string 保存 endpoints
- 保留旧 key 兼容逻辑
- 由 Swift 持有独立的 `SettingsDraft` 编辑态

这会导致 config schema 分裂在 Kotlin DTO 与 Swift draft 两侧。

### 4.3 Bridge 过重

`PulseBarBridge` 当前同时承担：

- config façade
- snapshot 读取
- usage 更新
- interaction 协调
- reporter capture/sync
- media command
- native platform glue

更严重的是，像 `readMenuState()` 这样的读接口同时触发状态更新、持久化和网络副作用，违反 query / side-effect 分离。

### 4.4 Swift 侧承担了过多可复用逻辑

`NativeMonitorModel` 当前不仅是 UI adapter，还承担：

- refresh/polling policy
- throttling
- config mapping
- dashboard/menubar 状态聚合
- endpoint/live listen 派生状态
- debug trigger 编排

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

### Phase 1：清理旧残留与日志基线

#### 目标

先把系统从“混合兼容态”清到“只有当前实现”的状态，同时为后续重构建立统一日志基线。

#### 具体动作

- 删除：
  - `PulseBarPreferencesStore.importLegacyFilesIfNeeded()`
  - `PulseBarPreferencesStore.migrateRoomUsageIfNeeded()`
  - `PulseBarRawJournalStore.migrateToRoomIfNeeded()`
  - legacy config JSON import
  - legacy usage import
  - raw journal defaults fallback key 解析
  - legacy endpoint fallback / config mirror
  - migration flag key
- 明确：
  - 不再读取任何 legacy JSON 文件
  - 不再从旧 `NSUserDefaults` key 恢复 usage/raw journal/config
  - 不再保留迁移开关
  - 旧数据直接丢弃，不做兼容
- 建立日志基线：
  - 盘点现有日志入口
  - 明确分类与输出目标
  - 先统一命名和分类，不要求一步改完所有实现

#### 产出

- 代码中不存在 legacy/compat/migration 分支
- 文档中明确 “硬切换，不保留兼容”
- 日志分类清单与统一入口方案完成

#### 验收

- fresh environment 启动正常
- 有 legacy 文件/旧 defaults 的环境也能启动，但不会导入旧数据
- Room 仍正常负责 usage/raw journal/checkpoint

### Phase 2：Config 迁移到 Kotlin Proto DataStore

#### 目标

把 config 层从 `NSUserDefaults + JSON` 切到 Kotlin Proto DataStore，并让 Kotlin 成为 config schema 的唯一 owner。

#### 具体动作

- 在 `common` 中引入 DataStore KMP 依赖
- 新建 Proto config schema，覆盖：
  - endpoint list
  - polling / heartbeat / media settings
  - interaction settings
  - idle / app / page / media 配置
- 用 Kotlin DataStore store 替代 `PulseBarPreferencesStore` 的 config 持久化逻辑
- 移除 config 对 `NSUserDefaults` 的依赖
- 保留 Room，不迁 usage/raw journal/checkpoint
- 让 Swift 不再作为 config schema owner，只消费 Kotlin 导出的 config / editor state

#### 产出

- DataStore 成为 config 唯一持久化源
- Room 继续是 operational DB
- config schema 不再分裂在 Swift / Kotlin 两侧

#### 验收

- config 可读写、可重启恢复
- endpoint CRUD 不回归
- connect/disconnect/disable 语义不回归

### Phase 3：收口到 Shared Presentation Core

#### 目标

把可复用状态编排迁到 Kotlin，但不共享平台容器态。

#### 迁移到 Kotlin 的内容

- config editor state
- refresh / polling policy
- stats aggregation
- connection / live-listen derived state
- reusable status text / action availability
- menubar/dashboard 所需的共享内容块数据

#### 保留在平台侧的内容

- menubar 的 section 组合
- dashboard 的 navigation / panel / sheet / menu
- AppKit 生命周期
- CoreAudio capture / TCC / AppleScript / frontmost app 等平台接入

#### 产出

- `NativeMonitorModel` 缩成薄 adapter：
  - 订阅 shared presentation-core
  - 转发 intents
  - 管理 AppKit 生命周期
- shared 层提供统一的 reusable state，而不是 Swift 本地手工派生

#### 验收

- menubar 与 dashboard 使用同一套 Kotlin presentation-core 数据源
- 但两者 UI 结构仍可独立演化
- future Windows / desktop shell 可复用 shared core，而不被 macOS 容器结构绑定

## 6. KMP 日志与可观测性方案

### 6.1 目标

日志方案必须能回答三类问题：

- 为什么当前 UI 状态是这样
- 为什么某个 endpoint / live listen 没连上
- 为什么某次 capture / sync / media control 失败

日志的主要 owner 应为 Kotlin。Swift 只保留平台接入日志。

### 6.2 日志分类

- `app.lifecycle`
  - app start/stop
  - shared store start
  - initial config load
- `config.store`
  - DataStore load/save/update
  - endpoint editor apply
  - config validation failure
- `stats.refresh`
  - refresh requested
  - refresh skipped reason
  - stats query result count / totalSeconds
  - menubar first-open forced refresh
- `sync.endpoint`
  - probe / replay / request / result / error
  - connect / disconnect / disable intent
- `live_listen.session`
  - device-session connect/open/close/reconnect
  - stream start/stop
  - capture permission / capture started / stopped / failure
- `platform.adapter`
  - AppleScript failure
  - frontmost app fallback
  - status item / panel lifecycle
  - native permission 或 CoreAudio 问题

### 6.3 输出策略

- Kotlin 侧提供统一 logging facade
- 输出双通道：
  - Console / unified logging 用于开发调试
  - `~/Library/Logs/PulseBarNative/*.log` 用于持久调试
- 统一字段：
  - `timestamp`
  - `category`
  - `event`
  - `endpointId`
  - `workspaceId`
  - `deviceId` / `roomId`
  - `reason` / `error`
  - `requestId` 或 correlation id（如有）
- 对高频日志做采样/去重：
  - reconnect loop
  - replay interval skip
  - periodic refresh skip
- 不记录敏感信息：
  - API key 明文
  - 全量 payload 正文默认不打，只打摘要

### 6.4 当前应用建议写哪些日志

#### 配置层

- config 首次加载
- config 更新前后 schema version
- endpoint 列表变更摘要
- DataStore 读写失败

#### 刷新与状态层

- menubar 打开触发 refresh
- dashboard 激活触发 refresh
- stats refresh skipped / forced
- 当前 shared state snapshot version / source

#### 同步层

- endpoint probe request / result
- replay start / complete / skipped
- queue pending count 变化
- 连接状态切换

#### Live Listen

- device-session ws open / close / reconnect
- capture permission 状态
- capture start / stop / failure
- stream start / stop command

#### 平台接入层

- AppleScript 执行失败
- frontmost app 识别 fallback
- status item / panel show/hide

## 7. 验收标准

- Legacy import / migration 全部移除
- config 迁移到 Kotlin Proto DataStore
- Room 继续负责 usage/raw journal/checkpoint
- Swift 不再拥有可复用 config schema 与大量共享状态派生逻辑
- shared 层提供 presentation-core，但不提供具体 menubar/dashboard 容器态
- 日志可以覆盖 config / sync / live listen / refresh / media control 主链路

## 8. 非目标

本轮不做以下内容：

- 把 menubar/dashboard 容器结构直接共享到 common
- 用 DataStore 替换 Room
- 消除所有 Swift 文件
- 将 CoreAudio/TCC/AppKit/AppleScript 全部改写为纯 Kotlin 无平台 adapter 形式

## 9. 结论

本次重构应当采用：

- **Room for operational data**
- **Proto DataStore for config**
- **Kotlin for domain/data + presentation-core**
- **Swift for platform shell + platform adapters**

重构顺序必须先清 legacy，再迁 config，最后收 presentation-core。否则复杂度只会继续叠加，而不会真正下降。
