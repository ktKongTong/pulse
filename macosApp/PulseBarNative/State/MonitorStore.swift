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

    @Published private(set) var focusState: FocusState?
    @Published private(set) var mediaState: MediaFlowState?
    @Published private(set) var currentMedia: Media?
    @Published private(set) var todayStats: [AppUsageItem] = []
    @Published private(set) var todayTotalSeconds: Int = 0
    @Published private(set) var connectionStatesByEndpointID: [String: PulseBarConnectionState] = [:]
    @Published private(set) var isMonitoring = false
    @Published private(set) var settings: PulseBarConfig = PulseBarConfig.defaultValue
    @Published var isPaused = false
    @Published var dashboardSelection: DashboardSection = .connection

    // MARK: - Dependencies

    private let bridge: PulseBarBridge
    private var observerTasks: [Task<Void, Never>] = []
    let streamStore: StreamCaptureStore
    private var subscribed = false
    private var frontmostAppObserver: NSObjectProtocol?
    private var connectionStores: [String: ConnectionStore] = [:]
    private var connectionStateTasks: [String: Task<Void, Never>] = [:]
    private var mediaStateTask: Task<Void, Never>?
    private var appUsageTask: Task<Void, Never>?
    private let nowPlayingEventSource = NowPlayingEventSource()
    private var connectedMediaEndpointIDs: Set<String> = []

    init() {
        self.bridge = PulseBarBridge(initialMedia: NowPlayingEventSource.startupSnapshot())
        self.streamStore = StreamCaptureStore(bridge: bridge)
    }

    deinit {
        for t in observerTasks { t.cancel() }
        for t in connectionStateTasks.values { t.cancel() }
        mediaStateTask?.cancel()
        appUsageTask?.cancel()
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
                self?.handleNowPlayingChange(snapshot)
            }
        }

        let runtimeTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await state in bridge.runtimeState.asAsyncSequence() {
                    self?.applyRuntimeStateUpdate(state)
                }
            } catch {}
        }
        observerTasks.append(runtimeTask)

        let mediaFlowTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await state in bridge.mediaFlow.asAsyncSequence() {
                    self?.applyMediaFlowStateUpdate(state)
                }
            } catch {}
        }
        observerTasks.append(mediaFlowTask)

        let configTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await config in bridge.config.asAsyncSequence() {
                    self?.applyConfigUpdate(config)
                }
            } catch {}
        }
        observerTasks.append(configTask)


        let connectionTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await flows in bridge.connectionStates.asAsyncSequence() {
                    self?.applyConnectionStateFlows(flows)
                }
            } catch {}
        }
        observerTasks.append(connectionTask)

        let usageTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await stats in bridge.usageStats.asAsyncSequence() {
                    self?.applyUsageStatsUpdate(stats)
                }
            } catch {}
        }
        observerTasks.append(usageTask)

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

    private func handleNowPlayingChange(_ snapshot: Media?) {
        guard isMonitoring, !isPaused else { return }
        if streamStore.updateCurrentMedia(snapshot) {
            let label = snapshot?.title ?? "nil"
            PulseNativeLog.info(.streamSession, "native.media.changed title=\(label) playing=\(snapshot?.isPlaying == true)")
        }
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

    var streamEndpoints: [EndpointConfig] {
        settings.streamEndpoints
    }

    // MARK: - Settings commands
    func saveConfig(_ config: PulseBarConfig) {
        bridge.emitNativeEvent(event: UpdateConfigCommand(config: config))
    }

    func addEndpoint() {
        let next = PulseBarConfig(
            endpoints: settings.endpoints + [EndpointConfig.defaultEndpoint(index: settings.endpoints.count)],
            idleThresholdSeconds: settings.idleThresholdSeconds,
            changeStabilityMillis: settings.changeStabilityMillis
        )
        saveConfig(next)
        streamStore.updateEndpoints(streamEndpoints)
    }

    func updateEndpoint(_ endpoint: EndpointConfig) {
        let next = PulseBarConfig(
            endpoints: settings.endpoints.map { $0.id == endpoint.id ? endpoint : $0 },
            idleThresholdSeconds: settings.idleThresholdSeconds,
            changeStabilityMillis: settings.changeStabilityMillis
        )
        saveConfig(next)
    }

    func updateSettings(idleThresholdSeconds: Int32? = nil, changeStabilityMillis: Int32? = nil) {
        saveConfig(
            PulseBarConfig(
                endpoints: settings.endpoints,
                idleThresholdSeconds: idleThresholdSeconds ?? settings.idleThresholdSeconds,
                changeStabilityMillis: changeStabilityMillis ?? settings.changeStabilityMillis
            )
        )
    }

    func connectionStore(endpointId: String) -> ConnectionStore {
        if let store = connectionStores[endpointId] { return store }
        let store = ConnectionStore(endpointId: endpointId, bridge: bridge)
        connectionStores[endpointId] = store
        if let state = connectionStatesByEndpointID[endpointId] {
            store.applyState(state)
        }
        store.start()
        return store
    }

    func removeConnectionStore(endpointId: String) {
        connectionStores[endpointId]?.stop()
        connectionStores.removeValue(forKey: endpointId)
    }

    // MARK: - Media / interaction commands

    func mediaCommand(_ command: PlayerPlaybackCommand) {
        let success = nowPlayingEventSource.mediaCommand(command)
        PulseNativeLog.info(.streamSession, "native.mediaCommand command=\(String(describing: command)) success=\(success)")
        if success { refreshNowPlayingSoon() }
    }

    func seekMedia(to progressSeconds: Double) {
        let success = nowPlayingEventSource.seek(to: progressSeconds)
        PulseNativeLog.info(.streamSession, "native.seekMedia progress=\(progressSeconds) success=\(success)")
        if success { refreshNowPlayingSoon() }
    }

    // MARK: - Observer handlers

    private func applyRuntimeStateUpdate(_ state: RuntimeState) {
        focusState = state.focusState
    }

    private func applyMediaFlowStateUpdate(_ state: MediaFlowState) {
        mediaState = state
        mediaStateTask?.cancel()
        mediaStateTask = Task { @MainActor [weak self] in
            do {
                for try await media in state.media.asAsyncSequence() {
                    self?.currentMedia = media
                }
            } catch {}
        }
    }

    private func applyUsageStatsUpdate(_ stats: UsageStats) {
        todayTotalSeconds = Int(stats.appStats.totalSeconds)
        appUsageTask?.cancel()
        let usages = stats.appStats.usages
        appUsageTask = Task { @MainActor [weak self] in
            do {
                for try await rows in usages.asAsyncSequence() {
                    self?.todayStats = rows
                }
            } catch {}
        }
    }

    private func applyConfigUpdate(_ config: PulseBarConfig) {
        settings = config
        streamStore.updateEndpoints(streamEndpoints)
    }

    private func applyConnectionStateFlows(_ flows: [String: any KotlinCoroutineSupport.KotlinTypedFlow<PulseBarConnectionState>]) {
        for task in connectionStateTasks.values { task.cancel() }
        connectionStateTasks.removeAll()
        connectionStatesByEndpointID = [:]
        connectedMediaEndpointIDs = []

        for (endpointId, flow) in flows {
            connectionStateTasks[endpointId] = Task { @MainActor [weak self] in
                do {
                    for try await state in flow.asAsyncSequence() {
                        self?.applyConnectionStateUpdate(state)
                    }
                } catch {}
            }
        }
    }

    private func applyConnectionStateUpdate(_ state: PulseBarConnectionState) {
        connectionStatesByEndpointID[state.endpointId] = state
        connectionStores[state.endpointId]?.applyState(state)

        let connected = Set(connectionStatesByEndpointID.values.compactMap { state in
            state.connectionState == .CONNECTED ? state.endpointId : nil
        })
        let newlyConnected = connected.subtracting(connectedMediaEndpointIDs)
        connectedMediaEndpointIDs = connected
        if !newlyConnected.isEmpty {
            PulseNativeLog.info(.streamSession, "native.media.connected endpoints=\(newlyConnected.sorted().joined(separator: ",")) publishCurrentState refreshNowPlaying")
            streamStore.republishCurrentMediaState()
            nowPlayingEventSource.refresh()
        }
    }

    private func refreshNowPlayingSoon() {
        nowPlayingEventSource.refresh()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.nowPlayingEventSource.refresh()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.nowPlayingEventSource.refresh()
        }
    }
}

private extension PulseBarConfig {
    static var defaultValue: PulseBarConfig {
        PulseBarConfig(
            endpoints: [EndpointConfig.defaultEndpoint(index: 0, name: "Primary", enabled: true)],
            idleThresholdSeconds: 300,
            changeStabilityMillis: 1200
        )
    }

    var streamEndpoints: [EndpointConfig] {
        endpoints.filter {
            $0.enabled &&
                !$0.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                !$0.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

}

extension EndpointConfig: @retroactive Identifiable {}

extension EndpointConfig {
    static func defaultEndpoint(index: Int, name: String? = nil, enabled: Bool = false) -> EndpointConfig {
        EndpointConfig(
            id: UUID().uuidString.lowercased(),
            name: name ?? "Endpoint \(index + 1)",
            enabled: enabled,
            url: "http://localhost:8900",
            siteId: "",
            workspaceId: "default",
            apiKey: ""
        )
    }

    var displayName: String {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty { return trimmedName }
        let rawUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: rawUrl), let host = components.host, !host.isEmpty else {
            return rawUrl.isEmpty ? "Untitled endpoint" : rawUrl
        }
        return host
    }
}
