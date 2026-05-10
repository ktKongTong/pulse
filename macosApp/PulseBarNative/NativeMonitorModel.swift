import AppKit
import Combine
import Foundation
@preconcurrency import PulseBarShared

@MainActor
final class NativeMonitorModel: ObservableObject {
    @Published private(set) var snapshot: LiveSnapshot?
    @Published private(set) var todayStats: [UsageRow] = []
    @Published private(set) var todayTotalSeconds: Int = 0
    @Published private(set) var interactionItems: [InteractionItem] = []
    @Published private(set) var interactionPendingCount: Int = 0
    @Published private(set) var interactionLastStatus: String?
    @Published private(set) var syncState: SyncStatusInfo?
    @Published private(set) var connectingEndpointIDs: Set<String> = []
    @Published private(set) var isMonitoring = false
    @Published var settingsDraft = SettingsDraft()
    @Published var isPaused = false
    @Published var dashboardSelection: DashboardSection = .connection

    private let bridgeWorker = NativeBridgeWorker()
    let liveListenCaptureModel: LiveListenCaptureModel
    private var subscribed = false

    nonisolated(unsafe) private static let iso8601Formatter = ISO8601DateFormatter()
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    init() {
        self.liveListenCaptureModel = LiveListenCaptureModel(bridge: bridgeWorker)
    }

    final class NativeBridgeWorker: LiveListenBridge, @unchecked Sendable {
        private let queue = DispatchQueue(label: "io.github.kt.pulsebar.native.bridge", qos: .utility)
        private var bridge: PulseBarBridge!
        private var cancellables: [PulseBarCancellable] = []

        init() {
            queue.sync {
                bridge = PulseBarBridge()
            }
        }

        func subscribeAll(
            onMenuState: @escaping @MainActor (PulseBarMenuState) -> Void,
            onConfig: @escaping @MainActor (PulseBarConfig) -> Void,
            onSyncState: @escaping @MainActor (PulseBarSyncState) -> Void,
            onInteractionState: @escaping @MainActor (PulseBarInteractionState) -> Void,
            onTodayStats: @escaping @MainActor (PulseBarTodayStats) -> Void
        ) {
            queue.async {
                self.cancellables.append(self.bridge.observeMenuState { state in
                    DispatchQueue.main.async { onMenuState(state) }
                })
                self.cancellables.append(self.bridge.observeConfig { config in
                    DispatchQueue.main.async { onConfig(config) }
                })
                self.cancellables.append(self.bridge.observeSyncState { state in
                    DispatchQueue.main.async { onSyncState(state) }
                })
                self.cancellables.append(self.bridge.observeInteractionState { state in
                    DispatchQueue.main.async { onInteractionState(state) }
                })
                self.cancellables.append(self.bridge.observeTodayStats { stats in
                    DispatchQueue.main.async { onTodayStats(stats) }
                })
            }
        }

        func cancelAll() {
            queue.async {
                for c in self.cancellables { c.cancel() }
                self.cancellables.removeAll()
            }
        }

        func forceTick() {
            queue.async { self.bridge.forceTick() }
        }

        func updateConfig(from draft: SettingsDraft, completion: (@MainActor () -> Void)? = nil) {
            queue.async {
                self.bridge.updateConfig(config: NativeMonitorModel.makeConfig(from: draft))
                if let completion {
                    DispatchQueue.main.async {
                        completion()
                    }
                }
            }
        }

        func retry(completion: @escaping @MainActor () -> Void) {
            queue.async {
                _ = self.bridge.retryEndpoint()
                DispatchQueue.main.async {
                    completion()
                }
            }
        }

        func mediaCommand(_ command: PulseBarPlaybackCommand) {
            queue.async {
                _ = self.bridge.mediaCommand(command: command)
            }
        }

        func seekMedia(to progressSeconds: Double) {
            queue.async {
                _ = self.bridge.seekMedia(progressSeconds: progressSeconds)
            }
        }

        func acceptInteraction(_ requestId: String, completion: @escaping @MainActor () -> Void) {
            queue.async {
                _ = self.bridge.acceptInteraction(requestId: requestId)
                DispatchQueue.main.async {
                    completion()
                }
            }
        }

        func dismissInteraction(_ requestId: String, completion: @escaping @MainActor () -> Void) {
            queue.async {
                _ = self.bridge.dismissInteraction(requestId: requestId)
                DispatchQueue.main.async {
                    completion()
                }
            }
        }

        // MARK: LiveListenBridge

        func startLiveListen(
            roomId: String,
            deviceId: String,
            baseUrl: String,
            workspaceId: String,
            apiKey: String,
            sampleRate: Int32,
            channels: Int32,
            chunkDurationMs: Int32
        ) {
            queue.async {
                self.bridge.startLiveListen(
                    roomId: roomId,
                    deviceId: deviceId,
                    baseUrl: baseUrl,
                    workspaceId: workspaceId,
                    apiKey: apiKey,
                    sampleRate: sampleRate,
                    channels: channels,
                    chunkDurationMs: chunkDurationMs
                )
            }
        }

        func stopLiveListen() {
            queue.async { self.bridge.stopLiveListen() }
        }

        func submitLiveListenPcmBase64(_ encoded: String) {
            queue.async { self.bridge.submitLiveListenPcmBase64(chunkBase64: encoded) }
        }

        func updateLiveListenMediaState(permissionAllow: Bool, playbackPlaying: Bool, captureRunning: Bool) {
            queue.async {
                self.bridge.updateLiveListenMediaState(
                    permissionAllow: permissionAllow,
                    playbackPlaying: playbackPlaying,
                    captureRunning: captureRunning
                )
            }
        }

        func updateLiveListenMedia(
            providerId: String?,
            trackId: String?,
            title: String?,
            artist: String?,
            album: String?,
            artworkUrl: String?,
            durationSeconds: Double,
            isPlaying: Bool
        ) {
            queue.async {
                self.bridge.updateLiveListenMedia(
                    providerId: providerId,
                    trackId: trackId,
                    title: title,
                    artist: artist,
                    album: album,
                    artworkUrl: artworkUrl,
                    durationSeconds: durationSeconds,
                    isPlaying: isPlaying
                )
            }
        }

        func observeLiveListenStats(
            onSnapshot: @escaping @MainActor (LiveListenPublisherStats) -> Void,
            cancellableReceived: @escaping @MainActor (PulseBarCancellable) -> Void
        ) {
            queue.async {
                let cancellable = self.bridge.observeLiveListenStats { stats in
                    let mapped = LiveListenPublisherStats(from: stats)
                    DispatchQueue.main.async { onSnapshot(mapped) }
                }
                DispatchQueue.main.async { cancellableReceived(cancellable) }
            }
        }
    }

    func start() {
        PulseNativeLog.info(.liveListenSession, "monitor.start")
        if subscribed {
            isPaused = false
            return
        }
        isMonitoring = true
        isPaused = false
        subscribed = true

        bridgeWorker.subscribeAll(
            onMenuState: { [weak self] state in
                self?.applyMenuStateUpdate(state)
            },
            onConfig: { [weak self] config in
                self?.applyConfigUpdate(config)
            },
            onSyncState: { [weak self] state in
                self?.applySyncStateUpdate(state)
            },
            onInteractionState: { [weak self] state in
                self?.applyInteractionStateUpdate(state)
            },
            onTodayStats: { [weak self] stats in
                self?.applyTodayStatsUpdate(stats)
            }
        )

        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    deinit {
        bridgeWorker.cancelAll()
    }

    func prepareLiveListenCapturePane() {
        liveListenCaptureModel.refreshSources()
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    func requestLiveListenAudioCapturePermissionAtStartup() {
        liveListenCaptureModel.requestAudioCapturePermissionAtStartup()
    }

    func startDebugNativeLiveListenStream(preferredProvider: String? = nil, preferredBundleId: String? = nil) {
        liveListenCaptureModel.selectPreferredSource(preferredProvider: preferredProvider, preferredBundleId: preferredBundleId)
        let endpoints = liveListenEndpoints
        let endpointList = endpoints.map { $0.baseURL.absoluteString }.joined(separator: ",")
        let source = liveListenCaptureModel.selectedSource?.name ?? "nil"
        PulseNativeLog.info(.liveListenSession, "debug.stream.start endpoints=\(endpointList) source=\(source)")
        liveListenCaptureModel.updateEndpoints(endpoints)
        dashboardSelection = .connection
        liveListenCaptureModel.startNativeStream()
    }

    func stopDebugNativeLiveListenStream() {
        PulseNativeLog.info(.liveListenSession, "debug.stream.stop")
        liveListenCaptureModel.stopCapture()
    }

    func stop() {
        isMonitoring = false
        isPaused = true
    }

    func togglePaused() {
        if !isMonitoring {
            start()
            return
        }
        isPaused.toggle()
        if !isPaused {
            bridgeWorker.forceTick()
        }
    }

    func resumeAndRefresh() {
        if !isMonitoring {
            start()
            return
        }
        isPaused = false
        bridgeWorker.forceTick()
    }

    func refreshMenuBarContent() {
        if !isMonitoring {
            start()
            return
        }
        isPaused = false
        bridgeWorker.forceTick()
    }

    private func applyMenuStateUpdate(_ state: PulseBarMenuState) {
        let mapped = Self.mapSnapshotObject(state.snapshot)
        applySnapshotIfNeeded(mapped)
        liveListenCaptureModel.updateCurrentMedia(mapped?.media)
    }

    private func applyTodayStatsUpdate(_ stats: PulseBarTodayStats) {
        let rows = stats.topRows.map { row in
            Self.mapUsageRow(
                key: row.key,
                label: row.label,
                bundleId: row.bundleId,
                totalSeconds: Int(row.totalSeconds),
            )
        }
        if todayStats != rows {
            todayStats = rows
        }
        let total = Int(stats.totalSeconds)
        if todayTotalSeconds != total {
            todayTotalSeconds = total
        }
    }

    private func applyConfigUpdate(_ config: PulseBarConfig) {
        let draft = Self.mapConfig(config)
        if settingsDraft != draft {
            settingsDraft = draft
        }
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    private func applySyncStateUpdate(_ state: PulseBarSyncState) {
        let mapped = Self.mapSyncStateObject(state)
        if syncState != mapped {
            syncState = mapped
        }
        clearFinishedConnectingEndpoints(mapped)
    }

    private func applyInteractionStateUpdate(_ state: PulseBarInteractionState) {
        let mapped = Self.mapInteractionStateObject(state)
        if interactionItems != mapped.items {
            interactionItems = mapped.items
        }
        if interactionPendingCount != mapped.pendingCount {
            interactionPendingCount = mapped.pendingCount
        }
        if interactionLastStatus != mapped.lastStatus {
            interactionLastStatus = mapped.lastStatus
        }
    }

    func saveConfig() {
        bridgeWorker.updateConfig(from: settingsDraft) { [weak self] in
            self?.bridgeWorker.forceTick()
        }
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    var liveListenEndpoints: [LiveListenEndpointConfig] {
        let enabled = settingsDraft.endpoints.compactMap { endpoint -> LiveListenEndpointConfig? in
            guard endpoint.enabled && !endpoint.disconnected else { return nil }
            return LiveListenEndpointConfig.fromEndpointDraft(endpoint)
        }
        if !enabled.isEmpty { return enabled }
        return settingsDraft.endpoints.compactMap { endpoint in
            LiveListenEndpointConfig.fromEndpointDraft(endpoint)
        }
    }

    func addEndpoint() {
        if settingsDraft.endpoints.isEmpty {
            settingsDraft.endpoints.append(.defaultPrimary())
        } else {
            settingsDraft.endpoints.append(.default(index: settingsDraft.endpoints.count))
        }
    }

    func removeEndpoint(_ endpointID: String) {
        settingsDraft.endpoints.removeAll { $0.id == endpointID }
        saveConfig()
    }

    func setEndpointEnabled(_ endpointID: String, enabled: Bool) {
        guard let index = settingsDraft.endpoints.firstIndex(where: { $0.id == endpointID }) else {
            return
        }
        settingsDraft.endpoints[index].enabled = enabled
        saveConfig()
    }

    func disconnectEndpoint(_ endpointID: String) {
        guard let index = settingsDraft.endpoints.firstIndex(where: { $0.id == endpointID }) else {
            return
        }
        settingsDraft.endpoints[index].disconnected = true
        connectingEndpointIDs.remove(endpointID)
        saveConfig()
    }

    func connectEndpoint(_ endpointID: String) {
        guard let index = settingsDraft.endpoints.firstIndex(where: { $0.id == endpointID }) else {
            return
        }
        settingsDraft.endpoints[index].disconnected = false
        connectingEndpointIDs.insert(endpointID)
        saveConfig()
        retryEndpoint(endpointID: endpointID)
    }

    func mediaCommand(_ command: PulseBarPlaybackCommand) {
        bridgeWorker.mediaCommand(command)
    }

    func seekMedia(to progressSeconds: Double) {
        bridgeWorker.seekMedia(to: progressSeconds)
    }

    func acceptInteraction(_ requestId: String) {
        bridgeWorker.acceptInteraction(requestId) { [weak self] in
            self?.bridgeWorker.forceTick()
        }
    }

    func dismissInteraction(_ requestId: String) {
        bridgeWorker.dismissInteraction(requestId) { [weak self] in
            self?.bridgeWorker.forceTick()
        }
    }

    func retryEndpoint(endpointID: String? = nil) {
        if let endpointID {
            connectingEndpointIDs.insert(endpointID)
        }
        bridgeWorker.retry { [weak self] in
            if let endpointID {
                self?.connectingEndpointIDs.remove(endpointID)
            }
        }
    }

    nonisolated private static func mapMedia(
        providerId: String,
        source: String,
        itemType: String,
        title: String,
        artist: String,
        album: String?,
        albumArtist: String?,
        artworkURL: String?,
        progressSeconds: Double,
        durationSeconds: Int,
        linkURL: String?,
        trackId: String?,
        isPlaying: Bool,
        trackNumber: NSNumber?,
        discNumber: NSNumber?,
        collectionId: String?,
        collectionTitle: String?,
        collectionLinkURL: String?
    ) -> MediaInfo {
        MediaInfo(
            id: trackId ?? UUID().uuidString,
            providerId: providerId,
            source: source,
            itemType: itemType,
            title: title,
            artist: artist,
            album: album,
            albumArtist: albumArtist,
            artworkURL: artworkURL.flatMap(URL.init(string:)),
            progressSeconds: progressSeconds,
            durationSeconds: durationSeconds > 0 ? durationSeconds : nil,
            link: linkURL,
            isPlaying: isPlaying,
            trackNumber: trackNumber.map(\.intValue).flatMap { $0 > 0 ? $0 : nil },
            discNumber: discNumber.map(\.intValue).flatMap { $0 > 0 ? $0 : nil },
            collectionId: collectionId,
            collectionTitle: collectionTitle,
            collectionLink: collectionLinkURL
        )
    }

    nonisolated private static func mapUsageRow(
        key: String,
        label: String,
        bundleId: String,
        totalSeconds: Int
    ) -> UsageRow {
        UsageRow(
            id: key,
            key: key,
            label: label,
            bundleId: bundleId,
            totalSeconds: totalSeconds
        )
    }

    nonisolated private static func mapInteractionItem(
        requestId: String,
        status: String,
        provider: String,
        uri: String,
        title: String?,
        issuedAtIso8601: String,
        updatedAtIso8601: String,
        targetDeviceId: String?,
        errorCode: String?,
        errorMessage: String?
    ) -> InteractionItem {
        return InteractionItem(
            id: requestId,
            requestId: requestId,
            status: status,
            provider: provider,
            uri: uri,
            title: title,
            issuedAt: iso8601Formatter.date(from: issuedAtIso8601) ?? Date(),
            updatedAt: iso8601Formatter.date(from: updatedAtIso8601) ?? Date(),
            targetDeviceId: targetDeviceId,
            errorCode: errorCode,
            errorMessage: errorMessage
        )
    }

    nonisolated private static func mapEndpointDraft(
        id: String,
        name: String,
        enabled: Bool,
        disconnected: Bool,
        transport: TransportOption,
        endpointURL: String,
        workspaceId: String,
        siteId: String,
        apiKey: String,
        batchWindowSeconds: Int
    ) -> EndpointSettingsDraft {
        EndpointSettingsDraft(
            id: id,
            name: name,
            enabled: enabled,
            disconnected: disconnected,
            transport: transport,
            endpointUrl: endpointURL,
            workspaceId: workspaceId,
            siteId: siteId,
            apiKey: apiKey,
            batchWindowSeconds: max(batchWindowSeconds, 1)
        )
    }

    nonisolated private static func mapEndpointSyncState(
        id: String,
        name: String,
        enabled: Bool,
        transportName: String,
        endpointURL: String,
        status: String,
        lastStatus: String?,
        pendingCount: Int,
        needsAttention: Bool,
        lastAttemptAtIso8601: String?,
        lastProbeAtIso8601: String?,
        lastSuccessAtIso8601: String?,
        lastFailureAtIso8601: String?,
        lastErrorMessage: String?,
        diagnosticMessage: String?,
        acknowledgedSeqMax: Int,
        acknowledgedAtIso8601: String?
    ) -> EndpointSyncStatusInfo {
        EndpointSyncStatusInfo(
            id: id,
            name: name,
            enabled: enabled,
            transportName: transportName,
            endpointURL: endpointURL,
            status: status,
            lastStatus: lastStatus,
            pendingCount: pendingCount,
            needsAttention: needsAttention,
            lastAttemptAt: lastAttemptAtIso8601.flatMap(iso8601Formatter.date(from:)),
            lastProbeAt: lastProbeAtIso8601.flatMap(iso8601Formatter.date(from:)),
            lastSuccessAt: lastSuccessAtIso8601.flatMap(iso8601Formatter.date(from:)),
            lastFailureAt: lastFailureAtIso8601.flatMap(iso8601Formatter.date(from:)),
            lastErrorMessage: lastErrorMessage,
            diagnosticMessage: diagnosticMessage,
            acknowledgedSeqMax: acknowledgedSeqMax,
            acknowledgedAt: acknowledgedAtIso8601.flatMap(iso8601Formatter.date(from:))
        )
    }

    nonisolated private static func mapSyncState(
        enabled: Bool,
        enabledEndpointCount: Int,
        totalEndpointCount: Int,
        status: String,
        lastStatus: String?,
        pendingCount: Int,
        needsAttention: Bool,
        endpoints: [EndpointSyncStatusInfo]
    ) -> SyncStatusInfo {
        SyncStatusInfo(
            enabled: enabled,
            enabledEndpointCount: enabledEndpointCount,
            totalEndpointCount: totalEndpointCount,
            status: status,
            lastStatus: lastStatus,
            pendingCount: pendingCount,
            needsAttention: needsAttention,
            endpoints: endpoints
        )
    }

    private static func todayIsoString() -> String {
        dayFormatter.string(from: Date())
    }

    nonisolated private static func mapSnapshotObject(_ snapshot: PulseBarSnapshot?) -> LiveSnapshot? {
        guard let snapshot else { return nil }
        let media = snapshot.media.map { media in
            mapMedia(
                providerId: media.providerId,
                source: media.source,
                itemType: media.itemType,
                title: media.title,
                artist: media.artist,
                album: media.album,
                albumArtist: media.albumArtist,
                artworkURL: media.artworkUrl,
                progressSeconds: media.progressSeconds,
                durationSeconds: Int(media.durationSeconds),
                linkURL: media.linkUrl,
                trackId: media.trackId,
                isPlaying: media.isPlaying,
                trackNumber: media.trackNumber.map(NSNumber.init(value:)),
                discNumber: media.discNumber.map(NSNumber.init(value:)),
                collectionId: media.collectionId,
                collectionTitle: media.collectionTitle,
                collectionLinkURL: media.collectionLinkUrl
            )
        }
        // snapshot.appName already carries the resolved display name from
        // the Kotlin side (see PulseBarBridge.resolvedApplicationName, which
        // delegates to resolveAppDisplayName on macOS).
        return LiveSnapshot(
            appName: snapshot.appName,
            bundleId: snapshot.bundleId,
            pageTitle: snapshot.pageTitle,
            observedAt: iso8601Formatter.date(from: snapshot.observedAtIso8601) ?? Date(),
            media: media
        )
    }

    nonisolated private static func mapStatsPage(_ page: PulseBarStatsPage) -> (items: [UsageRow], totalSeconds: Int) {
        (
            page.items.map { row in
                mapUsageRow(
                    key: row.key,
                    label: row.label,
                    bundleId: row.bundleId,
                    totalSeconds: Int(row.totalSeconds)
                )
            },
            Int(page.totalSeconds)
        )
    }

    nonisolated private static func mapInteractionStateObject(
        _ state: PulseBarInteractionState
    ) -> (items: [InteractionItem], pendingCount: Int, lastStatus: String?) {
        (
            state.items.map { item in
                mapInteractionItem(
                    requestId: item.requestId,
                    status: item.status,
                    provider: item.provider,
                    uri: item.uri,
                    title: item.title,
                    issuedAtIso8601: item.issuedAtIso8601,
                    updatedAtIso8601: item.updatedAtIso8601,
                    targetDeviceId: item.targetDeviceId,
                    errorCode: item.errorCode,
                    errorMessage: item.errorMessage
                )
            },
            Int(state.pendingCount),
            state.lastStatus
        )
    }

    nonisolated private static func mapSyncStateObject(_ state: PulseBarSyncState) -> SyncStatusInfo {
        mapSyncState(
            enabled: state.enabled,
            enabledEndpointCount: Int(state.enabledEndpointCount),
            totalEndpointCount: Int(state.totalEndpointCount),
            status: state.status,
            lastStatus: state.lastStatus,
            pendingCount: Int(state.pendingCount),
            needsAttention: state.needsAttention,
            endpoints: state.endpoints.map { endpoint in
                mapEndpointSyncState(
                    id: endpoint.id,
                    name: endpoint.name,
                    enabled: endpoint.enabled,
                    transportName: endpoint.transportName,
                    endpointURL: endpoint.endpointUrl,
                    status: endpoint.status,
                    lastStatus: endpoint.lastStatus,
                    pendingCount: Int(endpoint.pendingCount),
                    needsAttention: endpoint.needsAttention,
                    lastAttemptAtIso8601: endpoint.lastAttemptAtIso8601,
                    lastProbeAtIso8601: endpoint.lastProbeAtIso8601,
                    lastSuccessAtIso8601: endpoint.lastSuccessAtIso8601,
                    lastFailureAtIso8601: endpoint.lastFailureAtIso8601,
                    lastErrorMessage: endpoint.lastErrorMessage,
                    diagnosticMessage: endpoint.diagnosticMessage,
                    acknowledgedSeqMax: Int(endpoint.acknowledgedSeqMax),
                    acknowledgedAtIso8601: endpoint.acknowledgedAtIso8601
                )
            }
        )
    }

    private func clearFinishedConnectingEndpoints(_ syncState: SyncStatusInfo) {
        guard !connectingEndpointIDs.isEmpty else { return }
        for endpoint in syncState.endpoints where connectingEndpointIDs.contains(endpoint.id) {
            if endpoint.status != "disabled" && endpoint.status != "disconnected" {
                connectingEndpointIDs.remove(endpoint.id)
            }
        }
    }

    private func applySnapshotIfNeeded(_ nextSnapshot: LiveSnapshot?) {
        // Kotlin's menu state flow is a StateFlow that already de-dupes on
        // structural equality; the only remaining job here is to republish
        // when the mapped LiveSnapshot differs from what SwiftUI already has.
        if snapshot != nextSnapshot {
            snapshot = nextSnapshot
        }
    }

    nonisolated private static func mapConfig(_ config: PulseBarConfig) -> SettingsDraft {
        let endpoints: [EndpointSettingsDraft] = config.endpoints.map { endpoint in
            mapEndpointDraft(
                id: endpoint.id,
                name: endpoint.name,
                enabled: endpoint.enabled,
                disconnected: endpoint.disconnected,
                transport: mapTransportName(endpoint.transportName),
                endpointURL: endpoint.endpointUrl,
                workspaceId: endpoint.workspaceId,
                siteId: endpoint.siteId,
                apiKey: endpoint.apiKey,
                batchWindowSeconds: Int(endpoint.batchWindowSeconds)
            )
        }
        return SettingsDraft(
            endpoints: endpoints,
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

    nonisolated private static func makeConfig(from draft: SettingsDraft) -> PulseBarConfig {
        let endpoints = draft.endpoints.map { endpoint in
            PulseBarEndpointConfig(
                id: endpoint.id,
                name: endpoint.name,
                enabled: endpoint.enabled,
                disconnected: endpoint.disconnected,
                transport: mapTransport(endpoint.transport),
                transportName: endpoint.transport.rawValue,
                endpointUrl: endpoint.endpointUrl,
                workspaceId: endpoint.workspaceId,
                siteId: endpoint.siteId,
                apiKey: endpoint.apiKey,
                batchWindowSeconds: Int32(endpoint.batchWindowSeconds)
            )
        }
        return PulseBarConfig(
            endpoints: endpoints,
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

    nonisolated private static func mapTransport(_ transport: PulseBarTransport) -> TransportOption {
        switch transport {
        case .WEBHOOK:
            return .webhook
        case .HTTP_BATCH:
            return .httpBatch
        default:
            return .websocket
        }
    }

    nonisolated private static func mapTransportName(_ transport: String) -> TransportOption {
        switch transport {
        case "WEBHOOK":
            return .webhook
        case "HTTP_BATCH":
            return .httpBatch
        default:
            return .websocket
        }
    }

    nonisolated private static func mapTransport(_ transport: TransportOption) -> PulseBarTransport {
        switch transport {
        case .webhook:
            return .WEBHOOK
        case .httpBatch:
            return .HTTP_BATCH
        case .websocket:
            return .WEBSOCKET
        }
    }

    nonisolated private static func mapInteractionModeName(_ raw: String) -> InteractionExecutionMode {
        switch raw {
        case "AUTO_ENQUEUE":
            return .autoEnqueue
        default:
            return .confirm
        }
    }

    nonisolated private static func mapInteractionMode(_ mode: InteractionExecutionMode) -> PulseBarInteractionExecutionMode {
        switch mode {
        case .autoEnqueue:
            return .AUTO_ENQUEUE
        case .confirm:
            return .CONFIRM
        }
    }

    nonisolated private static func mapInteractionPlaybackModeName(_ raw: String) -> InteractionPlaybackMode {
        switch raw {
        case "PLAY_NOW":
            return .playNow
        default:
            return .playNext
        }
    }

    nonisolated private static func mapInteractionPlaybackMode(_ mode: InteractionPlaybackMode) -> PulseBarInteractionPlaybackMode {
        switch mode {
        case .playNow:
            return .PLAY_NOW
        case .playNext:
            return .PLAY_NEXT
        }
    }
}
