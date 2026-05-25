@preconcurrency import AppKit
import Combine
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
    @Published private(set) var connectingEndpointIDs: Set<String> = []
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
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshForFrontmostApplicationChange()
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

        let interactionTask: Task<Void, Never> = Task { @MainActor [weak self] in
            do {
                for try await state in bridge.interactionState.asAsyncSequence() {
                    self?.applyInteractionStateUpdate(state)
                }
            } catch {}
        }
        observerTasks.append(interactionTask)

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
        guard userInteractionAllowed("togglePaused") else { return }
        if !isMonitoring { start(); return }
        isPaused.toggle()
        if !isPaused { bridge.forceTick() }
    }

    func resumeAndRefresh() {
        streamStore.refreshAudioCapturePermissionStatus()
        if !isMonitoring { start(); return }
        isPaused = false
        bridge.forceTick()
    }

    func refreshMenuBarContent() {
        streamStore.refreshAudioCapturePermissionStatus()
        if !isMonitoring { start(); return }
        isPaused = false
        bridge.forceTick()
    }

    private func refreshForFrontmostApplicationChange() {
        guard isMonitoring, !isPaused else { return }
        bridge.tick()
    }

    // MARK: - Stream convenience

    var isPermissionPromptBlockingInteraction: Bool {
        streamStore.blocksUserInteractionForAudioPermission
    }

    func prepareStreamCapturePane() {
        guard userInteractionAllowed("prepareStreamCapturePane") else { return }
        streamStore.refreshSources()
        streamStore.updateEndpoints(streamEndpoints)
    }

    func requestStreamAudioCapturePermissionAtStartup() {
        streamStore.requestAudioCapturePermissionAtStartup()
    }

    func startDebugNativeStreamStream(preferredProvider: String? = nil, preferredBundleId: String? = nil) {
        guard userInteractionAllowed("startDebugNativeStreamStream") else { return }
        streamStore.selectPreferredSource(preferredProvider: preferredProvider, preferredBundleId: preferredBundleId)
        let endpoints = streamEndpoints
        let endpointList = endpoints.map { $0.baseUrl }.joined(separator: ",")
        let source = streamStore.selectedSource?.name ?? "nil"
        PulseNativeLog.info(.streamSession, "debug.stream.start endpoints=\(endpointList) source=\(source)")
        streamStore.updateEndpoints(endpoints)
        dashboardSelection = .connection
        streamStore.startNativeStream()
    }

    func stopDebugNativeStreamStream() {
        guard userInteractionAllowed("stopDebugNativeStreamStream") else { return }
        PulseNativeLog.info(.streamSession, "debug.stream.stop")
        streamStore.stopCapture()
    }

    var streamEndpoints: [StreamEndpointResolved] {
        PulseBarConfigFactory.shared.resolvedStreamEndpoints(draft: settingsDraft)
    }

    // MARK: - Settings commands

    func saveConfig() {
        guard userInteractionAllowed("saveConfig") else { return }
        bridge.updateConfig(config: PulseBarConfigFactory.shared.fromDraft(draft: settingsDraft))
        bridge.forceTick()
        streamStore.updateEndpoints(streamEndpoints)
    }

    func addEndpoint() {
        guard userInteractionAllowed("addEndpoint") else { return }
        var next = settingsDraft.endpoints
        if next.isEmpty {
            next.append(PulseBarConfigFactory.shared.defaultPrimaryEndpoint())
        } else {
            next.append(PulseBarConfigFactory.shared.defaultEndpoint(index: Int32(next.count)))
        }
        settingsDraft.endpoints = next
    }

    func removeEndpoint(_ endpointID: String) {
        guard userInteractionAllowed("removeEndpoint") else { return }
        settingsDraft.endpoints = settingsDraft.endpoints.filter { $0.id != endpointID }
        saveConfig()
    }

    func setEndpointEnabled(_ endpointID: String, enabled: Bool) {
        guard userInteractionAllowed("setEndpointEnabled") else { return }
        guard let endpoint = settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
        endpoint.enabled = enabled
        saveConfig()
    }

    func disconnectEndpoint(_ endpointID: String) {
        guard userInteractionAllowed("disconnectEndpoint") else { return }
        guard let endpoint = settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
        endpoint.disconnected = true
        connectingEndpointIDs.remove(endpointID)
        saveConfig()
        if isStreamEndpoint(endpoint) {
            streamStore.updateEndpoints(streamEndpoints)
            streamStore.disconnectEndpoint(endpointID)
        }
    }

    func connectEndpoint(_ endpointID: String) {
        guard userInteractionAllowed("connectEndpoint") else { return }
        guard let endpoint = settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
        endpoint.disconnected = false
        saveConfig()
        if isStreamEndpoint(endpoint) {
            streamStore.updateEndpoints(streamEndpoints)
            streamStore.reconnectServer(endpointID: endpointID)
            return
        }
        connectingEndpointIDs.insert(endpointID)
        retryEndpoint(endpointID: endpointID)
    }

    // MARK: - Media / interaction commands

    func mediaCommand(_ command: PulseBarPlaybackCommand) {
        guard userInteractionAllowed("mediaCommand") else { return }
        _ = bridge.mediaCommand(command: command)
    }

    func seekMedia(to progressSeconds: Double) {
        guard userInteractionAllowed("seekMedia") else { return }
        if bridge.seekMedia(progressSeconds: progressSeconds) {
            streamStore.publishMediaSeek(
                progressSeconds: progressSeconds,
                media: snapshot?.media
            )
        }
    }

    func acceptInteraction(_ requestId: String) {
        guard userInteractionAllowed("acceptInteraction") else { return }
        _ = bridge.acceptInteraction(requestId: requestId)
        bridge.forceTick()
    }

    func dismissInteraction(_ requestId: String) {
        guard userInteractionAllowed("dismissInteraction") else { return }
        _ = bridge.dismissInteraction(requestId: requestId)
        bridge.forceTick()
    }

    func retryEndpoint(endpointID: String? = nil) {
        guard userInteractionAllowed("retryEndpoint") else { return }
        if let endpointID {
            connectingEndpointIDs.insert(endpointID)
        }
        _ = bridge.retryEndpoint()
        if let endpointID {
            connectingEndpointIDs.remove(endpointID)
        }
    }

    // MARK: - Observer handlers

    private func applyMenuStateUpdate(_ state: PulseBarMenuState) {
        snapshot = state.snapshot
        streamStore.updateCurrentMedia(state.snapshot?.media)
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
        clearFinishedConnectingEndpoints(state)
    }

    private func applyInteractionStateUpdate(_ state: PulseBarInteractionState) {
        interactionItems = state.items
        interactionPendingCount = Int(state.pendingCount)
        interactionLastStatus = state.lastStatus
    }

    private func clearFinishedConnectingEndpoints(_ syncState: PulseBarSyncState) {
        guard !connectingEndpointIDs.isEmpty else { return }
        for endpoint in syncState.endpoints where connectingEndpointIDs.contains(endpoint.id) {
            if endpoint.status != "disabled" && endpoint.status != "disconnected" {
                connectingEndpointIDs.remove(endpoint.id)
            }
        }
    }

    private func isStreamEndpoint(_ endpoint: PulseBarEndpointDraft) -> Bool {
        !endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func userInteractionAllowed(_ command: String) -> Bool {
        guard !isPermissionPromptBlockingInteraction else {
            PulseNativeLog.info(.streamSession, "\(command) blocked while audio permission prompt is pending")
            return false
        }
        return true
    }
}
