import Foundation
@preconcurrency import PulseBarShared

/// Platform-only aggregate used by the multi-endpoint capture pane. Carries
/// a full `PulseBarStreamStats` (Kotlin class) plus the platform-level
/// display fields (endpoint URL / workspace id / human-readable name).
struct StreamEndpointPublisherStatus: Identifiable, Equatable {
    let id: String
    let name: String
    let endpointURL: String
    let workspaceId: String
    let statusText: String
    let stats: PulseBarStreamStats

    static func == (lhs: StreamEndpointPublisherStatus, rhs: StreamEndpointPublisherStatus) -> Bool {
        lhs.id == rhs.id &&
            lhs.name == rhs.name &&
            lhs.endpointURL == rhs.endpointURL &&
            lhs.workspaceId == rhs.workspaceId &&
            lhs.statusText == rhs.statusText &&
            lhs.stats === rhs.stats
    }
}

enum StreamMediaStreamPermission: String {
    case allow
    case disallow
}

enum StreamMediaPlaybackStatus: String {
    case playing
    case paused
}
