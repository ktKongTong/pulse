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
    var endpointEnabled = false
    var transport: TransportOption = .websocket
    var endpointUrl = ""
    var apiKey = ""
    var batchWindowSeconds = 15
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
