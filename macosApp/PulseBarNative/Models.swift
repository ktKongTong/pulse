import Foundation
@preconcurrency import PulseBarShared

/// SwiftUI navigation selection. Pure shell concern (SF Symbol names are
/// Apple-only); nothing to move to Kotlin.
enum DashboardSection: String, CaseIterable, Identifiable {
    case connection
    case reporting
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .connection: return "Connection"
        case .reporting: return "Reporting"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .connection: return "antenna.radiowaves.left.and.right"
        case .reporting: return "app.badge"
        case .settings: return "slider.horizontal.3"
        }
    }
}

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
