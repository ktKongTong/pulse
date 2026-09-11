# Windows 客户端采用双进程架构（JVM daemon + WinUI3 壳层）

归属：desktop-app
代码范围：`flowIpcDemo`（IPC 验证 spike）、`windowsApp`/`MyWinUIApp`（WinUI3 spike）、未来的 Windows 客户端
状态：active
验证：`./gradlew :flowIpcDemo:test`；Windows ARM64 本地盘上的 daemon/WinUI 构建与 real-runtime IPC slice 已验证（2026-09，见 §4）；消融记录见 [`docs/plans/active/windows-kotlin-ipc-ablation.md`](../../plans/active/windows-kotlin-ipc-ablation.md)

## 1. 背景与问题

Pulse 需要 Windows 客户端。目标是复用 `common` 里的 Kotlin shared runtime（配置、采集编排、Room 持久化、同步链路、共享状态），同时 UI 用原生 WinUI3。阻碍在于 Kotlin 在 Windows 上的落地方式：

- Kotlin/Native `mingwX64`：生态缺口致命。Room 和 DataStore 都没有 Windows native target，现有持久化选型（见 `architecture.md` §7）无法成立；与 .NET 的互调用只能走 C ABI，没有 Swift Export 级别的导出机制。
- Kotlin/JVM：全部关键依赖（Room 3 / DataStore / Ktor / coroutines）都有 JVM artifact，`common` 已有 jvm target。

因此问题变成：JVM 上的 Kotlin runtime 如何与 WinUI3（.NET）协作。

## 2. 备选路线与取舍

| 路线 | 结论 | 否决理由 |
| --- | --- | --- |
| Kotlin/Native mingwX64 DLL + P/Invoke | 否决 | Room/DataStore 无 mingwX64 target；`nativeHello` spike 证明只能支撑叶子函数，支撑不了完整 runtime |
| IKVM 单进程（JVM 字节码转 .NET 程序集） | 否决（已探索，`windowsApp` 保留 hello 级 spike） | 锁死 Java 8 字节码（`common` 的 `jvmTarget 1.8` 即为此妥协）；Room JVM 底层是 JNI 加载的 bundled SQLite，IKVM 下不可用；协程调度/KSP 生成代码风险高 |
| JNI Invocation API 在 WinUI3 进程内嵌 JVM | 否决 | 两套 GC/线程模型同进程，崩溃互相牵连，调试痛苦；相比双进程没有架构收益 |
| Compose Desktop 单进程 | 否决 | 非原生观感；与“UI 壳层不共享到 Kotlin”的既定原则（`architecture.md` §7.3）冲突 |
| **双进程：JVM Kotlin daemon + WinUI3 壳层，loopback gRPC IPC** | **采纳** | 见下 |

采纳理由：与现有架构天然对齐——bridge 已收敛成 Query/Command 边界（`architecture.md` §5），UI 侧本来就是薄 observable adapter（§4.2），把进程内调用换成消息通道不改变架构语义；daemon + 原生壳是成熟模式（Docker Desktop、Mullvad、Syncthing）。

## 3. 决策

1. Windows 客户端分两个进程：Kotlin/JVM daemon（复用 shared runtime，长期状态 owner）+ WinUI3 UI 进程（壳层、页面容器、Windows-only 平台服务）。
2. IPC 用 loopback gRPC：下行状态流 = server-streaming（Kotlin 直接 return `Flow`，.NET 用 `await foreach` 消费 `IAsyncEnumerable`）；上行平台事件 = client-streaming（Kotlin handler 直接收 `Flow`）。
3. 平台采集归 .NET 进程，对应 macOS 的 “Swift-only platform service” 角色（前台窗口、`GlobalSystemMediaTransportControls`、音频等 WinRT 能力），事件上行、共享状态下行。
4. IPC 契约用 proto 单一事实源，两端从同一份文件生成代码，遵循与 `packages/realtime-protocol` 同样的契约纪律（但它是 desktop 内部契约，不属于 wire protocol 域）。

## 4. 已验证结论（flowIpcDemo，2026-09）

实现位于 `flowIpcDemo/` 和 `windowsApp/`：自动化测试在真实 loopback socket 上运行，Windows ARM64 build 已通过；daemon 入口现在持有真实 `PulseBarBridge`，WinUI 通过 `RuntimeAdapter` 自动 spawn、读取 port 0/token handshake，并订阅 runtime/config/connection streams。`DemoRuntime` 仍保留为 transport regression fixture。

验证的四条 Flow 语义：

1. **快照优先**：新订阅者第一条消息就是当前状态（StateFlow replay 语义的契约化替代，实现上直接 return StateFlow 即可获得）。
2. **上行事件流**：.NET client-streaming 在 Kotlin 侧以原生 `Flow<PlatformEvent>` 到达，无手写泵循环。
3. **状态回环**：上行事件变更 daemon 状态并从下行流回到 UI 进程（Windows 实测：发布 3 个 `FrontmostAppChanged` 后 watch 流依次反映，无丢帧无乱序）。
4. **取消传播**：C# `CancellationToken` 取消 → gRPC cancel → Kotlin 服务端 Flow 收到 `CancellationException`。

附带结论：消费端跟得上时逐帧送达（实测 revision 无跳号）；慢消费者场景下 StateFlow 的 conflation（只拿最新值）是预期行为，契约应将其明确为“状态流只保证最终一致，不保证逐帧”。

关键版本：Kotlin 2.4.0 / coroutines 1.11.0；grpc-java 1.84.0、grpc-kotlin 1.5.0、protobuf 4.36.1、protobuf-gradle-plugin 0.10.0；.NET 侧 Grpc.Net.Client 2.71.0、Google.Protobuf 3.30.2、Grpc.Tools 2.72.0。

## 5. 真实实现的约束与当前状态

- **契约形状**：现有 `export/Bridge.kt` 的 `connectionStates: Flow<Map<String, Flow<ConnectionState>>>` 这类嵌套 Flow 无法跨 IPC，必须拍平成键控事件流或单流入口；当前首版只暴露已物化的 runtime/config/connection snapshots。
- **握手**：真实 daemon 已 bind 端口 0，并通过 `PULSEBAR_DAEMON_READY` 将端口、auth token 和 protocol version 交给 UI。传输只能用 loopback TCP：grpc-java 不支持 Windows named pipe。
- **重连语义**：`DesktopIpcTransport` 现在承接单次 IPC session，`RuntimeConnection` 承接连接状态、session 重启和基础指数 backoff；`RuntimeAdapter` 只保留 PulseBar domain 映射。daemon 崩溃恢复、外部 daemon ownership 的完整产品策略和实机验证仍未完成。
- **进程生命周期**：当前 UI 进程作为 owner spawn daemon，并在关闭时终止其进程；明确的 bridge close API、jlink 分发、冷启动和崩溃恢复仍需单独验证。
- **常驻内存**：JVM daemon 空载 RSS、jlink 裁剪和发布体积尚未实测；如未来不可接受，GraalVM native-image 是备选出口。
- **Tray**：WinUI3 没有一等 tray 支持，需要 H.NotifyIcon 或 Win32 interop；对 menubar/tray 形态的 app 这是核心路径，应尽早验证。
- **JVM 版本**：daemon 路线下 `common` 的 jvm target 现代化仍是独立收尾项。

## 6. 已知工程坑

- `protoc.exe` 不支持 UNC 路径：从 Parallels 共享目录（`\\psf\...`）跑 `generateProto` 必挂。映射盘符或拷到本地盘；.NET 工具链不受影响。Windows 侧持续开发应用本地盘 checkout。
- 镜像仓库没有 `com.google.protobuf` 的 plugin marker artifact：`settings.gradle.kts` 里用 `pluginManagement.resolutionStrategy` 把插件 id 映射到直接坐标（已提交）。
- 开发机 Mac 的 mise JDK `cacerts` 不完整且 Reqable 会 MITM JVM 的 TLS：Gradle 拉新依赖需要 `-Djavax.net.ssl.trustStoreType=KeychainStore -Djavax.net.ssl.trustStore=NONE`（加入 `~/.gradle/gradle.properties` 的 `org.gradle.jvmargs` 可持久化，仅限那台 Mac）。

## 7. 后续

- 本仓库的 `flowIpcDemo/` 保留为 transport regression baseline；正式 Windows 入口仍在逐步产品化。
- 下一批验证目标：tray（H.NotifyIcon）、正式 daemon 生命周期管理（spawn/看护/冷启动）、jlink 打包体积与内存、崩溃恢复和真实 Windows platform events。
- 消融实验记录见 [`docs/plans/active/windows-kotlin-ipc-ablation.md`](../../plans/active/windows-kotlin-ipc-ablation.md)。
- 正式 IPC 契约设计稿落地时放 `docs/desktop-app/design/`，并同步更新 `architecture.md` 的系统分层。
