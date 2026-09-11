using PulseBar.DesktopIpc.V1;
using IpcConfigSnapshot = PulseBar.DesktopIpc.V1.ConfigSnapshot;
using IpcConnectionStateSnapshot = PulseBar.DesktopIpc.V1.ConnectionStateSnapshot;

namespace PulseBar.Windows.Runtime;

public enum RuntimeConnectionState
{
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Failed,
    Stopping,
}

/// <summary>
/// Owns connection policy above a single DesktopIpcTransport session.
/// It knows lifecycle policy, but not PulseBar business commands or snapshots.
/// </summary>
public sealed class RuntimeConnection : IAsyncDisposable
{
    private readonly DesktopIpcTransport _transport;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly bool _autoStartDaemon;
    private readonly TimeSpan _maximumBackoff = TimeSpan.FromSeconds(30);
    private Task? _runTask;

    public RuntimeConnection(bool autoStartDaemon = true)
    {
        _autoStartDaemon = autoStartDaemon;
        _transport = new DesktopIpcTransport(autoStartDaemon, autoReconnect: false);
        _transport.RuntimeSnapshotReceived += snapshot => RuntimeSnapshotReceived?.Invoke(snapshot);
        _transport.ConfigSnapshotReceived += snapshot => ConfigSnapshotReceived?.Invoke(snapshot);
        _transport.ConnectionSnapshotReceived += snapshot => ConnectionSnapshotReceived?.Invoke(snapshot);
        _transport.ConnectionChanged += (connected, error) =>
        {
            if (connected)
            {
                SetState(RuntimeConnectionState.Connected, null);
            }
            else if (CurrentState is not RuntimeConnectionState.Stopping)
            {
                ConnectionChanged?.Invoke(false, error);
            }
        };
    }

    public RuntimeConnectionState CurrentState { get; private set; } = RuntimeConnectionState.Disconnected;

    public bool IsConnected => _transport.IsConnected;

    public event Action<RuntimeStateSnapshot>? RuntimeSnapshotReceived;
    public event Action<IpcConfigSnapshot>? ConfigSnapshotReceived;
    public event Action<IpcConnectionStateSnapshot>? ConnectionSnapshotReceived;
    public event Action<bool, string?>? ConnectionChanged;
    public event Action<RuntimeConnectionState, string?>? StateChanged;

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_runTask is not null && !_runTask.IsCompleted)
        {
            await WaitForConnectionAsync(cancellationToken);
            return;
        }

        cancellationToken.ThrowIfCancellationRequested();
        SetState(RuntimeConnectionState.Connecting, null);
        _runTask = RunAsync(_lifetime.Token);
        await WaitForConnectionAsync(cancellationToken);
        if (!IsConnected)
        {
            throw new InvalidOperationException(
                "The Kotlin runtime could not be connected.");
        }
    }

    public Task PublishPlatformEventAsync(
        PlatformEvent message,
        CancellationToken cancellationToken = default) =>
        _transport.PublishPlatformEventAsync(message, cancellationToken);

    public Task PublishUserCommandAsync(
        UserCommand message,
        CancellationToken cancellationToken = default) =>
        _transport.PublishUserCommandAsync(message, cancellationToken);

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var attempt = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                if (attempt > 0)
                {
                    SetState(RuntimeConnectionState.Reconnecting, null);
                }

                await _transport.ConnectAsync(cancellationToken);
                if (!IsConnected)
                {
                    throw new InvalidOperationException("The IPC session ended before becoming connected.");
                }

                attempt = 0;
                await _transport.WaitForSessionEndAsync(cancellationToken);

                if (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                attempt = 1;
                SetState(RuntimeConnectionState.Reconnecting, null);
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                attempt++;
                SetState(
                    attempt == 1 ? RuntimeConnectionState.Failed : RuntimeConnectionState.Reconnecting,
                    error.Message);

                if (!_autoStartDaemon && attempt == 1)
                {
                    break;
                }

                var delay = TimeSpan.FromSeconds(Math.Min(1 << Math.Min(attempt - 1, 4), 30));
                await Task.Delay(delay > _maximumBackoff ? _maximumBackoff : delay, cancellationToken);
            }
        }

        if (CurrentState is not RuntimeConnectionState.Stopping)
        {
            SetState(RuntimeConnectionState.Disconnected, null);
        }
    }

    private async Task WaitForConnectionAsync(CancellationToken cancellationToken)
    {
        while (!IsConnected)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_runTask is { IsCompleted: true })
            {
                await _runTask;
                return;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(50), cancellationToken);
        }
    }

    private void SetState(RuntimeConnectionState state, string? error)
    {
        CurrentState = state;
        StateChanged?.Invoke(state, error);
        ConnectionChanged?.Invoke(state == RuntimeConnectionState.Connected, error);
    }

    public async ValueTask DisposeAsync()
    {
        SetState(RuntimeConnectionState.Stopping, null);
        _lifetime.Cancel();

        if (_runTask is not null)
        {
            try
            {
                await _runTask;
            }
            catch (OperationCanceledException)
            {
            }
        }

        await _transport.DisposeAsync();
        _lifetime.Dispose();
        CurrentState = RuntimeConnectionState.Disconnected;
    }
}
