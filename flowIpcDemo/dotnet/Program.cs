// FlowIpcDemo.Client: validates the "Kotlin Flow <-> .NET async stream" story
// of the dual-process plan against the demo daemon (`./gradlew :flowIpcDemo:runDaemon`).
//
// This is a plain console app on purpose: everything here is exactly the code
// a WinUI3 store adapter would contain, minus DispatcherQueue marshalling.

using Grpc.Core;
using Grpc.Net.Client;
using PulseBar.FlowIpc.V1;

const string DaemonAddress = "http://127.0.0.1:56180";

Console.WriteLine($"[client] connecting to {DaemonAddress}");
using var channel = GrpcChannel.ForAddress(DaemonAddress);
var client = new FlowBridgeDemo.FlowBridgeDemoClient(channel);

// 1. Kotlin StateFlow -> IAsyncEnumerable, consumed with `await foreach`
//    (the C# analog of Swift's `for await` over the exported AsyncSequence).
using var watchCts = new CancellationTokenSource();
var watchTask = WatchRuntimeStateAsync("watch-1", watchCts.Token);

await Task.Delay(TimeSpan.FromSeconds(3));

// 2. .NET -> Kotlin: platform events as a client stream; the Kotlin handler
//    receives them as a plain Flow<PlatformEvent>.
Console.WriteLine("[client] publishing 3 platform events (watch-1 should reflect them)");
using var publish = client.PublishPlatformEvents();
string[] apps = ["com.microsoft.vscode", "org.mozilla.firefox", "com.jetbrains.rider"];
foreach (var app in apps)
{
    await publish.RequestStream.WriteAsync(new PlatformEvent
    {
        FrontmostAppChanged = new FrontmostAppChanged { AppId = app },
    });
    await Task.Delay(TimeSpan.FromSeconds(1.5));
}
await publish.RequestStream.CompleteAsync();
var summary = await publish;
Console.WriteLine($"[client] daemon accepted {summary.AcceptedEvents} events");

await Task.Delay(TimeSpan.FromSeconds(3));

// 3. Cancellation: CancellationToken -> gRPC cancel -> Kotlin coroutine
//    cancellation. The daemon logs "subscriber detached (cause=...)".
Console.WriteLine("[client] cancelling watch-1 (check the daemon log)");
watchCts.Cancel();
await watchTask;

// 4. Snapshot-first: a fresh subscriber's first item is already the latest
//    state — the explicit-contract replacement for StateFlow replay.
using (var snapshot = client.WatchRuntimeState(new WatchRuntimeStateRequest()))
{
    await foreach (var state in snapshot.ResponseStream.ReadAllAsync())
    {
        Console.WriteLine(
            $"[watch-2] first item already carries latest state: rev={state.Revision} app={state.FrontmostApp} events={state.PlatformEventCount}");
        break; // Disposing the call cancels the stream.
    }
}

Console.WriteLine("[client] demo complete");
return;

async Task WatchRuntimeStateAsync(string label, CancellationToken ct)
{
    try
    {
        using var call = client.WatchRuntimeState(new WatchRuntimeStateRequest(), cancellationToken: ct);
        await foreach (var state in call.ResponseStream.ReadAllAsync(ct))
        {
            Console.WriteLine(
                $"[{label}] rev={state.Revision} ticks={state.TickCount} app={state.FrontmostApp} events={state.PlatformEventCount}");
        }
    }
    catch (OperationCanceledException)
    {
        Console.WriteLine($"[{label}] cancelled (expected)");
    }
    catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
    {
        Console.WriteLine($"[{label}] cancelled (expected)");
    }
}
