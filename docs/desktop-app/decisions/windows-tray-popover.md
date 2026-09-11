# Windows Tray Popover implementation

归属：`windowsApp`
代码范围：`windowsApp/App.*`、`windowsApp/Runtime/TrayHostView.*`、`windowsApp/Runtime/StatusPopover.*`
状态：active
验证：必须运行 Windows ARM64 shell，确认 popup `Loaded` 日志和 tray 的 open/dismiss/reopen 路径。

## Decision

Windows 的 tray-only 壳层使用 `H.NotifyIcon.WinUI`，而不维护自己的
`Shell_NotifyIcon`、WndProc 子类化、光标坐标定位或伪造的窗口样式。

`TaskbarIcon` 必须是已加载 `TrayHostView` 的成员，而不是 `Application.Resources` 中的孤立资源（与 H.NotifyIcon 的 WinUI sample 一致）。`TrayPopup` 必须作为 `TaskbarIcon.TrayPopup` 的 XAML 子属性声明：库会在该属性变更时创建其专用的 WinUI popup window。host view 加载后仅调用 `ForceCreate()`，以创建 tray message window：

- 左键由 `PopupActivation="LeftClick"` 触发库的 `ShowTrayPopup`；
- 由库决定 notification-area 锚定、popup window 的测量、定位与 dismiss 生命周期；
- 应用启动时不创建普通 `Window`，因此不进入任务栏；
- `StatusPopover` 复用 macOS panel 的“当前应用 → 媒体 → 五项 usage”信息层级，不承担 Runtime/Debug dashboard 的职责；在 Windows runtime 导出对应 snapshots 前，内容明确是静态视觉预览。

## Previous experiment assessment

| 项目 | 处置 | 理由 |
| --- | --- | --- |
| gRPC proto、`DesktopIpcTransport`、`RuntimeConnection`、`RuntimeAdapter` | 保留 | JVM daemon 与 WinUI 壳层的进程边界和 domain 映射，与 tray 呈现无关。 |
| `FrontmostAppWatcher`、`RuntimeLog` | 保留 | 是 Windows-only 平台采集和诊断基础设施；等正式状态 adapter 接入 Popover 后再消费。 |
| `TrayIconService` | 移除 | 手写 `Shell_NotifyIcon` 和 WndProc 子类化重复实现成熟库已覆盖的职责。 |
| 1×1 `MainWindow`、`GetCursorPos`、`Flyout.ShowAt` | 移除 | 只是为 tray icon 不是 XAML element 而做的脆弱宿主模拟。 |
| `RuntimePanelView`（sidebar、Runtime/Debug、日志和配置表单） | 移除 | 过大的 dashboard 被塞进 transient popover，且使 IPC 调试逻辑和 UI 生命周期耦合。 |
| `MyWinUIApp` | 不纳入 Windows 客户端 | 是未接入 Pulse runtime 的模板项目；不得作为生产入口继续扩展。 |

## Runtime follow-up

本次仅验证 tray/popover 基础。保留的 IPC runtime 尚未绑定到
`StatusPopover`；不要为了显示静态 popup 而启动 daemon 或把调试表单重新放回
popover。后续应先定义一个小型、只读的 UI state adapter，再把连接状态和必要命令
接入该视图。

## Required manual verification

1. 启动后仅出现 PulseBar notification-area icon，没有普通窗口或任务栏条目。
2. 左键 tray icon 显示紧凑 `StatusPopover`，位置由 `H.NotifyIcon` 锚定。
3. 点击 popup 外部能 dismiss；再次左键可重新显示。
4. 退出进程后 tray icon 被释放。
