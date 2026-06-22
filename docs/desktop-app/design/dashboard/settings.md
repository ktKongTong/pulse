# PulseBar Settings 设计草案

本文只记录当前已经确认的全局设置设计约束。它描述 Preferences 窗口中
`General` 分区的对象边界、页面结构和当前版本需要承载的全局设置项。当前版本不扩展为通用配置中心。

## 1. 设计目标

`Settings` 只负责全局通用设置，不负责对象级配置。

这意味着：

- 不配置 connection
- 不配置 reporting app
- 不承担运行态控制
- 不承载复杂 diagnostics

当前阶段，`Settings` 的职责应收敛为：

- 配置 Pulse app 的全局行为偏好

## 2. 对象边界

`Settings` 是 `Global App Preferences` 页面。

只要某项配置满足下面条件，就可以进入 `Settings`：

- 它作用于整个 app
- 它不从属于某个 connection
- 它不从属于某个 reporting app
- 它不是运行时瞬时动作

不满足这些条件的配置，不应进入当前版本的 `Settings`。

## 3. 当前版本包含的设置项

当前阶段只包含以下 3 项：

1. `App Sampling Interval`
   - app 采样间隔

2. `Switch Detection Stability`
   - 切换判断阈值
   - 例如稳定 1s 才算切换

3. `Launch at Login`
   - 是否开机启动

这 3 项就是当前版本 `Settings` 的完整范围。

## 4. 当前版本不包含的内容

当前版本明确不进入 `Settings` 的内容包括：

- endpoint 配置
- connection 级推流配置
- connection 级重试 / 重连 / 心跳配置
- reporting app 的启用 / 禁用
- browser / IDE / media 的 reporting 细粒度规则
- 当前运行状态
- 实时控制动作
- 历史统计
- diagnostics 原始信息

这些内容必须分别归属到 `Connection`、`Reporting` 或其他模块，而不是回流到 `Settings`。

## 5. 页面结构

`Settings` 当前不需要左右布局。

它应当是单页表单，采用单列页面结构。

当前页面分为 3 个区块：

- `Sampling`
- `Detection`
- `System`

对应关系如下：

- `Sampling`
  - `App Sampling Interval`

- `Detection`
  - `Switch Detection Stability`

- `System`
  - `Launch at Login`

## 6. 交互要求

`Settings` 是低频、全局、稳定的配置面。

因此它应满足以下要求：

- 结构简单
- 无对象切换
- 不混入运行态信息
- 不和其他模块职责重叠

当前版本的设计目标不是扩展功能，而是把全局偏好从其他模块中剥离出来，形成一个边界清楚的独立页面。
