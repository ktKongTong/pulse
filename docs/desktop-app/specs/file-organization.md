# Desktop App 文件组织

归属：`common`、`macosApp`
代码范围：`common`、`macosApp`
状态：active
验证：Kotlin package / Swift 目录移动后同步更新本文档；Swift 文件移动后同步 Xcode project 并跑 Xcode build；涉及 KMP bridge / Swift Export 时再跑 `pnpm check:native`

本文只定义 desktop app 的代码组织原则：新代码按什么边界放、哪些东西不能混放。运行时如何协作成一个 app 看 `architecture.md`；目标产品结构看 `docs/desktop-app/design/`。

## 组织边界

### `common`

放 Kotlin shared code，以及 Kotlin 侧需要的 platform actual。

适合放进 `common` 的内容：

- 可跨平台复用的模型、状态机、store、selector、formatter
- Kotlin 持有的持久化 owner
- Swift Export API
- 共享层依赖的平台抽象
- macOS source set 下的 Kotlin actual / platform wiring

不适合放进 `common` 的内容：

- AppKit / SwiftUI 生命周期
- menubar / dashboard / panel / sheet / menu 这类平台容器态
- 必须由 Swift-only runtime 直接管理的 native service 实现

### `macosApp`

放 SwiftUI / AppKit 壳层和 Swift-only runtime 代码。

适合放进 `macosApp/PulseBarNative` 的内容：

- app entry、status item、window/panel/menu 生命周期
- SwiftUI 页面和页面容器
- 纯展示组件
- Swift-only runtime service
- SwiftUI observable adapter
- Swift Export workaround 和轻量 adapter

不适合放进 `macosApp/PulseBarNative` 的内容：

- 与 Kotlin shared 重复的持久化 owner
- 复制一套 protocol shape
- 应该下沉到 shared 的长期业务规则

## 目录规则

### `common/.../core/*`

放共享 domain/data/presentation-core、store、selector、formatter、平台抽象，以及它们的 platform actual。

### `common/.../export`

只放 Swift Export public boundary、导出 DTO、bridge actual 和围绕导出边界的 glue。

不要把 `export` 当成通用杂项目录。新增平台能力如果不属于 Swift Export boundary，优先放回对应 `core/*`。

### `macosApp/PulseBarNative/App`

只放 app entry 和 AppKit 生命周期 glue。

### `macosApp/PulseBarNative/Bridge`

只放 Swift/Kotlin interop、Swift Export workaround 和轻量类型适配。

不要在 `Bridge` 中放 UI store、业务编排或持久化 owner。

### `macosApp/PulseBarNative/Design`

只放纯展示组件。

如果一个组件直接依赖业务 store、endpoint、Live Listen 状态或 raw protocol type，它就不该放在 `Design`。

### `macosApp/PulseBarNative/Screens`

放用户可见页面、页面容器和页面内 feature UI。

### `macosApp/PulseBarNative/Services`

放 Swift-only runtime service，例如 capture、permission、installed app catalog 等平台能力。

### `macosApp/PulseBarNative/State`

放 SwiftUI observable adapter、subscription lifecycle、task lifecycle 和 transient UI state。

不要让 `State` 重新演化成共享业务规则的大对象；长期规则应优先下沉到 `common`。

## 放置判断顺序

新增代码时按下面顺序判断：

1. 如果是协议字段、WebSocket message、HTTP contract 或兼容策略：
   - 放 `packages/realtime-protocol` 和 `docs/protocol`。
2. 如果是跨平台复用的模型、状态机、store、selector、formatter：
   - 放 `common`。
3. 如果是 Kotlin 侧需要的 macOS actual / platform wiring：
   - 放 `common/src/macosMain`。
4. 如果是 Swift-only runtime 能力：
   - 放 `macosApp/PulseBarNative/Services`。
5. 如果是用户可见页面或页面容器：
   - 放 `macosApp/PulseBarNative/Screens`。
6. 如果是纯展示组件：
   - 放 `macosApp/PulseBarNative/Design`。
7. 如果是 SwiftUI observable adapter：
   - 放 `macosApp/PulseBarNative/State`。

## 禁止事项

- 不把 `file-organization.md` 写成 architecture、PRD 或执行计划。
- 不在 Swift-only 类型里临时定义 protocol shape。
- 不在 `Bridge` 中混入 UI store、业务编排或持久化 owner。
- 不在 `Design` 中直接依赖业务 store 或 raw protocol type。
- 不继续扩大 `common/src/macosMain/.../export` 来承载与 Swift Export 无关的新平台能力。
- `composeApp/**` 当前不存在，不作为 desktop app 的有效代码归属。
