# Pulse macOS Tray-Only Preferences Plan

归属：`macosApp`
代码范围：`macosApp/PulseBarNative`、`macosApp/project.yml`、`docs/desktop-app`
状态：active
验证：Xcode app UI build/run；涉及 KMP bridge 时再跑 `pnpm check:native`

## Goal

Pulse macOS app should behave as a menu bar only utility. Launching the app shows
only the menu bar status item, does not occupy the Dock, and does not open a main
dashboard window. Configuration lives in an on-demand, dialog-style Preferences
window opened from the status item's right-click menu. The Preferences window
matches the provided macOS reference: title `PulseBar 设置`, a centered
`通用 / 报告` segmented control, and no sidebar/dashboard navigation.
The window is a compact settings popup, not a dashboard-sized canvas.

## Product Behavior

- Launch shows a menu bar icon and no Dock/app switcher icon.
- Menu bar icon dynamically reflects runtime state:
  - Default/online: standard waveform icon
  - Offline/error: dimmed / error dot indicator
  - Streaming active: highlighted / active waveform animation
- Left click on the menu bar icon opens the compact status/media panel (`MenuBarContentView`).
  - Panel header includes:
    - **Connection status icon**: icon-sized indicator colored by state (green = connected, yellow = connecting/reconnecting, red = error, gray = disabled). Hover shows detailed error reason and a **Retry** action button.
    - **Audio stream kill switch**: icon button showing streaming state; clicking it immediately stops/disallows audio streaming without digging into Settings.
  - **Media section**: pure display card without playback seek control. The progress bar (`MediaSeekBar`) is removed, and overall media component height is tightly controlled.
- Right click on the menu bar icon shows only:
  - `Settings...`
  - `Quit`
- `Settings...` opens the Preferences window:
  - `通用` tab: `连接`、`启动`、`音频`
  - `报告` tab: `Application rules` with **Default Whitelist** semantics (only explicitly enabled apps are tracked/reported; non-whitelisted apps are completely ignored).
- `Quit` exits the app.
- There is no right-click `Stop Listening` / `Start Listening` item.
- Existing startup runtime behavior stays unchanged: `monitor.start()` and the
  current audio permission request timing remain as-is for this refactor.

## Implementation Changes

- Replace the app's launch dashboard scene with a SwiftUI `Settings` scene and
  an AppKit-created Preferences window for the status-item menu action.
- Replace the sidebar/dashboard shell with a dialog-style Preferences surface:
  - `通用` tab: `连接`、`启动`、`音频`
  - `报告` tab: `Application rules` with search filter and default whitelist logic.
- Main panel (`MenuBarContentView`) improvements:
  - Add connection status indicator icon button with state colors, hover tooltip showing error details, and an inline retry button.
  - Add audio stream kill switch icon button in the panel header to immediately stop streaming.
  - Remove `MediaSeekBar` from `MenuBarContentView` and downsize the media component to a compact, display-only card.
- Dynamic menu bar status item:
  - Update `StatusItemController` to observe connection and streaming states and switch icon/tint accordingly.
- Reporting default whitelist:
  - Only report apps explicitly checked in the whitelist. Non-whitelisted apps do not produce events or usage rows.
- Keep Preferences sizing and spacing close to macOS System Settings density:
  - default window around `560 x 480`
  - minimum content around `520 x 420`
  - compact grouped rows and section gaps, not dashboard-scale whitespace
- `通用 / 连接` is read-oriented by default:
  - show current connection status
  - show only the server URL in the main settings window, with the row label
    `地址`
  - move server address, client ID, and API key editing into an explicit
    `编辑连接` sheet
- `通用 / 音频` follows macOS System Settings row layout:
  - `允许串流音频` uses a switch, not a checkbox
  - `音频源` shows `自动` for the automatic source
  - `音频权限` shows the status dot directly after the label, plus
    `打开系统设置...` aligned to the right
- `通用 / 启动` must register with macOS Login Items:
  - the `登录时启动` switch is driven by `SMAppService.mainApp.status`
  - turning it on calls `SMAppService.mainApp.register()`
  - turning it off calls `SMAppService.mainApp.unregister()`
  - do not implement this as a standalone `UserDefaults` / `@AppStorage`
    boolean
- Remove Report controls that do not currently change runtime behavior:
  - `Report unconfigured applications`
  - `Add Application...`
  - `Remove`
- Audio source selection is a controlled list, not a running-app picker:
  - first item is `自动`
  - selectable capture sources are `System Audio` plus explicitly supported
    player apps that are currently running
  - ordinary apps such as System Settings, IDEs, browsers, and design tools
    must never appear as audio sources
- Keep the existing hand-written `NSStatusItem + NSPanel` implementation for the
  left-click status panel; do not migrate to SwiftUI `MenuBarExtra` in this pass.
- Remove the dashboard jump button from `MenuBarContentView`.
- Update `StatusItemController` so the right-click menu contains only
  `Settings...` and `Quit`.
- Set `LSUIElement` to `true` in both `macosApp/PulseBarNative/Info.plist` and
  `macosApp/project.yml`.
- Update product docs that still describe the desired macOS app as
  `menubar + dashboard`; the target is now `tray-only + Preferences`.
- If Swift files are added or moved, update the generated Xcode project through
  the repo's project generation/patch scripts instead of hand-editing
  `project.pbxproj`.

## Non-Goals

- No protocol or wire-shape changes.
- No KMP config owner changes.
- No connection-state semantic changes.
- No change to startup monitoring or startup permission request timing.

## Verification

1. Build and run from the Xcode app UI using the `PulseBarNative` scheme.

2. Static checks:

   - `Info.plist` and `project.yml` both set `LSUIElement=true`.
   - Right-click menu labels are exactly `Settings...` and `Quit`.
   - Stale user-visible dashboard wording is removed or marked historical.

3. Runtime checks:

   - Launch the Debug app bundle.
   - Confirm no Dock icon and no app switcher entry.
   - Confirm left click opens/closes the compact status panel.
   - Confirm right click contains only `Settings...` and `Quit`.
   - Confirm `Settings...` opens the dialog-style `PulseBar 设置` window.
   - Confirm the top segmented control contains only `通用` and `报告`.
   - Confirm `通用` renders `连接`、`启动`、`音频` in that order.
   - Confirm `连接` only shows connection status and server URL until the user
     opens `编辑...`, and labels the URL row as `地址`.
   - Confirm `启动` uses the row label `登录时启动`.
   - Confirm `登录时启动` reads and updates macOS Login Items through
     `SMAppService.mainApp`, not only a local stored preference.
   - Confirm `音频` uses switch controls for streaming, labels streaming as
     `允许串流音频`, labels the source row as `音频源`, and shows `自动` for the
     automatic source.
   - Confirm `报告` renders only `Application rules`.
   - Confirm `音频权限` renders only a red/yellow/green status dot directly after
     the label, with no wide empty value column and no permission status text
     such as `已授予`.
   - Confirm `音频源` shows `自动` and only controlled capture sources,
     not arbitrary running applications.

Run `pnpm check:native` only if implementation touches shared/KMP bridge code.
