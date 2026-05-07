# PulseBar macOS App 重构 PRD

## 1. 背景

当前 PulseBar macOS app 已经同时承载本机监控、媒体读取、Live Listen、endpoint 同步、本地缓存、Web 请求响应、权限提示和诊断观测等多类能力，但界面组织仍然沿着工程模块演化，形成了 `Dashboard / Activity / Sync / Live Listen / Settings` 这类实现导向结构。

结果是：

- 菜单栏与主窗口职责重叠
- `Sync` 与 `Live Listen` 默认暴露大量底层概念
- `Settings` 混入运行态与对象级配置
- 用户需要先理解系统内部结构，才能完成基本操作

本次重构目标不是局部修补，而是重建 mac app 的产品结构、模块边界和交互模型。

## 2. 产品目标

本次重构后的 mac app 需要满足以下目标：

- `menubar` 成为轻量状态确认与快捷控制入口
- `dashboard` 成为完整控制台，即使移除 `menubar` 也必须独立成立
- `Connection`、`Reporting`、`Settings` 三个核心模块职责清晰，不再重叠
- 当前版本移除 `Overview`，不再保留“大而全首页”
- 当前版本不做独立 `Diagnostics` 模块
- 当前版本不把 `Analytics` 放入主导航，只保留未来文档定义

## 3. 非目标

当前版本明确不做以下内容：

- `Overview` 页面
- 独立 `Diagnostics` 模块
- 当前版 `Analytics` 页面实现
- app-specific reporting 细粒度规则
- browser / IDE / media / LLM 的专用 reporting 配置器
- 自定义文案、metadata、page、url allowlist 规则
- card 风格信息面板式 UI

## 4. 总体信息架构

当前版本只保留两个主体：

- `menubar`
- `dashboard`

两者关系如下：

- `menubar` 是轻量入口
- `dashboard` 是完整控制台
- `dashboard` 不依赖 `menubar` 才能成立
- `dashboard` 与 `menubar` 没有联动约束，不要求镜像结构

## 5. Menubar

`menubar` 的职责是轻量状态确认与快捷控制。

核心原则：

- 主轴是 `media / focus`
- 连接与推流状态是次级状态区
- 配置错误、权限缺失等问题通过次级状态区反映
- 提供高频快捷操作

本 PRD 不继续展开 `menubar` 的具体布局，只锁定它是轻量入口，不与 `dashboard` 的完整控制台角色混淆。

## 6. Dashboard Shell

`dashboard` 是完整控制台。

### 6.1 Sidebar 结构

当前 sidebar 结构固定为：

- 顶部：移除
- 中部：`nav`
- 底部：`media`

约束：

- 不在 dashboard 中展示当前 `focus`
- sidebar 顶部不放运行摘要
- sidebar 直接从导航开始
- sidebar 底部 `media` 只负责展示，不负责控制

### 6.2 当前导航范围

当前 dashboard sidebar 只包含：

- `Connection`
- `Reporting`
- `Settings`

当前明确不进入 sidebar 的内容：

- `Overview`
- `Analytics`
- `Diagnostics`

解释：

- `Overview` 页面直接移除
- `Analytics` 仅作为未来需求保留，不进入当前 dashboard
- `Diagnostics` 模块当前不做

## 7. Connection

### 7.1 模块定位

`Connection` 不是连接状态页，也不是配置页。它是 endpoint 实体的完整控制域。

它负责：

- endpoint 实体的 CRUD
- connection 的运行状态
- connect / disconnect / reconnect
- enable / disable
- 推流相关运行信息
- 本地未同步缓存的最小可见信息

它不负责：

- app-specific reporting 配置
- 通用 diagnostics 中心

### 7.2 对象模型

`connection = endpoint 实体`

一个 connection 就是一个具体 endpoint，不再拆成更细的 channel 或 transport 对象。

### 7.3 页面结构

`Connection` 页面采用左右布局：

- 左侧：`connection list`
- 右侧：当前选中 connection 的 `detail`

### 7.4 Connection List

每个 list item 只显示：

- `connection 名称`
- `endpoint 标识`
- `status dot`

状态点规则：

- 绿点：`connected`
- 红点：`disconnected`
- 黄点：`reconnecting`

名称规则：

- 当 `connection 名称` 不为空时：
  - 主标题显示 `connection 名称`
  - 次信息显示 `endpoint 标识`
- 当 `connection 名称` 为空时：
  - 主标题直接使用 `endpoint`
  - 不再显示次级 endpoint 信息

左侧 list 不显示：

- pending count
- disconnected reason
- 更细粒度状态解释

### 7.5 Connection Status

用户可见状态只有 3 个：

- `connected`
- `disconnected`
- `reconnecting`

以下内容不是 status，而是 `disconnected reason`：

- `failed`
- `misconfigured`
- `degraded`

### 7.6 Detail Header

右侧 detail 顶部固定为两部分：

- 左侧：`connection status + optional reason`
- 右侧：actions

actions 固定为：

1. `Connect / Disconnect`
2. `Enable / Disable`
3. dropdown menu：
   - `Edit`
   - `Delete`

`Delete` 必须二次确认。

### 7.7 关键语义

- `Disconnect`
  - 只表示与 server 的连接断开
  - 不等于 disabled
- `Enable / Disable`
  - 是 endpoint 的可用性控制
- `Disable` 后：
  - 该 endpoint 不再进行任何上报或记录行为
- `Disconnect` 后：
  - 仍可保持 enabled

### 7.8 Detail Body 边界

当前版本只锁定 `detail body` 的内容边界，不锁定具体布局。

必须存在的信息：

1. `Connection Status` 详细信息
2. `Streaming` 摘要
   - `focus` 只占很小一部分
   - `media` 只占很小一部分
   - 不展示“当前正在推什么 / 可推但未推”这类噪音
3. `Local Cache`
   - 只展示一个 `pending count`

明确不进入主体的内容：

- `enabled`
- 完整 config 平铺
- 大量事件流
- diagnostics 原始信息

### 7.9 Edit Connection

`config` 不应平铺在主体中。

`Edit Connection` 通过 sheet 或对话框打开，承载详细推送配置，例如：

- 间隔
- 心跳
- 重试策略
- 重连策略

## 8. Reporting

### 8.1 模块定位

当前阶段的 `Reporting` 不是规则编辑器，而是 app enrollment 管理面。

它只解决一个问题：

- 某个 app 是否作为独立 app 进入 Pulse 上报链路

### 8.2 对象边界

`Reporting` 按 app 组织，不按 connection 组织。

当前版本明确不做：

- 通用 reporting schema
- app 能力模板
- media rule
- browser / IDE / media / LLM 的复杂定制 form
- 自定义文案
- page / url / metadata 细粒度配置

### 8.3 页面结构

`Reporting` 页面采用左右布局：

- 左侧：`installed app list`
- 右侧：当前选中 app 的 `reporting detail`

左侧来源是系统已安装 app 列表，而不是当前观测到的 app 列表。

### 8.4 App List

每个 list item 只显示：

1. `app icon`
2. `app name`
3. `enabled / disabled` 状态

不显示：

- bundle id
- 规则摘要
- 字段配置
- 文案覆盖状态

### 8.5 状态语义

- `Enabled`
  - 该 app 作为独立 app 进入 Pulse 上报链路
- `Disabled`
  - 该 app 不作为独立 app 处理
  - 归并到 `other`
  - 事件仍然上报

因此，`Disabled` 不是“不上报”，而是“不作为独立 app reporting 对象存在”。

### 8.6 Other

`other` 是系统保留桶：

- 不可删除
- 不可禁用

### 8.7 Detail

右侧 detail 当前只需要顶部 `action bar`：

- `Enable`
- `Disable`

右侧 `detail body` 当前可以为空。

## 9. Settings

### 9.1 模块定位

`Settings` 只负责全局通用设置，不负责对象级配置。

它是 `Global App Preferences` 页面。

### 9.2 当前版本包含的设置项

当前只包含以下 3 项：

1. `App Sampling Interval`
2. `Switch Detection Stability`
3. `Launch at Login`

### 9.3 当前版本不包含的内容

明确不进入 `Settings` 的内容：

- endpoint 配置
- connection 推流配置
- connection 重试 / 重连 / 心跳配置
- reporting app 的启用 / 禁用
- reporting 细粒度规则
- 当前运行状态
- 实时控制动作
- 历史统计
- diagnostics 原始信息

### 9.4 页面结构

`Settings` 不需要左右布局，采用单页单列结构。

页面分为 3 个区块：

- `Sampling`
- `Detection`
- `System`

对应关系：

- `Sampling`
  - `App Sampling Interval`
- `Detection`
  - `Switch Detection Stability`
- `System`
  - `Launch at Login`

## 10. Analytics

`Analytics` 仅作为未来需求保留，不进入当前 dashboard。

当前唯一保留目标：

- 按 app 聚合展示当日使用时间

当前明确不做：

- 多日切换
- 自定义时间范围
- page 维度统计
- media 维度统计
- 趋势图
- 对比分析
- 导出

## 11. 视觉与交互约束

### 11.1 全局约束

严格禁止 `card UI` 作为默认分块方式。

页面分块原则：

- 通过间距实现区块划分
- 尽量避免明显边框
- 不依赖卡片容器组织页面
- 使用留白、层级、排版和对齐关系构建结构

### 11.2 风格方向

整体风格应参考当前对话中给出的桌面应用截图：

- 安静
- 克制
- 密度适中
- 工具型信息布局
- 不使用 card 化 AI 风格面板布局

## 12. 当前代码与目标结构的偏差

当前代码中的以下结构与目标 PRD 不一致，后续实施需被替换：

- `Dashboard / Activity / Sync / Live Listen / Settings` 旧导航
- `DashboardSidebarHeader` 顶部头区
- `DashboardOverviewPane`
- `DashboardActivityPane`
- `DashboardSyncPane`
- `LiveListenCapturePane` 作为独立主导航模块
- 当前 `SettingsEditorContent` 中混入的运行态、endpoint 配置、interaction 状态和复杂采样调参

当前 `PulseBarNativeApp` 启动即 `monitor.start()`、聚焦 dashboard、请求音频采集权限，也与新的首次使用路径不匹配，后续需要重构启动流程。

## 13. 实施分阶段

### Phase 1

- 完成 PRD 定稿
- 将分散草案并入或标记为来源文档
- 明确当前 dashboard 壳层结构和模块边界

### Phase 2

- 重做 dashboard shell
- 移除旧导航与 sidebar header
- 建立新的 `Connection / Reporting / Settings` 主导航
- 建立 sidebar bottom media 展示区

### Phase 3

- 完成 `Connection` 页面重构
- 收编旧 `Sync` 与 `Live Listen` 的相关能力
- 建立新的 connection status、actions 和 edit flow

### Phase 4

- 完成 `Reporting` 页面重构
- 完成 `Settings` 页面重构
- 剥离旧 settings 中的对象级配置和运行态内容

### Phase 5

- 统一视觉与交互细节
- 去除 card UI 痕迹
- 调整密度、留白、排版和页面节奏

## 14. 验收标准

当前版本完成后，需要满足以下验收条件：

- dashboard 只保留 `Connection / Reporting / Settings` 三个主导航
- 不存在 `Overview` 页面
- sidebar 顶部为空，底部只有 media 展示
- `Connection` 能独立完成 endpoint 的全周期管理
- `Reporting` 只做 app enrollment，不混入复杂 rules
- `Settings` 只保留三项全局偏好
- `disabled` 与 `disconnected` 的产品语义在 UI 中被清晰区分
- 页面不使用 card UI，而是通过间距与排版完成分块
- dashboard 即使脱离 menubar，也能独立承担完整控制台职责
