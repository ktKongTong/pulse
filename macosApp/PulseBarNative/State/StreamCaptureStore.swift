import AppKit
import Foundation
@preconcurrency import PulseBarShared
import SwiftUI

private typealias PulseStreamPermission = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamPermission
private typealias PulsePlaybackStatus = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.PlaybackStatus
private typealias PulseStreamCaptureStatus = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamCaptureStatus

private final class StreamPcmForwarder: @unchecked Sendable {
    private static let targetChunkDurationMillis = 500

    private let worker: StreamBridge
    private let queue = DispatchQueue(label: "io.github.kt.pulsebar.native.stream-pcm-forward")
    private let anchorProgressMs: Int64
    private let anchorObservedAtMillis: Int64
    private let sampleRate: Int
    private let channels: Int
    private let bytesPerFrame: Int
    private let targetChunkBytes: Int
    private var inputChunks = 0
    private var emittedChunks = 0
    private var inputBytes = 0
    private var emittedBytes = 0
    private var forwardedFrames: Int64 = 0
    private var pendingData = Data()
    private var firstPcmStartAtMillis: Int64?

    init(worker: StreamBridge, anchor: StreamMediaPositionAnchor, format: StreamFormat) {
        self.worker = worker
        self.anchorProgressMs = anchor.progressMs
        self.anchorObservedAtMillis = anchor.observedAtMillis
        self.sampleRate = max(Int(format.sampleRate), 1)
        self.channels = max(Int(format.channels), 1)
        self.bytesPerFrame = max(Int(format.channels), 1) * 2
        self.targetChunkBytes = max(
            1,
            max(Int(format.sampleRate), 1) * max(Int(format.channels), 1) * 2 * Self.targetChunkDurationMillis / 1_000
        )
    }

    func enqueue(_ data: Data) {
        queue.async { [worker, anchorProgressMs, anchorObservedAtMillis, sampleRate, channels] in
            self.inputChunks += 1
            self.inputBytes += data.count
            self.pendingData.append(data)
            while self.pendingData.count >= self.targetChunkBytes {
                let chunk = self.pendingData.prefix(self.targetChunkBytes)
                self.pendingData.removeFirst(self.targetChunkBytes)
                self.emitChunk(
                    Data(chunk),
                    worker: worker,
                    anchorProgressMs: anchorProgressMs,
                    anchorObservedAtMillis: anchorObservedAtMillis,
                    sampleRate: sampleRate,
                    channels: channels
                )
            }
        }
    }

    private func emitChunk(
        _ data: Data,
        worker: StreamBridge,
        anchorProgressMs: Int64,
        anchorObservedAtMillis: Int64,
        sampleRate: Int,
        channels: Int
    ) {
            emittedChunks += 1
            emittedBytes += data.count
            let frames = Int64(data.count / bytesPerFrame)
            let nowMillis = Int64(Date().timeIntervalSince1970 * 1000.0)
            let dataDurationMs = frames * 1_000 / Int64(sampleRate)
            if firstPcmStartAtMillis == nil {
                firstPcmStartAtMillis = nowMillis - dataDurationMs
            }
            let firstPcmStartAtMillis = firstPcmStartAtMillis ?? nowMillis
            let streamOffsetMs = forwardedFrames * 1_000 / Int64(sampleRate)
            let mediaStartPositionMs = max(
                0,
                anchorProgressMs + (firstPcmStartAtMillis - anchorObservedAtMillis) + streamOffsetMs
            )
            forwardedFrames += frames
            worker.emitNativeEvent(
                event: NativeStreamPcmChunk(
                    chunkBase64: data.base64EncodedString(),
                    mediaStartPositionMs: mediaStartPositionMs
                )
            )
            if emittedChunks <= 3 || emittedChunks % 20 == 0 {
                PulseNativeLog.debug(
                    .streamSession,
                    "capture pcm.forward bytes=\(self.emittedBytes) inputBytes=\(self.inputBytes) lastBytes=\(data.count) mediaStartPositionMs=\(mediaStartPositionMs)"
                )
            }
    }
}

private struct StreamMediaPositionAnchor {
    let progressMs: Int64
    let observedAtMillis: Int64
}

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
    private static let mediaStatePublishQueue = DispatchQueue(label: "io.github.kt.pulsebar.native.media-state-publish")
    static let autoSourceId = "auto"
    private static let systemSourceId = "system"

    // MARK: - Exposed to SwiftUI

    @Published private(set) var sources: [StreamCaptureSource] = []
    @Published var selectedSourceId: String = autoSourceId
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
        if selectedSourceId == Self.autoSourceId {
            return automaticSource()
        }
        return sources.first { $0.id == selectedSourceId } ?? automaticSource()
    }

    private func automaticSource() -> StreamCaptureSource? {
        if let providerId = currentMedia?.providerId?.lowercased() {
            if providerId == "spotify",
               let source = source(matchingBundleId: "com.spotify.client", fallbackName: "spotify") {
                return source
            }
            if providerId == "apple-music",
               let source = source(matchingBundleId: "com.apple.Music", fallbackName: "music") {
                return source
            }
        }

        return sources.first { $0.id == Self.systemSourceId } ?? sources.first
    }

    private func source(matchingBundleId bundleId: String, fallbackName: String) -> StreamCaptureSource? {
        sources.first { source in
            source.bundleId == bundleId || source.name.localizedCaseInsensitiveContains(fallbackName)
        }
    }

    var serverConnectionText: String {
        publisherStatusText
    }

    var serverEndpointText: String {
        endpoints.map { "\($0.displayName): \($0.url)" }.joined(separator: "\n")
    }

    var captureActivityText: String {
        isCapturing ? "Capturing \(meter.capturedFrames) frames" : statusText
    }

    var nextReconnectText: String {
        "No reconnect scheduled"
    }

    var canReconnectServer: Bool {
        !endpoints.isEmpty
    }

    var blocksUserInteractionForAudioPermission: Bool {
        audioCapturePermissionRequestPending
    }

    // MARK: - Internal state

    private var endpoints: [EndpointConfig] = []
    private let service = StreamCaptureService()
    private lazy var session = StreamCaptureSession(service: service)
    private var startupPermissionTask: Task<Void, Never>?
    private var lastPublishedMediaSignature: String?
    private var lastPublishedProgressSeconds: Double?
    private var lastPublishedMediaObservedAtMillis: Int64?
    private var currentMedia: Media?
    private var currentStreamFormat: StreamFormat?
    private var cachedIdleStreamFormat: StreamFormat?
    private let worker: StreamBridge
    private var statsTask: Task<Void, Never>?
    private var commandTask: Task<Void, Never>?
    private var mediaStatePublishTask: Task<Void, Never>?
    private var pcmForwarder: StreamPcmForwarder?
    private let currentMediaSnapshot: @Sendable () async -> Media?

    // MARK: - Lifecycle

    init(bridge: StreamBridge, currentMediaSnapshot: @escaping @Sendable () async -> Media?) {
        self.worker = bridge
        self.currentMediaSnapshot = currentMediaSnapshot
        if UserDefaults.standard.object(forKey: Self.mediaStreamAllowedKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.mediaStreamAllowedKey)
        }
        mediaStreamPermission = UserDefaults.standard.bool(forKey: Self.mediaStreamAllowedKey) ? .allow : .disallow
        cachedIdleStreamFormat = defaultStreamFormat()
        refreshAudioCapturePermissionStatusAsync()
        refreshSourcesAsync()
        subscribeStats()
    }

    deinit {
        statsTask?.cancel()
        commandTask?.cancel()
        mediaStatePublishTask?.cancel()
        startupPermissionTask?.cancel()
        pcmForwarder = nil
    }

    private func subscribeStats() {
        // stream stats
        let worker = self.worker
        commandTask = Task { @MainActor [weak self] in
            do {
                for try await command in worker.serverCommands.asAsyncSequence() {
                    self?.handleHostCommand(command)
                }
            } catch {
                self?.log("host command stream ended error=\(error.localizedDescription)")
            }
        }
    }

    private func handleHostCommand(_ command: any ServerCommandEvent) {
        if let command = command as? NativeRequestedCommandEvent {
            log("server requested capture start endpoint=\(command.endpointId) stream=\(command.streamId) generation=\(command.generation)")
            Task { @MainActor [weak self] in
                await self?.startServerDrivenCapture(endpointId: command.endpointId)
            }
        } else if let command = command as? NativeStoppedCommandEvent {
            log("server requested capture stop endpoint=\(command.endpointId) stream=\(command.streamId ?? "nil") reason=\(String(describing: command.reason))")
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
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.startServerDrivenCapture(endpointId: self.endpoints.first?.id ?? "")
            }
        } else if !snapshot.captureRequested && previouslyRequested && isCapturing {
            log("server requested capture stop")
            stopCaptureSession()
        }
        if isCapturing && snapshot.connectionState == .FAILED {
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

    func updateEndpoints(_ endpoints: [EndpointConfig]) {
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
        startupPermissionTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let initialStatus = service.audioCapturePermissionStatus()
            audioCapturePermissionStatus = initialStatus
            log("startup audio permission begin status=\(initialStatus.rawValue)")
            audioCapturePermissionRequestPending = initialStatus == .unknown
            if audioCapturePermissionRequestPending {
                publisherStatusText = "Waiting for audio capture permission"
            }
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

    func refreshAudioCapturePermissionStatusAsync() {
        guard !audioCapturePermissionRequestPending else { return }
        let service = self.service
        Task {
            let status = await Task.detached(priority: .utility) {
                service.audioCapturePermissionStatus()
            }.value
            guard !audioCapturePermissionRequestPending else { return }
            audioCapturePermissionStatus = status
        }
    }

    func refreshSources() {
        guard allowCommandWhilePermissionPromptPending("refreshSources") else { return }
        sources = service.availableSources()
        if selectedSourceId != Self.autoSourceId, !sources.contains(where: { $0.id == selectedSourceId }) {
            selectedSourceId = Self.autoSourceId
        }
        updateCachedIdleStreamFormat()
    }

    func refreshSourcesAsync() {
        guard allowCommandWhilePermissionPromptPending("refreshSourcesAsync") else { return }
        let service = self.service
        Task {
            let loadedSources = await Task.detached(priority: .utility) {
                service.availableSources()
            }.value
            sources = loadedSources
            if selectedSourceId != Self.autoSourceId, !loadedSources.contains(where: { $0.id == selectedSourceId }) {
                selectedSourceId = Self.autoSourceId
            }
            cachedIdleStreamFormat = await streamFormatAsync(for: selectedSource)
        }
    }

    @discardableResult
    func updateCurrentMedia(_ media: Media?) -> Bool {
        let signature = mediaSignature(media)
        guard shouldPublishMediaUpdate(signature: signature, media: media) else { return false }
        lastPublishedMediaSignature = signature
        lastPublishedProgressSeconds = media?.progressSeconds
        lastPublishedMediaObservedAtMillis = nowMillis()
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
        return true
    }

    func republishCurrentMediaState() {
        pushMediaStateToBridge()
    }

    func setMediaStreamAllowed(_ allowed: Bool) {
        guard allowCommandWhilePermissionPromptPending("setMediaStreamAllowed") else { return }
        let next: StreamMediaStreamPermission = allowed ? .allow : .disallow
        guard next != mediaStreamPermission else { return }
        mediaStreamPermission = next
        scheduleMediaStatePublish(useCachedIdleFormat: true)
        DispatchQueue.global(qos: .utility).async {
            UserDefaults.standard.set(allowed, forKey: Self.mediaStreamAllowedKey)
        }
        if !allowed && isCapturing {
            log("owner disabled media stream during capture")
            stopCapture()
            statusText = "Media stream disabled"
        }
    }

    func selectPreferredSource(preferredProvider: String?, preferredBundleId: String?) {
        guard allowCommandWhilePermissionPromptPending("selectPreferredSource") else { return }
        _ = preferredProvider
        _ = preferredBundleId
        if selectedSourceId != Self.autoSourceId, selectedSource == nil {
            selectedSourceId = Self.autoSourceId
            updateCachedIdleStreamFormat()
        }
        if sources.isEmpty {
            refreshSourcesAsync()
        }
    }

    // MARK: - Capture modes

    /// Invoked when the Kotlin state machine reports `captureRequested=true`
    /// (the server has issued `stream.start`). Picks the preferred capture
    /// source, kicks off CoreAudio via the session, and forwards PCM chunks
    /// to the bridge.
    private func startServerDrivenCapture(endpointId: String) async {
        guard !isCapturing else { return }
        guard !audioCapturePermissionRequestPending else {
            log("server requested capture while startup audio permission request is pending")
            emitMediaStreamStopped(reason: .CAPTURE_PERMISSION_MISSING)
            return
        }
        guard mediaStreamPermission == .allow else {
            log("server started stream but owner disallowed media")
            emitMediaStreamStopped(reason: .STREAM_DISABLED)
            return
        }
        selectPreferredSource(preferredProvider: currentMedia?.providerId, preferredBundleId: nil)
        guard let source = selectedSource else {
            log("server started stream but no capture source available")
            emitMediaStreamStopped(reason: .CAPTURE_SOURCE_UNAVAILABLE)
            return
        }

        guard let anchor = await refreshMediaPositionAnchor() else {
            log("server started stream but media position unavailable")
            emitMediaStreamStopped(reason: .NO_PLAYABLE_MEDIA)
            return
        }
        let permissionStatus = service.audioCapturePermissionStatus()
        audioCapturePermissionStatus = permissionStatus
        log("server capture permission status=\(permissionStatus.rawValue)")

        beginServerDrivenCapture(endpointId: endpointId, source: source, anchor: anchor)
    }

    private func refreshMediaPositionAnchor() async -> StreamMediaPositionAnchor? {
        let observedAtMillis = nowMillis()
        guard let snapshot = await currentMediaSnapshot(), snapshot.isPlaying else {
            return nil
        }
        currentMedia = snapshot
        lastPublishedMediaSignature = mediaSignature(snapshot)
        lastPublishedProgressSeconds = snapshot.progressSeconds
        lastPublishedMediaObservedAtMillis = observedAtMillis
        mediaPlaybackStatus = .playing
        pushMediaStateToBridge()
        return StreamMediaPositionAnchor(
            progressMs: Int64((snapshot.progressSeconds * 1_000.0).rounded()),
            observedAtMillis: observedAtMillis
        )
    }

    private func beginServerDrivenCapture(endpointId: String, source: StreamCaptureSource, anchor: StreamMediaPositionAnchor) {
        errorMessage = nil
        statusText = "Starting stream…"
        isCapturing = true
        meter = StreamCaptureMeter()
        currentStreamFormat = streamFormat(for: source)
        pushMediaStateToBridge(captureRunning: true)

        runStreamingSession(endpointId: endpointId, source: source, anchor: anchor)
    }


    private func runStreamingSession(endpointId: String, source: StreamCaptureSource, anchor: StreamMediaPositionAnchor, isManual: Bool = false) {
        if isManual {
            log("audio permission preflight begin")
        }
        let forwarder = StreamPcmForwarder(worker: worker, anchor: anchor, format: currentStreamFormat ?? streamFormat(for: source))
        pcmForwarder = forwarder
        session.runStreaming(
            source: source,
            preflightPermission: true,
            pcmHandler: { data in
                forwarder.enqueue(data)
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
                if !isManual {
                    emitMediaStreamStopped(reason: Self.streamStopReason(for: error))
                }
            },
            onFinish: { [weak self] in
                guard let self else { return }
                if isManual {
                    // emit stop
                }
                pushMediaStateToBridge(captureRunning: false)
                isCapturing = false
                pcmForwarder = nil
                updateAggregatePublisherState()
            }
        )
    }

    private func emitMediaStreamStopped(reason: PulseStreamStopReason) {
        emitNativeEventAsync(NativeMediaStreamStopped(reason: reason))
    }

    private static func streamStopReason(for error: Error) -> PulseStreamStopReason {
        if let captureError = error as? StreamCaptureError {
            switch captureError {
            case .audioCapturePermissionDenied, .audioCapturePermissionNotGranted:
                return .CAPTURE_PERMISSION_MISSING
            case .unsupportedOS:
                return .UNSUPPORTED_APP
            case .coreAudio:
                return .CAPTURE_SOURCE_UNAVAILABLE
            }
        }
        return .CAPTURE_SOURCE_LOST
    }

    private static func effectivePermissionStatusAfterSuccessfulProbe(_ preflightStatus: StreamAudioCapturePermissionStatus) -> StreamAudioCapturePermissionStatus {
        preflightStatus == .unknown ? .authorized : preflightStatus
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
        currentStreamFormat = nil
        statusText = "Stopped"
        updateAggregatePublisherState()
    }

    // MARK: - Private helpers

    private func pushMediaStateToBridge(
        captureRunning: Bool? = nil,
        useCachedIdleFormat: Bool = false
    ) {
        let capture = captureRunning ?? isCapturing
        let format = currentStreamFormat ?? cachedIdleStreamFormat ?? defaultStreamFormat()
        emitNativeEventAsync(
            NativeMediaStateChanged(
                permission: mediaStreamPermission == .allow ? PulseStreamPermission.ALLOW : PulseStreamPermission.DISALLOW,
                playbackStatus: mediaPlaybackStatus == .playing ? PulsePlaybackStatus.PLAYING : PulsePlaybackStatus.PAUSED,
                captureStatus: capture ? PulseStreamCaptureStatus.CAPTURING : PulseStreamCaptureStatus.IDLE,
                reason: nil,
                message: nil,
                format: format,
                media: currentMedia,
                observedAtMillis: Int64(Date().timeIntervalSince1970 * 1000.0)
            )
        )

    }

    private func emitNativeEventAsync(_ event: any NativeDeviceEvent & Sendable) {
        let worker = self.worker
        Self.mediaStatePublishQueue.async {
            worker.emitNativeEvent(event: event)
        }
    }

    private func scheduleMediaStatePublish(
        captureRunning: Bool? = nil,
        useCachedIdleFormat: Bool = false
    ) {
        mediaStatePublishTask?.cancel()
        mediaStatePublishTask = Task { @MainActor [weak self] in
            await Task.yield()
            guard let self, !Task.isCancelled else { return }
            self.pushMediaStateToBridge(
                captureRunning: captureRunning,
                useCachedIdleFormat: useCachedIdleFormat
            )
            self.mediaStatePublishTask = nil
        }
    }

    private func updateCachedIdleStreamFormat() {
        cachedIdleStreamFormat = streamFormat(for: selectedSource)
    }

    private func streamFormat(for source: StreamCaptureSource?) -> StreamFormat {
        StreamFormat(
            codec: "pcm16-wav",
            sampleRate: Int32(service.streamSampleRate(for: source)),
            channels: 2,
            bitDepth: 16
        )
    }

    private func streamFormatAsync(for source: StreamCaptureSource?) async -> StreamFormat {
        let service = self.service
        return await Task.detached(priority: .utility) {
            StreamFormat(
                codec: "pcm16-wav",
                sampleRate: Int32(service.streamSampleRate(for: source)),
                channels: 2,
                bitDepth: 16
            )
        }.value
    }

    private func defaultStreamFormat() -> StreamFormat {
        StreamFormat(
            codec: "pcm16-wav",
            sampleRate: 48_000,
            channels: 2,
            bitDepth: 16
        )
    }

    private func mediaSignature(_ media: Media?) -> String {
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

    private func shouldPublishMediaUpdate(signature: String, media: Media?) -> Bool {
        guard signature == lastPublishedMediaSignature else { return true }
        guard let media, media.isPlaying else { return false }
        guard let lastProgress = lastPublishedProgressSeconds,
              let lastObservedAt = lastPublishedMediaObservedAtMillis else {
            return true
        }
        let elapsedSeconds = Double(nowMillis() - lastObservedAt) / 1000.0
        let expectedProgress = lastProgress + elapsedSeconds
        return abs(media.progressSeconds - expectedProgress) > 2.0
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    private func updateAggregatePublisherState() {
        endpointPublisherStats = endpoints.map { endpoint in
            return StreamEndpointPublisherStatus(
                id: endpoint.id,
                name: endpoint.displayName,
                endpointURL: endpoint.url,
                statusText: publisherStats.statusText,
                stats: publisherStats
            )
        }
        if endpoints.isEmpty {
            publisherStatusText = "Configure a Stream endpoint in Settings"
        } else {
            let activeActive = publisherStats.connectionState == .CONNECTED ? 1 : 0
            publisherStatusText = "Stream device sessions connected \(activeActive)/\(endpoints.count)"
        }
    }

    private static func streamStatusText(
        sourceName: String,
        publisherStats: PulseBarStreamStats
    ) -> String {
        if publisherStats.isSending {
            return "Streaming \(sourceName)"
        }
        if publisherStats.captureRequested {
            return "Starting \(sourceName)"
        }
        return "Ready for \(sourceName)"
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
