# PulseBar

一个基于 Kotlin Multiplatform + SwiftUI 的 macOS 14+ 菜单栏状态监控与同步应用。

## 已实现能力

- 以 `LSUIElement` 模式运行，仅显示菜单栏图标，不出现在 Dock。
- 监控当前前台应用，并对同一应用/页面停留时间做本地按日聚合统计。
- 针对浏览器读取当前标签页标题与 URL。
- 针对 Spotify / Music 读取后台播放内容。
- 通过空闲阈值识别 `ACTIVE` / `AWAY`，区分“还停留在界面 A 处理”和“界面 A 挂着但人离开了”。
- 焦点变化采用“轻轮询 + 稳定化窗口”策略，变化稳定后立即推送，不只依赖定时上报。
- 支持两类隐私规则：
  - `ANONYMIZE`：保留时长统计，但脱敏应用/页面/媒体信息。
  - `EXCLUDE`：完全不进入统计与上报。
- 支持三种端点传输：
  - `WEBSOCKET`
  - `WEBHOOK`
  - `HTTP_BATCH`
- 设置页内可查看：
  - 当前状态
  - 详细配置
  - 隐私规则
  - 日志记录
  - 统计汇总

## Presence/V2 协议

当前默认对接的是跨平台 `presence.v2`。

- 设备上报：`POST /api/v2/presence/ingest`
- 历史归档：`POST /api/v2/history/ingest`
- 服务端查询/下发：
  - `GET /api/v1/meta`
  - `GET /api/v1/realtime/ws?workspaceId=...&roomId=...`
  - `GET /api/v1/site/history`
  - `GET /api/v1/site/lifetime`
  - `GET /api/v1/content/history`
  - `GET /api/v1/content/lifetime`
  - `GET /api/v1/owner/history`
  - `GET /api/v1/owner/lifetime`

设备到服务端采用 append-only HTTP ingest，使用 `deviceId + seq + eventId` 做幂等。

核心状态模型采用正交状态轴，而不是扁平的 `ACTIVE / AWAY / OFFLINE`：

- `availability.state`
  - `active | idle | locked | sleeping | offline`
- `focus.state`
  - `foreground | background | none`
- `presenceKind`
  - `interactive | passive | media`

媒体统一建模为通用 `mediaSessions[]`，不绑定 Spotify：

- `provider.id`
  - 例如 `spotify` / `apple-music` / `netease-music` / `qq-music`
- `provider.kind`
  - `music | video | other`
- `item`
  - `track | album | playlist | episode | stream | unknown`
- `playbackStatus`
  - `playing | paused | stopped`
  - `scope = local | remote`

默认聚合规则：

- 只统计 `availability = active`
- 只统计 `focus.state = foreground`
- 默认排除系统保留应用，例如 `loginwindow`
- `scope = remote` 的媒体允许上报，但默认不进入统计

## 本地权限要求

首次运行时，建议在系统里授予：

- `Automation`
  - 用于读取 Safari / Chrome / Spotify / Music 的脚本数据。
- `Accessibility`
  - 当前实现对前台应用检测主要依赖 `lsappinfo`，但如果后续扩展窗口级信息，仍建议开启。

未授权时应用仍可运行，只是页面标题、URL、媒体信息可能为空。

## 运行与打包

KMP 共享层编译：

```bash
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/jbr-21.0.9/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew :common:compileKotlinMacosArm64
```

Xcode 原生菜单栏 App 构建：

```bash
xcodebuild -project macosApp/PulseBarNative.xcodeproj \
  -scheme PulseBarNative \
  -configuration Debug \
  -derivedDataPath macosApp/.xcode-derived \
  CODE_SIGNING_ALLOWED=NO build
```

## 目录结构

- `common`
  - KMP 共享业务层，负责状态模型、监控桥接、Room 本地持久化与 Swift export
- `macosApp`
  - 原生 SwiftUI 菜单栏应用和 Xcode 工程
- `apps/realtime-worker`
  - Cloudflare Worker + Durable Object 服务端，负责 ingest、房间聚合、chat 与统计查询
- `packages/realtime-protocol`
  - TS 协议包，承载 `presence.v2`、`web.v1`、`realtime.ws.v2`
- `packages/realtime-react`
  - Web 侧 realtime client façade，统一封装 transport、订阅管理与 hooks
- `docs`
  - 协议与架构文档

## 文档

- [文档入口](./docs/index.md)
  - Pulse 文档入口，按 owner 拆分为 worker、desktop app、protocol 和全局 harness。
- [Pulse Worker](./docs/pulse-worker/index.md)
  - `apps/realtime-worker` 的架构、文件组织、runtime、verification 和 specs。
- [Desktop App 文档](./docs/desktop-app/index.md)
  - `common` 与 `macosApp` 的 KMP/native 架构、设计、计划和验证方式。
- [Protocol](./docs/protocol/index.md)
  - 通信协议、消息模型、endpoint contract、Live Listen 协议和兼容策略。
- [全局规范](./docs/specs/index.md)
  - 跨域 specs，例如 module boundaries 与 `@pulse/realtime-react` public API。
- [Harness](./docs/harness/index.md)
  - agent 工作流、文档结构、诊断和验证门槛。

## Realtime Workspace

`pulse/` 现在同时是：

- Gradle/KMP 工程
- pnpm workspace

新增 JS workspace 使用：

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm check:all
```

本地开发：

```bash
pnpm --filter @pulse/realtime-worker dev
```

默认本地地址：

- Worker: `http://127.0.0.1:8900`
- App/UI: `http://127.0.0.1:8900`

## Realtime Routes

Worker-hosted public routes 当前暴露：

- `POST /api/v2/presence/ingest`
- `POST /api/v2/history/ingest`
- `POST /api/v1/web/ingest`
- `GET /api/v1/meta`
- `GET /api/v1/realtime/ws?workspaceId=...&roomId=...`
- `GET /api/v1/site/history`
- `GET /api/v1/site/lifetime`
- `GET /api/v1/content/history`
- `GET /api/v1/content/lifetime`
- `GET /api/v1/owner/history`
- `GET /api/v1/owner/lifetime`

Durable Object 房间：

- `global`
- `page:<canonicalUrl>`
- `chat:<roomId>`

浏览器侧 `web.v1` 事件：

- `page_view`
- `reading_progress`
- `heartbeat`
- `session_end`

## 当前实现的边界

- 浏览器标签读取目前覆盖 Safari、Chrome、Brave、Edge、Chromium、Vivaldi、Arc。
- 媒体采集是 provider-agnostic 的自动探测，不要求用户手动选择平台。
- `Spotify` 与 `Apple Music` 当前是已接通的 richer metadata provider。
- `NeteaseMusic / QQMusic` 当前作为 best-effort probe 入口存在，未安装时会静默跳过，不会弹系统选择器。
- 应用级监控是稳定可用的；页面级和媒体级能力取决于目标应用是否暴露 AppleScript 接口以及用户是否授权。
- `realtime-worker` 是当前唯一的房间聚合与统计事实来源；Web 和 native 端都只消费协议包或 Worker 输出。
- 原生 SwiftUI 菜单栏 UI 当前仍以本地共享状态为主，同时本地存储已经切到 Room。
