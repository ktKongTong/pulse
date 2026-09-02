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
    @Published private(set) var currentMedia: Media?
    @Published private(set) var todayStats: [AppUsageItem] = []
    @Published private(set) var todayTotalSeconds: Int = 0
    @Published private(set) var connectionStatesByEndpointID: [String: PulseBarConnectionState] = [:]
    @Published private(set) var settings: PulseBarConfig?

    // MARK: - Dependencies

    private let bridge: PulseBarBridge
    private var isMonitoring = false
    private var observerTasks: [Task<Void, Never>] = []
    let streamStore: StreamCaptureStore
    private var subscribed = false
    private var frontmostAppObserver: NSObjectProtocol?
    private var connectionStateTasks: [String: Task<Void, Never>] = [:]
    private var mediaStateTask: Task<Void, Never>?
    private var appUsageTask: Task<Void, Never>?
    private let nowPlayingEventSource = NowPlayingEventSource()
    private let networkStateMonitor = NetworkStateMonitor()
    private var connectedMediaEndpointIDs: Set<String> = []

    init() {
        self.bridge = PulseBarBridge(initialMedia: NowPlayingEventSource.startupSnapshot())
        self.streamStore = StreamCaptureStore(
            bridge: bridge,
            currentMediaSnapshot: { [nowPlayingEventSource] in
                await nowPlayingEventSource.snapshot()
            }
        )
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
        networkStateMonitor.stop()
    }

    // MARK: - Lifecycle

    func start() {
        PulseNativeLog.info(.streamSession, "monitor.start")
        if subscribed {
            return
        }
        isMonitoring = true
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

        networkStateMonitor.start { [weak self] snapshot in
            Task { @MainActor in
                self?.handleNetworkChange(snapshot)
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

    func resumeAndRefresh() {
        streamStore.refreshAudioCapturePermissionStatusAsync()
        if !isMonitoring { start(); return }
        // bridge.forceTick()
    }

    func refreshMenuBarContent() {
        streamStore.refreshAudioCapturePermissionStatusAsync()
        if !isMonitoring { start(); return }
    }

    private func handleFrontmostApplicationChange(bundleId: String, name: String) {
        guard isMonitoring else { return }
        let event = NativeFrontmostAppChanged(
            bundleId: bundleId,
            name: name
        )
        bridge.emitNativeEvent(event: event)
    }

    private func handleNowPlayingChange(_ snapshot: Media?) {
        guard isMonitoring else { return }
        if streamStore.updateCurrentMedia(snapshot) {
            let label = snapshot?.title ?? "nil"
            PulseNativeLog.info(.streamSession, "native.media.changed title=\(label) playback=\(snapshot?.playbackStatus ?? .PAUSED)")
        }
    }

    private func handleNetworkChange(_ snapshot: NetworkSnapshot) {
        guard isMonitoring else { return }
        PulseNativeLog.info(
            .streamSession,
            "native.network.changed online=\(snapshot.online) expensive=\(snapshot.expensive) constrained=\(snapshot.constrained)"
        )
        bridge.emitNativeEvent(
            event: NativeNetworkChanged(
                online: snapshot.online,
                expensive: snapshot.expensive,
                constrained: snapshot.constrained
            )
        )
    }

    // MARK: - Stream convenience

    var isPermissionPromptBlockingInteraction: Bool {
        streamStore.blocksUserInteractionForAudioPermission
    }

    func requestStreamAudioCapturePermissionAtStartup() {
        streamStore.requestAudioCapturePermissionAtStartup()
    }

    private var streamEndpoints: [EndpointConfig] {
        settings?.streamEndpoints ?? []
    }

    // MARK: - Settings commands
    func updateEndpoint(_ endpoint: EndpointConfig) {
        guard let settings else { return }
        let next = PulseBarConfig(
            endpoints: settings.endpoints.map { $0.id == endpoint.id ? endpoint : $0 },
            commonConfig: settings.commonConfig
        )
        bridge.emitNativeEvent(event: UpdateConfigCommand(config: next))
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
        reconcileConnectionStateTasks(for: config.endpoints)
    }

    private func reconcileConnectionStateTasks(for endpoints: [EndpointConfig]) {
        let endpointIDs = Set(endpoints.map(\.id))
        let removedEndpointIDs = connectionStateTasks.keys.filter { !endpointIDs.contains($0) }
        for endpointId in removedEndpointIDs {
            connectionStateTasks[endpointId]?.cancel()
            connectionStateTasks.removeValue(forKey: endpointId)
            connectionStatesByEndpointID.removeValue(forKey: endpointId)
            connectedMediaEndpointIDs.remove(endpointId)
        }

        for endpointId in endpointIDs where connectionStateTasks[endpointId] == nil {
            connectionStateTasks[endpointId] = Task { @MainActor [weak self, bridge] in
                do {
                    for try await state in bridge.connectionState(endpointId: endpointId).asAsyncSequence() {
                        self?.applyConnectionStateUpdate(state)
                    }
                } catch {
                    self?.connectionStateTasks.removeValue(forKey: endpointId)
                    self?.connectionStatesByEndpointID.removeValue(forKey: endpointId)
                    self?.connectedMediaEndpointIDs.remove(endpointId)
                }
            }
        }
    }

    private func applyConnectionStateUpdate(_ state: PulseBarConnectionState) {
        connectionStatesByEndpointID[state.endpointId] = state

        let connected = Set(connectionStatesByEndpointID.values.compactMap { state in
            state.connectionStatus.isConnected ? state.endpointId : nil
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
    var streamEndpoints: [EndpointConfig] {
        endpoints.filter {
            $0.enabled &&
                !$0.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

}
