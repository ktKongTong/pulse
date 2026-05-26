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
    }

    private func applyConnectionStatesUpdate(_ states: [PulseBarConnectionState]) {
        connectionStatesByEndpointID = Dictionary(uniqueKeysWithValues: states.map { ($0.endpointId, $0) })
    }

    private func isStreamEndpoint(_ endpoint: PulseBarEndpointDraft) -> Bool {
        !endpoint.endpointUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !endpoint.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

}
