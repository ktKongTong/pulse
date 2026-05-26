import AppKit
import Foundation
@preconcurrency import PulseBarShared
import SwiftUI

private typealias StreamStatusInput = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.StreamStatusInput
private typealias StreamPresentation = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.StreamPresentation

/// `@MainActor ObservableObject` store for the Stream screen.
///
/// Layer: **State/**. Only holds `@Published` state + command methods.
/// Platform work delegates to `Services/Stream/`; transport +
/// reconnect + framing live in Kotlin via `StreamBridge`.
///
/// Future split (deferred, non-behavior-touching refactor): the
/// `startServerDrivenCapture` / `startNativeStream` / `stopCapture` /
/// `updateCurrentMedia` decision tree is a state machine; it can be
/// lifted into a pure `StreamEngine` that takes an input snapshot
/// and returns effects, leaving this store as a thin effects executor.
/// Not doing it now — the current flow is working and tested.
@MainActor
final class StreamCaptureStore: ObservableObject {
    private static let mediaStreamAllowedKey = "PulseBarNative.stream.mediaStreamAllowed"
    private static let audioCapturePermissionStartupRequestedKey = "PulseBarNative.stream.audioCapturePermissionStartupRequested"

    // MARK: - Exposed to SwiftUI

    @Published private(set) var sources: [StreamCaptureSource] = []
    @Published var selectedSourceId: String = "system"
    @Published private(set) var isCapturing = false
    @Published private(set) var statusText = "Idle"
    @Published private(set) var meter = StreamCaptureMeter()
    @Published private(set) var errorMessage: String?
    @Published private(set) var publisherStatusText = "Publisher idle"
    @Published private(set) var publisherStats: PulseBarStreamStats = PulseBarStreamStatsFactory.shared.idle()
    @Published private(set) var endpointPublisherStats: [StreamEndpointPublisherStatus] = []
    @Published private(set) var mediaStreamPermission: StreamMediaStreamPermission = .allow
    @Published private(set) var mediaPlaybackStatus: StreamMediaPlaybackStatus = .paused
    @Published private(set) var mediaPlaybackReason = "no media"
    @Published private(set) var currentMediaLabel = "-"
    @Published private(set) var audioCapturePermissionStatus: StreamAudioCapturePermissionStatus = .unknown
    @Published private(set) var audioCapturePermissionRequestPending = false

    // MARK: - Derived

    var selectedSource: StreamCaptureSource? {
        sources.first { $0.id == selectedSourceId } ?? sources.first
    }

    var serverConnectionText: String {
        StreamPresentation.shared.serverConnectionText(input: buildStatusInput())
    }

    var serverEndpointText: String {
        endpoints.map { "\($0.displayName): \($0.baseUrl)" }.joined(separator: "\n")
    }

    var captureActivityText: String {
        StreamPresentation.shared.captureActivityText(input: buildStatusInput())
    }

    var nextReconnectText: String {
        StreamPresentation.shared.nextReconnectText(
            input: buildStatusInput(),
            nowMillis: Int64(Date().timeIntervalSince1970 * 1000.0)
        )
    }

    var canReconnectServer: Bool {
        !endpoints.isEmpty
    }

    var blocksUserInteractionForAudioPermission: Bool {
        audioCapturePermissionRequestPending
    }

    // MARK: - Internal state

    private var endpoints: [StreamEndpointResolved] = []
    private let service = StreamCaptureService()
    private lazy var session = StreamCaptureSession(service: service)
    private var startupPermissionTask: Task<Void, Never>?
    private var lastPublishedMediaSignature: String?
    private var currentMedia: NativeMediaSnapshot?
    private let worker: StreamBridge
    private var statsTask: Task<Void, Never>?
    private var commandTask: Task<Void, Never>?

    // MARK: - Lifecycle

    init(bridge: StreamBridge) {
        self.worker = bridge
        if UserDefaults.standard.object(forKey: Self.mediaStreamAllowedKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.mediaStreamAllowedKey)
        }
        mediaStreamPermission = UserDefaults.standard.bool(forKey: Self.mediaStreamAllowedKey) ? .allow : .disallow
        audioCapturePermissionStatus = service.audioCapturePermissionStatus()
        refreshSources()
        subscribeStats()
    }

    deinit {
        statsTask?.cancel()
        commandTask?.cancel()
        startupPermissionTask?.cancel()
    }

    private func subscribeStats() {
        // stream stats
        let worker = self.worker
        commandTask = Task { @MainActor [weak self] in
            do {
                for try await command in worker.hostCommands.asAsyncSequence() {
                    self?.handleHostCommand(command)
                }
            } catch {
                self?.log("host command stream ended error=\(error.localizedDescription)")
            }
        }
    }

    private func handleHostCommand(_ command: NativeHostCommand) {
        if let command = command as? NativeStreamRequestedCommand {
            log("server requested capture start endpoint=\(command.endpointId) stream=\(command.streamId) generation=\(command.generation)")
            startServerDrivenCapture()
        } else if let command = command as? NativeStreamStoppedCommand {
            log("server requested capture stop endpoint=\(command.endpointId) stream=\(command.streamId ?? "nil") reason=\(command.reason)")
            stopCaptureSession()
        } else {
            log("ignored host command type=\(type(of: command))")
        }
    }

    // map stats to ui state
    private func applyStatsSnapshot(_ snapshot: PulseBarStreamStats) {
        let previouslyRequested = publisherStats.captureRequested
        publisherStats = snapshot
        updateAggregatePublisherState()
        if snapshot.captureRequested && !previouslyRequested {
            log("server requested capture start")
            startServerDrivenCapture()
        } else if !snapshot.captureRequested && previouslyRequested && isCapturing {
            log("server requested capture stop")
            stopCaptureSession()
        }
        if isCapturing && snapshot.connectionStateParsed == .FAILED {
            log("live listen failed during capture")
            stopCaptureSession()
            statusText = "Stream connection failed"
        } else if isCapturing {
            statusText = Self.streamStatusText(
                sourceName: selectedSource?.name ?? "selected source",
                publisherStats: snapshot
            )
        }
    }

    // MARK: - Public commands

    func updateEndpoints(_ endpoints: [StreamEndpointResolved]) {
        self.endpoints = endpoints
        if endpoints.isEmpty {
            if isCapturing {
                log("stopping capture because no live listen endpoints remain")
                stopCapture()
            } else {
                // emitStopStreamEvent()
                // worker.stopStream()
            }
            publisherStatusText = "Configure a Stream endpoint in Settings"
            updateAggregatePublisherState()
            return
        }
        pushMediaStateToBridge()
        updateAggregatePublisherState()
        if !isCapturing {
            publisherStatusText = "Publisher idle"
        }
    }

    func requestAudioCapturePermissionAtStartup() {
        guard startupPermissionTask == nil else { return }
        let initialStatus = service.audioCapturePermissionStatus()
        audioCapturePermissionStatus = initialStatus
        log("startup audio permission preflight status=\(initialStatus.rawValue)")
        guard initialStatus == .unknown else { return }
        guard !UserDefaults.standard.bool(forKey: Self.audioCapturePermissionStartupRequestedKey) else { return }
        UserDefaults.standard.set(true, forKey: Self.audioCapturePermissionStartupRequestedKey)
        audioCapturePermissionRequestPending = true
        publisherStatusText = "Waiting for audio capture permission"
        startupPermissionTask = Task { @MainActor [weak self] in
            guard let self else { return }
            log("startup audio permission begin status=\(initialStatus.rawValue)")
            defer {
                audioCapturePermissionRequestPending = false
                startupPermissionTask = nil
            }
            do {
                try await service.ensureAudioCapturePermissionForUI()
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                log("startup audio permission ok status=\(status.rawValue)")
                updateAggregatePublisherState()
            } catch {
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                errorMessage = error.localizedDescription
                publisherStatusText = "Audio capture permission required"
                log("startup audio permission failed status=\(status.rawValue) error=\(error.localizedDescription)")
            }
        }
    }

    func refreshAudioCapturePermissionStatus() {
        guard !audioCapturePermissionRequestPending else { return }
        audioCapturePermissionStatus = service.audioCapturePermissionStatus()
    }

    func refreshSources() {
        guard allowCommandWhilePermissionPromptPending("refreshSources") else { return }
        sources = service.availableSources()
        if !sources.contains(where: { $0.id == selectedSourceId }) {
            selectedSourceId = sources.first?.id ?? "system"
        }
    }

    func updateCurrentMedia(_ media: NativeMediaSnapshot?) {
        let signature = mediaSignature(media)
        guard signature != lastPublishedMediaSignature else { return }
        lastPublishedMediaSignature = signature
        currentMedia = media
        mediaPlaybackStatus = media?.isPlaying == true ? .playing : .paused
        if let media {
            let title = media.title ?? "-"
            let artist = media.artist ?? ""
            currentMediaLabel = artist.isEmpty ? title : "\(title) - \(artist)"
            mediaPlaybackReason = media.isPlaying ? "playing" : "paused"
        } else {
            currentMediaLabel = "-"
            mediaPlaybackReason = "no playable media"
        }

        pushMediaStateToBridge()

        if let media, media.isPlaying {
            // 1. emit event
            // 2. receive and update state
            // 3. flow receive

            // worker.updateStreamMedia(
            //     providerId: media.providerId,
            //     trackId: media.trackId,
            //     title: media.title,
            //     artist: media.artist,
            //     album: media.album,
            //     artworkUrl: media.artworkUrl,
            //     progressSeconds: media.progressSeconds,
            //     durationSeconds: Double(media.durationSeconds),
            //     isPlaying: media.isPlaying
            // )
        } else {
        }

        if isCapturing && (mediaStreamPermission != .allow || media?.isPlaying != true) {
            let stopReason = mediaStreamPermission == .allow ? "no_playable_media" : "stream_disabled"
            log("media stream stopped during capture reason=\(stopReason) media=\(media?.title ?? "nil")")
            stopCapture()
            statusText = mediaStreamPermission == .allow ? "Media stopped" : "Media stream disabled"
        }
    }

    func setMediaStreamAllowed(_ allowed: Bool) {
        guard allowCommandWhilePermissionPromptPending("setMediaStreamAllowed") else { return }
        let next: StreamMediaStreamPermission = allowed ? .allow : .disallow
        guard next != mediaStreamPermission else { return }
        mediaStreamPermission = next
        UserDefaults.standard.set(allowed, forKey: Self.mediaStreamAllowedKey)
        pushMediaStateToBridge()
        if !allowed && isCapturing {
            log("owner disabled media stream during capture")
            stopCapture()
            statusText = "Media stream disabled"
        }
    }

    func selectPreferredSource(preferredProvider: String?, preferredBundleId: String?) {
        guard allowCommandWhilePermissionPromptPending("selectPreferredSource") else { return }
        refreshSources()
        if let preferredBundleId = preferredBundleId?.trimmingCharacters(in: .whitespacesAndNewlines),
           !preferredBundleId.isEmpty,
           let source = sources.first(where: { $0.bundleId?.localizedCaseInsensitiveContains(preferredBundleId) == true }) {
            selectedSourceId = source.id
            return
        }

        if preferredProvider?.lowercased() == "spotify",
           let source = sources.first(where: { source in
               source.bundleId?.localizedCaseInsensitiveContains("spotify") == true ||
                   source.name.localizedCaseInsensitiveContains("spotify")
           }) {
            selectedSourceId = source.id
            return
        }

        if selectedSource == nil {
            selectedSourceId = sources.first?.id ?? "system"
        }
    }

    // MARK: - Capture modes

    /// Invoked when the Kotlin state machine reports `captureRequested=true`
    /// (the server has issued `stream.start`). Picks the preferred capture
    /// source, kicks off CoreAudio via the session, and forwards PCM chunks
    /// to the bridge.
    private func startServerDrivenCapture() {
        guard !isCapturing else { return }
        guard allowCommandWhilePermissionPromptPending("startServerDrivenCapture") else { return }
        guard mediaStreamPermission == .allow else {
            log("server started stream but owner disallowed media")
            return
        }
        selectPreferredSource(preferredProvider: currentMedia?.providerId, preferredBundleId: nil)
        guard let source = selectedSource else {
            log("server started stream but no capture source available")
            return
        }
        errorMessage = nil
        statusText = "Starting stream…"
        isCapturing = true
        meter = StreamCaptureMeter()
        pushMediaStateToBridge(captureRunning: true)

        runStreamingSession(source: source)
    }


    private func runStreamingSession(source: StreamCaptureSource, isManual: Bool = false) {
        if isManual {
            log("audio permission preflight begin")
        }
        let worker = self.worker
        session.runStreaming(
            source: source,
            preflightPermission: true,
            pcmHandler: { data in
                let encoded = data.base64EncodedString()
                worker.submitStreamPcmBase64(chunkBase64: encoded)
            },
            onMeter: { [weak self] m in
                guard let self else { return }
                meter = m
                statusText = Self.streamStatusText(
                    sourceName: source.name,
                    publisherStats: publisherStats
                )
            },
            onError: { [weak self] error in
                guard let self else { return }
                log("\(isManual ? "stream" : "server-driven capture") failed error=\(error.localizedDescription)")
                errorMessage = error.localizedDescription
                statusText = "Stream failed"
                if isManual { publisherStatusText = "Publisher failed" }
            },
            onFinish: { [weak self] in
                guard let self else { return }
                if isManual {
                    // emit stop
                }
                pushMediaStateToBridge(captureRunning: false)
                isCapturing = false
                updateAggregatePublisherState()
            }
        )
    }

    func reconnectServer(endpointID: String? = nil) {
        guard allowCommandWhilePermissionPromptPending("reconnectServer") else { return }
        guard !endpoints.isEmpty else {
            publisherStatusText = "Configure a Stream endpoint in Settings"
            updateAggregatePublisherState()
            return
        }
        publisherStatusText = "Manual reconnect requested"
        updateAggregatePublisherState()
    }

    func disconnectEndpoint(_ endpointID: String) {
        guard allowCommandWhilePermissionPromptPending("disconnectEndpoint") else { return }
        // stopCaptureSession 应该有 kotlin 侧进行控制
        // UI 只发送 event
        // worker.stopStream()
        publisherStatusText = endpoints.isEmpty ? "Configure a Stream endpoint in Settings" : "Publisher idle"
        updateAggregatePublisherState()
    }

    func stopCapture() {
        stopCaptureSession()
        // worker.emitStreamLocalStop()
    }

    private func stopCaptureSession() {
        session.cancel()
        pushMediaStateToBridge(captureRunning: false)
        isCapturing = false
        statusText = "Stopped"
        updateAggregatePublisherState()
    }

    // MARK: - Private helpers

    private func pushMediaStateToBridge(captureRunning: Bool? = nil) {
        let capture = captureRunning ?? isCapturing
        worker.emitNativeEvent(
            event: NativeMediaStateChanged(
                permissionAllow: mediaStreamPermission == .allow,
                playbackPlaying: mediaPlaybackStatus == .playing,
                captureRunning: capture,
                reason: nil,
                message: nil,
                media: currentMedia,
                observedAtMillis: Int64(Date().timeIntervalSince1970 * 1000.0)
            )
        )

    }

    private func mediaSignature(_ media: NativeMediaSnapshot?) -> String {
        guard let media else { return "none" }
        return [
            media.providerId ?? "",
            media.trackId ?? "",
            media.title ?? "",
            media.artist ?? "",
            media.album ?? "",
            String(media.durationSeconds ?? 0),
            media.isPlaying ? "playing" : "paused"
        ].joined(separator: "|")
    }

    private func updateAggregatePublisherState() {
        endpointPublisherStats = endpoints.map { endpoint in
            return StreamEndpointPublisherStatus(
                id: endpoint.id,
                name: endpoint.displayName,
                endpointURL: endpoint.baseUrl,
                workspaceId: endpoint.workspaceId,
                statusText: publisherStats.statusText,
                stats: publisherStats
            )
        }
        if endpoints.isEmpty {
            publisherStatusText = "Configure a Stream endpoint in Settings"
        } else {
            let activeActive = publisherStats.connectionStateParsed == .CONNECTED ? 1 : 0
            publisherStatusText = "Stream device sessions connected \(activeActive)/\(endpoints.count)"
        }
    }

    private static func streamStatusText(
        sourceName: String,
        publisherStats: PulseBarStreamStats
    ) -> String {
        StreamPresentation.shared.streamStatusText(
            sourceName: sourceName,
            input: makeStatusInput(stats: publisherStats, isCapturing: false, capturedFrames: 0, endpointCount: 0, activeConnected: false)
        )
    }

    private func buildStatusInput() -> StreamStatusInput {
        let activeConnected = publisherStats.connectionStateParsed == .CONNECTED
        return Self.makeStatusInput(
            stats: publisherStats,
            isCapturing: isCapturing,
            capturedFrames: Int64(meter.capturedFrames),
            endpointCount: Int32(endpoints.count),
            activeConnected: activeConnected
        )
    }

    private static func makeStatusInput(
        stats: PulseBarStreamStats,
        isCapturing: Bool,
        capturedFrames: Int64,
        endpointCount: Int32,
        activeConnected: Bool
    ) -> StreamStatusInput {
        let connectedAt = activeConnected ? Int32(1) : Int32(0)
        // Kotlin uses `0L` as the "no scheduled reconnect" sentinel.
        let nextReconnectMillis: Int64? = stats.nextReconnectAtMillis > 0 ? stats.nextReconnectAtMillis : nil
        return StreamStatusInput(
            connectionStateName: stats.connectionStateName,
            isSending: stats.isSending,
            isCapturing: isCapturing,
            capturedFrames: capturedFrames,
            nextReconnectAtMillis: nextReconnectMillis,
            endpointCount: endpointCount,
            connectedEndpointCount: connectedAt
        )
    }

    private func log(_ message: String) {
        PulseNativeLog.debug(.streamSession, "capture \(message)")
    }

    private func allowCommandWhilePermissionPromptPending(_ command: String) -> Bool {
        guard !audioCapturePermissionRequestPending else {
            publisherStatusText = "Waiting for audio capture permission"
            log("\(command) blocked while audio permission prompt is pending")
            return false
        }
        return true
    }
}
