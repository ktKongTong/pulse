using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PulseBar.Windows.Runtime;

/// <summary>
/// Publishes real Windows foreground-window changes.
/// The callback only extracts a process identity; business handling remains in RuntimeAdapter/Kotlin.
/// </summary>
public sealed class FrontmostAppWatcher : IDisposable
{
    private const uint EventSystemForeground = 0x0003;
    private const uint WinEventOutOfContext = 0x0000;

    private readonly WinEventDelegate _callback;
    private IntPtr _hook;
    private string? _lastAppId;

    public FrontmostAppWatcher()
    {
        _callback = HandleForegroundChanged;
    }

    public event Action<string>? AppChanged;

    public void Start()
    {
        if (_hook != IntPtr.Zero)
        {
            return;
        }

        _hook = SetWinEventHook(
            EventSystemForeground,
            EventSystemForeground,
            IntPtr.Zero,
            _callback,
            0,
            0,
            WinEventOutOfContext);
        if (_hook == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                $"SetWinEventHook failed with Win32 error {Marshal.GetLastWin32Error()}.");
        }

        RuntimeLog.Info("platform.frontmost.started");
        PublishCurrentForegroundWindow();
    }

    private void HandleForegroundChanged(
        IntPtr hook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint eventThread,
        uint eventTime)
    {
        PublishForegroundWindow(hwnd);
    }

    private void PublishCurrentForegroundWindow()
    {
        PublishForegroundWindow(GetForegroundWindow());
    }

    private void PublishForegroundWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero ||
            GetWindowThreadProcessId(hwnd, out var processId) == 0 ||
            processId == 0)
        {
            return;
        }

        string appId;
        try
        {
            using var process = Process.GetProcessById((int)processId);
            appId = process.ProcessName;
        }
        catch (Exception error)
        {
            RuntimeLog.Error($"platform.frontmost.resolve_failed pid={processId}", error);
            return;
        }

        if (string.Equals(_lastAppId, appId, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _lastAppId = appId;
        RuntimeLog.Info($"platform.frontmost.changed app={appId} pid={processId}");
        AppChanged?.Invoke(appId);
    }

    public void Dispose()
    {
        if (_hook == IntPtr.Zero)
        {
            return;
        }

        UnhookWinEvent(_hook);
        _hook = IntPtr.Zero;
        RuntimeLog.Info("platform.frontmost.stopped");
    }

    private delegate void WinEventDelegate(
        IntPtr hook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint eventThread,
        uint eventTime);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventDelegate lpfnWinEventProc,
        uint idProcess,
        uint idThread,
        uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr hwnd,
        out uint processId);
}
