import AppKit
import Foundation
@preconcurrency import PulseBarShared
import SwiftUI

/// UI-facing Live Listen coordinator. Owns the thin Swift `LiveListenCaptureService`
/// for CoreAudio capture, observes telemetry from Kotlin's `LiveListenClient`
/// via the `PulseBarBridge`, and exposes everything the debug pane needs
/// through `@Published` properties.
///
/// All state-machine logic, WebSocket transport, WAV framing, and reconnect
/// scheduling live in Kotlin. Swift only forwards PCM bytes and binds UI.
@MainActor
final class LiveListenCaptureModel: ObservableObject {
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
    @Published private(set) var publisherStats = LiveListenPublisherStats()
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
        let total = endpoints.count
        guard total > 0 else { return "none" }
        let connected = endpoints.count { endpoint in
            activeEndpointId == endpoint.id && publisherStats.connectionState == .connected
        }
        return "\(connected)/\(total)"
    }

    var serverEndpointText: String {
        endpoints.map { endpoint in
            let name = endpoint.name.isEmpty ? endpoint.baseURL.host ?? endpoint.baseURL.absoluteString : endpoint.name
            return "\(name): \(endpoint.baseURL.absoluteString)"
        }.joined(separator: "\n")
    }

    var captureActivityText: String {
        if !isCapturing { return "idle" }
        if publisherStats.isSending { return "sending" }
        if meter.capturedFrames > 0 { return "capturing" }
        return "starting"
    }

    var nextReconnectText: String {
        guard let nextReconnectAt = publisherStats.nextReconnectAt else { return "-" }
        let seconds = max(0, nextReconnectAt.timeIntervalSince(Date()))
        if seconds < 1 { return "now" }
        return String(format: "%.0fs", seconds)
    }

    var canReconnectServer: Bool {
        !endpoints.isEmpty
    }

    // MARK: - Internal state

    private var endpoints: [LiveListenEndpointConfig] = []
    private var activeEndpointId: String?
    private let service = LiveListenCaptureService()
    private var meterTask: Task<Void, Never>?
    private var startupPermissionTask: Task<Void, Never>?
    private var lastPublishedMediaSignature: String?
    private var currentMedia: MediaInfo?
    private let worker = LiveListenBridgeWorker()
    private var statsCancellable: PulseBarCancellable?

    // MARK: - Lifecycle

    init() {
        if UserDefaults.standard.object(forKey: Self.mediaStreamAllowedKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.mediaStreamAllowedKey)
        }
        mediaStreamPermission = UserDefaults.standard.bool(forKey: Self.mediaStreamAllowedKey) ? .allow : .disallow
        refreshSources()
        subscribeStats()
    }

    deinit {
        statsCancellable?.cancel()
        meterTask?.cancel()
        startupPermissionTask?.cancel()
    }

    private func subscribeStats() {
        worker.observeStats { [weak self] snapshot in
            guard let self else { return }
            applyStatsSnapshot(snapshot)
        } cancellableReceived: { [weak self] cancellable in
            self?.statsCancellable = cancellable
        }
    }

    private func applyStatsSnapshot(_ snapshot: LiveListenPublisherStats) {
        publisherStats = snapshot
        updateAggregatePublisherState()
        if isCapturing && snapshot.connectionState == .failed {
            appendLiveListenCaptureDebugLog("live listen failed during capture")
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

    func updateEndpoints(_ endpoints: [LiveListenEndpointConfig]) {
        self.endpoints = endpoints
        if endpoints.isEmpty {
            if isCapturing {
                appendLiveListenCaptureDebugLog("stopping capture because no live listen endpoints remain")
                stopCapture()
            } else {
                worker.stopLiveListen()
            }
            activeEndpointId = nil
            publisherStatusText = "Configure a Live Listen endpoint in Settings"
            updateAggregatePublisherState()
            return
        }

        updateAggregatePublisherState()
        if !isCapturing {
            publisherStatusText = "Publisher idle"
        }

        // Ensure the Kotlin client tracks the active endpoint (currently the first).
        if let primary = endpoints.first, activeEndpointId != primary.id {
            activeEndpointId = primary.id
            if isCapturing {
                connectToActiveEndpoint(roomId: "live-listen:owner", deviceId: "owner")
            }
        }
    }

    func requestAudioCapturePermissionAtStartup() {
        guard startupPermissionTask == nil else { return }
        startupPermissionTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let initialStatus = service.audioCapturePermissionStatus()
            audioCapturePermissionStatus = initialStatus
            appendLiveListenCaptureDebugLog("startup audio permission begin status=\(initialStatus.rawValue)")
            do {
                try await service.ensureAudioCapturePermissionForUI()
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                appendLiveListenCaptureDebugLog("startup audio permission ok status=\(status.rawValue)")
            } catch {
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                errorMessage = error.localizedDescription
                publisherStatusText = "Audio capture permission required"
                appendLiveListenCaptureDebugLog("startup audio permission failed status=\(status.rawValue) error=\(error.localizedDescription)")
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

    func updateCurrentMedia(_ media: MediaInfo?) {
        let signature = Self.mediaSignature(media)
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

        if isCapturing && (mediaStreamPermission != .allow || media?.isPlaying != true) {
            let stopReason = mediaStreamPermission == .allow ? "no_playable_media" : "live_listen_disabled"
            appendLiveListenCaptureDebugLog("media stream stopped during capture reason=\(stopReason) media=\(media?.title ?? "nil")")
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
            appendLiveListenCaptureDebugLog("owner disabled media stream during capture")
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

    func startCaptureOnly(seconds: Double = 10) {
        guard !isCapturing, let selectedSource else { return }
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

        meterTask?.cancel()
        meterTask = Task { [weak self] in
            guard let self else { return }
            do {
                let stream = try await service.capture(source: selectedSource, outputURL: outputURL, seconds: seconds)
                statusText = "Capturing \(selectedSource.name)…"
                for try await update in stream {
                    meter = update.meter
                    statusText = update.statusText
                }
                lastSampleURL = outputURL
                statusText = "Captured sample"
            } catch {
                errorMessage = error.localizedDescription
                statusText = "Capture failed"
            }
            isCapturing = false
        }
    }

    func startNativeStream(roomId: String = "live-listen:owner", deviceId: String = "owner") {
        appendLiveListenCaptureDebugLog("startNativeStream called room=\(roomId) device=\(deviceId) isCapturing=\(isCapturing) selected=\(selectedSource?.name ?? "nil") endpoints=\(endpoints.map { $0.baseURL.absoluteString }.joined(separator: ","))")
        guard !isCapturing, let selectedSource else {
            appendLiveListenCaptureDebugLog("startNativeStream ignored isCapturing=\(isCapturing) selected=\(selectedSource?.name ?? "nil")")
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

        meterTask?.cancel()
        meterTask = Task { [weak self] in
            guard let self else { return }
            do {
                appendLiveListenCaptureDebugLog("audio permission preflight begin")
                try service.ensureAudioCapturePermissionForBackgroundStart()
                appendLiveListenCaptureDebugLog("audio permission preflight ok")
                pushMediaStateToBridge(captureRunning: true)

                // Deliver every captured chunk straight to the Kotlin bridge.
                // The Swift render callback is real-time safe; `submitPcm` on
                // the bridge is a non-blocking `trySend` into a buffered channel.
                let worker = self.worker
                let stream = try await service.capture(source: selectedSource) { data in
                    worker.submitPcm(data: data)
                }
                statusText = "Waiting for \(selectedSource.name) audio…"
                for try await update in stream {
                    meter = update.meter
                    statusText = Self.streamStatusText(
                        sourceName: selectedSource.name,
                        publisherStats: publisherStats
                    )
                }
            } catch {
                appendLiveListenCaptureDebugLog("stream failed error=\(error.localizedDescription)")
                errorMessage = error.localizedDescription
                statusText = "Stream failed"
                publisherStatusText = "Publisher failed"
            }
            worker.stopLiveListen()
            pushMediaStateToBridge(captureRunning: false)
            isCapturing = false
            updateAggregatePublisherState()
        }
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
        service.stop()
        meterTask?.cancel()
        meterTask = nil
        worker.stopLiveListen()
        pushMediaStateToBridge(captureRunning: false)
        isCapturing = false
        statusText = "Stopped"
        updateAggregatePublisherState()
    }

    // MARK: - Private

    private func connectToActiveEndpoint(roomId: String, deviceId: String) {
        guard let endpoint = endpoints.first(where: { $0.id == activeEndpointId }) ?? endpoints.first else { return }
        activeEndpointId = endpoint.id
        worker.startLiveListen(
            roomId: roomId,
            deviceId: deviceId,
            baseUrl: endpoint.baseURL.absoluteString,
            workspaceId: endpoint.workspaceId,
            apiKey: endpoint.apiKey
        )
    }

    private func pushMediaStateToBridge(captureRunning: Bool? = nil) {
        let running = captureRunning ?? isCapturing
        worker.updateMediaState(
            permissionAllow: mediaStreamPermission == .allow,
            playbackPlaying: mediaPlaybackStatus == .playing,
            captureRunning: running
        )
    }

    private func updateAggregatePublisherState() {
        endpointPublisherStats = endpoints.map { endpoint in
            let active = endpoint.id == activeEndpointId
            return LiveListenEndpointPublisherStatus(
                id: endpoint.id,
                name: endpoint.name.isEmpty ? endpoint.baseURL.host ?? endpoint.baseURL.absoluteString : endpoint.name,
                endpointURL: endpoint.baseURL.absoluteString,
                workspaceId: endpoint.workspaceId,
                statusText: active ? publisherStats.statusText : "Standby",
                stats: active ? publisherStats : LiveListenPublisherStats()
            )
        }
        if endpoints.isEmpty {
            publisherStatusText = "Configure a Live Listen endpoint in Settings"
        } else {
            let activeActive = publisherStats.connectionState == .connected ? 1 : 0
            publisherStatusText = "Live Listen device sessions connected \(activeActive)/\(endpoints.count)"
        }
    }

    private static func streamStatusText(
        sourceName: String,
        publisherStats: LiveListenPublisherStats
    ) -> String {
        switch publisherStats.connectionState {
        case .connecting:
            return "Connecting Live Listen server…"
        case .connected:
            if publisherStats.isSending {
                return "Sending \(sourceName) audio…"
            }
            return "Capturing \(sourceName)…"
        case .reconnecting:
            return "Reconnecting Live Listen server…"
        case .failed:
            return "Live Listen connection failed"
        case .stopping:
            return "Stopping stream…"
        case .stopped:
            return "Stream stopped"
        case .idle:
            return "Preparing stream…"
        }
    }

    private static func mediaSignature(_ media: MediaInfo?) -> String {
        guard let media else { return "none" }
        return [
            media.id,
            media.providerId,
            media.source,
            media.title,
            media.artist,
            media.album ?? "",
            media.link ?? "",
            String(media.durationSeconds ?? 0),
            media.isPlaying ? "playing" : "paused",
        ].joined(separator: "|")
    }

    private func appendLiveListenCaptureDebugLog(_ message: String) {
        PulseNativeLog.debug(.liveListenSession, "capture \(message)")
    }
}

// MARK: - Bridge worker (all Kotlin calls off the main actor)

private final class LiveListenBridgeWorker: @unchecked Sendable {
    private let queue = DispatchQueue(label: "io.github.kt.pulsebar.live-listen.bridge", qos: .utility)
    private var bridge: PulseBarBridge!

    init() {
        queue.sync {
            bridge = PulseBarBridge()
        }
    }

    func startLiveListen(
        roomId: String,
        deviceId: String,
        baseUrl: String,
        workspaceId: String,
        apiKey: String,
        sampleRate: Int32 = 48_000,
        channels: Int32 = 2,
        chunkDurationMs: Int32 = 500
    ) {
        queue.async {
            self.bridge.startLiveListen(
                roomId: roomId,
                deviceId: deviceId,
                baseUrl: baseUrl,
                workspaceId: workspaceId,
                apiKey: apiKey,
                sampleRate: sampleRate,
                channels: channels,
                chunkDurationMs: chunkDurationMs
            )
        }
    }

    func stopLiveListen() {
        queue.async { self.bridge.stopLiveListen() }
    }

    /// Called from the real-time CoreAudio render thread. We hop to a
    /// utility queue immediately; [PulseBarBridge.submitLiveListenPcmBase64]
    /// is a non-blocking channel `trySend` on the Kotlin side.
    func submitPcm(data: Data) {
        let encoded = data.base64EncodedString()
        queue.async {
            self.bridge.submitLiveListenPcmBase64(chunkBase64: encoded)
        }
    }

    func updateMediaState(permissionAllow: Bool, playbackPlaying: Bool, captureRunning: Bool) {
        queue.async {
            self.bridge.updateLiveListenMediaState(
                permissionAllow: permissionAllow,
                playbackPlaying: playbackPlaying,
                captureRunning: captureRunning
            )
        }
    }

    func observeStats(
        onSnapshot: @escaping @MainActor (LiveListenPublisherStats) -> Void,
        cancellableReceived: @escaping @MainActor (PulseBarCancellable) -> Void
    ) {
        queue.async {
            let cancellable = self.bridge.observeLiveListenStats { stats in
                let mapped = LiveListenPublisherStats(from: stats)
                DispatchQueue.main.async { onSnapshot(mapped) }
            }
            DispatchQueue.main.async { cancellableReceived(cancellable) }
        }
    }
}

// MARK: - SwiftUI-facing stat types

/// Mirror of the Kotlin `PulseBarLiveListenStats` class adapted for Swift
/// presentation code. Keeping the shape stable means the existing views don't
/// need to know about the Kotlin types directly.
struct LiveListenPublisherStats: Equatable, Sendable {
    var connectionState: LiveListenPublisherConnectionState = .idle
    var webSocketURL: String?
    var lastConnectedAt: Date?
    var lastDisconnectedAt: Date?
    var nextReconnectAt: Date?
    var reconnectDelaySeconds: Double?
    var lastSendAt: Date?
    var lastErrorMessage: String?
    var acceptedFrames: UInt64 = 0
    var acceptedBytes: UInt64 = 0
    var droppedFrames: UInt64 = 0
    var droppedChunks: UInt64 = 0
    var lastSequence: UInt64 = 0
    var bufferedFrames: UInt64 = 0
    var queuedChunks: Int = 0
    var queuedBytes: UInt64 = 0
    var queuedFirstSequence: UInt64?
    var queuedLastSequence: UInt64?
    var isSending: Bool = false
    var maxQueuedChunks: Int = 0
    var reconnectCount: UInt64 = 0
    var reconnectAttempt: Int = 0
    var chunksSent: UInt64 = 0
    var bytesSent: UInt64 = 0
    var sendBitrateKbps: Double?
    var lastChunkBytes: UInt64 = 0
    var chunkDurationMs: Int = 500
    var statusText: String = "Live Listen client idle"
}

enum LiveListenPublisherConnectionState: String, Sendable, Equatable {
    case idle
    case connecting
    case connected
    case reconnecting
    case stopping
    case stopped
    case failed
}

extension LiveListenPublisherStats {
    init(from stats: PulseBarLiveListenStats) {
        self.connectionState = LiveListenPublisherConnectionState(kotlin: stats.connectionState)
        self.webSocketURL = stats.webSocketUrl
        self.lastConnectedAt = LiveListenPublisherStats.dateOrNil(millis: stats.lastConnectedAtMillis)
        self.lastDisconnectedAt = LiveListenPublisherStats.dateOrNil(millis: stats.lastDisconnectedAtMillis)
        self.nextReconnectAt = LiveListenPublisherStats.dateOrNil(millis: stats.nextReconnectAtMillis)
        self.reconnectDelaySeconds = stats.reconnectDelaySeconds > 0 ? stats.reconnectDelaySeconds : nil
        self.lastSendAt = LiveListenPublisherStats.dateOrNil(millis: stats.lastSendAtMillis)
        self.lastErrorMessage = stats.lastErrorMessage
        self.acceptedFrames = UInt64(max(0, stats.acceptedFrames))
        self.acceptedBytes = UInt64(max(0, stats.acceptedBytes))
        self.droppedFrames = UInt64(max(0, stats.droppedFrames))
        self.droppedChunks = UInt64(max(0, stats.droppedChunks))
        self.lastSequence = UInt64(max(0, stats.lastSequence))
        self.bufferedFrames = UInt64(max(0, stats.bufferedFrames))
        self.queuedChunks = Int(stats.queuedChunks)
        self.queuedBytes = UInt64(max(0, stats.queuedBytes))
        self.queuedFirstSequence = stats.queuedFirstSequence >= 0 ? UInt64(stats.queuedFirstSequence) : nil
        self.queuedLastSequence = stats.queuedLastSequence >= 0 ? UInt64(stats.queuedLastSequence) : nil
        self.isSending = stats.isSending
        self.maxQueuedChunks = Int(stats.maxQueuedChunks)
        self.reconnectCount = UInt64(max(0, stats.reconnectCount))
        self.reconnectAttempt = Int(stats.reconnectAttempt)
        self.chunksSent = UInt64(max(0, stats.chunksSent))
        self.bytesSent = UInt64(max(0, stats.bytesSent))
        self.sendBitrateKbps = stats.sendBitrateKbps > 0 ? stats.sendBitrateKbps : nil
        self.lastChunkBytes = UInt64(max(0, stats.lastChunkBytes))
        self.chunkDurationMs = Int(stats.chunkDurationMs)
        self.statusText = stats.statusText
    }

    private static func dateOrNil(millis: Int64) -> Date? {
        millis > 0 ? Date(timeIntervalSince1970: TimeInterval(millis) / 1000.0) : nil
    }
}

extension LiveListenPublisherConnectionState {
    init(kotlin: PulseBarLiveListenConnectionState) {
        switch kotlin {
        case .IDLE: self = .idle
        case .CONNECTING: self = .connecting
        case .CONNECTED: self = .connected
        case .RECONNECTING: self = .reconnecting
        case .STOPPING: self = .stopping
        case .STOPPED: self = .stopped
        case .FAILED: self = .failed
        default: self = .idle
        }
    }
}

struct LiveListenEndpointPublisherStatus: Identifiable, Equatable {
    let id: String
    let name: String
    let endpointURL: String
    let workspaceId: String
    let statusText: String
    let stats: LiveListenPublisherStats
}

enum LiveListenMediaStreamPermission: String {
    case allow
    case disallow
}

enum LiveListenMediaPlaybackStatus: String {
    case playing
    case paused
}
