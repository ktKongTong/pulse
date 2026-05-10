import AppKit
import Combine
import Foundation
@preconcurrency import PulseBarShared

@MainActor
final class NativeMonitorModel: ObservableObject {
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
        endpoints: [PulseBarEndpointDraft.pulseDefaultPrimary()],
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

    /// Kotlin owns all threading — its bridge internally uses coroutines with
    /// a supervisor Job and its own `Mutex`. We don't need a queue in Swift
    /// anymore; we just talk to the bridge directly.
    private let bridge: PulseBarBridge
    private var cancellables: [PulseBarCancellable] = []
    let liveListenCaptureModel: LiveListenCaptureModel
    private var subscribed = false

    init() {
        self.bridge = PulseBarBridge()
        self.liveListenCaptureModel = LiveListenCaptureModel(bridge: bridge)
    }

    // MARK: - Nonisolated observer subscribers
    //
    // These are explicitly nonisolated so the closures they pass to Kotlin
    // don't inherit @MainActor isolation. We then dispatch onto main inside
    // the closure and invoke the caller's @MainActor handler there.

    nonisolated private static func subscribeMenu(bridge: PulseBarBridge, onMain: @escaping @MainActor (PulseBarMenuState) -> Void) -> PulseBarCancellable {
        bridge.observeMenuState { state in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(state) } }
        }
    }

    nonisolated private static func subscribeConfig(bridge: PulseBarBridge, onMain: @escaping @MainActor (PulseBarConfig) -> Void) -> PulseBarCancellable {
        bridge.observeConfig { config in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(config) } }
        }
    }

    nonisolated private static func subscribeSync(bridge: PulseBarBridge, onMain: @escaping @MainActor (PulseBarSyncState) -> Void) -> PulseBarCancellable {
        bridge.observeSyncState { state in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(state) } }
        }
    }

    nonisolated private static func subscribeInteraction(bridge: PulseBarBridge, onMain: @escaping @MainActor (PulseBarInteractionState) -> Void) -> PulseBarCancellable {
        bridge.observeInteractionState { state in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(state) } }
        }
    }

    nonisolated private static func subscribeToday(bridge: PulseBarBridge, onMain: @escaping @MainActor (PulseBarTodayStats) -> Void) -> PulseBarCancellable {
        bridge.observeTodayStats { stats in
            DispatchQueue.main.async { MainActor.assumeIsolated { onMain(stats) } }
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

        // Kotlin delivers observer callbacks on Dispatchers.Default. Use the
        // nonisolated subscribe helpers above so the closure captured by
        // Kotlin isn't inherited-@MainActor (which would trip Swift 6 at
        // runtime), then hop to @MainActor explicitly.
        cancellables.append(Self.subscribeMenu(bridge: bridge, onMain: { [weak self] state in self?.applyMenuStateUpdate(state) }))
        cancellables.append(Self.subscribeConfig(bridge: bridge, onMain: { [weak self] config in self?.applyConfigUpdate(config) }))
        cancellables.append(Self.subscribeSync(bridge: bridge, onMain: { [weak self] state in self?.applySyncStateUpdate(state) }))
        cancellables.append(Self.subscribeInteraction(bridge: bridge, onMain: { [weak self] state in self?.applyInteractionStateUpdate(state) }))
        cancellables.append(Self.subscribeToday(bridge: bridge, onMain: { [weak self] stats in self?.applyTodayStatsUpdate(stats) }))

        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    deinit {
        for c in cancellables { c.cancel() }
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
            bridge.forceTick()
        }
    }

    func resumeAndRefresh() {
        if !isMonitoring {
            start()
            return
        }
        isPaused = false
        bridge.forceTick()
    }

    func refreshMenuBarContent() {
        if !isMonitoring {
            start()
            return
        }
        isPaused = false
        bridge.forceTick()
    }

    private func applyMenuStateUpdate(_ state: PulseBarMenuState) {
        // Kotlin's menu state flow is a StateFlow that already de-dupes on
        // structural equality. We re-publish unconditionally; SwiftUI
        // diffing handles the rest.
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

    func saveConfig() {
        bridge.updateConfig(config: PulseBarConfigFactory.shared.fromDraft(draft: settingsDraft))
        bridge.forceTick()
        liveListenCaptureModel.updateEndpoints(liveListenEndpoints)
    }

    var liveListenEndpoints: [LiveListenEndpointConfig] {
        // Delegate candidate selection to Kotlin (prefers enabled + credentialed,
        // falls back to any with credentials). Swift only adapts the result into
        // platform-typed URLs.
        let candidates = PulseBarConfigFactory.shared.liveListenCandidateEndpoints(draft: settingsDraft)
        return candidates.compactMap { kotlin in
            LiveListenEndpointConfig.fromKotlinDraft(kotlin)
        }
    }

    func addEndpoint() {
        var next = settingsDraft.endpoints
        if next.isEmpty {
            next.append(.pulseDefaultPrimary())
        } else {
            next.append(.pulseDefault(index: next.count))
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

    private func clearFinishedConnectingEndpoints(_ syncState: PulseBarSyncState) {
        guard !connectingEndpointIDs.isEmpty else { return }
        for endpoint in syncState.endpoints where connectingEndpointIDs.contains(endpoint.id) {
            if endpoint.status != "disabled" && endpoint.status != "disconnected" {
                connectingEndpointIDs.remove(endpoint.id)
            }
        }
    }
}
