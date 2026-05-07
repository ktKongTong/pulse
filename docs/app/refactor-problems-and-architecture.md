# PulseBar App 当前重大问题

本文承接 [refactor-plan.md](./refactor-plan.md) 的第 3 节。内容基于当前 `macosApp` 与 macOS bridge 代码审查，用于明确 app 侧重构的主要问题。

## 3. 当前重大问题

### 3.1 首次启动缺少任务引导

当前 `PulseBarNativeApp` 在启动后立即执行 `monitor.start()`、聚焦 Dashboard，并请求 Live Listen 音频采集权限。这个行为把运行、主窗口展示和权限请求合并为一个启动副作用。

问题在于，用户还没有理解 app 需要哪些权限、为什么需要 endpoint、Live Listen 是否是必须能力，就已经进入完整控制台。首次使用应当先建立配置与授权路径，而不是直接暴露运行态和采集权限。

### 3.2 菜单栏与主窗口职责重复

菜单栏当前展示当前 app、媒体控制、今日统计、启动/停止监控、打开 Dashboard、打开 Settings、退出 app。主窗口的 Dashboard 也展示当前 app、媒体、interaction、今日统计和运行状态。

这导致两个入口都像“缩小版控制台”。菜单栏没有保持轻量，主窗口也没有成为唯一完整管理面。用户无法判断某个操作应该在菜单栏完成，还是进入 Dashboard 完成。

### 3.3 Dashboard 按工程模块组织，而不是按用户任务组织

当前主窗口 sidebar 使用 `Dashboard / Activity / Sync / Live Listen / Settings`。这个结构基本对应现有代码模块和能力堆叠，而不是用户任务。

用户真正关心的是：是否已经配置好、是否正在运行、当前状态是否正常、Live Listen 是否可用、出现问题如何恢复。现有 Dashboard 把这些问题拆散到多个页面，并要求用户理解 Sync、Live Listen、Settings 的内部关系。

### 3.4 Sync 页面暴露底层同步机制

Sync 页面直接展示 `Server Probe`、`Ingest Config`、`SQLite Queue`、`Ack Seq`、`Delivery`、endpoint diagnostic 和 replay 操作。这些信息对开发排查有价值，但不是正常用户判断同步是否健康所需的第一层信息。

更严重的是，`Replay Endpoint` 作为主操作出现，但没有解释它和“本地已记录、服务器不可用、配置错误、等待重试”的关系。同步状态应该先转译成用户可理解的问题，例如“服务器不可达”“配置缺失”“有数据等待上传”，再把原始指标放进诊断层。

### 3.5 Live Listen 默认界面是诊断面板

Live Listen 页面默认展示 endpoint、采集源、meter、publisher stats、queue、reconnect、chunk、permission、playback、capture、endpoint publisher 和 diagnostics。它同时承担用户控制面、采集源选择面、运行状态面和开发诊断面。

当前文案说明 Live Listen 由 Web 侧请求自动触发，但页面仍提供 `Capture 10s Sample`、`Reconnect Server`、`Stop Capture` 等操作。用户很难判断哪些是日常操作，哪些是调试操作，哪些操作会影响 Web 侧一起听流程。

### 3.6 设置页面混入运行态与高级调参

Settings 当前包含 runtime pause、当前 app 卡片、endpoint 配置、sampling 参数、interactions 配置和 interaction 状态预览。它既是配置页，又承担实时状态展示和交互处理。

设置页应当只保存持久偏好和必要配置。当前把 pause monitoring、当前运行快照、pending request、sampling 毫秒级调参放在同一层，会让设置页成为另一个 Dashboard。

### 3.7 状态模型集中在单个 `NativeMonitorModel`

`NativeMonitorModel` 同时维护 snapshot、usage stats、interaction、sync、settings draft、pause/monitoring、dashboard selection、Live Listen capture model、debug trigger file polling 和 distributed notification observer。

这让 UI 很难围绕稳定的用户状态建模。当前界面直接消费这些底层字段，导致“运行状态”“同步健康”“配置完成度”“Live Listen 可用性”“诊断指标”之间没有明确层级。重构需要先定义 UI-facing 状态，再把 bridge 与 reporter 的原始状态映射进去。
