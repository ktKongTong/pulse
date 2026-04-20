import AppKit
import Combine
import Foundation
import PulseBarShared
@_implementationOnly import SharedBridge_PulseBarShared

@MainActor
final class NativeMonitorModel: ObservableObject {
    @Published private(set) var snapshot: LiveSnapshot?
    @Published private(set) var todayStats: [UsageRow] = []
    @Published private(set) var todayTotalSeconds: Int = 0
    @Published private(set) var interactionItems: [InteractionItem] = []
    @Published private(set) var interactionPendingCount: Int = 0
    @Published private(set) var interactionLastStatus: String?
    @Published private(set) var syncState: SyncStatusInfo?
    @Published var settingsDraft = SettingsDraft()
    @Published var isPaused = false
    @Published var dashboardSelection: DashboardSection = .dashboard

    private var loopTask: Task<Void, Never>?
    private let bridge = PulseBarBridge()
    private var lastStatsRefreshAt: Date = .distantPast
    private var lastInteractionRefreshAt: Date = .distantPast
    private var lastSyncRefreshAt: Date = .distantPast

    private static let iso8601Formatter = ISO8601DateFormatter()
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    @_silgen_name("Kotlin_native_internal_ref_disposeExternalRCRef")
    private static func disposeExternalRCRef(_ ref: UnsafeMutableRawPointer?)

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
    }

    func start() {
        guard loopTask == nil else { return }
        settingsDraft = Self.mapConfig(bridge.readConfig())
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

    func togglePaused() {
        isPaused.toggle()
    }

    func refresh() {
        let now = Date()
        let today = Self.todayIsoString()
        let payload = autoreleasepool { () -> RefreshPayload in
            let bridgeRef = Self.externalRCRef(of: bridge as AnyObject)
            let snapshot = Self.readSnapshot(bridgeRef: bridgeRef)

            var todayStats: [UsageRow]?
            var todayTotalSeconds: Int?
            var statsRefreshedAt: Date?
            if shouldRefreshStats(now: now) {
                let stats = Self.readStats(
                    bridgeRef: bridgeRef,
                    dayIso: today,
                    limit: 100
                )
                todayStats = stats.items
                todayTotalSeconds = stats.totalSeconds
                statsRefreshedAt = now
            }

            var interactionItems: [InteractionItem]?
            var interactionPendingCount: Int?
            var interactionLastStatus: String?
            var interactionRefreshedAt: Date?
            if now.timeIntervalSince(lastInteractionRefreshAt) >= 2 {
                let interactionState = Self.readInteractionState(bridgeRef: bridgeRef)
                interactionItems = interactionState.items
                interactionPendingCount = interactionState.pendingCount
                interactionLastStatus = interactionState.lastStatus
                interactionRefreshedAt = now
            }

            var syncState: SyncStatusInfo?
            var syncRefreshedAt: Date?
            if now.timeIntervalSince(lastSyncRefreshAt) >= 2 {
                syncState = Self.readSyncState(bridgeRef: bridgeRef)
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

        applySnapshotIfNeeded(payload.snapshot)

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
            lastSyncRefreshAt = refreshedAt
        }
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
        lastInteractionRefreshAt = .distantPast
        Task { @MainActor in refresh() }
    }

    func dismissInteraction(_ requestId: String) {
        _ = bridge.dismissInteraction(requestId: requestId)
        lastInteractionRefreshAt = .distantPast
        Task { @MainActor in refresh() }
    }

    func retryEndpoint() {
        _ = bridge.retryEndpoint()
        lastSyncRefreshAt = .distantPast
        Task { @MainActor in refresh() }
    }

    private static func mapMedia(
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

    private static func mapUsageRow(
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

    private static func mapInteractionItem(
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

    private static func mapSyncState(
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
        acknowledgedSeqMax: Int,
        acknowledgedAtIso8601: String?
    ) -> SyncStatusInfo {
        return SyncStatusInfo(
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
            acknowledgedSeqMax: acknowledgedSeqMax,
            acknowledgedAt: acknowledgedAtIso8601.flatMap(iso8601Formatter.date(from:))
        )
    }

    private static func todayIsoString() -> String {
        dayFormatter.string(from: Date())
    }

    private static func resolvedDisplayName(appName: String, bundleId: String) -> String {
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

    private func shouldRefreshStats(now: Date) -> Bool {
        guard now.timeIntervalSince(lastStatsRefreshAt) >= 5 else { return false }
        return NSApp.isActive
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

    private static func externalRCRef(of object: AnyObject) -> UnsafeMutableRawPointer? {
        let selector = NSSelectorFromString("externalRCRef")
        typealias Function = @convention(c) (AnyObject, Selector) -> UnsafeMutableRawPointer?
        let implementation = object.method(for: selector)
        let function = unsafeBitCast(implementation, to: Function.self)
        return function(object, selector)
    }

    private static func withDisposedExternalRef<T>(
        _ ref: UnsafeMutableRawPointer?,
        _ body: (UnsafeMutableRawPointer) -> T
    ) -> T? {
        guard let ref else { return nil }
        defer { disposeExternalRCRef(ref) }
        return body(ref)
    }

    private static func readSnapshot(bridgeRef: UnsafeMutableRawPointer?) -> LiveSnapshot? {
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

    private static func readStats(
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

    private static func readInteractionState(
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

    private static func readSyncState(bridgeRef: UnsafeMutableRawPointer?) -> SyncStatusInfo? {
        guard let bridgeRef else { return nil }
        let syncRef = io_github_kt_pulsebar_export_PulseBarBridge_readSyncState(bridgeRef)
        return withDisposedExternalRef(syncRef) { syncRef in
            mapSyncState(
                enabled: io_github_kt_pulsebar_export_PulseBarSyncState_enabled_get(syncRef),
                transportName: io_github_kt_pulsebar_export_PulseBarSyncState_transportName_get(syncRef),
                endpointURL: io_github_kt_pulsebar_export_PulseBarSyncState_endpointUrl_get(syncRef),
                status: io_github_kt_pulsebar_export_PulseBarSyncState_status_get(syncRef),
                lastStatus: io_github_kt_pulsebar_export_PulseBarSyncState_lastStatus_get(syncRef),
                pendingCount: Int(io_github_kt_pulsebar_export_PulseBarSyncState_pendingCount_get(syncRef)),
                needsAttention: io_github_kt_pulsebar_export_PulseBarSyncState_needsAttention_get(syncRef),
                lastAttemptAtIso8601: io_github_kt_pulsebar_export_PulseBarSyncState_lastAttemptAtIso8601_get(syncRef),
                lastProbeAtIso8601: io_github_kt_pulsebar_export_PulseBarSyncState_lastProbeAtIso8601_get(syncRef),
                lastSuccessAtIso8601: io_github_kt_pulsebar_export_PulseBarSyncState_lastSuccessAtIso8601_get(syncRef),
                lastFailureAtIso8601: io_github_kt_pulsebar_export_PulseBarSyncState_lastFailureAtIso8601_get(syncRef),
                lastErrorMessage: io_github_kt_pulsebar_export_PulseBarSyncState_lastErrorMessage_get(syncRef),
                acknowledgedSeqMax: Int(io_github_kt_pulsebar_export_PulseBarSyncState_acknowledgedSeqMax_get(syncRef)),
                acknowledgedAtIso8601: io_github_kt_pulsebar_export_PulseBarSyncState_acknowledgedAtIso8601_get(syncRef)
            )
        }
    }

    private var pollIntervalMillis: Int {
        min(max(settingsDraft.appPollingMillis, 750), 5_000)
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
