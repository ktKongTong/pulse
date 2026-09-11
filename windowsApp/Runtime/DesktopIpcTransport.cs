using Grpc.Core;
using Grpc.Net.Client;
using System.Diagnostics;
using System.Net.Sockets;
using PulseBar.DesktopIpc.V1;

namespace PulseBar.Windows.Runtime;

/// <summary>
/// Transport-only owner for the Kotlin daemon process and DesktopRuntime gRPC session.
/// It knows wire messages and lifecycle mechanics, but not PulseBar business commands.
/// </summary>
public sealed class DesktopIpcTransport : IAsyncDisposable
{
    public const string ProtocolVersion = "desktop-ipc-v1";

    private readonly bool _autoStartDaemon;
    private readonly bool _autoReconnect;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _publishLock = new(1, 1);
    private Process? _daemonProcess;
    private DesktopEndpoint? _endpoint;
    private GrpcChannel? _channel;
    private DesktopRuntime.DesktopRuntimeClient? _client;
    private AsyncClientStreamingCall<PlatformEvent, PublishSummary>? _publishCall;
    private AsyncClientStreamingCall<UserCommand, PublishSummary>? _commandCall;
    private Task? _connectionTask;

    public DesktopIpcTransport(bool autoStartDaemon = true, bool autoReconnect = false)
    {
        _autoStartDaemon = autoStartDaemon;
        _autoReconnect = autoReconnect;
    }

    public bool IsConnected { get; private set; }

    public event Action<RuntimeStateSnapshot>? RuntimeSnapshotReceived;
    public event Action<PulseBar.DesktopIpc.V1.ConfigSnapshot>? ConfigSnapshotReceived;
    public event Action<PulseBar.DesktopIpc.V1.ConnectionStateSnapshot>? ConnectionSnapshotReceived;
    public event Action<bool, string?>? ConnectionChanged;

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_connectionTask is not null && !_connectionTask.IsCompleted)
        {
            await WaitForConnectionAsync(cancellationToken);
            return;
        }

        cancellationToken.ThrowIfCancellationRequested();
        var connected = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        _connectionTask = RunConnectionLoopAsync(connected, _lifetime.Token);

        try
        {
            await connected.Task.WaitAsync(TimeSpan.FromMinutes(3), cancellationToken);
        }
        catch
        {
            throw;
        }
    }

    public async Task WaitForSessionEndAsync(CancellationToken cancellationToken = default)
    {
        if (_connectionTask is null)
        {
            return;
        }

        await _connectionTask.WaitAsync(cancellationToken);
    }

    public async Task PublishPlatformEventAsync(
        PlatformEvent message,
        CancellationToken cancellationToken = default)
    {
        var publishCall = _publishCall;
        if (publishCall is null || !IsConnected)
        {
            throw new InvalidOperationException("The runtime is not connected.");
        }

        var authenticatedMessage = message.Clone();
        authenticatedMessage.AuthToken = _endpoint?.AuthToken ??
            throw new InvalidOperationException("The runtime is not connected.");

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            _lifetime.Token,
            cancellationToken);
        await _publishLock.WaitAsync(linked.Token);
        try
        {
            await publishCall.RequestStream.WriteAsync(authenticatedMessage);
        }
        finally
        {
            _publishLock.Release();
        }
    }

    public async Task PublishUserCommandAsync(
        UserCommand message,
        CancellationToken cancellationToken = default)
    {
        var commandCall = _commandCall;
        if (commandCall is null || !IsConnected)
        {
            throw new InvalidOperationException("The runtime is not connected.");
        }

        var authenticatedMessage = message.Clone();
        authenticatedMessage.AuthToken = _endpoint?.AuthToken ??
            throw new InvalidOperationException("The runtime is not connected.");

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            _lifetime.Token,
            cancellationToken);
        await _publishLock.WaitAsync(linked.Token);
        try
        {
            await commandCall.RequestStream.WriteAsync(authenticatedMessage);
        }
        finally
        {
            _publishLock.Release();
        }
    }

    private async Task WaitForConnectionAsync(CancellationToken cancellationToken)
    {
        while (!IsConnected)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await Task.Delay(TimeSpan.FromMilliseconds(50), cancellationToken);
        }
    }

    private async Task RunConnectionLoopAsync(
        TaskCompletionSource<bool> connected,
        CancellationToken cancellationToken)
    {
        var firstAttempt = true;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var endpoint = await EnsureDaemonAsync(cancellationToken);
                    await RunSessionAsync(endpoint, connected, cancellationToken);
                    firstAttempt = false;
                    if (!_autoReconnect)
                    {
                        break;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception error)
                {
                    if (!connected.Task.IsCompleted)
                    {
                        connected.TrySetException(error);
                    }
                    else
                    {
                        ConnectionChanged?.Invoke(false, error.Message);
                    }

                    if (!_autoReconnect || (firstAttempt && !_autoStartDaemon))
                    {
                        break;
                    }
                }

                IsConnected = false;
                ConnectionChanged?.Invoke(false, null);
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            }
        }
        finally
        {
            IsConnected = false;
            connected.TrySetCanceled(cancellationToken);
            await DisposeSessionAsync();
        }
    }

    private async Task RunSessionAsync(
        DesktopEndpoint endpoint,
        TaskCompletionSource<bool> connected,
        CancellationToken cancellationToken)
    {
        _endpoint = endpoint;
        _channel = GrpcChannel.ForAddress(endpoint.Address);
        _client = new DesktopRuntime.DesktopRuntimeClient(_channel);
        _publishCall = _client.PublishPlatformEvents(cancellationToken: cancellationToken);
        _commandCall = _client.PublishUserCommands(cancellationToken: cancellationToken);

        _ = WatchConfigAsync(endpoint, cancellationToken);
        _ = WatchConnectionStateAsync(endpoint, cancellationToken);

        try
        {
            using var watch = _client.WatchRuntimeState(
                CreateWatchRequest(endpoint),
                cancellationToken: cancellationToken);

            IsConnected = true;
            connected.TrySetResult(true);
            ConnectionChanged?.Invoke(true, null);

            await foreach (var snapshot in watch.ResponseStream.ReadAllAsync(cancellationToken))
            {
                RuntimeSnapshotReceived?.Invoke(snapshot);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (RpcException error)
        {
            throw new InvalidOperationException(
                $"Desktop IPC stream failed: {error.Status.Detail}", error);
        }
        finally
        {
            await DisposeSessionAsync();
        }
    }

    private async Task<DesktopEndpoint> EnsureDaemonAsync(
        CancellationToken cancellationToken)
    {
        if (_daemonProcess is { HasExited: false } && _endpoint is not null &&
            await IsReachableAsync(_endpoint.Port, cancellationToken))
        {
            return _endpoint;
        }

        if (!_autoStartDaemon)
        {
            throw new InvalidOperationException("Kotlin daemon is not running.");
        }

        await StopDaemonAsync();
        var repositoryRoot = FindRepositoryRoot();
        if (repositoryRoot is null)
        {
            throw new InvalidOperationException(
                "Could not locate the repository root containing gradlew.bat.");
        }

        _daemonProcess = Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/d /c gradlew.bat :flowIpcDemo:runDaemon --no-daemon",
            WorkingDirectory = repositoryRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        });

        if (_daemonProcess is null)
        {
            throw new InvalidOperationException("Failed to start the Kotlin daemon process.");
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            _lifetime.Token,
            cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(3));

        while (!timeout.IsCancellationRequested)
        {
            if (_daemonProcess.HasExited)
            {
                var error = await _daemonProcess.StandardError.ReadToEndAsync();
                throw new InvalidOperationException(
                    $"Kotlin daemon exited before handshake ({_daemonProcess.ExitCode}). {error}");
            }

            var line = await _daemonProcess.StandardOutput.ReadLineAsync(timeout.Token);
            if (line is null)
            {
                continue;
            }

            if (TryParseHandshake(line, out var endpoint))
            {
                _endpoint = endpoint;
                _ = DrainDaemonOutputAsync(_daemonProcess.StandardOutput, "daemon.stdout", cancellationToken);
                _ = DrainDaemonOutputAsync(_daemonProcess.StandardError, "daemon.stderr", cancellationToken);
                RuntimeLog.Info($"daemon.handshake port={endpoint.Port} protocol={ProtocolVersion}");
                return endpoint;
            }
        }

        throw new TimeoutException("Timed out waiting for the Kotlin daemon handshake.");
    }

    private static async Task DrainDaemonOutputAsync(
        StreamReader reader,
        string source,
        CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    return;
                }

                RuntimeLog.Info($"{source} {line}");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException)
        {
        }
        catch (Exception error)
        {
            RuntimeLog.Error($"{source}.drain_failed", error);
        }
    }

    private async Task WatchConfigAsync(
        DesktopEndpoint endpoint,
        CancellationToken cancellationToken)
    {
        if (_client is null)
        {
            return;
        }

        try
        {
            using var call = _client.WatchConfig(
                CreateWatchRequest(endpoint),
                cancellationToken: cancellationToken);
            await foreach (var snapshot in call.ResponseStream.ReadAllAsync(cancellationToken))
            {
                ConfigSnapshotReceived?.Invoke(snapshot);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (RpcException error)
        {
            ConnectionChanged?.Invoke(false, $"Config stream failed: {error.Status.Detail}");
        }
    }

    private async Task WatchConnectionStateAsync(
        DesktopEndpoint endpoint,
        CancellationToken cancellationToken)
    {
        if (_client is null)
        {
            return;
        }

        try
        {
            using var call = _client.WatchConnectionState(
                CreateWatchRequest(endpoint),
                cancellationToken: cancellationToken);
            await foreach (var snapshot in call.ResponseStream.ReadAllAsync(cancellationToken))
            {
                ConnectionSnapshotReceived?.Invoke(snapshot);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (RpcException error)
        {
            ConnectionChanged?.Invoke(false, $"Connection stream failed: {error.Status.Detail}");
        }
    }

    private WatchRequest CreateWatchRequest(DesktopEndpoint endpoint) => new()
    {
        ProtocolVersion = ProtocolVersion,
        AuthToken = endpoint.AuthToken,
    };

    private async Task DisposeSessionAsync()
    {
        if (_commandCall is not null)
        {
            try
            {
                await _commandCall.RequestStream.CompleteAsync();
                await _commandCall.ResponseAsync;
            }
            catch (Exception)
            {
            }
            finally
            {
                _commandCall.Dispose();
                _commandCall = null;
            }
        }

        if (_publishCall is not null)
        {
            try
            {
                await _publishCall.RequestStream.CompleteAsync();
                await _publishCall.ResponseAsync;
            }
            catch (Exception)
            {
            }
            finally
            {
                _publishCall.Dispose();
                _publishCall = null;
            }
        }

        _client = null;
        _channel?.Dispose();
        _channel = null;
    }

    private async Task StopDaemonAsync()
    {
        if (_daemonProcess is null)
        {
            return;
        }

        if (!_daemonProcess.HasExited)
        {
            try
            {
                _daemonProcess.Kill(entireProcessTree: true);
                await _daemonProcess.WaitForExitAsync();
            }
            catch (InvalidOperationException)
            {
            }
        }

        _daemonProcess.Dispose();
        _daemonProcess = null;
        _endpoint = null;
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();

        if (_connectionTask is not null)
        {
            try
            {
                await _connectionTask;
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception)
            {
            }
        }

        await DisposeSessionAsync();
        await StopDaemonAsync();
        _publishLock.Dispose();
        _lifetime.Dispose();
    }

    private static string? FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "gradlew.bat")) &&
                Directory.Exists(Path.Combine(directory.FullName, "flowIpcDemo")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        return null;
    }

    private static async Task<bool> IsReachableAsync(
        int port,
        CancellationToken cancellationToken)
    {
        using var client = new TcpClient();
        using var probe = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        probe.CancelAfter(TimeSpan.FromMilliseconds(500));

        try
        {
            await client.ConnectAsync("127.0.0.1", port, probe.Token);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private static bool TryParseHandshake(string line, out DesktopEndpoint endpoint)
    {
        endpoint = default!;
        const string prefix = "PULSEBAR_DAEMON_READY ";
        if (!line.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var values = line[prefix.Length..]
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => parts[0], parts => parts[1]);

        if (!values.TryGetValue("port", out var portValue) ||
            !int.TryParse(portValue, out var port) ||
            !values.TryGetValue("token", out var token) ||
            !values.TryGetValue("protocol", out var protocol) ||
            protocol != ProtocolVersion)
        {
            return false;
        }

        endpoint = new DesktopEndpoint(
            $"http://127.0.0.1:{port}",
            port,
            token);
        return true;
    }

    private sealed record DesktopEndpoint(string Address, int Port, string AuthToken);
}
