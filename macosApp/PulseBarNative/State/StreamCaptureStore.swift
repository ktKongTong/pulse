import Combine
import Foundation
@preconcurrency import PulseBarShared

private typealias PulseStreamPermission = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamPermission
private typealias PulsePlaybackStatus = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.PlaybackStatus
private typealias PulseStreamCaptureStatus = ExportedKotlinPackages.io.github.kt.pulsebar.model.stream.StreamCaptureStatus

private final class StreamPcmForwarder: @unchecked Sendable {
    private static let targetChunkDurationMillis = 500

    private let worker: PulseBarBridge
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

    init(worker: PulseBarBridge, anchor: StreamMediaPositionAnchor, format: StreamFormat) {
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
        worker: PulseBarBridge,
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

/// `@MainActor ObservableObject` store for native audio streaming.
///
/// Layer: **State/**. Only holds `@Published` state + command methods.
/// Platform work delegates to `Services/Stream/`; transport +
/// reconnect + framing live in Kotlin via `PulseBarBridge`.
@MainActor
final class StreamCaptureStore: ObservableObject {
    private static let mediaStreamAllowedKey = "PulseBarNative.stream.mediaStreamAllowed"
    private static let mediaStatePublishQueue = DispatchQueue(label: "io.github.kt.pulsebar.native.media-state-publish")
    static let autoSourceId = "auto"
    private static let systemSourceId = "system"

    // MARK: - Exposed to SwiftUI

    @Published private(set) var sources: [StreamCaptureSource] = []
    @Published var selectedSourceId: String = autoSourceId
    @Published private(set) var mediaStreamAllowed = true
    @Published private(set) var audioCapturePermissionStatus: StreamAudioCapturePermissionStatus = .unknown
    @Published private(set) var audioCapturePermissionRequestPending = false

    // MARK: - Derived

    private var selectedSource: StreamCaptureSource? {
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

    var blocksUserInteractionForAudioPermission: Bool {
        audioCapturePermissionRequestPending
    }

    // MARK: - Internal state

    private let service = StreamCaptureService()
    private lazy var session = StreamCaptureSession(service: service)
    private var startupPermissionTask: Task<Void, Never>?
    private var lastPublishedMediaSignature: String?
    private var lastPublishedProgressSeconds: Double?
    private var lastPublishedMediaObservedAtMillis: Int64?
    private var currentMedia: Media?
    private var isMediaPlaying = false
    private var currentStreamFormat: StreamFormat?
    private var cachedIdleStreamFormat: StreamFormat?
    private let worker: PulseBarBridge
    private var commandTask: Task<Void, Never>?
    private var mediaStatePublishTask: Task<Void, Never>?
    private var pcmForwarder: StreamPcmForwarder?
    private var isCapturing = false
    private let currentMediaSnapshot: @Sendable () async -> Media?

    // MARK: - Lifecycle

    init(bridge: PulseBarBridge, currentMediaSnapshot: @escaping @Sendable () async -> Media?) {
        self.worker = bridge
        self.currentMediaSnapshot = currentMediaSnapshot
        if UserDefaults.standard.object(forKey: Self.mediaStreamAllowedKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.mediaStreamAllowedKey)
        }
        mediaStreamAllowed = UserDefaults.standard.bool(forKey: Self.mediaStreamAllowedKey)
        cachedIdleStreamFormat = defaultStreamFormat()
        refreshAudioCapturePermissionStatusAsync()
        refreshSourcesAsync()
        subscribeStats()
    }

    deinit {
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

    // MARK: - Public commands

    func updateEndpoints(_ endpoints: [EndpointConfig]) {
        if endpoints.isEmpty {
            if isCapturing {
                log("stopping capture because no live listen endpoints remain")
                stopCaptureSession()
            }
            return
        }
        pushMediaStateToBridge()
    }

    func requestAudioCapturePermissionAtStartup() {
        guard startupPermissionTask == nil else { return }
        startupPermissionTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let initialStatus = service.audioCapturePermissionStatus()
            audioCapturePermissionStatus = initialStatus
            log("startup audio permission begin status=\(initialStatus.rawValue)")
            audioCapturePermissionRequestPending = initialStatus == .unknown
            defer {
                audioCapturePermissionRequestPending = false
                startupPermissionTask = nil
            }
            do {
                try await service.ensureAudioCapturePermissionForUI()
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                log("startup audio permission ok status=\(status.rawValue)")
            } catch {
                let status = service.audioCapturePermissionStatus()
                audioCapturePermissionStatus = status
                log("startup audio permission failed status=\(status.rawValue) error=\(error.localizedDescription)")
            }
        }
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
        isMediaPlaying = media?.isPlaying == true

        pushMediaStateToBridge()

        if isCapturing && (!mediaStreamAllowed || media?.isPlaying != true) {
            let stopReason = mediaStreamAllowed ? "no_playable_media" : "stream_disabled"
            log("media stream stopped during capture reason=\(stopReason) media=\(media?.title ?? "nil")")
            stopCaptureSession()
        }
        return true
    }

    func republishCurrentMediaState() {
        pushMediaStateToBridge()
    }

    func setMediaStreamAllowed(_ allowed: Bool) {
        guard allowCommandWhilePermissionPromptPending("setMediaStreamAllowed") else { return }
        guard allowed != mediaStreamAllowed else { return }
        mediaStreamAllowed = allowed
        scheduleMediaStatePublish()
        let mediaStreamAllowedKey = Self.mediaStreamAllowedKey
        DispatchQueue.global(qos: .utility).async {
            UserDefaults.standard.set(allowed, forKey: mediaStreamAllowedKey)
        }
        if !allowed && isCapturing {
            log("owner disabled media stream during capture")
            stopCaptureSession()
        }
    }

    private func selectPreferredSource() {
        guard allowCommandWhilePermissionPromptPending("selectPreferredSource") else { return }
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
        guard mediaStreamAllowed else {
            log("server started stream but owner disallowed media")
            emitMediaStreamStopped(reason: .STREAM_DISABLED)
            return
        }
        selectPreferredSource()
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
        isMediaPlaying = true
        pushMediaStateToBridge()
        return StreamMediaPositionAnchor(
            progressMs: Int64((snapshot.progressSeconds * 1_000.0).rounded()),
            observedAtMillis: observedAtMillis
        )
    }

    private func beginServerDrivenCapture(endpointId: String, source: StreamCaptureSource, anchor: StreamMediaPositionAnchor) {
        isCapturing = true
        currentStreamFormat = streamFormat(for: source)
        pushMediaStateToBridge(captureRunning: true)

        runStreamingSession(endpointId: endpointId, source: source, anchor: anchor)
    }


    private func runStreamingSession(endpointId: String, source: StreamCaptureSource, anchor: StreamMediaPositionAnchor) {
        let forwarder = StreamPcmForwarder(worker: worker, anchor: anchor, format: currentStreamFormat ?? streamFormat(for: source))
        pcmForwarder = forwarder
        session.runStreaming(
            source: source,
            pcmHandler: { data in
                forwarder.enqueue(data)
            },
            onError: { [weak self] error in
                guard let self else { return }
                log("server-driven capture failed error=\(error.localizedDescription)")
                emitMediaStreamStopped(reason: Self.streamStopReason(for: error))
            },
            onFinish: { [weak self] in
                guard let self else { return }
                pushMediaStateToBridge(captureRunning: false)
                isCapturing = false
                pcmForwarder = nil
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

    private func stopCaptureSession() {
        session.cancel()
        pushMediaStateToBridge(captureRunning: false)
        isCapturing = false
        currentStreamFormat = nil
    }

    // MARK: - Private helpers

    private func pushMediaStateToBridge(
        captureRunning: Bool? = nil
    ) {
        let capture = captureRunning ?? isCapturing
        let format = currentStreamFormat ?? cachedIdleStreamFormat ?? defaultStreamFormat()
        emitNativeEventAsync(
            NativeMediaStateChanged(
                permission: mediaStreamAllowed ? PulseStreamPermission.ALLOW : PulseStreamPermission.DISALLOW,
                playbackStatus: isMediaPlaying ? PulsePlaybackStatus.PLAYING : PulsePlaybackStatus.PAUSED,
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
        captureRunning: Bool? = nil
    ) {
        mediaStatePublishTask?.cancel()
        mediaStatePublishTask = Task { @MainActor [weak self] in
            await Task.yield()
            guard let self, !Task.isCancelled else { return }
            self.pushMediaStateToBridge(
                captureRunning: captureRunning
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

    private func log(_ message: String) {
        PulseNativeLog.debug(.streamSession, "capture \(message)")
    }

    private func allowCommandWhilePermissionPromptPending(_ command: String) -> Bool {
        guard !audioCapturePermissionRequestPending else {
            log("\(command) blocked while audio permission prompt is pending")
            return false
        }
        return true
    }
}
