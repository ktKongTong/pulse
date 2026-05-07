# PulseBar Dashboard Shell 设计草案

本文只记录当前已经确认的 `dashboard` 壳层结构与基础视觉约束。它描述 sidebar 的组织方式、当前导航范围，以及整体 UI 的分块方式。具体模块内部页面另见各自设计文档。

## 1. Dashboard 角色

`dashboard` 是完整控制台。

它不依赖 `menubar` 才能成立，也不需要和 `menubar` 保持结构映射。两者没有联动约束。

因此，`dashboard` 的壳层设计只服务于 dashboard 自己的使用方式，不以 `menubar` 为参照。

## 2. Sidebar 结构

当前 sidebar 结构已经明确：

- 顶部：直接移除
- 中部：`nav`
- 底部：`media`

特别约束：

- 当前 `focus` 不在 dashboard 中展示
- sidebar 顶部不放运行摘要，不放品牌头，不放 focus，不放 connection summary

也就是说，sidebar 直接从导航开始。

## 3. 当前导航范围

当前 dashboard sidebar 只需要以下导航项：

- `Connection`
- `Reporting`
- `Settings`

当前明确不进入 sidebar 的内容：

- `Overview`
- `Analytics`
- `Diagnostics`

其中：

- `Overview` 页面直接移除
- `Analytics` 仅作为未来需求保留文档，不进入当前导航
- `Diagnostics` 模块不做

## 4. Sidebar Bottom Media

sidebar 底部保留 `media` 区域。

当前只确认一条：

- `media` 只负责展示

当前不要求：

- media 控制
- media 复杂详情
- media 诊断信息

sidebar 底部 media 只是一个稳定的展示区，而不是额外的功能面板。

## 5. 视觉约束

dashboard 严禁使用 `card UI` 作为默认分块方式。

分块原则：

- 通过间距实现区块划分
- 尽量避免明显边框
- 不依赖卡片容器组织页面

也就是说：

- 使用留白
- 使用层级与排版
- 使用对齐关系

而不是通过 card、边框、描边去硬切页面。

## 6. 参考方向

dashboard 的壳层与分块风格，应参考当前对话中给出的两张截图：

- 更偏桌面阅读器 / 工具型应用的信息布局
- 更偏间距组织而非边框组织的管理界面

本质要求是：

- 安静
- 克制
- 密度适中
- 不使用 card 化的 AI 风格面板布局
