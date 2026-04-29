import Foundation

struct MediaInfo: Equatable, Identifiable {
    let id: String
    let providerId: String
    let source: String
    let itemType: String
    let title: String
    let artist: String
    let album: String?
    let albumArtist: String?
    let artworkURL: URL?
    let progressSeconds: Double
    let durationSeconds: Int?
    let link: String?
    let isPlaying: Bool
    let trackNumber: Int?
    let discNumber: Int?
    let collectionId: String?
    let collectionTitle: String?
    let collectionLink: String?
}

struct InteractionItem: Identifiable, Equatable {
    let id: String
    let requestId: String
    let status: String
    let provider: String
    let uri: String
    let title: String?
    let issuedAt: Date
    let updatedAt: Date
    let targetDeviceId: String?
    let errorCode: String?
    let errorMessage: String?
}

struct UsageRow: Identifiable, Equatable {
    let id: String
    let key: String
    let label: String
    let bundleId: String
    let totalSeconds: Int
}

struct LiveSnapshot: Equatable {
    let appName: String
    let bundleId: String
    let pageTitle: String?
    let observedAt: Date
    let media: MediaInfo?
}

struct EndpointSyncStatusInfo: Identifiable, Equatable {
    let id: String
    let name: String
    let enabled: Bool
    let transportName: String
    let endpointURL: String
    let status: String
    let lastStatus: String?
    let pendingCount: Int
    let needsAttention: Bool
    let lastAttemptAt: Date?
    let lastProbeAt: Date?
    let lastSuccessAt: Date?
    let lastFailureAt: Date?
    let lastErrorMessage: String?
    let diagnosticMessage: String?
    let acknowledgedSeqMax: Int
    let acknowledgedAt: Date?
}

struct SyncStatusInfo: Equatable {
    let enabled: Bool
    let enabledEndpointCount: Int
    let totalEndpointCount: Int
    let status: String
    let lastStatus: String?
    let pendingCount: Int
    let needsAttention: Bool
    let endpoints: [EndpointSyncStatusInfo]
}

enum DashboardSection: String, CaseIterable, Identifiable {
    case dashboard
    case activity
    case sync
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .activity: return "Activity"
        case .sync: return "Sync"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: return "square.grid.2x2.fill"
        case .activity: return "chart.bar.doc.horizontal.fill"
        case .sync: return "antenna.radiowaves.left.and.right"
        case .settings: return "slider.horizontal.3"
        }
    }
}

enum TransportOption: String, CaseIterable, Identifiable {
    case websocket = "WEBSOCKET"
    case webhook = "WEBHOOK"
    case httpBatch = "HTTP_BATCH"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .websocket: return "WebSocket"
        case .webhook: return "Webhook"
        case .httpBatch: return "HTTP Batch"
        }
    }
}

enum InteractionExecutionMode: String, CaseIterable, Identifiable {
    case confirm = "CONFIRM"
    case autoEnqueue = "AUTO_ENQUEUE"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .confirm: return "Confirm First"
        case .autoEnqueue: return "Auto Enqueue"
        }
    }
}

enum InteractionPlaybackMode: String, CaseIterable, Identifiable {
    case playNow = "PLAY_NOW"
    case playNext = "PLAY_NEXT"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .playNow: return "Play Now"
        case .playNext: return "Play Next"
        }
    }
}

struct SettingsDraft: Equatable {
    var endpoints: [EndpointSettingsDraft] = [EndpointSettingsDraft.defaultPrimary()]
    var idleThresholdSeconds = 300
    var changeStabilityMillis = 1200
    var heartbeatSeconds = 60
    var appPollingMillis = 500
    var pagePollingMillis = 2000
    var mediaPollingMillis = 500
    var allowWebInteractions = true
    var interactionExecutionMode: InteractionExecutionMode = .confirm
    var interactionPlaybackMode: InteractionPlaybackMode = .playNext
}

struct EndpointSettingsDraft: Identifiable, Equatable {
    var id: String
    var name: String
    var enabled: Bool
    var transport: TransportOption
    var endpointUrl: String
    var workspaceId: String
    var siteId: String
    var apiKey: String
    var batchWindowSeconds: Int

    static func `default`(index: Int) -> EndpointSettingsDraft {
        EndpointSettingsDraft(
            id: UUID().uuidString.lowercased(),
            name: "Endpoint \(index + 1)",
            enabled: false,
            transport: .websocket,
            endpointUrl: "",
            workspaceId: "",
            siteId: "",
            apiKey: "",
            batchWindowSeconds: 15
        )
    }

    static func defaultPrimary() -> EndpointSettingsDraft {
        var draft = EndpointSettingsDraft.default(index: 0)
        draft.name = "Primary endpoint"
        return draft
    }
}
