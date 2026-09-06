# PulseBar Reporting 设计草案

本文只记录当前已经确认的 `Reporting` 设计约束。它描述 Preferences 窗口中
`Reporting` 分区的对象边界、页面结构、列表项规则和顶部操作规则。当前版本不展开更复杂的 reporting 配置，也不讨论未来增强能力。

## 1. 设计目标

当前阶段的 `Reporting` 不做复杂规则系统，不做按 app 的字段级定制，不做 metadata、page、url allowlist 等增强配置。

这一版只解决一个问题：

- 某个 app 是否作为独立 app 进入 Pulse 的上报链路

因此，`Reporting` 当前不是规则编辑器，而是 app 级 reporting enrollment 管理面。

## 2. 对象边界

`Reporting` 按 app 组织，不按 connection 组织。

当前阶段不做：

- 通用 reporting schema
- app 能力模板
- media rule
- browser / IDE / media / LLM 的复杂定制 form
- 自定义文案
- page / url / metadata 的细粒度配置

这些都属于未来增强功能，不进入当前版本。

## 3. 页面结构

`Reporting` 页面采用左右布局。

- 左侧：`installed app list`
- 右侧：当前选中 app 的 `reporting detail`

左侧展示系统已安装应用列表，而不是当前观测到的 app 列表。

这样可以保证：

- 用户可以提前配置某个 app
- 已配置过但当前未运行的 app 仍然可见
- 该模块是稳定的 app catalog，而不是运行时偶遇配置器

## 4. App List

每个 list item 只显示：

1. `app icon`
2. `app name`
3. `enabled / disabled` 状态

不显示：

- bundle id
- 规则摘要
- 字段配置
- 文案覆盖状态
- 其他次级信息

左侧 list 的职责只是按 app 定位，并快速判断这个 app 当前是否作为独立 reporting 对象处理。

## 5. 状态语义（默认白名单模式）

PulseBar 采用**默认白名单（Default Whitelist）**机制保护用户隐私：

`Enabled`（加入白名单）

- 该 app 明确加入白名单，作为独立 app 进入 Pulse 上报链路与时长统计。

`Disabled`（未在白名单）

- 该 app 不在白名单中。
- **完全不上报、不记录**（True Ignore）。
- 用户在前台操作该 app 时，Pulse 保持静默，不收集也不上报前台切换事件。

## 6. Other

系统不再强制保留全量兜底桶将未授权应用隐蔽上报。对于无法获取 BundleID 或系统桌面原生切换空闲态，可作为 `idle / none` 标记，严禁将用户未授权的第三方私密应用打包进 `other` 上报。

## 7. Detail Header

右侧 detail 当前只需要顶部 `action bar`。

这个 `action bar` 只提供：

- `Enable`
- `Disable`

右侧 `detail body` 在当前版本可以为空，不需要额外说明文案，也不需要平铺更多配置内容。

## 8. 当前版本不做的内容

当前版本明确不做：

- app-specific 字段配置
- browser page / url / metadata 规则
- IDE project / file 规则
- media app 规则
- 自定义文案
- 多层级 reporting rule editor

这些能力后续如果需要，再作为增强功能单独设计。
