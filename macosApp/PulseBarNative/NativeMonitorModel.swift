import Combine
import Foundation
import PulseBarShared

@MainActor
final class NativeMonitorModel: ObservableObject {
    @Published private(set) var snapshot: LiveSnapshot?
    @Published private(set) var todayStats: [UsageRow] = []
    @Published var settingsDraft = SettingsDraft()
    @Published var isPaused = false

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
        todayStats = [state.firstUsage, state.secondUsage, state.thirdUsage]
            .compactMap { $0 }
            .map(Self.mapUsageRow(_:))
    }

    func saveConfig() {
        bridge.updateConfig(config: Self.makeConfig(from: settingsDraft))
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
            source: media.source,
            title: media.title,
            artist: media.artist,
            album: media.album,
            artworkURL: media.artworkUrl.flatMap(URL.init(string:)),
            progressSeconds: media.progressSeconds,
            durationSeconds: media.durationSeconds > 0 ? Int(media.durationSeconds) : nil,
            link: media.linkUrl,
            isPlaying: media.isPlaying
        )
    }

    private static func mapUsageRow(_ row: PulseBarUsageRow) -> UsageRow {
        UsageRow(
            id: UUID().uuidString,
            label: row.label,
            totalSeconds: Int(row.totalSeconds)
        )
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
            mediaPollingMillis: Int(config.mediaPollingMillis)
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
            mediaPollingMillis: Int32(draft.mediaPollingMillis)
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
}
