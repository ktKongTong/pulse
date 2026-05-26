import Foundation
import SwiftUI
@preconcurrency import PulseBarShared

typealias ConnectionRuntimeStatus = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.ConnectionRuntimeStatus

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
/// "connecting" state on top.
@MainActor
func resolveConnectionStatus(
    endpoint: PulseBarEndpointDraft,
    sync: PulseBarEndpointSyncState?,
    manuallyDisconnected: Bool,
    isConnecting: Bool
) -> ConnectionRuntimeStatus {
    if isConnecting { return .Reconnecting }
    return ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.resolveDraftConnectionStatus(
        endpoint: endpoint,
        sync: sync,
        manuallyDisconnected: manuallyDisconnected
    )
}
