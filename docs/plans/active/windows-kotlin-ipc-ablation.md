# Windows Kotlin/JVM ↔ WinUI IPC 消融实验记录

归属：desktop-app（跨 `flowIpcDemo`、`common`、`windowsApp`）
代码范围：`flowIpcDemo/src/main/kotlin/io/github/kt/pulsebar/desktopipc`、`flowIpcDemo/src/test`、`windowsApp/Runtime`
状态：active
验证：Windows ARM64 本地盘；结果见「实验结果」

## 1. 实验目的

本实验用于区分两个问题：

1. snapshot-first、事件回环和 gRPC Flow 语义是否由 IPC adapter 本身提供；
2. 接入真实 `PulseBarBridge` 后，是否仍然保持同一份 desktop IPC contract，而不是在 WinUI 侧复制业务状态。

实验不是性能基准，也不代表发布包的冷启动、内存或吞吐表现。当前只比较行为闭环和测试执行时间，用于决定下一步实现边界。

## 2. 消融条件

### A：transport-only

保留：

- loopback gRPC server/client；
- `DesktopRuntime` contract；
- token/version 入口；
- snapshot-first runtime stream；
- client-streaming platform event；
- event → state round-trip。

移除：

- 真实 `PulseBarBridge`；
- Room/DataStore/Ktor 等 shared runtime 初始化；
- config/connection 的真实业务事件映射。

实现对应：

- `DemoRuntime`
- `DesktopRuntimeService`
- `FlowBridgeDemoServerTest`（原始 Flow 语义基线）

### B：real-runtime edge

保留同一份：

- protobuf contract；
- loopback gRPC transport；
- token/version 验证；
- server-streaming / client-streaming 形状。

加入：

- `PulseBarBridge`；
- `runtimeState`、`config`、`connectionState` 三条真实 Flow 映射；
- `NativeFrontmostAppChanged`；
- `UpdateConfigCommand`、`ConnectCommand`、`DisconnectCommand`、`SetEndpointEnabledCommand`。

实现对应：

- `RealDesktopRuntimeService`
- `DesktopRuntimeServiceTest`

## 3. 执行命令

两组 Gradle 测试必须串行执行，因为 Gradle 的 test report 目录是模块级共享目录，并发执行会互相覆盖 binary test result 文件。

```powershell
Measure-Command {
  .\gradlew.bat :flowIpcDemo:test `
    --tests io.github.kt.pulsebar.flowipc.FlowBridgeDemoServerTest `
    --no-daemon
} | Select-Object TotalSeconds

Measure-Command {
  .\gradlew.bat :flowIpcDemo:test `
    --tests io.github.kt.pulsebar.flowipc.DesktopRuntimeServiceTest `
    --no-daemon
} | Select-Object TotalSeconds
```

WinUI 编译验证：

```powershell
Measure-Command {
  dotnet build .\windowsApp\PulseBar.Windows.csproj `
    -c Debug `
    -p:Platform=ARM64 `
    -r win-arm64 `
    --no-restore
} | Select-Object TotalSeconds
```

## 4. 实验结果（2026-09-07）

| 条件 | 测试 | 结果 | 本次执行时间 |
| --- | --- | --- | ---: |
| A transport-only | `FlowBridgeDemoServerTest` | 通过 | 约 27.7 s |
| B real-runtime edge | `DesktopRuntimeServiceTest` | 通过 | 约 29.8 s |
| WinUI ARM64 编译 | `PulseBar.Windows.csproj` | 通过 | 约 6.0 s |

此前完整回归也已通过：

```text
:flowIpcDemo:test — BUILD SUCCESSFUL
```

并且项目级 diagnostics、`git diff --check` 均无错误。

## 5. 可归因结论

### 5.1 Flow 语义主要由 contract + transport 形状保证

A 条件在没有真实 `PulseBarBridge` 的情况下仍通过 snapshot-first、上行事件流、状态回环和取消语义测试。因此这些语义不依赖具体业务 runtime；它们来自：

- `StateFlow`/`Flow` 到 gRPC streaming 的映射；
- proto 中明确的 snapshot-first 约定；
- server-streaming 与 client-streaming 的 RPC 形状。

### 5.2 接入真实 bridge 没有改变 IPC 边界

B 条件使用同一份 contract，并通过真实 bridge 的 Flow 和显式 command 完成映射。当前测试通过说明真实 runtime 可以作为 transport edge 的下游 owner，而不需要让 C# 了解 Kotlin 对象图或嵌套 Flow。

### 5.3 当前观测到的成本很小，但不能外推成性能指标

B 比 A 本次多约 2.1 秒，主要可能来自真实 runtime 初始化和测试构建/缓存状态；样本只有一次，且 Gradle 配置缓存、JVM 启动和磁盘状态都会影响结果。因此这里只记录为“当前 smoke test 成本未出现数量级异常”，不作吞吐、延迟或内存结论。

## 6. 失败与控制变量

第一次尝试并行启动两组 Gradle test 和 WinUI build，造成共享构建/测试输出竞争，出现：

- `java.io.EOFException`；
- `NoSuchFileException: ...in-progress-results-generic.bin`。

随后改为串行执行，两组测试和 WinUI 构建均通过。该失败归因于实验调度，不归因于实现代码。

## 7. 尚未覆盖的消融

本实验没有证明以下能力：

- daemon 被杀掉后的自动重连和快照恢复；
- 指数退避、连接状态枚举和错误分类；
- Windows 真实前台应用、网络、GSMTC/media 事件；
- daemon shutdown 时所有 coroutine、stream 和 bridge 资源都被明确关闭；
- 冷启动、RSS、发布包体积和高频事件吞吐；
- API key 的安全存储和日志脱敏。

下一轮建议做故障消融：

1. 运行 WinUI；
2. 记录已有 runtime snapshot；
3. 终止 daemon；
4. 观察 UI 是否保留旧快照、显示断开状态并自动恢复；
5. 恢复后发送 frontmost event，确认 revision/event count 继续变化。

在此故障实验完成前，不应把当前 `RuntimeAdapter` 称为完整产品级连接管理器。
