using PulseBar.DesktopIpc.V1;
using IpcConfigSnapshot = PulseBar.DesktopIpc.V1.ConfigSnapshot;
using IpcConnectionStateSnapshot = PulseBar.DesktopIpc.V1.ConnectionStateSnapshot;

namespace PulseBar.Windows.Runtime;

public sealed record RuntimeSnapshot(
    ulong Revision,
    ulong TickCount,
    string FrontmostApp,
    uint PlatformEventCount);

public sealed record ConfigSnapshot(
    ulong Revision,
    string Url,
    string DeviceId,
    string ApiKey,
    bool Enabled,
    uint IdleThresholdSeconds,
    uint ChangeStabilityMillis);

public sealed record ConnectionSnapshot(
    ulong Revision,
    string Phase,
    string Url,
    bool Enabled,
    ulong ReconnectCount,
    uint ReconnectAttempt,
    string LastErrorMessage);

/// <summary>
/// PulseBar domain adapter over the transport-only DesktopIpcTransport.
/// It maps stable PulseBar snapshots and commands without owning business rules.
/// </summary>
public sealed class RuntimeAdapter : IAsyncDisposable
{
    private readonly RuntimeConnection _connection;
    private RuntimeSnapshot? _snapshot;

    public RuntimeAdapter(bool autoStartDaemon = true)
    {
        _connection = new RuntimeConnection(autoStartDaemon);
        _connection.RuntimeSnapshotReceived += ApplyRuntimeSnapshot;
        _connection.ConfigSnapshotReceived += ApplyConfigSnapshot;
        _connection.ConnectionSnapshotReceived += ApplyConnectionSnapshot;
        _connection.ConnectionChanged += (connected, error) =>
            ConnectionChanged?.Invoke(connected, error);
    }

    public bool IsConnected => _connection.IsConnected;

    public RuntimeSnapshot? Snapshot => _snapshot;

    public event Action<RuntimeSnapshot>? SnapshotChanged;
    public event Action<ConfigSnapshot>? ConfigChanged;
    public event Action<ConnectionSnapshot>? ConnectionSnapshotChanged;
    public event Action<bool, string?>? ConnectionChanged;

    public Task ConnectAsync(CancellationToken cancellationToken = default) =>
        _connection.ConnectAsync(cancellationToken);

    public async Task UpdateConfigAsync(
        string url,
        string deviceId,
        string apiKey,
        bool enabled,
        uint idleThresholdSeconds,
        uint changeStabilityMillis,
        CancellationToken cancellationToken = default)
    {
        RuntimeLog.Info(
            $"command.send type=UpdateConfig url={url} device={deviceId} enabled={enabled} " +
            $"idleSeconds={idleThresholdSeconds} stabilityMillis={changeStabilityMillis} apiKeyPresent={!string.IsNullOrEmpty(apiKey)}");
        await _connection.PublishUserCommandAsync(
            new UserCommand
            {
                UpdateConfig = new UpdateConfig
                {
                    Url = url,
                    DeviceId = deviceId,
                    ApiKey = apiKey,
                    Enabled = enabled,
                    IdleThresholdSeconds = idleThresholdSeconds,
                    ChangeStabilityMillis = changeStabilityMillis,
                },
            },
            cancellationToken);
        RuntimeLog.Info("command.sent type=UpdateConfig");
    }

    public async Task ConnectEndpointAsync(CancellationToken cancellationToken = default)
    {
        RuntimeLog.Info("command.send type=Connect");
        await _connection.PublishUserCommandAsync(
            new UserCommand { Connect = new Connect() },
            cancellationToken);
        RuntimeLog.Info("command.sent type=Connect");
    }

    public async Task DisconnectEndpointAsync(CancellationToken cancellationToken = default)
    {
        RuntimeLog.Info("command.send type=Disconnect");
        await _connection.PublishUserCommandAsync(
            new UserCommand { Disconnect = new Disconnect() },
            cancellationToken);
        RuntimeLog.Info("command.sent type=Disconnect");
    }

    public async Task PublishFrontmostAppAsync(
        string appId,
        CancellationToken cancellationToken = default)
    {
        RuntimeLog.Info($"event.send type=FrontmostAppChanged app={appId}");
        await _connection.PublishPlatformEventAsync(
            new PlatformEvent
            {
                FrontmostAppChanged = new FrontmostAppChanged { AppId = appId },
            },
            cancellationToken);
        RuntimeLog.Info($"event.sent type=FrontmostAppChanged app={appId}");
    }

    public ValueTask DisposeAsync() => _connection.DisposeAsync();

    private void ApplyRuntimeSnapshot(RuntimeStateSnapshot snapshot)
    {
        _snapshot = new RuntimeSnapshot(
            snapshot.Revision,
            snapshot.TickCount,
            snapshot.FrontmostApp,
            snapshot.PlatformEventCount);
        RuntimeLog.Info(
            $"snapshot.recv type=RuntimeState revision={snapshot.Revision} app={snapshot.FrontmostApp} events={snapshot.PlatformEventCount}");
        SnapshotChanged?.Invoke(_snapshot);
    }

    private void ApplyConfigSnapshot(IpcConfigSnapshot snapshot)
    {
        RuntimeLog.Info(
            $"snapshot.recv type=Config revision={snapshot.Revision} url={snapshot.Url} device={snapshot.DeviceId} enabled={snapshot.Enabled}");
        ConfigChanged?.Invoke(new ConfigSnapshot(
            snapshot.Revision,
            snapshot.Url,
            snapshot.DeviceId,
            snapshot.ApiKey,
            snapshot.Enabled,
            snapshot.IdleThresholdSeconds,
            snapshot.ChangeStabilityMillis));
    }

    private void ApplyConnectionSnapshot(IpcConnectionStateSnapshot snapshot)
    {
        RuntimeLog.Info(
            $"snapshot.recv type=Connection revision={snapshot.Revision} phase={snapshot.Phase} enabled={snapshot.Enabled} " +
            $"reconnectCount={snapshot.ReconnectCount} errorPresent={!string.IsNullOrWhiteSpace(snapshot.LastErrorMessage)}");
        ConnectionSnapshotChanged?.Invoke(new ConnectionSnapshot(
            snapshot.Revision,
            snapshot.Phase,
            snapshot.Url,
            snapshot.Enabled,
            snapshot.ReconnectCount,
            snapshot.ReconnectAttempt,
            snapshot.LastErrorMessage));
    }
}
