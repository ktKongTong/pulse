import Foundation
import SwiftUI
@preconcurrency import PulseBarShared

// MARK: - Kotlin-type adapters
//
// The only Swift-side additions to the Kotlin export types are:
//  - `Identifiable` conformances so SwiftUI `ForEach` + `.tag(_:)` work
//  - `@unchecked Sendable` markings for the cross-actor observer hop
//  - `artworkURL` — wraps the Kotlin `String?` URL in a Foundation `URL`.
//
// Everything else (ISO8601 parsing, UUID generation, time formatting,
// sentinel-to-optional lifts, endpoint normalization) is owned by Kotlin.

extension PulseBarUsageRow: @retroactive Identifiable {
    public var id: String { key }
}

extension PulseBarInteractionItem: @retroactive Identifiable {
    public var id: String { requestId }
}

extension PulseBarEndpointSyncState: @retroactive Identifiable {}
extension PulseBarEndpointDraft: @retroactive Identifiable {}
extension LiveListenEndpointResolved: @retroactive Identifiable {}

extension PulseBarLiveListenStats: @retroactive @unchecked Sendable {}
extension PulseBarMedia: @retroactive @unchecked Sendable {}
extension PulseBarSnapshot: @retroactive @unchecked Sendable {}

extension PulseBarMedia {
    /// Wrap the Kotlin `String?` URL in a Foundation `URL` for `AsyncImage`.
    var artworkURL: URL? { artworkUrl.flatMap(URL.init(string:)) }
}

extension PulseBarLiveListenStats {
    /// Parse the Kotlin enum from its string name. Going through
    /// `connectionStateName` avoids Swift Export's
    /// `init(__externalRCRefUnsafe:)` enum-getter path, which fatalErrors
    /// at runtime. See `docs/app/swift-export-enum-bug.md` (KT-83730).
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

// MARK: - ConnectionRuntimeStatus adapter
//
// Shared with Settings / Live Listen views. Lives here so the workaround
// is discoverable in one place (see `docs/app/swift-export-enum-bug.md`
// for why we parse from a String instead of reading the Kotlin enum
// directly).

typealias ConnectionRuntimeStatus = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.ConnectionRuntimeStatus

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
/// see `docs/app/swift-export-enum-bug.md` (KT-83730).
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
