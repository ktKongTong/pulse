@preconcurrency import AppKit
import Combine
import Darwin
import Foundation
@preconcurrency import PulseBarShared

/// Root `ObservableObject` for the SwiftUI tree. Fans out Kotlin bridge
/// observer streams onto `@Published` properties grouped by feature.
///
/// Views inject this object via `.environmentObject(...)` from
/// `PulseBarNativeApp` / `StatusItemController`.
///
/// Threading: Kotlin owns all side effects (the Kotlin bridge uses its
/// own `CoroutineScope(SupervisorJob() + Dispatchers.Default)` + internal
/// `Mutex`). Swift is a pure consumer + command issuer.
///
/// Kotlin 2.4's Swift Export exposes `Flow<T>` properties as
/// `AsyncSequence<T, Error>` (KT-64572). We consume them directly via
/// `for await` loops inside `@MainActor` `Task`s — no dispatch hop, no
/// `MainActor.assumeIsolated`, no `PulseBarCancellable` wrapper.
@MainActor
final class MonitorStore: ObservableObject {

    // MARK: - Published state

    @Published private(set) var snapshot: PulseBarSnapshot?
    @Published private(set) var todayStats: [PulseBarUsageRow] = []
    @Published private(set) var todayTotalSeconds: Int = 0
    @Published private(set) var interactionItems: [PulseBarInteractionItem] = []
    @Published private(set) var interactionPendingCount: Int = 0
    @Published private(set) var interactionLastStatus: String?
    @Published private(set) var syncState: PulseBarSyncState?
    @Published private(set) var connectionStatesByEndpointID: [String: PulseBarConnectionState] = [:]
    @Published private(set) var manuallyDisconnectedEndpointIDs: Set<String> = []
    @Published private(set) var isMonitoring = false
    @Published var settingsDraft: PulseBarConfigDraft = PulseBarConfigDraft(
        endpoints: [PulseBarConfigFactory.shared.defaultPrimaryEndpoint()],
        idleThresholdSeconds: 300,
        changeStabilityMillis: 1200,
        heartbeatSeconds: 60,
        appPollingMillis: 500,
        pagePollingMillis: 2000,
        mediaPollingMillis: 500,
        allowWebInteractions: false,
        interactionExecutionModeName: "CONFIRM",
        interactionPlaybackModeName: "PLAY_NEXT"
    )
    @Published var isPaused = false
    @Published var dashboardSelection: DashboardSection = .connection

    // MARK: - Dependencies

    private let bridge: PulseBarBridge
    private var observerTasks: [Task<Void, Never>] = []
    let streamStore: StreamCaptureStore
    private var subscribed = false
    private var frontmostAppObserver: NSObjectProtocol?
    private var connectionStores: [String: ConnectionStore] = [:]
    private let nowPlayingEventSource = NowPlayingEventSource()

    init() {
        self.bridge = PulseBarBridge()
        self.streamStore = StreamCaptureStore(bridge: bridge)
    }

    deinit {
        for t in observerTasks { t.cancel() }
        if let frontmostAppObserver {
            Task { @MainActor in
                NSWorkspace.shared.notificationCenter.removeObserver(frontmostAppObserver)
            }
        }
        nowPlayingEventSource.stop()
    }

    // MARK: - Lifecycle

    func start() {
        PulseNativeLog.info(.streamSession, "monitor.start")
        if subscribed {
            isPaused = false
            return
        }
        isMonitoring = true
        isPaused = false
        subscribed = true
        let bridge = self.bridge
        frontmostAppObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
                return
            }
            let bundleId = app.bundleIdentifier ?? "unknown"
            let name = app.localizedName ?? app.bundleIdentifier ?? "Unknown App"
            Task { @MainActor in
                self?.handleFrontmostApplicationChange(bundleId: bundleId, name: name)
            }
        }

        nowPlayingEventSource.start { [weak self] snapshot in
            Task { @MainActor in
                self?.handleNowPlayingChange(snapshot?.toNativeMediaSnapshot())
            }
        }

        let menuTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await state in bridge.menuState.asAsyncSequence() {
                    self?.applyMenuStateUpdate(state)
                }
            } catch {}
        }
        observerTasks.append(menuTask)

        let configTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await config in bridge.config.asAsyncSequence() {
                    self?.applyConfigUpdate(config)
                }
            } catch {}
        }
        observerTasks.append(configTask)

        let syncTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await state in bridge.syncState.asAsyncSequence() {
                    self?.applySyncStateUpdate(state)
                }
            } catch {}
        }
        observerTasks.append(syncTask)

        let connectionTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await states in bridge.connectionStates.asAsyncSequence() {
                    self?.applyConnectionStatesUpdate(Array(states))
                }
            } catch {}
        }
        observerTasks.append(connectionTask)

        let todayTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await stats in bridge.todayStats.asAsyncSequence() {
                    self?.applyTodayStatsUpdate(stats)
                }
            } catch {}
        }
        observerTasks.append(todayTask)

        streamStore.updateEndpoints(streamEndpoints)
    }

    func stop() {
        isMonitoring = false
        isPaused = true
    }

    func togglePaused() {
        if !isMonitoring { start(); return }
        isPaused.toggle()
        if !isPaused {
            
        }
    }

    func resumeAndRefresh() {
        streamStore.refreshAudioCapturePermissionStatus()
        if !isMonitoring { start(); return }
        isPaused = false
        // bridge.forceTick()
    }

    func refreshMenuBarContent() {
        streamStore.refreshAudioCapturePermissionStatus()
        if !isMonitoring { start(); return }
        isPaused = false
    }

    private func handleFrontmostApplicationChange(bundleId: String, name: String) {
        guard isMonitoring, !isPaused else { return }
        let event = NativeFrontmostAppChanged(
            bundleId: bundleId,
            name: name,
            observedAtMillis: nowMillis()
        )
        bridge.emitNativeEvent(event: event)
    }

    private func handleNowPlayingChange(_ snapshot: NativeMediaSnapshot?) {
        guard isMonitoring, !isPaused else { return }
        let label = snapshot?.title ?? "nil"
        PulseNativeLog.info(.streamSession, "native.nowPlaying title=\(label) playing=\(snapshot?.isPlaying == true)")
        streamStore.updateCurrentMedia(snapshot)
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    // MARK: - Stream convenience

    var isPermissionPromptBlockingInteraction: Bool {
        streamStore.blocksUserInteractionForAudioPermission
    }

    func prepareStreamCapturePane() {
        streamStore.refreshSources()
        streamStore.updateEndpoints(streamEndpoints)
    }

    func requestStreamAudioCapturePermissionAtStartup() {
        streamStore.requestAudioCapturePermissionAtStartup()
    }

    var streamEndpoints: [StreamEndpointResolved] {
        PulseBarConfigFactory.shared.resolvedStreamEndpoints(draft: settingsDraft)
    }

    // MARK: - Settings commands
    func saveConfig() {
    }

    func connectionStore(endpointId: String) -> ConnectionStore {
        if let store = connectionStores[endpointId] { return store }
        let store = ConnectionStore(endpointId: endpointId, bridge: bridge)
        connectionStores[endpointId] = store
        store.start()
        return store
    }

    func removeConnectionStore(endpointId: String) {
        connectionStores[endpointId]?.stop()
        connectionStores.removeValue(forKey: endpointId)
    }

    // MARK: - Media / interaction commands

    func mediaCommand(_ command: PulseBarPlaybackCommand) {

    }

    func seekMedia(to progressSeconds: Double) {

    }

    // MARK: - Observer handlers

    private func applyMenuStateUpdate(_ state: PulseBarMenuState) {
        snapshot = state.snapshot
    }

    private func applyTodayStatsUpdate(_ stats: PulseBarTodayStats) {
        todayStats = stats.topRows
        todayTotalSeconds = Int(stats.totalSeconds)
    }

    private func applyConfigUpdate(_ config: PulseBarConfig) {
        settingsDraft = PulseBarConfigFactory.shared.toDraft(config: config)
        streamStore.updateEndpoints(streamEndpoints)
    }

    private func applySyncStateUpdate(_ state: PulseBarSyncState) {
        syncState = state
    }

    private func applyConnectionStatesUpdate(_ states: [PulseBarConnectionState]) {
        connectionStatesByEndpointID = Dictionary(uniqueKeysWithValues: states.map { ($0.endpointId, $0) })
    }

    private func isStreamEndpoint(_ endpoint: PulseBarEndpointDraft) -> Bool {
        !endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

}

private final class NowPlayingEventSource: @unchecked Sendable {
    private typealias RegisterForNotifications = @convention(c) (DispatchQueue) -> Void
    private typealias GetNowPlayingInfo = @convention(c) (DispatchQueue, @escaping (CFDictionary?) -> Void) -> Void
    private typealias GetNowPlayingApplicationIsPlaying = @convention(c) (DispatchQueue, @escaping (Bool) -> Void) -> Void

    private var handle: UnsafeMutableRawPointer?
    private var registerForNotifications: RegisterForNotifications?
    private var getNowPlayingInfo: GetNowPlayingInfo?
    private var getNowPlayingApplicationIsPlaying: GetNowPlayingApplicationIsPlaying?
    private var observers: [NSObjectProtocol] = []
    private var onChange: (@Sendable (NowPlayingSnapshot?) -> Void)?

    func start(onChange: @escaping @Sendable (NowPlayingSnapshot?) -> Void) {
        guard self.onChange == nil else { return }
        self.onChange = onChange
        guard loadMediaRemote() else {
            PulseNativeLog.warn(.streamSession, "media.remote unavailable")
            return
        }

        registerForNotifications?(.main)
        observe("kMRMediaRemoteNowPlayingInfoDidChangeNotification")
        observe("kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification")
        observe("kMRMediaRemoteNowPlayingApplicationDidChangeNotification")
        observeDistributed("com.spotify.client.PlaybackStateChanged")
        observeDistributed("com.apple.Music.playerInfo")
        refresh()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.refresh()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) { [weak self] in
            self?.refresh()
        }
    }

    func stop() {
        observers.forEach { observer in
            NotificationCenter.default.removeObserver(observer)
            DistributedNotificationCenter.default().removeObserver(observer)
        }
        observers.removeAll()
        onChange = nil
    }

    private func loadMediaRemote() -> Bool {
        if getNowPlayingInfo != nil { return true }
        let path = "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote"
        guard let handle = dlopen(path, RTLD_NOW) else { return false }
        self.handle = handle

        guard
            let registerSymbol = dlsym(handle, "MRMediaRemoteRegisterForNowPlayingNotifications"),
            let infoSymbol = dlsym(handle, "MRMediaRemoteGetNowPlayingInfo"),
            let playingSymbol = dlsym(handle, "MRMediaRemoteGetNowPlayingApplicationIsPlaying")
        else {
            return false
        }

        registerForNotifications = unsafeBitCast(registerSymbol, to: RegisterForNotifications.self)
        getNowPlayingInfo = unsafeBitCast(infoSymbol, to: GetNowPlayingInfo.self)
        getNowPlayingApplicationIsPlaying = unsafeBitCast(playingSymbol, to: GetNowPlayingApplicationIsPlaying.self)
        return true
    }

    private func observe(_ name: String) {
        let observer = NotificationCenter.default.addObserver(
            forName: Notification.Name(name),
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.refresh()
        }
        observers.append(observer)
    }

    private func observeDistributed(_ name: String) {
        let observer = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name(name),
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.refresh()
        }
        observers.append(observer)
    }

    private func refresh() {
        guard let getNowPlayingInfo, let getNowPlayingApplicationIsPlaying else { return }
        let queue = DispatchQueue.main
        getNowPlayingApplicationIsPlaying(queue) { [weak self] isPlaying in
            getNowPlayingInfo(queue) { info in
                let snapshot = Self.makeSnapshot(info: info, isPlaying: isPlaying)
                    ?? Self.readPlayerFallbackSnapshot()
                self?.onChange?(snapshot)
            }
        }
    }

    private static func makeSnapshot(info: CFDictionary?, isPlaying: Bool) -> NowPlayingSnapshot? {
        guard let raw = info as? [String: Any], !raw.isEmpty else {
            PulseNativeLog.debug(.streamSession, "media.remote info.empty nil=\(info == nil)")
            return nil
        }
        let title = string(raw, "kMRMediaRemoteNowPlayingInfoTitle")
        let artist = string(raw, "kMRMediaRemoteNowPlayingInfoArtist")
        let album = string(raw, "kMRMediaRemoteNowPlayingInfoAlbum")
        let duration = double(raw, "kMRMediaRemoteNowPlayingInfoDuration")
        let elapsed = double(raw, "kMRMediaRemoteNowPlayingInfoElapsedTime") ?? 0
        let uniqueId = string(raw, "kMRMediaRemoteNowPlayingInfoUniqueIdentifier")
            ?? string(raw, "kMRMediaRemoteNowPlayingInfoContentItemIdentifier")
            ?? [title, artist, album].compactMap { $0 }.joined(separator: "|")

        guard title != nil || artist != nil || album != nil || !uniqueId.isEmpty else {
            let keys = raw.keys.sorted().joined(separator: ",")
            PulseNativeLog.debug(.streamSession, "media.remote info.noPlayable keys=\(keys)")
            return nil
        }

        PulseNativeLog.debug(.streamSession, "media.remote info title=\(title ?? "nil") artist=\(artist ?? "nil") playing=\(isPlaying)")

        return NowPlayingSnapshot(
            providerId: "system",
            itemType: "track",
            trackId: uniqueId.isEmpty ? nil : uniqueId,
            uri: nil,
            linkUrl: nil,
            title: title,
            artist: artist,
            album: album,
            artworkUrl: nil,
            progressSeconds: elapsed,
            durationSeconds: duration,
            isPlaying: isPlaying
        )
    }

    private static func string(_ raw: [String: Any], _ key: String) -> String? {
        raw[key] as? String
    }

    private static func double(_ raw: [String: Any], _ key: String) -> Double? {
        if let value = raw[key] as? Double { return value }
        if let value = raw[key] as? NSNumber { return value.doubleValue }
        return nil
    }

    private static func readPlayerFallbackSnapshot() -> NowPlayingSnapshot? {
        readSpotifySnapshot() ?? readMusicSnapshot()
    }

    private static func readSpotifySnapshot() -> NowPlayingSnapshot? {
        let script = """
        tell application id "com.spotify.client"
            if it is running then
                if player state is playing or player state is paused then
                    return (player state as text) & linefeed & (player position as text) & linefeed & (id of current track) & linefeed & (spotify url of current track) & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (duration of current track as text) & linefeed & (artwork url of current track)
                end if
            end if
        end tell
        """
        guard let output = runAppleScript(script) else { return nil }
        let values = paddedLines(output, count: 9)
        let rawDuration = Double(values[7].replacingOccurrences(of: ",", with: ".")) ?? 0
        let duration = rawDuration > 10_000 ? rawDuration / 1000 : rawDuration
        return NowPlayingSnapshot(
            providerId: "spotify",
            itemType: "track",
            trackId: values[2].isEmpty ? nil : values[2],
            uri: values[3].isEmpty ? nil : values[3],
            linkUrl: values[3].isEmpty ? nil : values[3],
            title: values[4].isEmpty ? nil : values[4],
            artist: values[5].isEmpty ? nil : values[5],
            album: values[6].isEmpty ? nil : values[6],
            artworkUrl: values[8].isEmpty ? nil : values[8],
            progressSeconds: Double(values[1].replacingOccurrences(of: ",", with: ".")) ?? 0,
            durationSeconds: duration > 0 ? duration : nil,
            isPlaying: values[0] == "playing"
        )
    }

    private static func readMusicSnapshot() -> NowPlayingSnapshot? {
        let script = """
        tell application id "com.apple.Music"
            if it is running then
                if player state is playing or player state is paused then
                    set trackId to ""
                    try
                        set trackId to (persistent ID of current track)
                    end try
                    return (player state as text) & linefeed & (player position as text) & linefeed & trackId & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (duration of current track as text)
                end if
            end if
        end tell
        """
        guard let output = runAppleScript(script) else { return nil }
        let values = paddedLines(output, count: 7)
        let duration = Double(values[6].replacingOccurrences(of: ",", with: "."))
        return NowPlayingSnapshot(
            providerId: "apple-music",
            itemType: "track",
            trackId: values[2].isEmpty ? nil : values[2],
            uri: nil,
            linkUrl: nil,
            title: values[3].isEmpty ? nil : values[3],
            artist: values[4].isEmpty ? nil : values[4],
            album: values[5].isEmpty ? nil : values[5],
            artworkUrl: nil,
            progressSeconds: Double(values[1].replacingOccurrences(of: ",", with: ".")) ?? 0,
            durationSeconds: duration,
            isPlaying: values[0] == "playing"
        )
    }

    private static func runAppleScript(_ source: String) -> String? {
        let script = NSAppleScript(source: source)
        var error: NSDictionary?
        let result = script?.executeAndReturnError(&error).stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let error {
            PulseNativeLog.warn(.streamSession, "media.fallback.applescript.error \(error)")
        }
        return result?.isEmpty == false ? result : nil
    }

    private static func paddedLines(_ output: String, count: Int) -> [String] {
        let values = output.split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        return values + Array(repeating: "", count: max(0, count - values.count))
    }
}

private struct NowPlayingSnapshot: Sendable {
    let providerId: String?
    let itemType: String?
    let trackId: String?
    let uri: String?
    let linkUrl: String?
    let title: String?
    let artist: String?
    let album: String?
    let artworkUrl: String?
    let progressSeconds: Double
    let durationSeconds: Double?
    let isPlaying: Bool

    func toNativeMediaSnapshot() -> NativeMediaSnapshot {
        NativeMediaSnapshot(
            providerId: providerId,
            itemType: itemType,
            trackId: trackId,
            uri: uri,
            linkUrl: linkUrl,
            title: title,
            artist: artist,
            album: album,
            artworkUrl: artworkUrl,
            progressSeconds: progressSeconds,
            durationSeconds: durationSeconds,
            isPlaying: isPlaying
        )
    }
}
