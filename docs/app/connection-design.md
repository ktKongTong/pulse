# PulseBar Connection 设计草案

本文只记录当前已经确认的 `Connection` 设计约束。它描述 `dashboard` 中 `Connection` 模块的对象模型、页面结构、状态语义和顶部处置区规则。尚未确定的 `detail body` 内部布局，不在本文展开。

## 1. 设计目标

`Connection` 不是连接状态页，也不是配置页。它是 endpoint 实体的完整控制域，负责 connection 的全周期管理。

这里的关注点包括：

- endpoint 实体本身的 CRUD
- connection 的运行状态
- connect / disconnect / reconnect 等运行控制
- enabled / disabled 等可用性控制
- 推流相关状态与必要摘要
- 本地未同步缓存的最小可见信息

不属于 `Connection` 的内容：

- 按 app 规则组织的 reporting 策略
- 过于细碎的 diagnostics 原始数据
- 尚未确定的 dashboard 首页编排

## 2. 对象模型

`connection = endpoint 实体`

一个 connection 就是一个具体 endpoint。用户管理的对象不是抽象链路，也不是 endpoint 下的子 channel，而是这个 endpoint 本身。

推流不是独立模块。它属于当前 connection 的运行能力。

因此：

- media 不独立成一级模块
- live 也不独立成一级模块
- connection 必须负责 endpoint 的全周期管理

## 3. 页面结构

`Connection` 页面采用左右布局。

- 左侧：`connection list`
- 右侧：当前选中 connection 的 `detail`

左侧负责快速定位和切换 connection。右侧负责查看状态、执行控制和进入更深入的维护动作。

## 4. Connection List

每个 list item 只显示最少必要信息：

- `connection 名称`
- `endpoint 标识`
- `status dot`

状态点规则：

- 绿点：`connected`
- 红点：`disconnected`
- 黄点：`reconnecting`

名称显示规则：

- 当 `connection 名称` 不为空时：
  - 主标题显示 `connection 名称`
  - 次信息显示 `endpoint 标识`
- 当 `connection 名称` 为空时：
  - 主标题直接使用 `endpoint`
  - 不再显示次级 endpoint 信息

左侧 list 不承担问题解释，不展示 pending count，不展示 disconnected reason，不展示更细粒度的底层状态。

## 5. Connection Status 语义

用户可见的 connection status 只有 3 个：

- `connected`
- `disconnected`
- `reconnecting`

以下内容不是 connection status：

- `failed`
- `misconfigured`
- `degraded`

这些都属于 `disconnected` 的原因，而不是独立状态。

这意味着：

- 左侧 list 不区分这些原因
- 顶部 detail 只显示 3 个主状态
- 更具体的问题只作为 `reason` 展示

## 6. Detail Header

右侧 detail 顶部采用固定结构。

左侧显示：

- `connection status`
- `optional reason`

右侧显示 action buttons：

1. `Connect / Disconnect`
2. `Enable / Disable`
3. `Dropdown Menu`

下拉菜单内容固定为：

- `Edit`
- `Delete`

`Delete` 必须要求用户确认后才能执行。

这里的动作语义如下：

- `Disconnect`
  - 手动让当前 connection 停止工作
  - 不等于 disable
- `Connect`
  - 让当前处于 disconnected 的 connection 恢复工作
- `Enable / Disable`
  - 是 endpoint 实体的可用性控制
  - 不是连接状态本身

特别约束：

- `Disconnect` 后，connection 仍然可以保持 `enabled`
- 也就是说，`enabled` 与 `connected` 必须是两层不同语义

## 7. Detail Body 已确认内容

虽然 detail body 的具体布局还未确定，但已确认它只应围绕当前 connection 的主要信息展开。

已确认必须存在的信息：

1. `Connection Status` 详细信息
2. `Streaming` 信息
   - 如果启用推流，则展示
   - `focus` 只占很小一部分，采用图标 + app name
   - `media` 也是很小的一部分
   - 不关心“当前正在推什么”或“可推但未推”这类细碎信息
3. `Local Cache`
   - 只关心本地有多少未同步事件
   - 只展示一个 `pending count`
   - 不应展开为独立的大区块

已确认不应进入 detail 主体的内容：

- `enabled`
- connection 完整配置平铺
- 大量事件流
- 原始 diagnostics

## 8. Edit Connection

`config` 不应平铺在 detail 主体中。

只有在用户主动修改 connection 配置时，才需要展开完整配置界面。因此 `Edit Connection` 应以对话框或 sheet 形式出现。

`Edit Connection` 中应承载更详细的推送配置，例如：

- 间隔
- 心跳
- 重试策略
- 重连策略

换句话说：

- 日常运行控制在 detail header 和 detail body 中完成
- 详细配置在 `Edit Connection` sheet 中完成

## 9. 与 Reporting 的边界

对不同 app / media 信息上报程度的配置，不属于 `Connection`。

例如：

- 不同 focus app 的信息提取程度
- 页面 metadata 上报策略
- 不同 app 的文案映射
- media 信息的上报粒度

这些都属于更一般的 reporting 规则，应按 app 规则组织，而不是按 connection 组织。
