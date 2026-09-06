# PulseBar 菜单栏与主面板交互设计规范

归属：`macosApp`
代码范围：`macosApp/PulseBarNative`、`common`
状态：active
验证：Xcode app UI build/run；涉及 KMP bridge 时再跑 `pnpm check:native`

本文定义 PulseBar 作为 Tray-Only 应用在**菜单栏图标（Status Item）**与**左键主状态面板（MenuBarContentView）**的核心交互规范，聚焦设备端 Owner 的掌控感、状态可见性与隐私安全。

---

## 1. 菜单栏图标与状态可见性（Status Item Visibility）

菜单栏图标不仅是常驻入口，更是系统运行状态的第一事实指示器。严禁使用固定不变的静态图标，必须根据当前运行时状态呈现清晰视觉差异：

| 运行状态 | 图标表现 | 视觉语义 |
| :--- | :--- | :--- |
| **已连接且空闲** | 标准波形图标（`waveform.path.ecg`） | 服务正常，设备在线 |
| **未连接 / 连接错误** | 图标置灰或带错误标识（如 `waveform.path.ecg` + 弱化透明度 / 警告点） | 提示 Owner 当前上报不可用或断网 |
| **音频串流中 (Streaming Active)** | 高亮图标 / 动态波形提示 | 醒目提醒 Owner 当前正有访客通过公网收听本机音频 |
| **暂停/隐身状态** | 划斜线或暂停符号 | 明确告知 Owner 当前追踪已暂停 |

---

## 2. 主面板头部状态与控制工具栏

在左键呼出的主面板（`MenuBarContentView`）顶部或工具栏区域，集成紧凑的控制与状态指示器：

### 2.1 连接状态指示（Connection Status Icon）
- **形态**：单 Icon 大小的圆形指示图标，放置于主面板右上角或头部。
- **状态色彩契约**：
  - `绿色`：已连接且稳定在线（Connected）。
  - `黄色`：连接中 / 唤醒重连中（Connecting / Reconnecting）。
  - `红色`：连接失败 / 凭证错误 / 网络超时（Error / Disconnected）。
  - `灰色`：已主动停止上报（Disabled）。
- **交互与排错（Hover & Retry）**：
  - 鼠标 **Hover** 时浮出轻量 Popover/Tooltip。
  - 浮层中展示当前服务器地址及**具体错误原因**（例如 `401 Unauthorized 密钥无效`、`网络超时 (Timeout)`、`DNS 解析失败` 等）。
  - 在 Hover 浮层中直接内置一个 **“重试（Retry）”** 按钮，允许 Owner 一键触发重新连接，无需进入二级设置界面。

### 2.2 音频串流关停能力（Audio Stream Kill Switch）
- **形态**：主面板常驻的单个 Icon Button（例如无线广播/电台图标）。
- **交互行为**：
  - 当无串流活动时：表现为幽灵态或置灰图标。
  - 当访客接入、串流处于活跃状态时：图标点亮（如高亮绿色或发光效果），提示“正在串流音频”。
  - **一键关停**：Owner 点击该 Icon Button，可**瞬间切断当前音频采集与推送**，将音频权限切换为 Disallow / Stop，给予 Owner 应对微信语音、会议或突发私密场景下的秒级切断安全感。

---

## 3. 媒体展示组件精简（Media View Streamlining）

为了降低面板视觉负荷、避免控制冲突与拖动条回跳：

- **移除媒体进度调节条（Remove MediaSeekBar）**：
  - 彻底去除面板上的拖拽进度条 `MediaSeekBar`，PulseBar 不再作为播放控制器使用。
  - 避免因 AppleScript / NowPlayingSession 异步延迟导致的进度条“回弹拖拽打架”问题。
- **收敛媒体组件视觉高度**：
  - 整体 media 组件转变为**纯展示性紧凑卡片**（Now Playing Card）。
  - 仅保留：高品质封面（Artwork）、歌曲标题、艺术家信息、简单的来源图标（Spotify/Apple Music）与简短的时长文字。
  - 显著压缩面板整体尺寸，让菜单栏弹窗更加克制、现代、轻盈。

---

## 4. 应用上报默认白名单机制（Default Whitelist Reporting）

彻底重构应用追踪与上报的心智模型，保护 Owner 隐私：

- **默认白名单机制（Opt-in Whitelist）**：
  - 默认状态下，**未加入白名单的系统应用一律不上报、不记录**（True Ignore）。
  - 彻底废除“未启用应用归并到 other 仍然上报事件与时长”的反直觉设计。
- **白名单配置交互**：
  - 在 Preferences 的 `Reporting` 面板中，增加应用搜索框（Search Filter），方便在数百个已安装 App 中快速检索。
  - 用户勾选开启的应用才会进入 Pulse 的焦点检测与时长上报链路。
  - 未勾选应用即使处于前台，PulseBar 也直接保持静默或视为无关注状态。
