import Foundation
@preconcurrency import PulseBarShared

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

extension SettingsDraft {
    /// Project the SwiftUI form state into the Kotlin-side primitive draft.
    var kotlinDraft: PulseBarConfigDraft {
        PulseBarConfigDraft(
            endpoints: endpoints.map { $0.kotlinDraft },
            idleThresholdSeconds: Int32(idleThresholdSeconds),
            changeStabilityMillis: Int32(changeStabilityMillis),
            heartbeatSeconds: Int32(heartbeatSeconds),
            appPollingMillis: Int32(appPollingMillis),
            pagePollingMillis: Int32(pagePollingMillis),
            mediaPollingMillis: Int32(mediaPollingMillis),
            allowWebInteractions: allowWebInteractions,
            interactionExecutionModeName: interactionExecutionMode.rawValue,
            interactionPlaybackModeName: interactionPlaybackMode.rawValue
        )
    }

    /// Build a Swift SettingsDraft from the Kotlin draft (used when the
    /// config observer emits a fresh value).
    init(kotlinDraft: PulseBarConfigDraft) {
        self.endpoints = kotlinDraft.endpoints.map { EndpointSettingsDraft(kotlin: $0) }
        self.idleThresholdSeconds = Int(kotlinDraft.idleThresholdSeconds)
        self.changeStabilityMillis = Int(kotlinDraft.changeStabilityMillis)
        self.heartbeatSeconds = Int(kotlinDraft.heartbeatSeconds)
        self.appPollingMillis = Int(kotlinDraft.appPollingMillis)
        self.pagePollingMillis = Int(kotlinDraft.pagePollingMillis)
        self.mediaPollingMillis = Int(kotlinDraft.mediaPollingMillis)
        self.allowWebInteractions = kotlinDraft.allowWebInteractions
        self.interactionExecutionMode = InteractionExecutionMode(rawValue: kotlinDraft.interactionExecutionModeName) ?? .confirm
        self.interactionPlaybackMode = InteractionPlaybackMode(rawValue: kotlinDraft.interactionPlaybackModeName) ?? .playNext
    }
}

struct EndpointSettingsDraft: Identifiable, Equatable {
    var id: String
    var name: String
    var enabled: Bool
    var disconnected: Bool
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
            disconnected: false,
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

extension EndpointSettingsDraft {
    init(kotlin: PulseBarEndpointDraft) {
        self.id = kotlin.id
        self.name = kotlin.name
        self.enabled = kotlin.enabled
        self.disconnected = kotlin.disconnected
        self.transport = TransportOption(rawValue: kotlin.transportName) ?? .websocket
        self.endpointUrl = kotlin.endpointUrl
        self.workspaceId = kotlin.workspaceId
        self.siteId = kotlin.siteId
        self.apiKey = kotlin.apiKey
        self.batchWindowSeconds = Int(kotlin.batchWindowSeconds)
    }

    var kotlinDraft: PulseBarEndpointDraft {
        PulseBarEndpointDraft(
            id: id,
            name: name,
            enabled: enabled,
            disconnected: disconnected,
            transportName: transport.rawValue,
            endpointUrl: endpointUrl,
            workspaceId: workspaceId,
            siteId: siteId,
            apiKey: apiKey,
            batchWindowSeconds: Int32(batchWindowSeconds)
        )
    }
}


struct LiveListenEndpointConfig: Equatable {
    let id: String
    let name: String
    let baseURL: URL
    let workspaceId: String
    let apiKey: String
}


extension LiveListenEndpointConfig {
    static func fromEndpointDraft(_ endpoint: EndpointSettingsDraft) -> LiveListenEndpointConfig? {
        let workspaceId = endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let apiKey = endpoint.apiKey
        guard !workspaceId.isEmpty, !apiKey.isEmpty else { return nil }
        // The Kotlin normalizer strips `/api/v2/presence/ingest`,
        // `/api/v1/live-listen`, `/api/v1/meta`, query, fragment, trailing
        // slash — shared with the Kotlin presence reporter so both sides
        // agree on the same base URL.
        guard let normalized = ExportedKotlinPackages.io.github.kt.pulsebar.core.platform.normalizePulseBaseUrl(raw: endpoint.endpointUrl),
              let baseURL = URL(string: normalized) else { return nil }
        return LiveListenEndpointConfig(
            id: endpoint.id,
            name: endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines),
            baseURL: baseURL,
            workspaceId: workspaceId,
            apiKey: apiKey
        )
    }

    /// Build from the Kotlin-side `PulseBarEndpointDraft` that already comes
    /// out of `PulseBarConfigFactory.liveListenCandidateEndpoints`.
    static func fromKotlinDraft(_ endpoint: PulseBarEndpointDraft) -> LiveListenEndpointConfig? {
        let workspaceId = endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let apiKey = endpoint.apiKey
        guard !workspaceId.isEmpty, !apiKey.isEmpty else { return nil }
        guard let normalized = ExportedKotlinPackages.io.github.kt.pulsebar.core.platform.normalizePulseBaseUrl(raw: endpoint.endpointUrl),
              let baseURL = URL(string: normalized) else { return nil }
        return LiveListenEndpointConfig(
            id: endpoint.id,
            name: endpoint.name.trimmingCharacters(in: .whitespacesAndNewlines),
            baseURL: baseURL,
            workspaceId: workspaceId,
            apiKey: apiKey
        )
    }
}
