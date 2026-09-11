# .NET ↔ Kotlin/JVM 双进程 IPC：Flow 语义验证结论

归属：desktop-app（技术验证总结，供独立验证 repo / 远程 thread 复用）
代码范围：`flowIpcDemo/`
状态：active
验证：`./gradlew :flowIpcDemo:test`；Windows ARM64 本地盘上的真实 daemon + WinUI ARM64 build 已通过（2026-09-07）；行为消融记录见 [`plans/active/windows-kotlin-ipc-ablation.md`](./plans/active/windows-kotlin-ipc-ablation.md)

本文是可携带的技术结论，目标是让后续验证工作不用重新推导。决策背景和路线取舍见 [Windows 双进程架构 ADR](./desktop-app/decisions/windows-dual-process-architecture.md)。

## 1. 核心结论

**Kotlin Flow 的消费体验可以几乎无损跨进程边界**，前提是用 gRPC streaming 把两端的原生异步抽象直接接起来：

| 方向 | Kotlin 侧 | .NET 侧 |
| --- | --- | --- |
| 状态下行 | server-streaming handler 直接 `return stateFlow.map { it.toProto() }` | `call.ResponseStream.ReadAllAsync()` → `IAsyncEnumerable<T>` + `await foreach` |
| 事件上行 | handler 签名就是 `suspend fun f(requests: Flow<E>)` | `client.Publish()` + `RequestStream.WriteAsync(...)` |
| 取消 | 服务端 Flow 收到 `CancellationException` | `CancellationToken` → gRPC cancel |

两侧都不写手工泵循环、不写帧协议、不写取消传播。`await foreach` 就是 C# 版的 Swift `for await`（Swift Export 把 `Flow<T>` 映射为 `AsyncSequence<T, Error>`，见 KT-64572）。

## 2. 进程边界真正改变的三件事

这些不是语法问题，是必须显式设计的语义差异：

1. **StateFlow replay → 快照优先契约**：每条状态流订阅后第一条消息必须是当前快照。实现上直接 return StateFlow 即可免费获得（collect 先发当前值），但它必须写进契约而不是靠实现细节。同时契约应声明：状态流只保证最终一致（conflation），不保证逐帧。
2. **流会断**：进程内 Flow 永不掉线，daemon 重启后 IPC 流全部中断。UI 侧需要统一的自动重订阅 store adapter；快照优先契约保证重订阅后状态自愈。
3. **只有序列化副本，没有对象引用**：嵌套 Flow（如 `Flow<Map<String, Flow<T>>>`）无法跨 IPC，必须拍平成键控事件流或单流入口。

## 3. 技术栈与版本（实测组合）

- Kotlin 侧：Kotlin 2.4.0、coroutines 1.11.0、grpc-java 1.84.0（netty-shaded）、grpc-kotlin 1.5.0、protobuf 4.36.1、protobuf-gradle-plugin 0.10.0、JDK 17+ bytecode
- .NET 侧：net8.0、Grpc.Net.Client 2.71.0、Google.Protobuf 3.30.2、Grpc.Tools 2.72.0
- 传输：loopback TCP + h2c（`GrpcChannel.ForAddress("http://127.0.0.1:...")` 在 .NET 8 直接可用）。**grpc-java 不支持 Windows named pipe**，两端交集就是 loopback；真实实现用端口 0 + 启动握手交换端口、auth token 和 protocol version。
- 契约：单一 `.proto` 文件，Gradle protobuf 插件和 Grpc.Tools 各自生成，不存在手写平行类型。

## 4. 两端代码形态（从 spike 摘录）

Kotlin 服务端，完整逻辑仅此：

```kotlin
override fun watchRuntimeState(request: WatchRuntimeStateRequest): Flow<RuntimeState> =
    runtime.state.map { it.toProto() }

override suspend fun publishPlatformEvents(requests: Flow<PlatformEvent>): PublishSummary {
    var accepted = 0
    requests.collect { event ->
        runtime.onFrontmostAppChanged(event.frontmostAppChanged.appId)
        accepted += 1
    }
    return publishSummary { acceptedEvents = accepted }
}
```

C# 消费端：

```csharp
using var call = client.WatchRuntimeState(new WatchRuntimeStateRequest(), cancellationToken: ct);
await foreach (var state in call.ResponseStream.ReadAllAsync(ct))
{
    // 等价于 Swift 侧对 AsyncSequence 的 for await
}

using var publish = client.PublishPlatformEvents();
await publish.RequestStream.WriteAsync(new PlatformEvent { ... });
await publish.RequestStream.CompleteAsync();
var summary = await publish;
```

## 5. 已验证的四条语义

自动化测试（`flowIpcDemo/src/test/.../FlowBridgeDemoServerTest.kt`）和 Windows 实机均验证通过：

1. 快照优先：新订阅者第一条消息就是当前状态（含变更后的新订阅者）。
2. 上行事件以原生 `Flow<PlatformEvent>` 到达 Kotlin handler。
3. 状态回环：上行事件变更 daemon 状态并从下行流回到客户端；实测 revision 无跳号无乱序。
4. 取消传播：`CancellationToken` 取消后，服务端 Flow 的 `onCompletion` 收到 `CancellationException`。

## 6. 复现与已知坑

复现方式见 [`flowIpcDemo/README.md`](../flowIpcDemo/README.md)。踩过的坑：

- **protoc.exe 不支持 UNC 路径**：从网络共享（如 Parallels `\\psf\...`）跑 `generateProto` 必报 `Could not make proto path relative`。映射盘符或用本地盘 checkout；.NET 工具链不受影响。
- **镜像仓库缺 plugin marker**：`com.google.protobuf` 插件需要在 `settings.gradle.kts` 用 `pluginManagement.resolutionStrategy.eachPlugin` 映射到直接坐标 `com.google.protobuf:protobuf-gradle-plugin:<ver>`。
- **JVM TLS 信任库**：开发机如果有 MITM 代理（Reqable 等）或 JDK cacerts 不全，Gradle 拉新依赖会 PKIX 失败；macOS 上给 `org.gradle.jvmargs` 加 `-Djavax.net.ssl.trustStoreType=KeychainStore -Djavax.net.ssl.trustStore=NONE` 改用系统钥匙串。

## 7. 当前实现状态与下一批待验证

当前已落地：

1. Kotlin daemon 持有真实 `PulseBarBridge`，并暴露 runtime/config/connection 三条 snapshot stream。
2. `DesktopIpcTransport` 负责一次 session 的 port 0、token、protocol version handshake、daemon spawn、gRPC stream lifecycle 和 auth 注入；它不认识 PulseBar command 语义。
3. `RuntimeConnection` 负责连接状态、session 重启和基础指数退避；`RuntimeAdapter` 只负责 PulseBar domain snapshot/command/event 映射。WinUI 已有 config 表单、connect/disconnect 命令和 frontmost event 演示。
4. `DemoRuntime` 与真实 bridge edge 的消融均通过；详见 [`windows-kotlin-ipc-ablation.md`](./plans/active/windows-kotlin-ipc-ablation.md)。

下一批待验证：

1. WinUI3 tray（H.NotifyIcon 或 Win32 interop）——tray 形态 app 的核心路径。
2. daemon 崩溃/重启后的正式 `RuntimeConnection`、指数 backoff、ownership 和快照恢复。
3. jlink 裁剪后的分发体积、常驻内存和冷启动时间。
4. 真实 Windows 前台应用、网络、GSMTC/media 与权限事件。
5. API key 的 PasswordBox 之外的安全存储、日志脱敏和发布配置。
