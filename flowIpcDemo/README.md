# Flow IPC Demo

双进程 Windows 方案的第二个 spike。验证目标只有一个：**Kotlin Flow 的语义能不能干净地跨越进程边界**，即

- Kotlin `StateFlow` → gRPC server-streaming → .NET `IAsyncEnumerable` + `await foreach`
- .NET 平台事件流 → gRPC client-streaming → Kotlin 侧以 `Flow<PlatformEvent>` 原生接收
- C# `CancellationToken` 取消 → 传播为 Kotlin 服务端 Flow 的 `CancellationException`
- StateFlow 的 replay 语义显式契约化：新订阅者的第一条消息永远是当前快照

契约在 [`src/main/proto/pulsebar/flowipc/v1/flow_ipc_demo.proto`](./src/main/proto/pulsebar/flowipc/v1/flow_ipc_demo.proto)，Kotlin 与 C# 两端共用同一份文件生成代码。这不是真实 bridge 契约，端口固定、无认证，仅用于验证。

## 自动化验证（任意平台）

```sh
./gradlew :flowIpcDemo:test
```

[`FlowBridgeDemoServerTest`](./src/test/kotlin/io/github/kt/pulsebar/flowipc/FlowBridgeDemoServerTest.kt) 在真实 loopback socket 上跑上面四条语义（客户端用 grpc-kotlin 代替 .NET，wire 行为一致）。

## 跨进程手动验证（Windows）

> 注意：`protoc.exe` 不支持 UNC 路径。如果项目位于网络共享（例如 Parallels 的 `\\psf\Home\...`），`generateProto` 会报 `Could not make proto path relative`。先把共享映射成盘符（`net use P: \\psf\Home`）从 `P:\...` 运行，或把仓库拷到本地盘再跑。`dotnet` 侧不受影响。

终端 1，启动 daemon：

```powershell
.\gradlew.bat :flowIpcDemo:runDaemon
```

终端 2，跑 .NET 客户端（任何装了 .NET 8+ SDK 的机器都行，不需要 WinUI3）：

```powershell
dotnet run --project .\flowIpcDemo\dotnet\FlowIpcDemo.Client.csproj
```

预期观察：

1. `[watch-1]` 每秒打印一次（daemon 内部 ticker 驱动 `rev`/`ticks` 递增），`app=unknown`。
2. 客户端发布 3 个 `FrontmostAppChanged` 事件后，`[watch-1]` 的 `app=` 依次变成三个 app id，`events=` 递增——上行事件改变 daemon 状态并从下行流回来。
3. 客户端取消 watch-1 后，daemon 日志出现 `watch: subscriber detached (cause=...CancellationException)`。
4. `[watch-2]` 的第一条消息就带有最新状态（快照优先契约）。

## 这个 demo 映射到真实方案的方式

- `DemoRuntime` ≙ Kotlin shared runtime（长期状态 owner，`StateFlow` 出口）。
- `FlowBridgeDemoService` ≙ 真实 bridge 的 IPC 边缘：下行 RPC 直接 return `StateFlow.map { toProto() }`，上行 handler 直接收 `Flow`，两侧都没有手写泵循环。
- .NET `Program.cs` ≙ WinUI3 侧 store adapter 的内核（真实版本再加 DispatcherQueue 编组和断线重订阅）。
- 真实 daemon 应 bind 端口 0，通过启动握手把端口 + auth token 交给 UI 进程，而不是固定端口。
