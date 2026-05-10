import Foundation
@preconcurrency import PulseBarShared

/// Kotlin delivers observer callbacks on `Dispatchers.Default`. These
/// `nonisolated` helpers subscribe on any thread and hop to `@MainActor`
/// before invoking the caller's handler, so the closure captured by
/// Kotlin isn't inherited-`@MainActor` (which trips Swift 6 at runtime).
enum MonitorBridgeSubscriptions {
    nonisolated static func menuState(
        bridge: PulseBarBridge,
        onMain: @escaping @MainActor (PulseBarMenuState) -> Void
    ) -> PulseBarCancellable {
        bridge.observeMenuState { state in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(state) } }
        }
    }

    nonisolated static func config(
        bridge: PulseBarBridge,
        onMain: @escaping @MainActor (PulseBarConfig) -> Void
    ) -> PulseBarCancellable {
        bridge.observeConfig { config in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(config) } }
        }
    }

    nonisolated static func syncState(
        bridge: PulseBarBridge,
        onMain: @escaping @MainActor (PulseBarSyncState) -> Void
    ) -> PulseBarCancellable {
        bridge.observeSyncState { state in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(state) } }
        }
    }

    nonisolated static func interactionState(
        bridge: PulseBarBridge,
        onMain: @escaping @MainActor (PulseBarInteractionState) -> Void
    ) -> PulseBarCancellable {
        bridge.observeInteractionState { state in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(state) } }
        }
    }

    nonisolated static func todayStats(
        bridge: PulseBarBridge,
        onMain: @escaping @MainActor (PulseBarTodayStats) -> Void
    ) -> PulseBarCancellable {
        bridge.observeTodayStats { stats in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(stats) } }
        }
    }
}


// TODO(kotlin-2.4): delete this entire file.
//
// Kotlin 2.4's Swift Export ships native `Flow<T>` / `suspend fun` support
// (KT-64572). See the reference implementation:
// https://github.com/GuilhE/SwiftExport-Playground
//
// Once we bump `kotlin = "2.4.x"` and switch the bridge's observer signatures
// from callbacks to `val xFlow: Flow<T>`, the subscribe helpers below become
// one-line Swift `for try await` loops inside a `Task`, with `@MainActor`
// inherited from the enclosing context. No DispatchQueue hop, no
// `MainActor.assumeIsolated`, no `PulseBarCancellable`.
//
// Migration steps are pre-written in docs/app/refactor-plan.md §11.
