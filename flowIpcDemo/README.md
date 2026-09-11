# Flow IPC Demo

双进程 Windows 方案的第二个 spike。验证目标只有一个：**Kotlin Flow 的语义能不能干净地跨越进程边界**，即

- Kotlin `StateFlow` → gRPC server-streaming → .NET `IAsyncEnumerable` + `await foreach`
- .NET 平台事件流 → gRPC client-streaming → Kotlin 侧以 `Flow<PlatformEvent>` 原生接收
- C# `CancellationToken` 取消 → 传播为 Kotlin 服务端 Flow 的 `CancellationException`
- StateFlow 的 replay 语义显式契约化：新订阅者的第一条消息永远是当前快照

原始语义 spike 契约在 [`src/main/proto/pulsebar/flowipc/v1/flow_ipc_demo.proto`](./src/main/proto/pulsebar/flowipc/v1/flow_ipc_demo.proto)。首个正式 desktop IPC slice 使用 [`src/main/proto/pulsebar/desktopipc/v1/desktop_ipc.proto`](./src/main/proto/pulsebar/desktopipc/v1/desktop_ipc.proto)，由 Kotlin daemon 和 `dotnet/DesktopIpc.Contract` 共同生成类型。当前 daemon 使用 loopback 动态端口（port 0）和启动 handshake token；`DemoRuntime` 仅作为 transport regression fixture，真实 daemon 使用 `PulseBarBridge`。

## 自动化验证（任意平台）

```sh
./gradlew :flowIpcDemo:test
```

[`FlowBridgeDemoServerTest`](./src/test/kotlin/io/github/kt/pulsebar/flowipc/FlowBridgeDemoServerTest.kt) 在真实 loopback socket 上跑上面四条语义（客户端用 grpc-kotlin 代替 .NET，wire 行为一致）。

## 跨进程手动验证（Windows）

> 注意：`protoc.exe` 不支持 UNC 路径。如果项目位于网络共享（例如 Parallels 的 `\\psf\\Home\\...`），`generateProto` 会报 `Could not make proto path relative`。先把仓库拷到 Windows 本地盘再跑。ARM64 Windows 使用 `-p:Platform=ARM64 -r win-arm64`。

推荐直接运行 WinUI 客户端：

```powershell
dotnet run --project .\\windowsApp\\PulseBar.Windows.csproj -c Debug -p:Platform=ARM64 -r win-arm64
```

WinUI 会自动启动 `:flowIpcDemo:runDaemon`，daemon 会创建真实的 Kotlin `PulseBarBridge`，然后输出 `PULSEBAR_DAEMON_READY` handshake。WinUI 使用随机 loopback 端口和 token 建立 DesktopRuntime 连接。点击 `Send frontmost event` 后，事件会进入真实 bridge，页面中的 snapshot 应显示新的 `app` 和递增的 `events`。

如果需要单独观察 daemon：

```powershell
.\\gradlew.bat :flowIpcDemo:runDaemon --no-daemon
```

预期日志包含：

```text
PULSEBAR_DAEMON_READY port=<随机端口> token=<随机 token> protocol=desktop-ipc-v1
```

## 这个 demo 映射到真实方案的方式

- `DemoRuntime` ≙ transport-only regression fixture，不代表正式业务 runtime。
- `RealDesktopRuntimeService` ≙ `PulseBarBridge` 的 IPC 边缘：下行 RPC 直接 return 真实 Flow 的 snapshot 映射，上行 handler 直接收 `Flow` 并转成显式 bridge event。
- `windowsApp/Runtime/RuntimeAdapter.cs` ≙ WinUI3 侧 store adapter：负责 daemon spawn、handshake、多个 watch stream、command/event publisher 和基础重连。
- daemon bind 端口 0，通过 `PULSEBAR_DAEMON_READY` 把端口、auth token 和 protocol version 交给 UI 进程。
