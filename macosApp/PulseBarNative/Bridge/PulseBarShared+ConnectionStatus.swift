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

extension PulseBarStreamStats {
    /// Parse `PulseBarStreamConnectionState` from its `.name` string.
    /// Avoids the Swift Export enum-getter crash path.
    var connectionStateParsed: PulseBarStreamConnectionState {
        switch connectionStateName {
        case "CONNECTING", "Connecting": return .CONNECTING
        case "CONNECTED", "Connected": return .CONNECTED
        case "RECONNECTING", "Reconnecting": return .RECONNECTING
        case "STOPPING", "Stopping": return .STOPPING
        case "STOPPED", "Stopped": return .STOPPED
        case "FAILED", "Failed": return .FAILED
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
        }
    }
}

extension PulseBarStreamConnectionState {
    var connectionRuntimeStatus: ConnectionRuntimeStatus {
        switch self {
        case .CONNECTED:
            return .Connected
        case .CONNECTING, .RECONNECTING, .STOPPING:
            return .Reconnecting
        case .IDLE, .STOPPED, .FAILED:
            return .Disconnected
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
