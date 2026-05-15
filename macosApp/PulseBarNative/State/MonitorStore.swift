import AppKit
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
        allowWebInteractions: true,
        interactionExecutionModeName: "CONFIRM",
        interactionPlaybackModeName: "PLAY_NEXT"
    )
    @Published var isPaused = false
    @Published var dashboardSelection: DashboardSection = .connection

    // MARK: - Dependencies

    private let bridge: PulseBarBridge
    private var observerTasks: [Task<Void, Never>] = []
    let liveListenStore: LiveListenCaptureStore
    private var subscribed = false

    init() {
        self.bridge = PulseBarBridge()
        self.liveListenStore = LiveListenCaptureStore(bridge: bridge)
    }

    deinit {
        for t in observerTasks { t.cancel() }
    }

    // MARK: - Lifecycle

    func start() {
        PulseNativeLog.info(.liveListenSession, "monitor.start")
        if subscribed {
            isPaused = false
            return
        }
        isMonitoring = true
        isPaused = false
        subscribed = true

        let bridge = self.bridge
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

        liveListenStore.updateEndpoints(liveListenEndpoints)
    }

    func stop() {
        isMonitoring = false
        isPaused = true
    }

    func togglePaused() {
        if !isMonitoring { start(); return }
        isPaused.toggle()
        if !isPaused { bridge.forceTick() }
    }

    func resumeAndRefresh() {
        if !isMonitoring { start(); return }
        isPaused = false
        bridge.forceTick()
    }

    func refreshMenuBarContent() {
        if !isMonitoring { start(); return }
        isPaused = false
        bridge.forceTick()
    }

    // MARK: - Live Listen convenience

    func prepareLiveListenCapturePane() {
        liveListenStore.refreshSources()
        liveListenStore.updateEndpoints(liveListenEndpoints)
    }

    func requestLiveListenAudioCapturePermissionAtStartup() {
        liveListenStore.requestAudioCapturePermissionAtStartup()
    }

    func startDebugNativeLiveListenStream(preferredProvider: String? = nil, preferredBundleId: String? = nil) {
        liveListenStore.selectPreferredSource(preferredProvider: preferredProvider, preferredBundleId: preferredBundleId)
        let endpoints = liveListenEndpoints
        let endpointList = endpoints.map { $0.baseUrl }.joined(separator: ",")
        let source = liveListenStore.selectedSource?.name ?? "nil"
        PulseNativeLog.info(.liveListenSession, "debug.stream.start endpoints=\(endpointList) source=\(source)")
        liveListenStore.updateEndpoints(endpoints)
        dashboardSelection = .connection
        liveListenStore.startNativeStream()
    }

    func stopDebugNativeLiveListenStream() {
        PulseNativeLog.info(.liveListenSession, "debug.stream.stop")
        liveListenStore.stopCapture()
    }

    var liveListenEndpoints: [LiveListenEndpointResolved] {
        PulseBarConfigFactory.shared.resolvedLiveListenEndpoints(draft: settingsDraft)
    }

    // MARK: - Settings commands

    func saveConfig() {
        bridge.updateConfig(config: PulseBarConfigFactory.shared.fromDraft(draft: settingsDraft))
        bridge.forceTick()
        liveListenStore.updateEndpoints(liveListenEndpoints)
    }

    func addEndpoint() {
        var next = settingsDraft.endpoints
        if next.isEmpty {
            next.append(PulseBarConfigFactory.shared.defaultPrimaryEndpoint())
        } else {
            next.append(PulseBarConfigFactory.shared.defaultEndpoint(index: Int32(next.count)))
        }
        settingsDraft.endpoints = next
    }

    func removeEndpoint(_ endpointID: String) {
        settingsDraft.endpoints = settingsDraft.endpoints.filter { $0.id != endpointID }
        saveConfig()
    }

    func setEndpointEnabled(_ endpointID: String, enabled: Bool) {
        guard let endpoint = settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
        endpoint.enabled = enabled
        saveConfig()
    }

    func disconnectEndpoint(_ endpointID: String) {
        guard let endpoint = settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
        endpoint.disconnected = true
        connectingEndpointIDs.remove(endpointID)
        saveConfig()
    }

    func connectEndpoint(_ endpointID: String) {
        guard let endpoint = settingsDraft.endpoints.first(where: { $0.id == endpointID }) else { return }
        endpoint.disconnected = false
        connectingEndpointIDs.insert(endpointID)
        saveConfig()
        retryEndpoint(endpointID: endpointID)
    }

    // MARK: - Media / interaction commands

    func mediaCommand(_ command: PulseBarPlaybackCommand) {
        _ = bridge.mediaCommand(command: command)
    }

    func seekMedia(to progressSeconds: Double) {
        _ = bridge.seekMedia(progressSeconds: progressSeconds)
    }

    func acceptInteraction(_ requestId: String) {
        _ = bridge.acceptInteraction(requestId: requestId)
        bridge.forceTick()
    }

    func dismissInteraction(_ requestId: String) {
        _ = bridge.dismissInteraction(requestId: requestId)
        bridge.forceTick()
    }

    func retryEndpoint(endpointID: String? = nil) {
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
        liveListenStore.updateCurrentMedia(state.snapshot?.media)
    }

    private func applyTodayStatsUpdate(_ stats: PulseBarTodayStats) {
        todayStats = stats.topRows
        todayTotalSeconds = Int(stats.totalSeconds)
    }

    private func applyConfigUpdate(_ config: PulseBarConfig) {
        settingsDraft = PulseBarConfigFactory.shared.toDraft(config: config)
        liveListenStore.updateEndpoints(liveListenEndpoints)
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
}
