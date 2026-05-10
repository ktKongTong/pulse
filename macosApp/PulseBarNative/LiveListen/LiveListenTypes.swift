import Foundation
@preconcurrency import PulseBarShared

/// Platform-only aggregate used by the multi-endpoint capture pane. Carries
/// a full `PulseBarLiveListenStats` (Kotlin class) plus the platform-level
/// display fields (endpoint URL / workspace id / human-readable name).
struct LiveListenEndpointPublisherStatus: Identifiable, Equatable {
    let id: String
    let name: String
    let endpointURL: String
    let workspaceId: String
    let statusText: String
    let stats: PulseBarLiveListenStats

    static func == (lhs: LiveListenEndpointPublisherStatus, rhs: LiveListenEndpointPublisherStatus) -> Bool {
        lhs.id == rhs.id &&
            lhs.name == rhs.name &&
            lhs.endpointURL == rhs.endpointURL &&
            lhs.workspaceId == rhs.workspaceId &&
            lhs.statusText == rhs.statusText &&
            lhs.stats === rhs.stats
    }
}

enum LiveListenMediaStreamPermission: String {
    case allow
    case disallow
}

enum LiveListenMediaPlaybackStatus: String {
    case playing
    case paused
}
