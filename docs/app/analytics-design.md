# PulseBar Analytics 设计草案

本文只记录当前已经确认的 `Analytics` 设计约束。它描述 `dashboard` 中 `Analytics` 模块的最小目标与范围。该模块属于未来需求，当前阶段只做文档沉淀，不继续展开实现细节。

## 1. 设计目标

`Analytics` 是统计信息页面，用于展示聚合后的使用数据。

当前版本不承担运行态控制，不承担 connection 管理，不承担 reporting 配置，也不承担 diagnostics。

这一版只关注一个问题：

- 当日使用时间如何按 app 聚合展示

## 2. 对象边界

`Analytics` 只处理统计结果，不处理实时运行信息。

这意味着以下内容不属于 `Analytics`：

- 当前 focus
- 当前 media
- 当前连接状态
- connection 级操作
- reporting app 配置
- 全局 settings
- 原始 diagnostics

这些能力应保留在 `dashboard` 的其他模块中，而不是进入 `Analytics` 页面。

## 3. 与 Dashboard 的关系

`Overview` 页面不做。

`Analytics` 不进入当前 dashboard sidebar 导航，只作为未来需求保留文档。

当前 dashboard 的主导航只包含：

- `Connection`
- `Reporting`
- `Settings`

## 4. 当前版本范围

当前阶段，`Analytics` 页面只包含一项核心内容：

- `按 app 聚合的当日使用时间`

也就是：

- 时间范围固定为 `today`
- 聚合维度固定为 `app`

当前不做：

- 多日切换
- 自定义时间范围
- page 维度统计
- media 维度统计
- 趋势图
- 对比分析
- 导出

## 5. 页面角色

`Analytics` 是未来需求中的信息页，不是当前主流程的一部分。

因此它在当前阶段的要求只有：

- 明确作为独立模块存在
- 范围极小
- 不与其他模块职责重叠
- 暂不继续细化布局和交互
