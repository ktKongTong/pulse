# PulseBar Windows tray shell

`windowsApp` is the WinUI 3 tray-only shell for the Windows client. It uses
[`H.NotifyIcon.WinUI`](https://github.com/HavenDV/H.NotifyIcon) rather than a
hand-written `Shell_NotifyIcon` implementation.

## Current slice

- Startup creates a temporary WinUI host `Window` only to load `TrayHostView`; it is removed from the app switcher and hidden after initialization, so no normal app window or taskbar entry remains.
- `TrayHostView` owns a `TaskbarIcon` inside a loaded WinUI visual tree, matching H.NotifyIcon's WinUI sample. `StatusPopover` is declared inline as `TaskbarIcon.TrayPopup`, so the library creates its dedicated popup window during XAML initialization.
- Left-clicking the notification-area icon opens `TaskbarIcon.TrayPopup`.
- `Runtime/StatusPopover` mirrors the macOS panel's current-focus, media, and five-row
  daily-usage layout. Its values are static reference data until the Windows runtime
  exports matching media and usage snapshots.

The former hidden 1×1 host window, `GetCursorPos` placement, manually subclassed
WndProc, and dashboard-style Runtime/Debug popup have been removed. The IPC types
in `Runtime/` remain as infrastructure, but are not yet bound to this initial UI.

## Run on Windows ARM64

```powershell
dotnet restore .\windowsApp\PulseBar.Windows.csproj
dotnet run --project .\windowsApp\PulseBar.Windows.csproj -c Debug -p:Platform=ARM64 -r win-arm64
```

Validate that the icon appears in the notification area, left-click opens the
Popover, outside-click dismisses it, and a second left-click reopens it. While the
app has no context menu, stop a development run with Ctrl+C. Details
and the retained/removed experiment assessment are in
[`docs/desktop-app/decisions/windows-tray-popover.md`](../docs/desktop-app/decisions/windows-tray-popover.md).
