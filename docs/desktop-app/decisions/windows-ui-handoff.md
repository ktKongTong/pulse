# Windows UI / Tray Popover 交接记录

归属：`windowsApp`、`flowIpcDemo`
代码范围：`windowsApp/MainWindow.*`、`windowsApp/Runtime/RuntimePanelView.*`、`windowsApp/Runtime/TrayIconService.cs`
状态：superseded
验证：历史记录；替代实现见 [Windows Tray Popover implementation](./windows-tray-popover.md)。

## 已取代说明

此记录中的手写 tray 与隐藏 host-window `Flyout` 方案已被移除，改用
`H.NotifyIcon.WinUI` 的 `TaskbarIcon.TrayPopup`。它仅保留为实验审计材料，不能
作为后续实现指引。

## 1. 历史交接结论

本阶段的 IPC、Kotlin daemon、foreground app 事件和日志链路已经可以工作。当前未完成的是 Windows UI shell：需要把它实现成类似 macOS `NSPopover` / OneDrive tray panel 的 transient Flyout，而不是普通主窗口。

后续维护者必须把下面的产品约束当作硬约束：

- PulseBar 启动后不显示普通主窗口。
- tray 是唯一的显示入口。
- 点击 tray 后展示一个紧凑的 panel。
- 点击 panel 外部后自动 dismiss。
- panel 是 transient UI，不是应用主窗口，不进入任务栏，不提供普通窗口生命周期语义。
- panel 内保留左侧 sidebar；不要改成横向 tab。
- panel 的 Runtime / Debug 展示内容需要是新设计的 panel UI，不要把旧 `MainWindow` 当作用户界面继续堆补丁。

## 2. 当前代码结构

### 2.1 Host

`windowsApp/MainWindow.xaml` 当前只包含一个 1×1 的 `HostRoot`：

```xml
<Grid x:Name="HostRoot" Width="1" Height="1" Background="Transparent" />
```

`windowsApp/MainWindow.xaml.cs` 当前职责是：

- 创建 `RuntimePanelView`；
- 创建 WinUI `Flyout`；
- 用隐藏 host window 为 Flyout 提供 XAML visual tree；
- tray click 时把 host 移到鼠标位置并显示 Flyout；
- Flyout 关闭后隐藏 host；
- 关闭应用时 dispose panel view。

它不应该重新承载 Runtime / Debug 页面。

### 2.2 新 panel

真正的 panel 内容在：

```text
windowsApp/Runtime/RuntimePanelView.xaml
windowsApp/Runtime/RuntimePanelView.xaml.cs
```

当前包含：

- 左侧 sidebar：`Runtime`、`Debug`；
- Runtime 页面：当前前台应用、runtime revision、platform events、连接状态、配置编辑；
- Debug 页面：runtime snapshot、command/event feed、live log；
- `RuntimeAdapter` 订阅；
- `FrontmostAppWatcher`；
- 日志刷新。

### 2.3 Tray

`windowsApp/Runtime/TrayIconService.cs` 使用 Win32 `Shell_NotifyIcon` 注册 notification-area icon。

当前只处理左键点击并调用：

```text
MainWindow.ShowPanelFromTray()
```

没有引入 WinForms/WPF。之前尝试加入 `UseWindowsForms`，导致 WinUI XAML 构建触发 `MC6000`，已撤销。

## 3. 当前 Flyout 方案

WinUI 3 没有可以直接绑定 Windows notification-area icon 的 XAML `Flyout` anchor，因为 tray icon 不是 `FrameworkElement`。当前采用的合理折中是：

```text
tray icon
  -> hidden 1×1 host window
  -> Flyout.ShowAt(HostRoot)
  -> RuntimePanelView
```

`Flyout` 使用：

```csharp
LightDismissOverlayMode = LightDismissOverlayMode.Off
```

由 WinUI Flyout 的 light-dismiss 机制负责外部点击关闭；`Flyout.Closed` 再隐藏 1×1 host。

不要重新添加以下方案：

- 把 `MainWindow` 当作用户面板；
- 直接显示普通 `Window`；
- 用 `WS_POPUP` / `WS_EX_TOOLWINDOW` / `SetWindowLongPtr` 模拟 popover；
- 用 `WM_ACTIVATEAPP` 替代 Flyout light-dismiss；
- 把 sidebar 改成顶部横向 tab。

## 4. 已遇到并修复的问题

### 4.1 无效 Symbol 导致窗口完全不显示

旧 XAML 使用：

```xml
Icon="DeveloperTools"
```

WinUI 3 无法解析该 Symbol，已移除图标。

### 4.2 相对 OutDir 造成递归路径

曾使用：

```powershell
-p:OutDir=build\windows-ui-startup-diagnostic-final\
```

后续 `dotnet run` 把该路径折叠进 `bin`，产生多层递归目录并触发 260 字符限制。已清理：

```text
windowsApp/bin
windowsApp/obj
windowsApp/build
```

隔离构建必须使用短绝对路径，例如：

```powershell
dotnet build .\windowsApp\PulseBar.Windows.csproj `
  -c Debug `
  -p:Platform=ARM64 `
  -r win-arm64 `
  --no-restore `
  -p:UseAppHost=false `
  -p:SelfContained=false `
  -p:OutDir=C:\pulsebar-build\
```

### 4.3 资源字典自引用

根 Grid 曾在自身资源字典定义前引用：

```xml
Background="{StaticResource WindowBackgroundBrush}"
```

已改为直接颜色值，避免 XAML 初始化阶段找不到资源。

### 4.4 `RuntimePanelView` 初始化期间的 SelectionChanged 崩溃

最新一次实机日志显示：

```text
XamlParseException: XAML parsing failed
NullReferenceException
RuntimePanelView.SidebarList_SelectionChanged
```

原因是：

```xml
IsSelected="True"
```

在 `InitializeComponent()` 期间触发 `SelectionChanged`，而 `RuntimePanel`、`DebugPanel`、`PageTitle` 和 `PageSubtitle` 尚未初始化。

当前已在 handler 开头加入 null guard，并在控件完整初始化后才允许应用 sidebar selection。

该修复已通过 ARM64 build，但尚未进行新的 Windows 实机启动确认。

## 5. 最新验证状态

最近一次成功构建：

```powershell
dotnet build .\windowsApp\PulseBar.Windows.csproj `
  -c Debug `
  -p:Platform=ARM64 `
  -r win-arm64 `
  --no-restore `
  -p:UseAppHost=false `
  -p:SelfContained=false `
  -p:OutDir=C:\pulsebar-build\
```

结果：

```text
Build succeeded
C:\pulsebar-build\PulseBar.Windows.dll
```

最近一次实机运行是在 selection guard 修复之前，因此日志中的 XAML failure 不能代表当前代码仍然失败。下一位必须重新启动验证，不要只看旧日志。

## 6. 下一步验证清单

1. 关闭旧的 `PulseBar.Windows` 进程。
2. 清理或区分旧日志时间段。
3. 使用默认 `dotnet run`：

```powershell
dotnet run --project .\windowsApp\PulseBar.Windows.csproj `
  -c Debug `
  -p:Platform=ARM64 `
  -r win-arm64 `
  --no-restore
```

4. 确认启动后没有普通窗口，只出现 tray icon。
5. 点击 tray icon，确认 `RuntimePanelView` Flyout 出现。
6. 点击 panel 外部，确认 Flyout 消失。
7. 再次点击 tray，确认可以重复显示。
8. 切换 sidebar 的 Runtime / Debug，确认内容切换，不是横向 tab。
9. 确认新日志包含：

```text
host.ready
tray.initialized
panel.show flyout
panel.hide reason=flyout_closed
```

10. 确认没有新的：

```text
XamlParseException
NullReferenceException
```

## 7. 不要继续扩展的内容

当前优先级不是：

- reconnect 策略；
- daemon crash recovery；
- jlink；
- 普通设置窗口；
- 继续美化旧 `MainWindow`；
- 把 panel 做成 dashboard；
- 增加更多卡片和统计指标。

当前唯一 UI 主线是：

```text
tray → WinUI Flyout → 新 RuntimePanelView → light dismiss
```
