import Foundation
import SwiftUI
@preconcurrency import PulseBarShared

// MARK: - KT-83730 enum-return workaround layer
//
// Swift Export's generated `init(__externalRCRefUnsafe:)` fatalErrors when
// Kotlin returns an enum whose C pointer doesn't match a per-case
// pre-cached pointer (KT-83730). Workaround: Kotlin returns the enum's
// `.name` string; Swift parses it back here.
//
// See `docs/desktop-app/specs/swift-export-enum-bug.md` for the rollback procedure once
// the upstream fix ships.

typealias ConnectionRuntimeStatus = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.ConnectionRuntimeStatus

extension PulseBarLiveListenStats {
    /// Parse `PulseBarLiveListenConnectionState` from its `.name` string.
    /// Avoids the Swift Export enum-getter crash path.
    var connectionStateParsed: PulseBarLiveListenConnectionState {
        switch connectionStateName {
        case "CONNECTING": return .CONNECTING
        case "CONNECTED": return .CONNECTED
        case "RECONNECTING": return .RECONNECTING
        case "STOPPING": return .STOPPING
        case "STOPPED": return .STOPPED
        case "FAILED": return .FAILED
        default: return .IDLE
        }
    }
}

extension ConnectionRuntimeStatus {
    var color: Color {
        switch self {
        case .Connected: return .green
        case .Disconnected: return .red
        case .Reconnecting: return .yellow
        default: return .secondary
        }
    }
}

/// Delegates to the shared Kotlin resolver and layers the optimistic
/// "connecting" state on top. Kotlin returns the enum's `name` string
/// (not the enum itself) because of Swift Export's enum-return crash —
/// see `docs/desktop-app/specs/swift-export-enum-bug.md` (KT-83730).
@MainActor
func resolveConnectionStatus(
    endpoint: PulseBarEndpointDraft,
    sync: PulseBarEndpointSyncState?,
    manuallyDisconnected: Bool,
    isConnecting: Bool
) -> ConnectionRuntimeStatus {
    if isConnecting { return .Reconnecting }
    let name = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.resolveDraftConnectionStatus(
        endpoint: endpoint,
        sync: sync,
        manuallyDisconnected: manuallyDisconnected
    )
    switch name {
    case "Connected": return .Connected
    case "Reconnecting": return .Reconnecting
    default: return .Disconnected
    }
}
