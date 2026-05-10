import AppKit
import Combine
import Foundation
@preconcurrency import PulseBarShared

/// Root `ObservableObject` for the SwiftUI tree. Fans out Kotlin bridge
/// observer callbacks onto `@Published` properties grouped by feature.
///
/// Views inject this object via `.environmentObject(...)` from
/// `PulseBarNativeApp` / `StatusItemController`.
///
/// Threading: Kotlin owns all side effects (the Kotlin bridge uses its
/// own `CoroutineScope(SupervisorJob() + Dispatchers.Default)` + internal
/// `Mutex`). Swift is a pure consumer + command issuer.
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
    private var cancellables: [PulseBarCancellable] = []
    let liveListenCaptureModel: LiveListenCaptureModel
    private var subscribed = false

    init() {
        self.bridge = PulseBarBridge()
        self.liveListenCaptureModel = LiveListenCaptureModel(bridge: bridge)
    }

    deinit {
        for c in cancellables { c.cancel() }
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

        cancellables.append(MonitorBridgeSubscriptions.menuState(bridge: bridge) { [weak self] s in self?.applyMenuStateUpdate(s) })
        cancellables.append(MonitorBridgeSubscriptions.config(bridge: bridge) { [weak self] c in self?.applyConfigUpdate(c) })
        cancellables.append(MonitorBridgeSubscriptions.syncState(bridge: bridge) { [weak self] s in self?.applySyncStateUpdate(s) })
        cancellables.append(MonitorBridgeSubscriptions.interactionState(bridge: bridge) { [weak self] s in self?.applyInteractionStateUpdate(s) })
        cancellables.append(MonitorBridgeSubscriptions.todayStats(bridge: bridge) { [weak self] s in self?.applyTodayStatsUpdate(s) })

        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
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
        liveListenCaptureModel.refreshSources()
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    func requestLiveListenAudioCapturePermissionAtStartup() {
        liveListenCaptureModel.requestAudioCapturePermissionAtStartup()
    }

    func startDebugNativeLiveListenStream(preferredProvider: String? = nil, preferredBundleId: String? = nil) {
        liveListenCaptureModel.selectPreferredSource(preferredProvider: preferredProvider, preferredBundleId: preferredBundleId)
        let endpoints = liveListenEndpoints
        let endpointList = endpoints.map { $0.baseUrl }.joined(separator: ",")
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

    var liveListenEndpoints: [LiveListenEndpointResolved] {
        PulseBarConfigFactory.shared.resolvedLiveListenEndpoints(draft: settingsDraft)
    }

    // MARK: - Settings commands

    func saveConfig() {
        bridge.updateConfig(config: PulseBarConfigFactory.shared.fromDraft(draft: settingsDraft))
        bridge.forceTick()
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
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
        liveListenCaptureModel.updateCurrentMedia(state.snapshot?.media)
    }

    private func applyTodayStatsUpdate(_ stats: PulseBarTodayStats) {
        todayStats = stats.topRows
        todayTotalSeconds = Int(stats.totalSeconds)
    }

    private func applyConfigUpdate(_ config: PulseBarConfig) {
        settingsDraft = PulseBarConfigFactory.shared.toDraft(config: config)
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
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
