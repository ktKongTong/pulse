# Windows Kotlin/JVM ↔ WinUI IPC 适配层实现计划

归属：desktop-app（跨 `common`、Kotlin/JVM daemon、`windowsApp`）
代码范围：`common`、`flowIpcDemo`、`windowsApp`、未来的 Windows daemon/runtime adapter
状态：active
验证：见「验证门槛」；Windows 实机验证是完成条件

## 1. 目标

把 macOS 当前的 Swift Export 交互模型，收敛为 Windows 上稳定、可重连、可测试的适配层：

```text
Windows platform services
        ↓ platform events / user commands
WinUI3 RuntimeAdapter (C#)
        ↓ loopback gRPC
Kotlin/JVM daemon adapter
        ↓ typed commands / snapshots
Kotlin shared runtime (PulseBarBridge)
```

目标不是让 WinUI 直接调用 Kotlin 对象，而是让两端通过同一份 IPC contract 看到一致的 query/command 语义：

- Kotlin 继续拥有长期业务状态、配置、持久化、同步和共享规则。
- WinUI 继续拥有窗口、页面、DispatcherQueue 和 Windows-only platform services。
- IPC 适配层负责序列化、流生命周期、重连、快照恢复和错误映射。
- UI 不依赖 Kotlin/JVM 类型，daemon 不依赖 WinUI 类型。

## 1.1 当前实现清单（2026-09-07）

- IPC 单一契约：`flowIpcDemo/src/main/proto/pulsebar/desktopipc/v1/desktop_ipc.proto`。
- C# 生成项目：`flowIpcDemo/dotnet/DesktopIpc.Contract/`；WinUI 通过 project reference 使用生成类型。
- 真实 daemon：`flowIpcDemo/src/main/kotlin/io/github/kt/pulsebar/flowipc/DaemonMain.kt`，持有 `PulseBarBridge`，使用 port 0、随机 token 和 `PULSEBAR_DAEMON_READY` handshake。
- 真实 IPC edge：`flowIpcDemo/src/main/kotlin/io/github/kt/pulsebar/desktopipc/RealDesktopRuntimeService.kt`，映射 runtime/config/connection Flow 和显式 commands。
- Transport：`windowsApp/Runtime/DesktopIpcTransport.cs`，只负责一次 daemon/gRPC session、port 0/token handshake、wire streams、auth 注入和资源释放；不暴露 PulseBar command 语义。
- Connection policy：`windowsApp/Runtime/RuntimeConnection.cs`，只负责连接状态、session 重启、指数退避和 daemon ownership；不映射业务 snapshot 或 command。
- Domain adapter：`windowsApp/Runtime/RuntimeAdapter.cs`，只负责 PulseBar snapshot/command/event 映射和 UI-facing model；不拥有 config、connection 或 usage 业务规则。
- WinUI surface：`windowsApp/MainWindow.xaml`、`windowsApp/MainWindow.xaml.cs`，已包含 runtime event、config、connect/disconnect 演示。
- Windows platform event：`windowsApp/Runtime/FrontmostAppWatcher.cs` 使用 Win32 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`，把前台进程名发布为 `FrontmostAppChanged`。
- 可观测性：`windowsApp/Runtime/RuntimeLog.cs` 将发送 command/event、接收 snapshot 和 platform event 写入 `%LOCALAPPDATA%\\PulseBar\\windows-runtime.log`；daemon stdout 记录接收和映射。
- 回归 fixture：`DemoRuntime` / `DesktopRuntimeService`，不再代表正式业务 runtime，仅用于 transport regression。
- 消融记录：[`windows-kotlin-ipc-ablation.md`](./windows-kotlin-ipc-ablation.md)。

## 2. 已确认基线

- `macosApp/PulseBarNative/State/MonitorStore.swift` 已将 Kotlin `Flow<T>` 消费为 Swift `AsyncSequence`。
- `common/src/commonMain/kotlin/io/github/kt/pulsebar/export/Bridge.kt` 是当前 Swift Export boundary。
- `flowIpcDemo/` 已验证：
  - Kotlin `StateFlow` → gRPC server-streaming → C# `await foreach`；
  - C# client-streaming → Kotlin `Flow<PlatformEvent>`；
  - `CancellationToken` → Kotlin `CancellationException`；
  - 新订阅第一条消息为当前快照。
- `windowsApp/` 已通过独立 .NET contract project 使用正式 desktop IPC contract；不使用 IKVM 承载正式 runtime。
- `common/src/jvmMain` 的本阶段 Windows daemon 前置项已补齐 JVM device identity、Ktor CIO 和 Room JVM 初始化；完整产品化 daemon 仍需 lifecycle/distribution 验证。
- `grpc-java` 与 .NET 的正式交集为 loopback TCP；daemon 使用 port 0，不依赖固定端口或 Windows named pipe。

## 3. 适配层设计原则

### 3.1 只暴露快照和事件，不暴露 Kotlin 对象图

禁止将以下形状直接作为跨进程接口：

```kotlin
Flow<Map<String, Flow<ConnectionState>>>
Flow<MediaFlowState> // 内部还包含 Flow/StateFlow
UsageStats           // 内部包含 AppStats.usages Flow
```

IPC 输出必须是可以独立反序列化、直接渲染的 snapshot/message。嵌套流拆成独立 RPC 或物化为当前值。

### 3.2 query 与 command 分离

- `Watch*` RPC 只订阅状态，不触发 tick、刷新或其他隐式副作用。
- `PublishPlatformEvents` 接收 Windows 平台事件。
- `PublishUserCommands` 接收连接、配置、媒体等显式命令。
- daemon 内部仍通过现有 `PulseBarBridge.emitNativeEvent()` / `EventDispatcher` 进入业务逻辑。

### 3.3 所有状态流采用 snapshot-first 语义

每次订阅必须满足：

1. 第一条消息是当前完整快照；
2. 后续消息是状态变化；
3. 慢消费者允许 conflation，只保证最终一致，不保证逐帧送达；
4. 重连后客户端可以仅依赖第一条快照恢复 UI 状态。

### 3.4 适配层拥有流生命周期，不拥有业务状态

- C# `DesktopIpcTransport` / `RuntimeAdapter` 和 Kotlin `IpcBridgeService` 可以管理：

- stream subscribe/cancel；
- reconnect/backoff；
- transport error；
- wire DTO 转换；
- DispatcherQueue 编组；
- handshake/auth。

它们不能复制 config schema、连接状态机、usage 计算或同步业务规则。

## 4. 目标目录与职责

### 4.1 契约与生成

当前实现：

```text
flowIpcDemo/src/main/proto/pulsebar/desktopipc/v1/desktop_ipc.proto
flowIpcDemo/dotnet/DesktopIpc.Contract/DesktopIpc.Contract.csproj
```

正式 contract 仍属于 desktop IPC，不放入 `packages/realtime-protocol`，因为它不是 worker/device wire protocol。C# 生成类型先由独立 contract project 产出，避免 WinUI/XAML 的 MSBuild pipeline 直接承担外部 proto 的生成。

Kotlin 侧由 Gradle protobuf 生成 Java/Kotlin gRPC 类型；C# 侧由 `Grpc.Tools` 从同一份 proto 生成客户端类型。

### 4.2 Kotlin daemon 边缘

建议新增或演进：

```text
common/src/jvmMain/.../platform/
common/src/jvmMain/.../daemon/
flowIpcDemo/src/main/kotlin/.../desktopipc/
```

职责：

- 创建并持有 `PulseBarBridge`；
- 将 shared state 映射为 wire snapshot；
- 将 `PlatformEvent` / `UserCommand` 映射为 `AppEvent`；
- 启动和停止 gRPC server；
- 暴露端口、token、protocol version；
- 处理客户端取消和 daemon shutdown。

### 4.3 WinUI 适配层

建议新增：

```text
windowsApp/Runtime/
  DesktopIpcClient.cs
  RuntimeAdapter.cs
  RuntimeConnection.cs
  RuntimeSnapshotStore.cs
  RuntimeEventPublisher.cs
```

职责：

- 启动/连接 daemon；
- 订阅多个 `Watch*` stream；
- 通过 `DispatcherQueue` 更新可绑定状态；
- 将 Windows platform event 转成 proto；
- 将用户操作转成显式 command；
- 断线后自动重连；
- 重连后使用 snapshot-first 快照恢复状态；
- 将 transport/daemon 错误转成 UI 可消费的 connection state。

`MainWindow.xaml.cs` 只依赖 `RuntimeAdapter` 的 UI-facing model，不直接依赖生成的 gRPC client 或 Kotlin/IKVM 类型。

### 4.4 macOS 侧保持现状，但校准边界

本计划不把 Swift Export 改成 gRPC，也不把 macOS 改为 daemon 架构。macOS 继续使用：

```text
PulseBarBridge → Swift Export → MonitorStore
```

只需要保证两点：

- 可跨平台复用的 snapshot/command 语义继续归属 `common`；
- Swift-only 的类型 adapter 留在 `macosApp/PulseBarNative/Bridge`，不把 Windows IPC DTO 搬入 Swift。

## 5. IPC contract 初版

正式 contract 以实际字段为准，以下是第一阶段建议形状：

```proto
service DesktopRuntime {
  rpc WatchRuntimeState(WatchRequest) returns (stream RuntimeStateSnapshot);
  rpc WatchMediaState(WatchRequest) returns (stream MediaStateSnapshot);
  rpc WatchConfig(WatchRequest) returns (stream ConfigSnapshot);
  rpc WatchConnectionState(WatchRequest) returns (stream ConnectionStateSnapshot);
  rpc WatchUsageStats(WatchRequest) returns (stream UsageStatsSnapshot);
  rpc WatchServerCommands(WatchRequest) returns (stream ServerCommand);

  rpc PublishPlatformEvents(stream PlatformEvent) returns (PublishSummary);
  rpc PublishUserCommands(stream UserCommand) returns (PublishSummary);
}
```

第一阶段不要一次性覆盖所有媒体数据和统计明细。推荐实现顺序：

1. `RuntimeStateSnapshot`：frontmost app / media summary / revision；
2. `PlatformEvent.frontmost_app_changed`；
3. `ConfigSnapshot` + `UpdateConfig`；
4. `ConnectionStateSnapshot` + connect/disconnect/enable；
5. `MediaStateSnapshot` 和媒体命令；
6. `UsageStatsSnapshot`；
7. `ServerCommand`；
8. PCM chunk 或其他高频二进制流单独评估，不与普通状态流混用。

事件和命令使用 `oneof`，不在 C# 中复制 Kotlin sealed/interface hierarchy：

```proto
message PlatformEvent {
  oneof event {
    FrontmostAppChanged frontmost_app_changed = 1;
    NetworkChanged network_changed = 2;
    MediaStateChanged media_state_changed = 3;
    MediaStreamStopped media_stream_stopped = 4;
    StreamPcmChunk stream_pcm_chunk = 5;
  }
}
```

所有 message 预留：

- `schema_version` 或通过 package/service version 控制兼容；
- monotonic `revision`；
- 时间戳；
- nullable 字段的明确表示；
- 未知 enum/oneof case 的安全忽略行为。

## 6. 分阶段实施

### Phase 0：基线和构建前置

目标：让 Windows daemon 的最小 JVM 运行环境具备可验证基础。

任务：

- [x] 确认 `common:jvmJar`、Room JVM 初始化和 DataStore JVM 路径在 Windows 本地盘可用；修复 JVM Room reified builder 反射崩溃。
- [x] 补齐 `common/src/jvmMain` 的 device identity actual（当前为稳定的 JVM 环境派生 ID，后续 Windows 产品化可替换为系统设备标识）。
- [x] 为 JVM 选择并实现 Ktor CIO engine；禁止保留该入口的运行时 `TODO()`。
- [ ] 确认 JVM target 从 IKVM 遗留的 Java 8 约束中解耦；daemon 使用项目决定的现代 JDK bytecode。
- [x] 把 Windows 构建和 proto 生成放在 Windows 本地盘，规避 UNC 路径问题。
- [x] 保留 `flowIpcDemo` 作为 transport regression baseline。

验收：

- daemon 最小入口能在 Windows 启动并退出；
- Room/DataStore/Ktor 初始化没有 `TODO` 或 JNI/路径异常；
- `flowIpcDemo` 自动化测试通过。

### Phase 1：正式 contract 与生成链路

目标：建立 Kotlin/.NET 单一契约，先打通 frontmost app 状态。

任务：

- [x] 创建正式 desktop IPC proto package。
- [x] 配置 Kotlin protobuf/gRPC 生成。
- [x] 建立独立 .NET contract project，从同一份 proto 生成 C# 类型，供 `windowsApp` 引用。
- [x] 为 `RuntimeStateSnapshot` 和 `FrontmostAppChanged` 建立 demo Kotlin wire mapper。
- [ ] 为同一字段建立 C# adapter tests。
- [x] 在 proto 中明确 snapshot-first、conflation、revision 和未知事件行为。

验收：

- 同一份 proto 在 Kotlin/.NET 两端生成成功；
- fake platform event 能改变 daemon state；
- 新 C# subscriber 第一条消息包含最新状态；
- 字段和 enum 没有手写平行定义。

### Phase 2：Kotlin daemon IPC adapter

目标：让 gRPC 只做 transport edge，不侵入 shared business logic。

任务：

- [x] 创建 daemon 入口并持有真实 `PulseBarBridge`。
- [x] 实现真实 bridge 的 `runtimeState` → `WatchRuntimeState` 映射。
- [x] 实现 `PublishPlatformEvents` → `NativeFrontmostAppChanged` 映射。
- [x] 保留 demo service 作为独立 transport regression fixture。
- [ ] 实现错误、取消和 shutdown 处理。
- [x] 增加端口 0 启动和 handshake 输出。
- [x] 增加 token 校验和 protocol version 校验。
- [x] 不允许 daemon service 暴露 Kotlin object reference 或 nested Flow。

验收：

- daemon 可以独立运行；
- client cancellation 能结束 Kotlin collector；
- daemon 日志能区分 attach/detach/reconnect/invalid token；
- daemon 关闭时所有 child coroutine 和 gRPC server 都结束。

### Phase 3：WinUI RuntimeAdapter

目标：把 C# transport 细节从 WinUI 页面中抹平。

任务：

- [x] 实现 demo daemon spawn/channel 创建；WinUI 首次连接会自动启动 `gradlew.bat :flowIpcDemo:runDaemon`。
- [x] 实现 demo daemon 的 port 0/token handshake，以及 adapter 的基础连接重试循环。
- [x] 将连接重试提取为正式 `RuntimeConnection`，补充基础指数 backoff 和 daemon ownership 语义；daemon 崩溃恢复和外部 daemon ownership 的完整产品策略仍待实机验证。
- [x] 实现首版 `RuntimeAdapter`，集中保存最新 snapshot。
- [x] 实现首版 `WatchRuntimeState` stream 消费。
- [x] 所有首版 UI 更新经 `DispatcherQueue` 进入 WinUI 线程。
- [x] 实现首版 frontmost platform event publisher。
- [x] stream 断开时保留已有 snapshot，重连后的第一条 snapshot 再覆盖状态。
- [x] 增加基础重连 backoff、连接状态枚举和连接错误入口；用户可见错误分类仍需产品化。
- [x] MainWindow 仅依赖 adapter 的状态和命令，不直接依赖 gRPC generated client。

验收：

- 点击 WinUI 按钮可以发出 command/event；
- daemon 状态变化能反映到 WinUI；
- daemon 重启后 UI 自动重连并恢复最新快照；
- UI 关闭时不遗留 daemon 或 gRPC stream。

### Phase 4：扩展 config、connection、media 和 usage

目标：按低风险顺序覆盖现有 `IPulseBarBridge` 的主要边界。

任务：

- [x] `config`：真实 `PulseBarBridge.config` 读流和 `UpdateConfigCommand` 更新命令。
- [x] `connectionState`：真实 `PulseBarBridge.connectionState` 快照、connect/disconnect、endpoint enabled。
- [x] WinUI 页面绑定和配置表单交互。
- [ ] `mediaFlow`：将内部嵌套 media Flow 改成独立 snapshot stream。
- [ ] `usageStats`：将嵌套 usages Flow 物化为 snapshot，明确排序和分页/大小策略。
- [ ] `serverCommands`：使用 `ServerCommand oneof`，补充 command id、generation 和 stop reason。
- [ ] 对高频 PCM chunk 单独设计 backpressure、丢弃和取消语义。

验收：

- WinUI 不再需要 IKVM 或 `Assembly.LoadFrom`；
- 所有正式 UI 状态均来自 adapter；
- 不存在 C# 侧复制的业务状态机；
- 嵌套 Flow 不出现在 proto 或 C# public adapter API 中。

### Phase 5：Windows platform services 和产品化生命周期

目标：接入真实 Windows 能力并达到可恢复运行状态。

任务：

- [x] 前台应用变化 → `FrontmostAppChanged`（首版使用 Win32 foreground process name）。
- [ ] 网络状态变化 → `NetworkChanged`。
- [ ] GSMTC/media 变化 → `MediaStateChanged`。
- [ ] 音频采集和权限 → 独立 Windows service，事件/数据通过 adapter 上行。
- [ ] daemon spawn、崩溃检测、重启次数和冷启动日志。
- [ ] jlink/JDK 分发、版本检查、安装目录和日志目录。
- [ ] tray 生命周期另行验证，不把 tray 逻辑塞入 Kotlin daemon。

验收：

- Windows 实机完成一次完整采集 → Kotlin 编排 → 状态回传 → WinUI 渲染链路；
- daemon 被杀掉后 UI 能恢复；
- 权限拒绝、网络断开、服务异常都有可见且可诊断状态；
- 关闭应用后没有后台 daemon 残留。

## 7. 测试策略

本阶段额外采用 A/B 消融：transport-only `DemoRuntime` 与 real-runtime `PulseBarBridge` edge 必须分别通过，且两者使用同一份 proto。实验结果和并发测试失败的控制变量记录见 [`windows-kotlin-ipc-ablation.md`](./windows-kotlin-ipc-ablation.md)。


### Kotlin

- contract mapper 单元测试；
- event oneof → `AppEvent` 映射测试；
- snapshot-first 测试；
- Flow cancellation 测试；
- daemon lifecycle 测试；
- Room/DataStore/Ktor JVM smoke test。

### .NET

- proto generated client smoke test；
- `RuntimeAdapter` 重连测试；
- snapshot 不丢失测试；
- DispatcherQueue 更新测试；
- invalid token/version 测试；
- daemon 退出/重启测试。

### 跨进程 Windows 实机

至少验证：

1. 启动 daemon 并握手；
2. WinUI 订阅后首条是当前快照；
3. Windows event 上行后 Kotlin 状态下行；
4. 取消订阅后 Kotlin collector 结束；
5. daemon 重启后自动重连；
6. UI 退出不遗留 daemon；
7. UNC 路径不作为正式构建前提。

## 8. 验证门槛

本计划是跨域计划，完成各阶段时执行对应验证：

```bash
# Kotlin/common 基线
pnpm check:native

# IPC 自动化 baseline
./gradlew :flowIpcDemo:test
```

Windows 本地 PowerShell：

```powershell
.\gradlew.bat :flowIpcDemo:test
.\gradlew.bat :flowIpcDemo:runDaemon
dotnet build .\windowsApp\PulseBar.Windows.csproj -c Debug -p:Platform=ARM64 -r win-arm64
```

正式 Windows 客户端还必须执行：

- daemon + WinUI 双进程实测；
- 真实 platform event 实测；
- daemon 崩溃/重启实测；
- 内存、冷启动和发布包体积测量。

当前环境不能完成 Windows 实机验证时，必须在阶段记录中明确阻塞原因，不能用 macOS 编译替代 Windows 验收。

## 9. 非目标

- 不在 WinUI 中嵌入完整 JVM。
- 不继续扩大 IKVM，使其承载 `PulseBarBridge`。
- 不把 Kotlin/Native mingwX64 作为完整 runtime 方案。
- 不把 Windows UI 容器状态搬入 `common`。
- 不把 desktop IPC contract 混入 `packages/realtime-protocol`。
- 不在 WinUI 中复制 Kotlin config、usage、connection 或 sync 业务规则。
- 不在本计划中重做 macOS Swift Export；macOS 继续作为同进程 adapter 参考实现。

## 10. 完成定义

只有同时满足以下条件，才可以把本计划移到 `docs/plans/completed/`：

- WinUI 不再通过 IKVM/反射加载正式 Kotlin runtime；
- 正式 IPC contract 由单一 proto 生成；
- Kotlin daemon 与 WinUI adapter 均支持 snapshot-first、取消和重连；
- nested Flow 已被适配层抹平；
- 至少一个真实 Windows platform event 完成双向闭环；
- daemon 生命周期、token handshake 和 shutdown 已在 Windows 实机验证；
- `flowIpcDemo` 回归测试和 Windows build 通过；
- `docs/desktop-app/architecture.md`、Windows ADR 与实际实现一致。
