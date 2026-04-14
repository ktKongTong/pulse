import Combine
import Foundation
import PulseBarShared

@MainActor
final class NativeMonitorModel: ObservableObject {
    @Published private(set) var snapshot: LiveSnapshot?
    @Published private(set) var todayStats: [UsageRow] = []
    @Published private(set) var todayTotalSeconds: Int = 0
    @Published private(set) var interactionItems: [InteractionItem] = []
    @Published private(set) var interactionPendingCount: Int = 0
    @Published private(set) var interactionLastStatus: String?
    @Published var settingsDraft = SettingsDraft()
    @Published var isPaused = false
    @Published var dashboardSelection: DashboardSection = .dashboard

    private var loopTask: Task<Void, Never>?
    private let bridge = PulseBarBridge()

    func start() {
        guard loopTask == nil else { return }
        settingsDraft = Self.mapConfig(bridge.readConfig())
        loopTask = Task {
            while !Task.isCancelled {
                if !isPaused {
                    await refresh()
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    func togglePaused() {
        isPaused.toggle()
    }

    func refresh() async {
        let state = bridge.readMenuState()
        snapshot = state.snapshot.map(Self.mapSnapshot(_:))

        let today = Self.todayIsoString()
        let statsPage = bridge.readStats(dayIso: today, limit: 100)
        todayStats = statsPage.items.map(Self.mapUsageRow(_:))
        todayTotalSeconds = Int(statsPage.totalSeconds)

        let interactionState = bridge.readInteractionState()
        interactionItems = interactionState.items.map(Self.mapInteractionItem(_:))
        interactionPendingCount = Int(interactionState.pendingCount)
        interactionLastStatus = interactionState.lastStatus
    }

    func saveConfig() {
        bridge.updateConfig(config: Self.makeConfig(from: settingsDraft))
    }

    func mediaCommand(_ command: PulseBarPlaybackCommand) {
        _ = bridge.mediaCommand(command: command)
    }

    func seekMedia(to progressSeconds: Double) {
        _ = bridge.seekMedia(progressSeconds: progressSeconds)
    }

    func acceptInteraction(_ requestId: String) {
        _ = bridge.acceptInteraction(requestId: requestId)
        Task { await refresh() }
    }

    func dismissInteraction(_ requestId: String) {
        _ = bridge.dismissInteraction(requestId: requestId)
        Task { await refresh() }
    }

    private static func mapSnapshot(_ snapshot: PulseBarSnapshot) -> LiveSnapshot {
        let formatter = ISO8601DateFormatter()
        return LiveSnapshot(
            appName: snapshot.appName,
            bundleId: snapshot.bundleId,
            pageTitle: snapshot.pageTitle,
            observedAt: formatter.date(from: snapshot.observedAtIso8601) ?? Date(),
            media: snapshot.media.map(mapMedia(_:))
        )
    }

    private static func mapMedia(_ media: PulseBarMedia) -> MediaInfo {
        MediaInfo(
            id: media.trackId ?? UUID().uuidString,
            providerId: media.providerId,
            source: media.source,
            itemType: media.itemType,
            title: media.title,
            artist: media.artist,
            album: media.album,
            albumArtist: media.albumArtist,
            artworkURL: media.artworkUrl.flatMap(URL.init(string:)),
            progressSeconds: media.progressSeconds,
            durationSeconds: media.durationSeconds > 0 ? Int(media.durationSeconds) : nil,
            link: media.linkUrl,
            isPlaying: media.isPlaying,
            trackNumber: media.trackNumber.map(Int.init).flatMap { $0 > 0 ? $0 : nil },
            discNumber: media.discNumber.map(Int.init).flatMap { $0 > 0 ? $0 : nil },
            collectionId: media.collectionId,
            collectionTitle: media.collectionTitle,
            collectionLink: media.collectionLinkUrl
        )
    }

    private static func mapUsageRow(_ row: PulseBarUsageRow) -> UsageRow {
        UsageRow(
            id: row.key,
            key: row.key,
            label: row.label,
            bundleId: row.bundleId,
            totalSeconds: Int(row.totalSeconds)
        )
    }

    private static func mapInteractionItem(_ item: PulseBarInteractionItem) -> InteractionItem {
        let formatter = ISO8601DateFormatter()
        return InteractionItem(
            id: item.requestId,
            requestId: item.requestId,
            status: item.status,
            provider: item.provider,
            uri: item.uri,
            title: item.title,
            issuedAt: formatter.date(from: item.issuedAtIso8601) ?? Date(),
            updatedAt: formatter.date(from: item.updatedAtIso8601) ?? Date(),
            targetDeviceId: item.targetDeviceId,
            errorCode: item.errorCode,
            errorMessage: item.errorMessage
        )
    }

    private static func todayIsoString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private static func mapConfig(_ config: PulseBarConfig) -> SettingsDraft {
        SettingsDraft(
            endpointEnabled: config.endpointEnabled,
            transport: mapTransportName(config.transportName),
            endpointUrl: config.endpointUrl,
            apiKey: config.apiKey,
            batchWindowSeconds: Int(config.batchWindowSeconds),
            idleThresholdSeconds: Int(config.idleThresholdSeconds),
            changeStabilityMillis: Int(config.changeStabilityMillis),
            heartbeatSeconds: Int(config.heartbeatSeconds),
            appPollingMillis: Int(config.appPollingMillis),
            pagePollingMillis: Int(config.pagePollingMillis),
            mediaPollingMillis: Int(config.mediaPollingMillis),
            allowWebInteractions: config.allowWebInteractions,
            interactionExecutionMode: mapInteractionModeName(config.interactionExecutionModeName),
            interactionPlaybackMode: mapInteractionPlaybackModeName(config.interactionPlaybackModeName)
        )
    }

    private static func makeConfig(from draft: SettingsDraft) -> PulseBarConfig {
        PulseBarConfig(
            endpointEnabled: draft.endpointEnabled,
            transport: mapTransport(draft.transport),
            transportName: draft.transport.rawValue,
            endpointUrl: draft.endpointUrl,
            apiKey: draft.apiKey,
            batchWindowSeconds: Int32(draft.batchWindowSeconds),
            idleThresholdSeconds: Int32(draft.idleThresholdSeconds),
            changeStabilityMillis: Int32(draft.changeStabilityMillis),
            heartbeatSeconds: Int32(draft.heartbeatSeconds),
            appPollingMillis: Int32(draft.appPollingMillis),
            pagePollingMillis: Int32(draft.pagePollingMillis),
            mediaPollingMillis: Int32(draft.mediaPollingMillis),
            allowWebInteractions: draft.allowWebInteractions,
            interactionExecutionMode: mapInteractionMode(draft.interactionExecutionMode),
            interactionExecutionModeName: draft.interactionExecutionMode.rawValue,
            interactionPlaybackMode: mapInteractionPlaybackMode(draft.interactionPlaybackMode),
            interactionPlaybackModeName: draft.interactionPlaybackMode.rawValue
        )
    }

    private static func mapTransport(_ transport: PulseBarTransport) -> TransportOption {
        switch transport {
        case .WEBHOOK:
            return .webhook
        case .HTTP_BATCH:
            return .httpBatch
        default:
            return .websocket
        }
    }

    private static func mapTransportName(_ transport: String) -> TransportOption {
        switch transport {
        case "WEBHOOK":
            return .webhook
        case "HTTP_BATCH":
            return .httpBatch
        default:
            return .websocket
        }
    }

    private static func mapTransport(_ transport: TransportOption) -> PulseBarTransport {
        switch transport {
        case .webhook:
            return .WEBHOOK
        case .httpBatch:
            return .HTTP_BATCH
        case .websocket:
            return .WEBSOCKET
        }
    }

    private static func mapInteractionModeName(_ raw: String) -> InteractionExecutionMode {
        switch raw {
        case "AUTO_ENQUEUE":
            return .autoEnqueue
        default:
            return .confirm
        }
    }

    private static func mapInteractionMode(_ mode: InteractionExecutionMode) -> PulseBarInteractionExecutionMode {
        switch mode {
        case .autoEnqueue:
            return .AUTO_ENQUEUE
        case .confirm:
            return .CONFIRM
        }
    }

    private static func mapInteractionPlaybackModeName(_ raw: String) -> InteractionPlaybackMode {
        switch raw {
        case "PLAY_NOW":
            return .playNow
        default:
            return .playNext
        }
    }

    private static func mapInteractionPlaybackMode(_ mode: InteractionPlaybackMode) -> PulseBarInteractionPlaybackMode {
        switch mode {
        case .playNow:
            return .PLAY_NOW
        case .playNext:
            return .PLAY_NEXT
        }
    }
}
