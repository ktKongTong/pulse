import Foundation

struct MediaInfo: Equatable, Identifiable {
    let id: String
    let source: String
    let title: String
    let artist: String
    let album: String?
    let artworkURL: URL?
    let progressSeconds: Double
    let durationSeconds: Int?
    let link: String?
    let isPlaying: Bool
}

struct UsageRow: Identifiable, Equatable {
    let id: String
    let label: String
    let totalSeconds: Int
}

struct LiveSnapshot: Equatable {
    let appName: String
    let bundleId: String
    let pageTitle: String?
    let observedAt: Date
    let media: MediaInfo?
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
}
