# Swift Export enum-return crash（KT-83730）

归属：`common`、`macosApp`
代码范围：Kotlin Swift Export 返回 enum 给 Swift 的调用路径
状态：active
验证：触碰 enum bridge 后必须 clean build 并实际启动 app

## 症状

Kotlin 函数通过 Swift Export 向 Swift 返回 Kotlin enum 时，生成的 Swift enum `init(__externalRCRefUnsafe:)` 可能落到 `fatalError()`，导致 app 启动或访问对应字段时崩溃。

常见表现类似：

```text
PulseBarShared/PulseBarShared.swift:2882: Fatal error
```

崩溃点在 Swift enum initializer 的 `default: fatalError()` 分支。

## 上游问题

- YouTrack: <https://youtrack.jetbrains.com/issue/KT-83730>

## 原因

Swift Export 生成的 enum initializer 会把 Kotlin 返回的 C pointer 和每个 enum case helper 返回的 pointer 做匹配。如果 Kotlin 返回的 pointer 没有匹配任何 case helper，Swift 就会落入 `fatalError()`。

这类生成代码大致如下：

```swift
public init(__externalRCRefUnsafe: UnsafeMutableRawPointer!, ...) {
    switch __externalRCRefUnsafe {
    case io_github_kt_pulsebar_core_presentation_ConnectionRuntimeStatus_Connected():
        self = .Connected
    case io_github_kt_pulsebar_core_presentation_ConnectionRuntimeStatus_Disconnected():
        self = .Disconnected
    case io_github_kt_pulsebar_core_presentation_ConnectionRuntimeStatus_Reconnecting():
        self = .Reconnecting
    default:
        fatalError()
    }
}
```

风险不只存在于 `ConnectionRuntimeStatus`，所有从 Kotlin 返回给 Swift 的 exported enum 都有类似风险。

## 当前 workaround

Kotlin 不直接返回 enum，而返回稳定字符串，例如 enum `.name`；Swift 侧再本地解析。

```kotlin
fun resolveDraftConnectionStatus(...): String = computed.name
```

Swift 侧按字符串转成本地 enum 或展示状态。

## 需要审计的调用点

- `PulseBarLiveListenStats.connectionState`
  - 如果 Swift 读取这个 enum 字段，优先读 bridge 暴露的 `connectionStateName: String` sibling field。
- `PulseBarEndpointConfig.transport`
- `PulseBarConfig.interactionExecutionMode`
- `PulseBarConfig.interactionPlaybackMode`
- 从 Swift 传给 Kotlin 的 enum 是反方向路径，目前不是这个崩溃点。

## 移除 workaround 的条件

只有同时满足以下条件才能移除字符串绕行：

1. KT-83730 对应 Kotlin / Swift Export 版本已修复。
2. Pulse 升级到包含修复的 Kotlin 版本。
3. clean rebuild 通过。
4. 直接启动 app 后不再触发 enum bridge 崩溃。
