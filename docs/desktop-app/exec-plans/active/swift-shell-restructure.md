# PulseBarNative Swift 壳层 Xcode / Reference Verification Checklist

归属：`macosApp`
代码范围：`macosApp/PulseBarNative`
状态：active
验证：Xcode build；涉及 KMP bridge 时再跑 `pnpm check:native`

本文是当前 Swift 壳层的 Xcode/project/reference verification checklist，不是目录迁移计划，也不是历史问题清单。目录迁移已经完成；跨语言收尾计划见 [KMP Native Refactor](./kmp-native-refactor.md)。

## 当前结构

当前 `macosApp/PulseBarNative` 已经按职责拆成以下目录：

```text
macosApp/PulseBarNative/
├── App/
├── Bridge/
├── Design/
├── Screens/
│   ├── Dashboard/
│   │   ├── Connection/
│   │   ├── LiveListen/
│   │   ├── Reporting/
│   │   └── Settings/
│   └── Menubar/
├── Services/
│   ├── InstalledApps/
│   └── LiveListen/
└── State/
```

旧计划里的 “九个 Swift 文件平铺” 问题已经不再是当前事实。本文保留为引用检查清单，确保 Xcode project、Swift package/reference 和目录职责持续一致。

## 当前职责边界

- `App`
  - app entry、status item、window helper。
- `Bridge`
  - Kotlin export 类型的 Swift adapter 和 Swift Export workaround。
- `Design`
  - 可复用 SwiftUI 设计组件。
- `Screens`
  - 用户可见页面。Dashboard 和 Menubar 分开维护。
- `Services`
  - Swift-only runtime service，例如 Live Listen capture、permission、wav writer、installed app catalog。
- `State`
  - SwiftUI store，目前包含 `MonitorStore` 和 `LiveListenCaptureStore`。

## 还需要收尾的事项

1. 确认 Xcode project 已包含当前目录下所有 Swift 文件。
2. 确认旧路径下没有残留 Swift 文件引用。
3. 检查 `Bridge` 中 Kotlin 类型 adapter 是否只放 interop 相关逻辑，不混入 UI 状态。
4. 检查 `Design` 中组件是否保持纯展示，不依赖 endpoint、Live Listen 或 monitor 业务状态。
5. 检查 `State` 中 store 的订阅范围，避免单个 store 重新变成所有页面共享的状态大对象。

## 验证

Swift 壳层引用检查完成前至少运行：

```bash
xcodebuild -project macosApp/PulseBarNative.xcodeproj \
  -scheme PulseBarNative \
  -configuration Debug \
  -derivedDataPath macosApp/.xcode-derived \
  CODE_SIGNING_ALLOWED=NO build
```

如果移动或修改了 Kotlin bridge 相关代码，再运行：

```bash
pnpm check:native
```

## 非目标

- 不改变 dashboard 视觉设计。
- 不改变 Live Listen 协议。
- 不把 protocol shape 放进 Swift-only 类型里。
- 不把历史问题审计塞进 architecture 文档。
