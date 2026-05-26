# Desktop App 当前架构

归属：`common`、`macosApp`
代码范围：`common/src/commonMain`、`common/src/macosMain`、`macosApp/PulseBarNative`
状态：active
验证：`pnpm check:native`；Swift 或 Xcode 工程变更还需要跑 Xcode build

本文只描述当前 desktop app 如何围绕配置、采集、持久化、响应式状态、同步链路和平台壳层协作成一个 app，不展开目录放置规则。目录放置原则见 `file-organization.md`。

## 1. 系统分层

当前 desktop app 由三层组成：

1. Kotlin shared runtime：`common/src/commonMain`
   - 持有共享模型、config schema、presentation helper、日志 facade、Swift Export API。
2. Kotlin macOS runtime：`common/src/macosMain`
   - 持有 macOS actual、config file wiring、Room/raw journal/reporter/bridge 等 Kotlin 侧运行时实现。
3. Swift native shell：`macosApp/PulseBarNative`
   - 持有 SwiftUI / AppKit 壳层、菜单栏、dashboard、Swift-only service、observable adapter。

这不是“Swift app 调几个 Kotlin helper”的结构。当前 app 的长期状态 owner 和大部分运行时边界在 Kotlin；Swift 负责平台壳层、页面容器和必须由 Swift-only runtime 管理的能力。

## 2. 配置与持久化

### 2.1 Config

config 的 owner 是 Kotlin `PulseBarConfigStore`。

- 存储技术：AndroidX Typed DataStore
- 序列化：JSON serializer
- 文件位置：`$HOME/Library/Application Support/PulseBar/config.v1.json`
- owner：Kotlin shared runtime，而不是 Swift `UserDefaults`

Swift 可以存在 UI draft 或 form state，但这些只是编辑态，不是 schema owner。

### 2.2 Operational data

运行态持久化继续分给 Room/SQLite：

- usage
- raw journal
- checkpoint / counter

对应原则：

- config 用 DataStore
- operational data 用 Room/SQLite
- `UserDefaults` 不是 config、usage、raw journal 或 checkpoint 的 owner

## 3. 采集与平台接入

采集链路分两类：

### 3.1 Kotlin 侧编排

Kotlin bridge/runtime 负责：

- 统一读取 snapshot
- usage 累计
- reporter capture / sync
- interaction client 协调
- config 驱动的行为切换
- 共享 presentation data 的物化

### 3.2 Swift-only platform service

Swift-only service 负责必须依赖 Apple 平台 API 的能力，例如：

- CoreAudio capture
- TCC / permission
- AppKit lifecycle
- installed app catalog
- 其他必须由 Swift / Obj-C runtime 直接管理的 native service

当前原则不是“所有平台能力都塞回 Kotlin”，而是：

- 能抽象成共享规则的逻辑放 Kotlin
- 必须依赖平台 runtime 的实现留在 Swift-only service
- 两者通过 bridge 和导出模型协作

## 4. 响应式状态与 UI 协作

当前 app 不是由页面直接读底层存储驱动。它的响应式边界是：

- Kotlin 侧产出共享状态、快照和导出 API
- Swift 侧 store / observable adapter 订阅这些导出状态
- SwiftUI 页面消费 Swift store，而不是直接持久化或直接实现共享规则

### 4.1 Kotlin 侧职责

Kotlin 侧负责长期业务状态和共享派生规则，例如：

- config 读取与写入
- connection / endpoint 展示辅助数据
- Live Listen 共享状态机与统计
- logger category 和主链路日志入口

### 4.2 Swift 侧职责

Swift 侧负责：

- `NSStatusItem`、window、panel、menu 生命周期
- 页面 transient state
- SwiftUI 绑定和 task lifecycle
- Swift Export workaround 和 adapter

原则上，Swift store 是 observable adapter，不应该重新拥有一套长期共享业务规则。

## 5. Query / Command 边界

当前 bridge 已经不是“读接口顺便触发系统刷新”的形态。

- `readMenuState()`
  - 纯读，返回当前 `latestMenuState`
- `tick()`
  - 周期性副作用入口
- 其他用户动作
  - 通过显式 command 表达，例如 retry / media command / interaction action

这条边界的意义是：

- UI 读状态不再隐式触发完整系统 tick
- 副作用由显式入口驱动
- 响应式 UI 和运行时副作用可以分开推理

## 6. 同步与数据流

desktop app 当前的主数据流可以概括成：

1. 平台采集
   - frontmost app、page、media、Live Listen、installed apps、permission 等
2. Kotlin runtime 编排
   - snapshot、usage、sync、interaction、presentation helper
3. 本地持久化
   - config -> DataStore
   - operational data -> Room/SQLite
4. 对外同步
   - presence/history 上报
   - endpoint reporter / replay / queue drain
5. UI 消费
   - Swift store 订阅 bridge/export
   - menubar 和 dashboard 渲染当前状态

所以 desktop app 的核心不是一个页面树，而是一条“采集 -> 编排 -> 持久化 -> 同步 -> UI”的运行时链路。

## 7. 技术选型边界

### 7.1 配置

- Typed DataStore + JSON serializer
- 不回退到 `UserDefaults + JSON blob`

### 7.2 运行态持久化

- Room/SQLite
- 不把 usage/raw journal/checkpoint 迁去 DataStore

### 7.3 UI / 壳层

- SwiftUI + AppKit shell
- 不把 menubar/dashboard 容器态共享到 Kotlin

### 7.4 共享 API

- Swift Export
- Kotlin shared runtime 是 Swift 侧的主要共享 API 来源

### 7.5 日志

- 统一入口是 `PulseLogger`
- 新日志优先纳入共享 facade，而不是零散 `println` / `NSLog` / `/tmp` debug 文件

## 8. 与其他域的边界

- `docs/protocol/` 和 `packages/realtime-protocol`
  - 拥有 wire schema、endpoint contract、兼容策略
- `apps/realtime-worker`
  - 拥有服务端聚合、查询、WebSocket 和 worker runtime
- `common` + `macosApp`
  - 拥有 desktop 本机采集、本地状态、native UI 和设备侧上报

协议字段和 endpoint contract 不应该散落在 Swift-only 类型或 Kotlin 临时结构里。

## 9. 当前注意点

- Swift Export enum return 已随 Kotlin `2.4.0-RC` 回到直接 enum 桥接；历史背景见 [Swift Export enum-return crash](./reference/swift-export-enum-bug.md)。
- Live Listen 同时跨 `common/core/livelisten`、`common/macosMain/LiveListenClient`、`macosApp/Services/LiveListen` 和 protocol 文档；改动时必须按 protocol 验证门槛检查。
- 目标产品结构、导航调整和 PRD 不属于当前架构事实，见 `docs/desktop-app/design/`。
