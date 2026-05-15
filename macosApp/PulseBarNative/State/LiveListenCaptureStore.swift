import AppKit
import Foundation
@preconcurrency import PulseBarShared
import SwiftUI

private typealias LiveListenStatusInput = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.LiveListenStatusInput
private typealias LiveListenPresentation = ExportedKotlinPackages.io.github.kt.pulsebar.core.presentation.LiveListenPresentation

/// `@MainActor ObservableObject` store for the Live Listen screen.
///
/// Layer: **State/**. Only holds `@Published` state + command methods.
/// Platform work delegates to `Services/LiveListen/`; transport +
/// reconnect + framing live in Kotlin via `LiveListenBridge`.
///
/// Future split (deferred, non-behavior-touching refactor): the
/// `startServerDrivenCapture` / `startNativeStream` / `stopCapture` /
/// `updateCurrentMedia` decision tree is a state machine; it can be
/// lifted into a pure `LiveListenEngine` that takes an input snapshot
/// and returns effects, leaving this store as a thin effects executor.
/// Not doing it now — the current flow is working and tested.
@MainActor
final class LiveListenCaptureStore: ObservableObject {
    private static let mediaStreamAllowedKey = "PulseBarNative.liveListen.mediaStreamAllowed"

    // MARK: - Exposed to SwiftUI

    @Published private(set) var sources: [LiveListenCaptureSource] = []
    @Published var selectedSourceId: String = "system"
    @Published private(set) var isCapturing = false
    @Published private(set) var statusText = "Idle"
    @Published private(set) var meter = LiveListenCaptureMeter()
    @Published private(set) var lastSampleURL: URL?
    @Published private(set) var errorMessage: String?
    @Published private(set) var publisherStatusText = "Publisher idle"
    @Published private(set) var publisherStats: PulseBarLiveListenStats = PulseBarLiveListenStatsFactory.shared.idle()
    @Published private(set) var endpointPublisherStats: [LiveListenEndpointPublisherStatus] = []
    @Published private(set) var mediaStreamPermission: LiveListenMediaStreamPermission = .allow
    @Published private(set) var mediaPlaybackStatus: LiveListenMediaPlaybackStatus = .paused
    @Published private(set) var mediaPlaybackReason = "no media"
    @Published private(set) var currentMediaLabel = "-"
    @Published private(set) var audioCapturePermissionStatus: LiveListenAudioCapturePermissionStatus = .unknown

    // MARK: - Derived

    var selectedSource: LiveListenCaptureSource? {
        sources.first { $0.id == selectedSourceId } ?? sources.first
    }

    var serverConnectionText: String {
        LiveListenPresentation.shared.serverConnectionText(input: buildStatusInput())
    }

    var serverEndpointText: String {
        endpoints.map { "\($0.displayName): \($0.baseUrl)" }.joined(separator: "\n")
    }

    var captureActivityText: String {
        LiveListenPresentation.shared.captureActivityText(input: buildStatusInput())
    }

    var nextReconnectText: String {
        LiveListenPresentation.shared.nextReconnectText(
            input: buildStatusInput(),
            nowMillis: Int64(Date().timeIntervalSince1970 * 1000.0)
        )
    }

    var canReconnectServer: Bool {
        !endpoints.isEmpty
    }

    // MARK: - Internal state

    private var endpoints: [LiveListenEndpointResolved] = []
    private var activeEndpointId: String?
    private let service = LiveListenCaptureService()
    private lazy var session = LiveListenCaptureSession(service: service)
    private var startupPermissionTask: Task<Void, Never>?
    private var lastPublishedMediaSignature: String?
    private var currentMedia: PulseBarMedia?
    private let worker: LiveListenBridge
    private var statsTask: Task<Void, Never>?

    // MARK: - Lifecycle

    init(bridge: LiveListenBridge) {
        self.worker = bridge
        if UserDefaults.standard.object(forKey: Self.mediaStreamAllowedKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.mediaStreamAllowedKey)
        }
        mediaStreamPermission = UserDefaults.standard.bool(forKey: Self.mediaStreamAllowedKey) ? .allow : .disallow
        refreshSources()
        subscribeStats()
    }

    deinit {
        statsTask?.cancel()
        startupPermissionTask?.cancel()
    }

    private func subscribeStats() {
        let stream = worker.liveListenStatsStream()
        statsTask = Task { @MainActor [weak self] in
            for await snapshot in stream {
                guard let self else { return }
                applyStatsSnapshot(snapshot)
            }
        }
    }

    private func applyStatsSnapshot(_ snapshot: PulseBarLiveListenStats) {
        let previouslyRequested = publisherStats.captureRequested
        publisherStats = snapshot
        updateAggregatePublisherState()
        if snapshot.captureRequested && !previouslyRequested {
            log("server requested capture start")
            startServerDrivenCapture()
        } else if !snapshot.captureRequested && previouslyRequested && isCapturing {
            log("server requested capture stop")
            stopCapture()
        }
        if isCapturing && snapshot.connectionStateParsed == .FAILED {
            log("live listen failed during capture")
            stopCapture()
            statusText = "Live Listen connection failed"
        } else if isCapturing {
            statusText = Self.streamStatusText(
                sourceName: selectedSource?.name ?? "selected source",
                publisherStats: snapshot
            )
        }
    }

    // MARK: - Public commands

    func updateEndpoints(_ endpoints: [LiveListenEndpointResolved]) {
        self.endpoints = endpoints
        if endpoints.isEmpty {
            if isCapturing {
                log("stopping capture because no live listen endpoints remain")
                stopCapture()
            } else {
                worker.stopLiveListen()
            }
            activeEndpointId = nil
            publisherStatusText = "Configure a Live Listen endpoint in Settings"
            updateAggregatePublisherState()
            return
        }

        let primary = endpoints.first
        if let primary, activeEndpointId != primary.id {
            activeEndpointId = primary.id
        } else if activeEndpointId == nil {
            activeEndpointId = primary?.id
        }
        connectToActiveEndpoint(roomId: "live-listen:owner", deviceId: "owner")
        pushMediaStateToBridge()
        updateAggregatePublisherState()
        if !isCapturing {
            publisherStatusText = "Publisher idle"
        }
    }

    func requestAudioCapturePermissionAtStartup() {
        guard startupPermissionTask == nil else { return }
        startupPermissionTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let initialStatus = service.audioCapturePermissionStatus()
            audioCapturePermissionStatus = initialStatus
            log("startup audio permission begin status=\(initialStatus.rawValue)")
            do {
                try await service.ensureAudioCapturePermissionForUI()
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                log("startup audio permission ok status=\(status.rawValue)")
            } catch {
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                errorMessage = error.localizedDescription
                publisherStatusText = "Audio capture permission required"
                log("startup audio permission failed status=\(status.rawValue) error=\(error.localizedDescription)")
            }
            startupPermissionTask = nil
        }
    }

    func refreshSources() {
        sources = service.availableSources()
        if !sources.contains(where: { $0.id == selectedSourceId }) {
            selectedSourceId = sources.first?.id ?? "system"
        }
    }

    func updateCurrentMedia(_ media: PulseBarMedia?) {
        let signature = LiveListenPresentation.shared.mediaSignature(media: media)
        guard signature != lastPublishedMediaSignature else { return }
        lastPublishedMediaSignature = signature
        currentMedia = media
        mediaPlaybackStatus = media?.isPlaying == true ? .playing : .paused
        if let media {
            currentMediaLabel = media.artist.isEmpty ? media.title : "\(media.title) - \(media.artist)"
            mediaPlaybackReason = media.isPlaying ? "playing" : "paused"
        } else {
            currentMediaLabel = "-"
            mediaPlaybackReason = "no playable media"
        }

        pushMediaStateToBridge()

        if let media, media.isPlaying {
            worker.updateLiveListenMedia(
                providerId: media.providerId,
                trackId: media.trackId,
                title: media.title,
                artist: media.artist,
                album: media.album,
                artworkUrl: media.artworkUrl,
                durationSeconds: Double(media.durationSeconds),
                isPlaying: media.isPlaying
            )
        } else {
            worker.updateLiveListenMedia(
                providerId: nil,
                trackId: nil,
                title: nil,
                artist: nil,
                album: nil,
                artworkUrl: nil,
                durationSeconds: 0,
                isPlaying: false
            )
        }

        if isCapturing && (mediaStreamPermission != .allow || media?.isPlaying != true) {
            let stopReason = mediaStreamPermission == .allow ? "no_playable_media" : "live_listen_disabled"
            log("media stream stopped during capture reason=\(stopReason) media=\(media?.title ?? "nil")")
            stopCapture()
            statusText = mediaStreamPermission == .allow ? "Media stopped" : "Media stream disabled"
        }
    }

    func setMediaStreamAllowed(_ allowed: Bool) {
        let next: LiveListenMediaStreamPermission = allowed ? .allow : .disallow
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
        meter = LiveListenCaptureMeter()
        pushMediaStateToBridge(captureRunning: true)

        runStreamingSession(source: source)
    }

    /// Manual debug entry: "Start native stream" button in the capture pane.
    func startNativeStream(roomId: String = "live-listen:owner", deviceId: String = "owner") {
        log("startNativeStream called room=\(roomId) device=\(deviceId) isCapturing=\(isCapturing) selected=\(selectedSource?.name ?? "nil") endpoints=\(endpoints.map { $0.baseUrl }.joined(separator: ","))")
        guard !isCapturing, let source = selectedSource else {
            log("startNativeStream ignored isCapturing=\(isCapturing) selected=\(selectedSource?.name ?? "nil")")
            return
        }
        guard !endpoints.isEmpty else {
            errorMessage = "Configure an endpoint URL, Workspace ID, and API Key in Settings > Endpoints before starting a native stream."
            publisherStatusText = "Missing Native endpoint config"
            return
        }
        guard mediaStreamPermission == .allow else {
            publisherStatusText = "Media stream permission disallowed"
            return
        }
        guard mediaPlaybackStatus == .playing else {
            publisherStatusText = "No playing media"
            return
        }

        errorMessage = nil
        statusText = "Starting stream…"
        publisherStatusText = "Connecting Live Listen servers…"
        isCapturing = true
        meter = LiveListenCaptureMeter()

        connectToActiveEndpoint(roomId: roomId, deviceId: deviceId)
        runStreamingSession(source: source, isManual: true)
    }

    /// Fixed-duration debug sample that writes a WAV file and surfaces its URL.
    func startCaptureOnly(seconds: Double = 10) {
        guard !isCapturing, let source = selectedSource else { return }
        errorMessage = nil
        statusText = "Starting capture…"
        isCapturing = true
        meter = LiveListenCaptureMeter()
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("pulse-live-listen-")
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("wav")
        try? FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        session.runSample(
            source: source,
            outputURL: outputURL,
            seconds: seconds,
            onMeter: { [weak self] m in
                self?.meter = m
            },
            onStatus: { [weak self] s in
                self?.statusText = s
            },
            onError: { [weak self] error in
                self?.errorMessage = error.localizedDescription
                self?.statusText = "Capture failed"
            },
            onFinish: { [weak self] in
                guard let self else { return }
                if errorMessage == nil {
                    lastSampleURL = outputURL
                    statusText = "Captured sample"
                }
                isCapturing = false
            }
        )
    }

    private func runStreamingSession(source: LiveListenCaptureSource, isManual: Bool = false) {
        let worker = self.worker
        if isManual {
            log("audio permission preflight begin")
        }
        session.runStreaming(
            source: source,
            preflightPermission: true,
            pcmHandler: { data in
                let encoded = data.base64EncodedString()
                worker.submitLiveListenPcmBase64(chunkBase64: encoded)
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
                if isManual { worker.stopLiveListen() }
                pushMediaStateToBridge(captureRunning: false)
                isCapturing = false
                updateAggregatePublisherState()
            }
        )
    }

    func reconnectServer() {
        guard !endpoints.isEmpty else {
            publisherStatusText = "Configure a Live Listen endpoint in Settings"
            return
        }
        publisherStatusText = "Manual reconnect requested"
        connectToActiveEndpoint(roomId: "live-listen:owner", deviceId: "owner")
    }

    func stopCapture() {
        session.cancel()
        worker.stopLiveListen()
        pushMediaStateToBridge(captureRunning: false)
        isCapturing = false
        statusText = "Stopped"
        updateAggregatePublisherState()
    }

    // MARK: - Private helpers

    private func connectToActiveEndpoint(roomId: String, deviceId: String) {
        guard let endpoint = endpoints.first(where: { $0.id == activeEndpointId }) ?? endpoints.first else { return }
        activeEndpointId = endpoint.id
        worker.startLiveListen(
            roomId: roomId,
            deviceId: deviceId,
            baseUrl: endpoint.baseUrl,
            workspaceId: endpoint.workspaceId,
            apiKey: endpoint.apiKey,
            sampleRate: 48_000,
            channels: 2,
            chunkDurationMs: 500
        )
    }

    private func pushMediaStateToBridge(captureRunning: Bool? = nil) {
        let running = captureRunning ?? isCapturing
        worker.updateLiveListenMediaState(
            permissionAllow: mediaStreamPermission == .allow,
            playbackPlaying: mediaPlaybackStatus == .playing,
            captureRunning: running
        )
    }

    private func updateAggregatePublisherState() {
        let idleStats = PulseBarLiveListenStatsFactory.shared.idle()
        endpointPublisherStats = endpoints.map { endpoint in
            let active = endpoint.id == activeEndpointId
            return LiveListenEndpointPublisherStatus(
                id: endpoint.id,
                name: endpoint.displayName,
                endpointURL: endpoint.baseUrl,
                workspaceId: endpoint.workspaceId,
                statusText: active ? publisherStats.statusText : "Standby",
                stats: active ? publisherStats : idleStats
            )
        }
        if endpoints.isEmpty {
            publisherStatusText = "Configure a Live Listen endpoint in Settings"
        } else {
            let activeActive = publisherStats.connectionStateParsed == .CONNECTED ? 1 : 0
            publisherStatusText = "Live Listen device sessions connected \(activeActive)/\(endpoints.count)"
        }
    }

    private static func streamStatusText(
        sourceName: String,
        publisherStats: PulseBarLiveListenStats
    ) -> String {
        LiveListenPresentation.shared.streamStatusText(
            sourceName: sourceName,
            input: makeStatusInput(stats: publisherStats, isCapturing: false, capturedFrames: 0, endpointCount: 0, activeConnected: false)
        )
    }

    private func buildStatusInput() -> LiveListenStatusInput {
        let activeConnected = publisherStats.connectionStateParsed == .CONNECTED && activeEndpointId != nil
        return Self.makeStatusInput(
            stats: publisherStats,
            isCapturing: isCapturing,
            capturedFrames: Int64(meter.capturedFrames),
            endpointCount: Int32(endpoints.count),
            activeConnected: activeConnected
        )
    }

    private static func makeStatusInput(
        stats: PulseBarLiveListenStats,
        isCapturing: Bool,
        capturedFrames: Int64,
        endpointCount: Int32,
        activeConnected: Bool
    ) -> LiveListenStatusInput {
        let connectedAt = activeConnected ? Int32(1) : Int32(0)
        // Kotlin uses `0L` as the "no scheduled reconnect" sentinel.
        let nextReconnectMillis: Int64? = stats.nextReconnectAtMillis > 0 ? stats.nextReconnectAtMillis : nil
        return LiveListenStatusInput(
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
        PulseNativeLog.debug(.liveListenSession, "capture \(message)")
    }
}
