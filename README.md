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

当前默认对接的是跨平台 `presence.v2`：

- 设备上报：`POST /v2/presence/ingest`
- 历史归档：`POST /v2/history/ingest`
- 服务端查询/下发：
  - `GET /v1/meta`
  - `GET /v1/realtime/ws?workspaceId=...&roomId=...`
  - `GET /v1/site/history`
  - `GET /v1/site/lifetime`
  - `GET /v1/content/history`
  - `GET /v1/content/lifetime`
  - `GET /v1/owner/history`
  - `GET /v1/owner/lifetime`

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
- `playback`
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
- `composeApp`
  - 旧的 Compose Desktop 壳，保留作迁移参考
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

- [Realtime Current State](/Users/kt/Documents/Playground/pulse/docs/realtime-current-state.md)
  - 当前代码对齐的协议、路由、DO 状态模型和具体状态流转
- [Realtime Protocols](/Users/kt/Documents/Playground/pulse/docs/realtime-protocols.md)
  - 详细描述 `presence.v2`、`web.v1`、房间聚合以及各端内部模型变换
- [Protocol Evolution](/Users/kt/Documents/Playground/pulse/docs/protocol-evolution.md)
  - 单独描述 SDK / wire protocol / canonical model 的演进策略与兼容矩阵
- [Module Boundaries](/Users/kt/Documents/Playground/pulse/docs/module-boundaries.md)
  - 明确 `worker / protocol / realtime-react / native` 的职责边界和依赖方向
- [Realtime React API](/Users/kt/Documents/Playground/pulse/docs/realtime-react-api.md)
  - 整理 `@pulse/realtime-react` 当前暴露的 hooks、client API、facade 形状和推荐用例

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

Worker 当前暴露：

- `POST /v2/presence/ingest`
- `POST /v2/history/ingest`
- `POST /v1/web/ingest`
- `GET /v1/meta`
- `GET /v1/realtime/ws?workspaceId=...&roomId=...`
- `GET /v1/site/history`
- `GET /v1/site/lifetime`
- `GET /v1/content/history`
- `GET /v1/content/lifetime`
- `GET /v1/owner/history`
- `GET /v1/owner/lifetime`

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
- 原生 SwiftUI 菜单栏 UI 当前仍以本地共享状态为主，同时本地存储已经切到 Room；`composeApp` 仅保留作迁移参考。
