import AppKit
import Combine
import Foundation
@preconcurrency import PulseBarShared
import SharedBridge_PulseBarShared

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

    private var loopTask: Task<Void, Never>?
    private let bridgeWorker = NativeBridgeWorker()
    let liveListenCaptureModel = LiveListenCaptureModel()
    private var lastStatsRefreshAt: Date = .distantPast
    private var lastInteractionRefreshAt: Date = .distantPast
    private var lastSyncRefreshAt: Date = .distantPast
    private var refreshInFlight = false

    nonisolated(unsafe) private static let iso8601Formatter = ISO8601DateFormatter()
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    @_silgen_name("Kotlin_native_internal_ref_disposeExternalRCRef")
    nonisolated private static func disposeExternalRCRef(_ ref: UnsafeMutableRawPointer?)

    init() {}

    private struct RefreshPayload {
        let snapshot: LiveSnapshot?
        let todayStats: [UsageRow]?
        let todayTotalSeconds: Int?
        let interactionItems: [InteractionItem]?
        let interactionPendingCount: Int?
        let interactionLastStatus: String?
        let syncState: SyncStatusInfo?
        let statsRefreshedAt: Date?
        let interactionRefreshedAt: Date?
        let syncRefreshedAt: Date?

        static let empty = RefreshPayload(
            snapshot: nil,
            todayStats: nil,
            todayTotalSeconds: nil,
            interactionItems: nil,
            interactionPendingCount: nil,
            interactionLastStatus: nil,
            syncState: nil,
            statsRefreshedAt: nil,
            interactionRefreshedAt: nil,
            syncRefreshedAt: nil
        )
    }

    private final class NativeBridgeWorker: @unchecked Sendable {
        private let queue = DispatchQueue(label: "io.github.kt.pulsebar.native.bridge", qos: .utility)
        private var bridge: PulseBarBridge!

        init() {
            queue.sync {
                bridge = PulseBarBridge()
            }
        }

        func readSettingsDraft(_ completion: @escaping @MainActor (SettingsDraft) -> Void) {
            queue.async {
                let draft = NativeMonitorModel.mapConfig(self.bridge.readConfig())
                DispatchQueue.main.async {
                    completion(draft)
                }
            }
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

        func refresh(
            today: String,
            now: Date,
            shouldRefreshStats: Bool,
            shouldRefreshInteraction: Bool,
            shouldRefreshSync: Bool,
            completion: @escaping @MainActor (RefreshPayload) -> Void
        ) {
            queue.async {
                let payload = autoreleasepool { () -> RefreshPayload in
                    let snapshot = NativeMonitorModel.mapSnapshotObject(self.bridge.readMenuState().snapshot)

                    var todayStats: [UsageRow]?
                    var todayTotalSeconds: Int?
                    var statsRefreshedAt: Date?
                    if shouldRefreshStats {
                        let stats = NativeMonitorModel.mapStatsPage(self.bridge.readStats(dayIso: today, limit: 100))
                        todayStats = stats.items
                        todayTotalSeconds = stats.totalSeconds
                        statsRefreshedAt = now
                    }

                    var interactionItems: [InteractionItem]?
                    var interactionPendingCount: Int?
                    var interactionLastStatus: String?
                    var interactionRefreshedAt: Date?
                    if shouldRefreshInteraction {
                        let interactionState = NativeMonitorModel.mapInteractionStateObject(self.bridge.readInteractionState())
                        interactionItems = interactionState.items
                        interactionPendingCount = interactionState.pendingCount
                        interactionLastStatus = interactionState.lastStatus
                        interactionRefreshedAt = now
                    }

                    var syncState: SyncStatusInfo?
                    var syncRefreshedAt: Date?
                    if shouldRefreshSync {
                        syncState = NativeMonitorModel.mapSyncStateObject(self.bridge.readSyncState())
                        syncRefreshedAt = now
                    }

                    return RefreshPayload(
                        snapshot: snapshot,
                        todayStats: todayStats,
                        todayTotalSeconds: todayTotalSeconds,
                        interactionItems: interactionItems,
                        interactionPendingCount: interactionPendingCount,
                        interactionLastStatus: interactionLastStatus,
                        syncState: syncState,
                        statsRefreshedAt: statsRefreshedAt,
                        interactionRefreshedAt: interactionRefreshedAt,
                        syncRefreshedAt: syncRefreshedAt
                    )
                }

                DispatchQueue.main.async {
                    completion(payload)
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
    }

    func start() {
        PulseNativeLog.info(.liveListenSession, "monitor.start")
        if loopTask != nil {
            isPaused = false
            return
        }
        isMonitoring = true
        isPaused = false
        bridgeWorker.readSettingsDraft { [weak self] draft in
            guard let self else { return }
            self.settingsDraft = draft
            self.liveListenCaptureModel.updateEndpoints(self.liveListenEndpoints)
            self.refresh(forceStatsRefresh: true)
        }
        refresh(forceStatsRefresh: true)
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
        loopTask = Task {
            while !Task.isCancelled {
                if !isPaused {
                    refresh()
                }
                try? await Task.sleep(for: .milliseconds(pollIntervalMillis))
            }
        }
    }

    deinit {
        loopTask?.cancel()
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
        loopTask?.cancel()
        loopTask = nil
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
            refresh()
        }
    }

    func resumeAndRefresh() {
        if !isMonitoring {
            start()
            return
        }
        isPaused = false
        refresh()
    }

    func refreshMenuBarContent() {
        if !isMonitoring {
            start()
            return
        }
        isPaused = false
        refresh(forceStatsRefresh: true)
    }

    func refresh(forceStatsRefresh: Bool = false) {
        guard !refreshInFlight else { return }
        let now = Date()
        let today = Self.todayIsoString()
        let shouldRefreshStats = forceStatsRefresh || shouldRefreshStats(now: now)
        let shouldRefreshInteraction = now.timeIntervalSince(lastInteractionRefreshAt) >= 2
        let shouldRefreshSync = now.timeIntervalSince(lastSyncRefreshAt) >= 2
        refreshInFlight = true

        bridgeWorker.refresh(
            today: today,
            now: now,
            shouldRefreshStats: shouldRefreshStats,
            shouldRefreshInteraction: shouldRefreshInteraction,
            shouldRefreshSync: shouldRefreshSync
        ) { [weak self] payload in
            guard let self else { return }
            self.refreshInFlight = false
            self.applyRefreshPayload(payload)
        }
    }

    private func applyRefreshPayload(_ payload: RefreshPayload) {
        applySnapshotIfNeeded(payload.snapshot)
        liveListenCaptureModel.updateCurrentMedia(payload.snapshot?.media)

        if let todayStats = payload.todayStats,
           let todayTotalSeconds = payload.todayTotalSeconds,
           let refreshedAt = payload.statsRefreshedAt {
            if self.todayStats != todayStats {
                self.todayStats = todayStats
            }
            if self.todayTotalSeconds != todayTotalSeconds {
                self.todayTotalSeconds = todayTotalSeconds
            }
            lastStatsRefreshAt = refreshedAt
        }

        if let interactionItems = payload.interactionItems,
           let interactionPendingCount = payload.interactionPendingCount,
           let refreshedAt = payload.interactionRefreshedAt {
            if self.interactionItems != interactionItems {
                self.interactionItems = interactionItems
            }
            if self.interactionPendingCount != interactionPendingCount {
                self.interactionPendingCount = interactionPendingCount
            }
            if interactionLastStatus != payload.interactionLastStatus {
                interactionLastStatus = payload.interactionLastStatus
            }
            lastInteractionRefreshAt = refreshedAt
        }

        if let syncState = payload.syncState,
           let refreshedAt = payload.syncRefreshedAt {
            if self.syncState != syncState {
                self.syncState = syncState
            }
            clearFinishedConnectingEndpoints(syncState)
            lastSyncRefreshAt = refreshedAt
        }
    }

    func saveConfig() {
        bridgeWorker.updateConfig(from: settingsDraft)
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
        lastSyncRefreshAt = .distantPast
        Task { @MainActor in refresh() }
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
        lastInteractionRefreshAt = .distantPast
        bridgeWorker.acceptInteraction(requestId) { [weak self] in
            self?.refresh()
        }
    }

    func dismissInteraction(_ requestId: String) {
        lastInteractionRefreshAt = .distantPast
        bridgeWorker.dismissInteraction(requestId) { [weak self] in
            self?.refresh()
        }
    }

    func retryEndpoint(endpointID: String? = nil) {
        if let endpointID {
            connectingEndpointIDs.insert(endpointID)
        }
        lastSyncRefreshAt = .distantPast
        bridgeWorker.retry { [weak self] in
            if let endpointID {
                self?.connectingEndpointIDs.remove(endpointID)
            }
            self?.lastSyncRefreshAt = .distantPast
            self?.refresh()
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

    nonisolated private static func resolvedDisplayName(appName: String, bundleId: String) -> String {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId),
           let bundle = Bundle(url: url) {
            let preferredName =
                bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ??
                bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
            if let preferredName, !preferredName.isEmpty {
                return preferredName
            }
        }
        return appName
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
        return LiveSnapshot(
            appName: resolvedDisplayName(appName: snapshot.appName, bundleId: snapshot.bundleId),
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

    private func shouldRefreshStats(now: Date) -> Bool {
        guard now.timeIntervalSince(lastStatsRefreshAt) >= 5 else { return false }
        return NSApp.isActive
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
        let currentSignature = Self.snapshotRenderSignature(snapshot)
        let nextSignature = Self.snapshotRenderSignature(nextSnapshot)
        if currentSignature != nextSignature {
            snapshot = nextSnapshot
        }
    }

    private static func snapshotRenderSignature(_ snapshot: LiveSnapshot?) -> SnapshotRenderSignature? {
        guard let snapshot else { return nil }
        return SnapshotRenderSignature(
            appName: snapshot.appName,
            bundleId: snapshot.bundleId,
            pageTitle: snapshot.pageTitle,
            media: snapshot.media.map { media in
                MediaRenderSignature(
                    id: media.id,
                    providerId: media.providerId,
                    source: media.source,
                    itemType: media.itemType,
                    title: media.title,
                    artist: media.artist,
                    album: media.album,
                    albumArtist: media.albumArtist,
                    artworkURL: media.artworkURL,
                    progressBucket: Int(media.progressSeconds.rounded(.down)),
                    durationSeconds: media.durationSeconds,
                    link: media.link,
                    isPlaying: media.isPlaying,
                    trackNumber: media.trackNumber,
                    discNumber: media.discNumber,
                    collectionId: media.collectionId,
                    collectionTitle: media.collectionTitle,
                    collectionLink: media.collectionLink
                )
            }
        )
    }

    private struct SnapshotRenderSignature: Equatable {
        let appName: String
        let bundleId: String
        let pageTitle: String?
        let media: MediaRenderSignature?
    }

    private struct MediaRenderSignature: Equatable {
        let id: String
        let providerId: String
        let source: String
        let itemType: String
        let title: String
        let artist: String
        let album: String?
        let albumArtist: String?
        let artworkURL: URL?
        let progressBucket: Int
        let durationSeconds: Int?
        let link: String?
        let isPlaying: Bool
        let trackNumber: Int?
        let discNumber: Int?
        let collectionId: String?
        let collectionTitle: String?
        let collectionLink: String?
    }

    nonisolated private static func externalRCRef(of object: AnyObject) -> UnsafeMutableRawPointer? {
        let selector = NSSelectorFromString("externalRCRef")
        typealias Function = @convention(c) (AnyObject, Selector) -> UnsafeMutableRawPointer?
        let implementation = object.method(for: selector)
        let function = unsafeBitCast(implementation, to: Function.self)
        return function(object, selector)
    }

    nonisolated private static func withDisposedExternalRef<T>(
        _ ref: UnsafeMutableRawPointer?,
        _ body: (UnsafeMutableRawPointer) -> T
    ) -> T? {
        guard let ref else { return nil }
        defer { disposeExternalRCRef(ref) }
        return body(ref)
    }

    nonisolated private static func readSnapshot(bridgeRef: UnsafeMutableRawPointer?) -> LiveSnapshot? {
        guard let bridgeRef else { return nil }
        let menuStateRef = io_github_kt_pulsebar_export_PulseBarBridge_readMenuState(bridgeRef)
        return withDisposedExternalRef(menuStateRef) { menuStateRef in
            guard let snapshotRef = io_github_kt_pulsebar_export_PulseBarMenuState_snapshot_get(menuStateRef) else {
                return nil
            }
            return withDisposedExternalRef(snapshotRef) { snapshotRef in
                let appName = io_github_kt_pulsebar_export_PulseBarSnapshot_appName_get(snapshotRef)
                let bundleId = io_github_kt_pulsebar_export_PulseBarSnapshot_bundleId_get(snapshotRef)
                let pageTitle = io_github_kt_pulsebar_export_PulseBarSnapshot_pageTitle_get(snapshotRef)
                let observedAt = io_github_kt_pulsebar_export_PulseBarSnapshot_observedAtIso8601_get(snapshotRef)
                let media = withDisposedExternalRef(
                    io_github_kt_pulsebar_export_PulseBarSnapshot_media_get(snapshotRef)
                ) { mediaRef in
                    mapMedia(
                        providerId: io_github_kt_pulsebar_export_PulseBarMedia_providerId_get(mediaRef),
                        source: io_github_kt_pulsebar_export_PulseBarMedia_source_get(mediaRef),
                        itemType: io_github_kt_pulsebar_export_PulseBarMedia_itemType_get(mediaRef),
                        title: io_github_kt_pulsebar_export_PulseBarMedia_title_get(mediaRef),
                        artist: io_github_kt_pulsebar_export_PulseBarMedia_artist_get(mediaRef),
                        album: io_github_kt_pulsebar_export_PulseBarMedia_album_get(mediaRef),
                        albumArtist: io_github_kt_pulsebar_export_PulseBarMedia_albumArtist_get(mediaRef),
                        artworkURL: io_github_kt_pulsebar_export_PulseBarMedia_artworkUrl_get(mediaRef),
                        progressSeconds: io_github_kt_pulsebar_export_PulseBarMedia_progressSeconds_get(mediaRef),
                        durationSeconds: Int(io_github_kt_pulsebar_export_PulseBarMedia_durationSeconds_get(mediaRef)),
                        linkURL: io_github_kt_pulsebar_export_PulseBarMedia_linkUrl_get(mediaRef),
                        trackId: io_github_kt_pulsebar_export_PulseBarMedia_trackId_get(mediaRef),
                        isPlaying: io_github_kt_pulsebar_export_PulseBarMedia_isPlaying_get(mediaRef),
                        trackNumber: io_github_kt_pulsebar_export_PulseBarMedia_trackNumber_get(mediaRef),
                        discNumber: io_github_kt_pulsebar_export_PulseBarMedia_discNumber_get(mediaRef),
                        collectionId: io_github_kt_pulsebar_export_PulseBarMedia_collectionId_get(mediaRef),
                        collectionTitle: io_github_kt_pulsebar_export_PulseBarMedia_collectionTitle_get(mediaRef),
                        collectionLinkURL: io_github_kt_pulsebar_export_PulseBarMedia_collectionLinkUrl_get(mediaRef)
                    )
                }
                return LiveSnapshot(
                    appName: resolvedDisplayName(appName: appName, bundleId: bundleId),
                    bundleId: bundleId,
                    pageTitle: pageTitle,
                    observedAt: iso8601Formatter.date(from: observedAt) ?? Date(),
                    media: media
                )
            }
        } ?? nil
    }

    nonisolated private static func readStats(
        bridgeRef: UnsafeMutableRawPointer?,
        dayIso: String,
        limit: Int32
    ) -> (items: [UsageRow], totalSeconds: Int) {
        guard let bridgeRef else { return ([], 0) }
        let statsRef = io_github_kt_pulsebar_export_PulseBarBridge_readStats__TypesOfArguments__Swift_String_Swift_Int32__(
            bridgeRef,
            dayIso,
            limit
        )
        return withDisposedExternalRef(statsRef) { statsRef in
            let rawItems = io_github_kt_pulsebar_export_PulseBarStatsPage_items_get(statsRef) as [AnyObject]
            let items: [UsageRow] = rawItems.compactMap { rawObject in
                guard let rowRef = externalRCRef(of: rawObject) else { return nil }
                return withDisposedExternalRef(rowRef) { rowRef in
                    mapUsageRow(
                        key: io_github_kt_pulsebar_export_PulseBarUsageRow_key_get(rowRef),
                        label: io_github_kt_pulsebar_export_PulseBarUsageRow_label_get(rowRef),
                        bundleId: io_github_kt_pulsebar_export_PulseBarUsageRow_bundleId_get(rowRef),
                        totalSeconds: Int(io_github_kt_pulsebar_export_PulseBarUsageRow_totalSeconds_get(rowRef))
                    )
                }
            }
            return (
                items,
                Int(io_github_kt_pulsebar_export_PulseBarStatsPage_totalSeconds_get(statsRef))
            )
        } ?? ([], 0)
    }

    nonisolated private static func readInteractionState(
        bridgeRef: UnsafeMutableRawPointer?
    ) -> (items: [InteractionItem], pendingCount: Int, lastStatus: String?) {
        guard let bridgeRef else { return ([], 0, nil) }
        let interactionRef = io_github_kt_pulsebar_export_PulseBarBridge_readInteractionState(bridgeRef)
        return withDisposedExternalRef(interactionRef) { interactionRef in
            let rawItems = io_github_kt_pulsebar_export_PulseBarInteractionState_items_get(interactionRef) as [AnyObject]
            let items: [InteractionItem] = rawItems.compactMap { rawObject in
                guard let itemRef = externalRCRef(of: rawObject) else { return nil }
                return withDisposedExternalRef(itemRef) { itemRef in
                    mapInteractionItem(
                        requestId: io_github_kt_pulsebar_export_PulseBarInteractionItem_requestId_get(itemRef),
                        status: io_github_kt_pulsebar_export_PulseBarInteractionItem_status_get(itemRef),
                        provider: io_github_kt_pulsebar_export_PulseBarInteractionItem_provider_get(itemRef),
                        uri: io_github_kt_pulsebar_export_PulseBarInteractionItem_uri_get(itemRef),
                        title: io_github_kt_pulsebar_export_PulseBarInteractionItem_title_get(itemRef),
                        issuedAtIso8601: io_github_kt_pulsebar_export_PulseBarInteractionItem_issuedAtIso8601_get(itemRef),
                        updatedAtIso8601: io_github_kt_pulsebar_export_PulseBarInteractionItem_updatedAtIso8601_get(itemRef),
                        targetDeviceId: io_github_kt_pulsebar_export_PulseBarInteractionItem_targetDeviceId_get(itemRef),
                        errorCode: io_github_kt_pulsebar_export_PulseBarInteractionItem_errorCode_get(itemRef),
                        errorMessage: io_github_kt_pulsebar_export_PulseBarInteractionItem_errorMessage_get(itemRef)
                    )
                }
            }
            return (
                items,
                Int(io_github_kt_pulsebar_export_PulseBarInteractionState_pendingCount_get(interactionRef)),
                io_github_kt_pulsebar_export_PulseBarInteractionState_lastStatus_get(interactionRef)
            )
        } ?? ([], 0, nil)
    }

    nonisolated private static func readSyncState(bridgeRef: UnsafeMutableRawPointer?) -> SyncStatusInfo? {
        guard let bridgeRef else { return nil }
        let syncRef = io_github_kt_pulsebar_export_PulseBarBridge_readSyncState(bridgeRef)
        return withDisposedExternalRef(syncRef) { syncRef in
            let rawEndpoints = io_github_kt_pulsebar_export_PulseBarSyncState_endpoints_get(syncRef) as [AnyObject]
            let endpoints: [EndpointSyncStatusInfo] = rawEndpoints.compactMap { rawObject -> EndpointSyncStatusInfo? in
                guard let endpointRef = externalRCRef(of: rawObject) else { return nil }
                return withDisposedExternalRef(endpointRef) { endpointRef in
                    mapEndpointSyncState(
                        id: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_id_get(endpointRef),
                        name: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_name_get(endpointRef),
                        enabled: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_enabled_get(endpointRef),
                        transportName: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_transportName_get(endpointRef),
                        endpointURL: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_endpointUrl_get(endpointRef),
                        status: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_status_get(endpointRef),
                        lastStatus: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_lastStatus_get(endpointRef),
                        pendingCount: Int(io_github_kt_pulsebar_export_PulseBarEndpointSyncState_pendingCount_get(endpointRef)),
                        needsAttention: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_needsAttention_get(endpointRef),
                        lastAttemptAtIso8601: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_lastAttemptAtIso8601_get(endpointRef),
                        lastProbeAtIso8601: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_lastProbeAtIso8601_get(endpointRef),
                        lastSuccessAtIso8601: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_lastSuccessAtIso8601_get(endpointRef),
                        lastFailureAtIso8601: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_lastFailureAtIso8601_get(endpointRef),
                        lastErrorMessage: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_lastErrorMessage_get(endpointRef),
                        diagnosticMessage: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_diagnosticMessage_get(endpointRef),
                        acknowledgedSeqMax: Int(io_github_kt_pulsebar_export_PulseBarEndpointSyncState_acknowledgedSeqMax_get(endpointRef)),
                        acknowledgedAtIso8601: io_github_kt_pulsebar_export_PulseBarEndpointSyncState_acknowledgedAtIso8601_get(endpointRef)
                    )
                }
            }
            return mapSyncState(
                enabled: io_github_kt_pulsebar_export_PulseBarSyncState_enabled_get(syncRef),
                enabledEndpointCount: Int(io_github_kt_pulsebar_export_PulseBarSyncState_enabledEndpointCount_get(syncRef)),
                totalEndpointCount: Int(io_github_kt_pulsebar_export_PulseBarSyncState_totalEndpointCount_get(syncRef)),
                status: io_github_kt_pulsebar_export_PulseBarSyncState_status_get(syncRef),
                lastStatus: io_github_kt_pulsebar_export_PulseBarSyncState_lastStatus_get(syncRef),
                pendingCount: Int(io_github_kt_pulsebar_export_PulseBarSyncState_pendingCount_get(syncRef)),
                needsAttention: io_github_kt_pulsebar_export_PulseBarSyncState_needsAttention_get(syncRef),
                endpoints: endpoints
            )
        }
    }

    private var pollIntervalMillis: Int {
        min(max(settingsDraft.appPollingMillis, 750), 5_000)
    }

    nonisolated private static func mapConfig(_ config: PulseBarConfig) -> SettingsDraft {
        guard let configRef = externalRCRef(of: config as AnyObject) else {
            return SettingsDraft()
        }
        return withDisposedExternalRef(configRef) { configRef in
            let rawEndpoints = io_github_kt_pulsebar_export_PulseBarConfig_endpoints_get(configRef) as [AnyObject]
            let endpoints: [EndpointSettingsDraft] = rawEndpoints.compactMap { rawObject -> EndpointSettingsDraft? in
                guard let endpointRef = externalRCRef(of: rawObject) else { return nil }
                return withDisposedExternalRef(endpointRef) { endpointRef in
                    mapEndpointDraft(
                        id: io_github_kt_pulsebar_export_PulseBarEndpointConfig_id_get(endpointRef),
                        name: io_github_kt_pulsebar_export_PulseBarEndpointConfig_name_get(endpointRef),
                        enabled: io_github_kt_pulsebar_export_PulseBarEndpointConfig_enabled_get(endpointRef),
                        disconnected: io_github_kt_pulsebar_export_PulseBarEndpointConfig_disconnected_get(endpointRef),
                        transport: mapTransportName(io_github_kt_pulsebar_export_PulseBarEndpointConfig_transportName_get(endpointRef)),
                        endpointURL: io_github_kt_pulsebar_export_PulseBarEndpointConfig_endpointUrl_get(endpointRef),
                        workspaceId: io_github_kt_pulsebar_export_PulseBarEndpointConfig_workspaceId_get(endpointRef),
                        siteId: io_github_kt_pulsebar_export_PulseBarEndpointConfig_siteId_get(endpointRef),
                        apiKey: io_github_kt_pulsebar_export_PulseBarEndpointConfig_apiKey_get(endpointRef),
                        batchWindowSeconds: Int(io_github_kt_pulsebar_export_PulseBarEndpointConfig_batchWindowSeconds_get(endpointRef))
                    )
                }
            }
            return SettingsDraft(
                endpoints: endpoints,
                idleThresholdSeconds: Int(io_github_kt_pulsebar_export_PulseBarConfig_idleThresholdSeconds_get(configRef)),
                changeStabilityMillis: Int(io_github_kt_pulsebar_export_PulseBarConfig_changeStabilityMillis_get(configRef)),
                heartbeatSeconds: Int(io_github_kt_pulsebar_export_PulseBarConfig_heartbeatSeconds_get(configRef)),
                appPollingMillis: Int(io_github_kt_pulsebar_export_PulseBarConfig_appPollingMillis_get(configRef)),
                pagePollingMillis: Int(io_github_kt_pulsebar_export_PulseBarConfig_pagePollingMillis_get(configRef)),
                mediaPollingMillis: Int(io_github_kt_pulsebar_export_PulseBarConfig_mediaPollingMillis_get(configRef)),
                allowWebInteractions: io_github_kt_pulsebar_export_PulseBarConfig_allowWebInteractions_get(configRef),
                interactionExecutionMode: mapInteractionModeName(io_github_kt_pulsebar_export_PulseBarConfig_interactionExecutionModeName_get(configRef)),
                interactionPlaybackMode: mapInteractionPlaybackModeName(io_github_kt_pulsebar_export_PulseBarConfig_interactionPlaybackModeName_get(configRef))
            )
        } ?? SettingsDraft()
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
