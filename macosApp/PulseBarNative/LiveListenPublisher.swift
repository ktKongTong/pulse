import Foundation

struct LiveListenPublisherConfig: Equatable, Sendable {
    let roomId: String
    let deviceId: String
    let baseURL: URL
    let workspaceId: String
    let apiKey: String
    var sampleRate: UInt32 = 48_000
    var channels: UInt32 = 2
    var chunkDurationMs: UInt32 = 500
}

enum LiveListenPublisherConnectionState: String, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting
    case stopping
    case stopped
    case failed
}

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
    var lastSequence: UInt64 = 0
    var bufferedFrames: UInt64 = 0
    var queuedChunks: UInt64 = 0
    var queuedBytes: UInt64 = 0
    var queuedFirstSequence: UInt64?
    var queuedLastSequence: UInt64?
    var isSending: Bool = false
    var maxQueuedChunks: UInt64 = 0
    var droppedChunks: UInt64 = 0
    var replayedChunks: UInt64 = 0
    var reconnectCount: UInt64 = 0
    var reconnectAttempt: UInt64 = 0
    var chunksSent: UInt64 = 0
    var bytesSent: UInt64 = 0
    var sendBitrateKbps: Double?
    var lastChunkBytes: UInt64 = 0
    var chunkDurationMs: UInt32 = 500
}

enum LiveListenPublisherCommand: Sendable {
    case start(preferredProvider: String?, preferredBundleId: String?)
    case stop
}

enum LiveListenPublisherEvent: Sendable {
    case statsChanged(LiveListenPublisherStats, String)
    case commandReceived(LiveListenPublisherCommand)
}

final class LiveListenPublisherTelemetry: @unchecked Sendable {
    private let lock = NSLock()
    private var latestStats = LiveListenPublisherStats()
    private var latestStatusText = "Native WebSocket publisher idle"
    var onSnapshotChanged: (@Sendable (LiveListenPublisherStats, String) -> Void)?

    var stats: LiveListenPublisherStats {
        lock.withLock { latestStats }
    }

    var statusText: String {
        lock.withLock { latestStatusText }
    }

    func record(_ event: LiveListenPublisherEvent) {
        switch event {
        case let .statsChanged(stats, statusText):
            lock.withLock {
                latestStats = stats
                latestStatusText = statusText
            }
            onSnapshotChanged?(stats, statusText)
        case .commandReceived:
            break
        }
    }
}

protocol LiveListenPublisher: LiveListenPCMConsumer {
    var statusText: String { get }
    var stats: LiveListenPublisherStats { get }
    var telemetry: LiveListenPublisherTelemetry { get }
    var isStreamActive: Bool { get }

    func connect(config: LiveListenPublisherConfig) async throws
    func reconnectNow() async throws
    func sendMediaUpdate(_ media: MediaInfo?)
    func sendMediaStateUnavailable(reason: String, message: String?)
    func stopStreaming()
    func stopStreamingAndNotify(reason: String)
    func stop() async
}

final class NativeLiveListenPublisher: NSObject, LiveListenPublisher, URLSessionWebSocketDelegate, @unchecked Sendable {
    private struct QueuedChunk {
        let sequence: UInt64
        let data: Data
        let capturedAt: Date
    }

    private let lock = NSLock()
    private var isRunning = false
    private var currentConfig: LiveListenPublisherConfig?
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var pcmBuffer = Data()
    private var pendingChunks: [QueuedChunk] = []
    private var nextChunkSequence: UInt64 = 1
    private var isSending = false
    private var streamActive = false
    private var streamId: String?
    private var generation: Int?
    private var latestMedia: MediaInfo?
    private var reconnectScheduled = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var mutableStats = LiveListenPublisherStats()
    private var mutableStatusText = "Native WebSocket publisher idle"
    private var chunkFrameCount: UInt32 = 48_000
    private var chunkByteCount: Int = 48_000 * 2 * MemoryLayout<Int16>.size
    private var lastBitrateSampleAt = Date()
    private var lastBitrateSampleBytes: UInt64 = 0
    private let maxQueuedChunks = 30
    let telemetry = LiveListenPublisherTelemetry()
    var onCommand: (@Sendable (LiveListenPublisherCommand) -> Void)?

    var statusText: String {
        telemetry.statusText
    }

    var stats: LiveListenPublisherStats {
        telemetry.stats
    }

    var isStreamActive: Bool {
        lock.withLock { streamActive }
    }

    func connect(config: LiveListenPublisherConfig) async throws {
        var oldHandles: (URLSessionWebSocketTask?, URLSession?) = (nil, nil)
        let shouldConnect = lock.withLock {
            if isRunning, currentConfig == config, webSocketTask != nil {
                return false
            }
            oldHandles = (webSocketTask, session)
            webSocketTask = nil
            session = nil
            return true
        }
        if !shouldConnect {
            emitStatsChanged()
            return
        }
        oldHandles.0?.cancel(with: .goingAway, reason: "publisher reconnecting".data(using: .utf8))
        oldHandles.1?.invalidateAndCancel()

        appendLiveListenPublisherDebugLog("ws publisher.connect begin base=\(config.baseURL.absoluteString) room=\(config.roomId)")
        lock.withLock {
            currentConfig = config
            pcmBuffer.removeAll(keepingCapacity: true)
            pendingChunks.removeAll(keepingCapacity: true)
            nextChunkSequence = 1
            isSending = false
            streamActive = false
            streamId = nil
            generation = nil
            reconnectScheduled = false
            reconnectAttempt = 0
            reconnectTask?.cancel()
            reconnectTask = nil
            mutableStats = LiveListenPublisherStats()
            mutableStats.connectionState = .connecting
            mutableStats.maxQueuedChunks = UInt64(maxQueuedChunks)
            mutableStats.chunkDurationMs = config.chunkDurationMs
            mutableStatusText = "Connecting Live Listen server…"
            chunkFrameCount = max(1, config.sampleRate * config.chunkDurationMs / 1_000)
            chunkByteCount = Int(chunkFrameCount * config.channels) * MemoryLayout<Int16>.size
            lastBitrateSampleAt = Date()
            lastBitrateSampleBytes = 0
            isRunning = true
        }
        emitStatsChanged()

        do {
            try await connectWebSocket(config: config, countReconnect: false)
        } catch {
            recordConnectFailure(error)
            scheduleReconnect(reason: error.localizedDescription)
        }
    }

    func consume(_ frame: LiveListenPCMFrame) {
        let chunks: [QueuedChunk] = lock.withLock {
            guard isRunning, streamActive || mutableStats.connectionState == .reconnecting else {
                mutableStats.droppedFrames += UInt64(frame.frameCount)
                return []
            }

            mutableStats.acceptedFrames += UInt64(frame.frameCount)
            mutableStats.acceptedBytes += UInt64(frame.pcm16Data.count)
            mutableStats.lastSequence = frame.sequence
            pcmBuffer.append(frame.pcm16Data)
            mutableStats.bufferedFrames = UInt64(pcmBuffer.count / Int(frame.channels * UInt32(MemoryLayout<Int16>.size)))
            mutableStatusText = "Buffering PCM for WebSocket chunks"

            var readyChunks: [QueuedChunk] = []
            while pcmBuffer.count >= chunkByteCount {
                let pcmChunk = pcmBuffer.prefix(chunkByteCount)
                readyChunks.append(QueuedChunk(
                    sequence: nextChunkSequence,
                    data: Self.wavChunk(
                        pcm16: Data(pcmChunk),
                        sampleRate: frame.sampleRate,
                        channels: frame.channels
                    ),
                    capturedAt: frame.capturedAt
                ))
                nextChunkSequence += 1
                pcmBuffer.removeFirst(chunkByteCount)
            }
            mutableStats.bufferedFrames = UInt64(pcmBuffer.count / Int(frame.channels * UInt32(MemoryLayout<Int16>.size)))
            return readyChunks
        }

        enqueueChunks(chunks)
        emitStatsChanged()
    }

    func stop() async {
        let handles = lock.withLock { () -> (URLSessionWebSocketTask?, URLSession?) in
            isRunning = false
            mutableStats.connectionState = .stopping
            mutableStatusText = "Native WebSocket publisher stopped"
            pcmBuffer.removeAll(keepingCapacity: true)
            pendingChunks.removeAll(keepingCapacity: true)
            mutableStats.queuedChunks = 0
            mutableStats.queuedBytes = 0
            mutableStats.queuedFirstSequence = nil
            mutableStats.queuedLastSequence = nil
            mutableStats.isSending = false
            mutableStats.connectionState = .stopped
            let task = webSocketTask
            let session = self.session
            currentConfig = nil
            mutableStats.lastDisconnectedAt = Date()
            webSocketTask = nil
            self.session = nil
            isSending = false
            streamActive = false
            streamId = nil
            generation = nil
            reconnectScheduled = false
            reconnectAttempt = 0
            reconnectTask?.cancel()
            reconnectTask = nil
            return (task, session)
        }

        handles.0?.cancel(with: .normalClosure, reason: "publisher stopped".data(using: .utf8))
        handles.1?.invalidateAndCancel()
        emitStatsChanged()
    }

    func reconnectNow() async throws {
        let reconnect: (LiveListenPublisherConfig, URLSessionWebSocketTask?, URLSession?)? = lock.withLock {
            guard let config = currentConfig else { return nil }
            isRunning = true
            let task = webSocketTask
            let session = self.session
            webSocketTask = nil
            self.session = nil
            streamActive = false
            isSending = false
            reconnectScheduled = false
            reconnectAttempt = 0
            reconnectTask?.cancel()
            reconnectTask = nil
            mutableStats.connectionState = .reconnecting
            mutableStats.nextReconnectAt = nil
            mutableStats.reconnectDelaySeconds = nil
            mutableStats.reconnectAttempt = 0
            mutableStatusText = "Manual reconnect requested"
            return (config, task, session)
        }
        guard let reconnect else { return }
        reconnect.1?.cancel(with: .goingAway, reason: "manual reconnect".data(using: .utf8))
        reconnect.2?.invalidateAndCancel()
        emitStatsChanged()
        do {
            try await connectWebSocket(config: reconnect.0, countReconnect: true)
        } catch {
            recordConnectFailure(error)
            scheduleReconnect(reason: error.localizedDescription)
        }
    }

    func stopStreaming() {
        lock.withLock {
            streamActive = false
            isSending = false
            pcmBuffer.removeAll(keepingCapacity: true)
            pendingChunks.removeAll(keepingCapacity: true)
            mutableStats.isSending = false
            mutableStats.queuedChunks = 0
            mutableStats.queuedBytes = 0
            mutableStats.queuedFirstSequence = nil
            mutableStats.queuedLastSequence = nil
            mutableStatusText = webSocketTask == nil ? "Native stream stopped" : "Native stream stopped; device session ready"
        }
        emitStatsChanged()
    }

    func stopStreamingAndNotify(reason: String) {
        let payload: (URLSessionWebSocketTask, String, Int)? = lock.withLock {
            guard let task = webSocketTask, let streamId, let generation else {
                return nil
            }
            return (task, streamId, generation)
        }
        if let payload {
            sendJSON([
                "protocol": "live-listen.device.v1",
                "type": "stream.stopped",
                "streamId": payload.1,
                "generation": payload.2,
                "reason": reason,
                "sentAt": ISO8601DateFormatter().string(from: Date()),
            ], task: payload.0, label: "stream stopped")
        }
        stopStreaming()
    }

    func sendMediaUpdate(_ media: MediaInfo?) {
        let snapshot: (URLSessionWebSocketTask, LiveListenPublisherConfig)? = lock.withLock {
            latestMedia = media
            guard let task = webSocketTask, let config = currentConfig else { return nil }
            return (task, config)
        }
        guard let snapshot else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        guard let media else {
            sendJSON([
                "protocol": "live-listen.device.v1",
                "type": "media.state.updated",
                "deviceId": snapshot.1.deviceId,
                "sentAt": now,
                "mediaState": [
                    "permission": "allow",
                    "playback": "paused",
                    "capture": "no-capture",
                    "reason": "no_playable_media",
                ],
            ], task: snapshot.0, label: "media state no playable media")
            return
        }
        let mediaPayload = Self.liveListenMediaPayload(media)
        sendJSON([
            "protocol": "live-listen.device.v1",
            "type": "media.updated",
            "deviceId": snapshot.1.deviceId,
            "sentAt": now,
            "media": mediaPayload,
            "clock": [
                "mediaProgressSeconds": max(0, media.progressSeconds),
                "observedAt": now,
                "sequence": max(0, Int(Date().timeIntervalSince1970 * 1000)),
            ],
        ], task: snapshot.0, label: "media updated")
        var mediaState: [String: Any] = [
            "permission": "allow",
            "playback": media.isPlaying ? "playing" : "paused",
            "capture": "no-capture",
            "media": mediaPayload,
        ]
        if !media.isPlaying {
            mediaState["reason"] = "no_playable_media"
            mediaState["message"] = "Current media is not playing."
        }
        sendJSON([
            "protocol": "live-listen.device.v1",
            "type": "media.state.updated",
            "deviceId": snapshot.1.deviceId,
            "sentAt": now,
            "mediaState": mediaState,
        ], task: snapshot.0, label: "media state \(media.isPlaying ? "playing" : "paused")")
    }

    func sendMediaStateUnavailable(reason: String, message: String? = nil) {
        let snapshot: (URLSessionWebSocketTask, LiveListenPublisherConfig)? = lock.withLock {
            guard let task = webSocketTask, let config = currentConfig else { return nil }
            return (task, config)
        }
        guard let snapshot else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        var mediaState: [String: Any] = [
            "permission": "disallow",
            "playback": "paused",
            "capture": "no-capture",
            "reason": reason,
        ]
        if let message { mediaState["message"] = message }
        sendJSON([
            "protocol": "live-listen.device.v1",
            "type": "media.state.updated",
            "deviceId": snapshot.1.deviceId,
            "sentAt": now,
            "mediaState": mediaState,
        ], task: snapshot.0, label: "media state \(reason)")
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        appendLiveListenPublisherDebugLog("ws didOpen protocol=\(`protocol` ?? "nil")")
        lock.withLock {
            mutableStats.connectionState = .connected
            mutableStats.lastConnectedAt = Date()
        }
        emitStatsChanged()
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) }
        appendLiveListenPublisherDebugLog("ws didClose code=\(closeCode.rawValue) reason=\(reasonText ?? "-")")
        handleWebSocketDisconnected(
            task: webSocketTask,
            session: session,
            error: nil,
            reason: reasonText.map { "closed code=\(closeCode.rawValue) \($0)" } ?? "closed code=\(closeCode.rawValue)",
            shouldAutoReconnect: Self.shouldAutoReconnect(closeCode: closeCode.rawValue)
        )
    }

    private func deviceSessionURL(config: LiveListenPublisherConfig) throws -> URL {
        let baseURL = config.baseURL
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        guard components != nil else { throw LiveListenPublisherError.invalidWebSocketURL }
        components?.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components?.path = "/api/v1/live-listen/device-session"
        components?.queryItems = [
            URLQueryItem(name: "workspaceId", value: config.workspaceId),
            URLQueryItem(name: "roomId", value: config.roomId),
            URLQueryItem(name: "deviceId", value: config.deviceId),
        ]
        guard let url = components?.url else { throw LiveListenPublisherError.invalidWebSocketURL }
        return url
    }

    private func waitForOpen(_ task: URLSessionWebSocketTask) async throws {
        try await Task.sleep(nanoseconds: 250_000_000)
        if task.state == .running { return }
        try await Task.sleep(nanoseconds: 750_000_000)
        guard task.state == .running else {
            throw LiveListenPublisherError.webSocketNotConnected
        }
    }

    private func receiveControlLoop(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self, weak task] result in
            guard let self, let task else { return }
            switch result {
            case let .success(message):
                if case let .string(text) = message {
                    self.appendLiveListenPublisherDebugLog("ws control \(text)")
                    self.handleControlMessage(text, task: task)
                }
                self.receiveControlLoop(task)
            case let .failure(error):
                self.appendLiveListenPublisherDebugLog("ws receive failed \(error.localizedDescription)")
                self.handleWebSocketDisconnected(
                    task: task,
                    session: nil,
                    error: error,
                    reason: "receive failed",
                    shouldAutoReconnect: true
                )
            }
        }
    }


    private func handleControlMessage(_ text: String, task: URLSessionWebSocketTask) {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        if object["type"] as? String == "producer.stop" {
            stopForRemoteReason("producer.stop")
            return
        }
        guard object["type"] as? String == "command",
              let commandId = object["commandId"] as? String,
              let command = object["command"] as? [String: Any],
              let commandType = command["type"] as? String else {
            return
        }
        switch commandType {
        case "stream.start", "stream.resume":
            let nextStreamId = command["streamId"] as? String
            let nextGeneration = command["generation"] as? Int
            let firstSeq = Self.uint64Value(command["fromSeq"])
            let capture = command["capture"] as? [String: Any]
            let preferredProvider = capture?["preferredProvider"] as? String
            let preferredBundleId = capture?["preferredBundleId"] as? String
            let audio = command["audio"] as? [String: Any]
            let chunkDurationMs = Self.uint32Value(audio?["chunkDurationMs"])
            lock.withLock {
                applyAudioConfigLocked(chunkDurationMs: chunkDurationMs)
                streamActive = true
                streamId = nextStreamId
                generation = nextGeneration
                mutableStatusText = commandType == "stream.resume" ? "Native stream resume accepted" : "Native stream start accepted"
            }
            sendAck(task: task, commandId: commandId, status: commandType == "stream.resume" ? "resumed" : "started", streamId: nextStreamId, generation: nextGeneration, firstSeq: firstSeq)
            emitStatsChanged()
            let publisherCommand = LiveListenPublisherCommand.start(preferredProvider: preferredProvider, preferredBundleId: preferredBundleId)
            telemetry.record(.commandReceived(publisherCommand))
            onCommand?(publisherCommand)
            flushPendingChunks()
        case "stream.stop":
            lock.withLock {
                streamActive = false
                mutableStatusText = "Native stream stopped by room"
            }
            sendAck(task: task, commandId: commandId, status: "stopped", streamId: command["streamId"] as? String ?? streamId, generation: generation, firstSeq: nil)
            emitStatsChanged()
            telemetry.record(.commandReceived(.stop))
            onCommand?(.stop)
        default:
            sendAck(task: task, commandId: commandId, status: "rejected", streamId: command["streamId"] as? String, generation: command["generation"] as? Int, firstSeq: nil)
        }
    }

    private func stopForRemoteReason(_ reason: String) {
        let handles = lock.withLock { () -> (URLSessionWebSocketTask?, URLSession?) in
            isRunning = false
            mutableStats.connectionState = .stopped
            mutableStats.lastDisconnectedAt = Date()
            mutableStats.lastErrorMessage = reason
            mutableStats.isSending = false
            mutableStatusText = "Native WebSocket publisher stopped by server: \(reason)"
            pcmBuffer.removeAll(keepingCapacity: true)
            pendingChunks.removeAll(keepingCapacity: true)
            updateQueueStatsLocked()
            let task = webSocketTask
            let session = self.session
            webSocketTask = nil
            self.session = nil
            currentConfig = nil
            isSending = false
            streamActive = false
            streamId = nil
            generation = nil
            reconnectScheduled = false
            return (task, session)
        }
        handles.0?.cancel(with: .normalClosure, reason: reason.data(using: .utf8))
        handles.1?.invalidateAndCancel()
        appendLiveListenPublisherDebugLog("ws stopped by server reason=\(reason)")
        emitStatsChanged()
    }

    private func connectWebSocket(config: LiveListenPublisherConfig, countReconnect: Bool) async throws {
        let wsURL = try deviceSessionURL(config: config)
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: wsURL)
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        lock.withLock {
            self.session = session
            webSocketTask = task
            mutableStats.webSocketURL = wsURL.absoluteString
            mutableStats.connectionState = countReconnect ? .reconnecting : .connecting
            mutableStats.lastErrorMessage = nil
            mutableStats.isSending = false
            isSending = false
            streamActive = false
            mutableStatusText = countReconnect ? "Reconnecting Live Listen device session…" : "Connecting Live Listen device session…"
            if countReconnect { mutableStats.reconnectCount += 1 }
        }
        task.resume()
        try await waitForOpen(task)
        appendLiveListenPublisherDebugLog("ws publisher connected url=\(wsURL.absoluteString) reconnect=\(countReconnect)")
        lock.withLock {
            mutableStats.connectionState = .connected
            mutableStats.lastConnectedAt = Date()
            mutableStatusText = "Native device session connected"
            reconnectScheduled = false
            reconnectAttempt = 0
            mutableStats.nextReconnectAt = nil
            mutableStats.reconnectDelaySeconds = nil
            mutableStats.reconnectAttempt = 0
            reconnectTask = nil
        }
        emitStatsChanged()
        sendHello(task: task, config: config)
        receiveControlLoop(task)
    }

    private func handleWebSocketDisconnected(
        task: URLSessionWebSocketTask?,
        session closedSession: URLSession?,
        error: Error?,
        reason: String,
        shouldAutoReconnect: Bool
    ) {
        var shouldReconnect = false
        lock.withLock {
            if let task, let currentTask = webSocketTask, currentTask !== task {
                return
            }
            if let task, webSocketTask === task {
                webSocketTask = nil
            }
            if let closedSession, session === closedSession {
                session = nil
            } else if task != nil {
                session?.invalidateAndCancel()
                session = nil
            }
            streamActive = false
            isSending = false
            mutableStats.isSending = false
            if !shouldAutoReconnect {
                pcmBuffer.removeAll(keepingCapacity: true)
                pendingChunks.removeAll(keepingCapacity: true)
                updateQueueStatsLocked()
            }
            mutableStats.lastDisconnectedAt = Date()
            if let error {
                mutableStats.lastErrorMessage = error.localizedDescription
            } else {
                mutableStats.lastErrorMessage = reason
            }
            if shouldAutoReconnect && isRunning && mutableStats.connectionState != .stopping && mutableStats.connectionState != .stopped {
                mutableStats.connectionState = .reconnecting
                mutableStatusText = "Live Listen server disconnected; reconnecting…"
                shouldReconnect = true
            } else if mutableStats.connectionState != .stopped {
                mutableStats.connectionState = .failed
                mutableStatusText = "Live Listen server disconnected"
            }
        }
        if shouldReconnect {
            scheduleReconnect(reason: reason)
        }
        emitStatsChanged()
    }

    private func enqueueChunks(_ chunks: [QueuedChunk]) {
        guard !chunks.isEmpty else { return }
        var shouldFlush = false
        lock.withLock {
            pendingChunks.append(contentsOf: chunks)
            while pendingChunks.count > maxQueuedChunks {
                let dropped = pendingChunks.removeFirst()
                mutableStats.droppedChunks += 1
                mutableStats.droppedFrames += UInt64(chunkFrameCount)
                appendLiveListenPublisherDebugLog("native ring dropped chunk seq=\(dropped.sequence)")
            }
            updateQueueStatsLocked()
            mutableStatusText = webSocketTask == nil
                ? "Queueing chunks while WebSocket reconnects"
                : "Queued WebSocket audio chunks"
            shouldFlush = webSocketTask != nil && streamActive && !isSending
        }
        if shouldFlush { flushPendingChunks() }
        emitStatsChanged()
    }

    private func applyAudioConfigLocked(chunkDurationMs: UInt32?) {
        guard let chunkDurationMs, chunkDurationMs > 0 else { return }
        let sampleRate = currentConfig?.sampleRate ?? 48_000
        let channels = currentConfig?.channels ?? 2
        currentConfig?.chunkDurationMs = chunkDurationMs
        chunkFrameCount = max(1, sampleRate * chunkDurationMs / 1_000)
        chunkByteCount = Int(chunkFrameCount * channels) * MemoryLayout<Int16>.size
        pcmBuffer.removeAll(keepingCapacity: true)
        mutableStats.bufferedFrames = 0
        mutableStats.chunkDurationMs = chunkDurationMs
        appendLiveListenPublisherDebugLog("audio config chunkDurationMs=\(chunkDurationMs) chunkBytes=\(chunkByteCount)")
    }

    private func flushPendingChunks() {
        let next: QueuedChunk?
        let task: URLSessionWebSocketTask?
        lock.lock()
        guard isRunning, streamActive, !isSending, let currentTask = webSocketTask, !pendingChunks.isEmpty else {
            lock.unlock()
            return
        }
        next = pendingChunks.first
        task = currentTask
        isSending = true
        mutableStats.isSending = true
        lock.unlock()

        guard let next, let task else { return }
        task.send(.data(next.data)) { [weak self] error in
            guard let self else { return }
            var shouldContinue = false
            var shouldReconnect = false
            self.lock.lock()
            self.isSending = false
            self.mutableStats.isSending = false
            if let error {
                self.mutableStats.connectionState = .failed
                self.mutableStats.lastDisconnectedAt = Date()
                self.mutableStats.lastErrorMessage = error.localizedDescription
                self.mutableStatusText = "WebSocket send failed: \(error.localizedDescription)"
                self.appendLiveListenPublisherDebugLog("ws send failed seq=\(next.sequence) \(error.localizedDescription)")
                if self.webSocketTask === task {
                    self.webSocketTask = nil
                    self.session?.invalidateAndCancel()
                    self.session = nil
                }
                shouldReconnect = self.isRunning
            } else {
                if self.pendingChunks.first?.sequence == next.sequence {
                    _ = self.pendingChunks.removeFirst()
                } else {
                    self.pendingChunks.removeAll { $0.sequence == next.sequence }
                }
                self.mutableStats.chunksSent += 1
                self.mutableStats.bytesSent += UInt64(next.data.count)
                self.mutableStats.lastChunkBytes = UInt64(next.data.count)
                self.mutableStats.lastSendAt = Date()
                self.mutableStatusText = "WebSocket audio chunk sent"
                self.updateQueueStatsLocked()
                self.updateBitrateLocked()
                shouldContinue = !self.pendingChunks.isEmpty
            }
            self.lock.unlock()

            if shouldReconnect {
                self.scheduleReconnect(reason: "send failed")
            } else if shouldContinue {
                self.flushPendingChunks()
            }
            self.emitStatsChanged()
        }
    }

    private func scheduleReconnect(reason: String) {
        let scheduled: (LiveListenPublisherConfig, UInt64, UInt64)? = lock.withLock {
            guard isRunning, !reconnectScheduled, let config = currentConfig else { return nil }
            let delay = Self.reconnectDelaySeconds(forAttempt: reconnectAttempt)
            reconnectAttempt += 1
            reconnectScheduled = true
            mutableStats.reconnectAttempt = UInt64(reconnectAttempt)
            mutableStats.reconnectDelaySeconds = Double(delay)
            mutableStats.nextReconnectAt = Date().addingTimeInterval(TimeInterval(delay))
            mutableStats.connectionState = .reconnecting
            mutableStatusText = "Reconnect scheduled in \(delay)s: \(reason)"
            return (config, delay, UInt64(reconnectAttempt))
        }
        guard let scheduled else { return }
        emitStatsChanged()
        let task = Task.detached { [weak self] in
            try? await Task.sleep(for: .seconds(scheduled.1))
            guard let self else { return }
            if Task.isCancelled { return }
            do {
                try await self.connectWebSocket(config: scheduled.0, countReconnect: true)
            } catch {
                self.appendLiveListenPublisherDebugLog("ws reconnect failed \(error.localizedDescription)")
                self.lock.withLock {
                    self.reconnectScheduled = false
                    self.mutableStats.lastErrorMessage = error.localizedDescription
                }
                self.scheduleReconnect(reason: error.localizedDescription)
            }
        }
        lock.withLock {
            reconnectTask = task
        }
    }

    private func recordConnectFailure(_ error: Error) {
        lock.withLock {
            mutableStats.connectionState = .reconnecting
            mutableStats.lastDisconnectedAt = Date()
            mutableStats.lastErrorMessage = error.localizedDescription
            mutableStatusText = "Live Listen server unavailable; reconnecting…"
        }
        emitStatsChanged()
    }

    private func updateQueueStatsLocked() {
        mutableStats.queuedChunks = UInt64(pendingChunks.count)
        mutableStats.queuedBytes = UInt64(pendingChunks.reduce(0) { $0 + $1.data.count })
        mutableStats.queuedFirstSequence = pendingChunks.first?.sequence
        mutableStats.queuedLastSequence = pendingChunks.last?.sequence
        mutableStats.isSending = isSending
    }

    private func updateBitrateLocked() {
        let now = Date()
        let elapsed = now.timeIntervalSince(lastBitrateSampleAt)
        guard elapsed >= 1 else { return }
        let deltaBytes = mutableStats.bytesSent - lastBitrateSampleBytes
        mutableStats.sendBitrateKbps = Double(deltaBytes * 8) / elapsed / 1000
        lastBitrateSampleAt = now
        lastBitrateSampleBytes = mutableStats.bytesSent
    }

    private static func reconnectDelaySeconds(forAttempt attempt: Int) -> UInt64 {
        let schedule: [UInt64] = [1, 2, 5, 10, 30, 60]
        return schedule[min(attempt, schedule.count - 1)]
    }

    private static func shouldAutoReconnect(closeCode: Int) -> Bool {
        switch closeCode {
        case 1000, 1003, 1008:
            return false
        default:
            return true
        }
    }

    private func emitStatsChanged() {
        let snapshot = lock.withLock { (mutableStats, mutableStatusText) }
        telemetry.record(.statsChanged(snapshot.0, snapshot.1))
    }

    private func sendHello(task: URLSessionWebSocketTask, config: LiveListenPublisherConfig) {
        let now = ISO8601DateFormatter().string(from: Date())
        let media = lock.withLock { latestMedia }
        let mediaState: [String: Any]
        if let media, media.isPlaying {
            mediaState = [
                "permission": "allow",
                "playback": "playing",
                "capture": "no-capture",
                "media": Self.liveListenMediaPayload(media),
            ]
        } else {
            mediaState = [
                "permission": "allow",
                "playback": "paused",
                "capture": "no-capture",
                "reason": "no_playable_media",
            ]
        }
        var payload: [String: Any] = [
            "protocol": "live-listen.device.v1",
            "type": "device.hello",
            "deviceId": config.deviceId,
            "sentAt": now,
            "lastSeq": max(0, nextChunkSequence - 1),
            "capabilities": [
                "binaryAudio": true,
                "localRingBuffer": true,
                "localRingBufferSeconds": 30,
            ],
            "mediaState": mediaState,
        ]
        if let streamId { payload["lastStreamId"] = streamId }
        if let generation { payload["lastGeneration"] = generation }
        sendJSON(payload, task: task, label: "device hello")
    }

    private func sendAck(
        task: URLSessionWebSocketTask,
        commandId: String,
        status: String,
        streamId: String?,
        generation: Int?,
        firstSeq: UInt64?
    ) {
        var payload: [String: Any] = [
            "protocol": "live-listen.device.v1",
            "type": "ack",
            "commandId": commandId,
            "status": status,
            "sentAt": ISO8601DateFormatter().string(from: Date()),
        ]
        if let streamId { payload["streamId"] = streamId }
        if let generation { payload["generation"] = generation }
        if let firstSeq { payload["firstSeq"] = firstSeq }
        sendJSON(payload, task: task, label: "ack commandId=\(commandId)")
    }

    private func sendJSON(_ payload: [String: Any], task: URLSessionWebSocketTask, label: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { [weak self] error in
            if let error {
                self?.appendLiveListenPublisherDebugLog("\(label) failed \(error.localizedDescription)")
            } else if label == "device hello" || label.hasPrefix("media state") {
                self?.appendLiveListenPublisherDebugLog("\(label) sent \(text)")
            }
        }
    }

    private func appendLiveListenPublisherDebugLog(_ message: String) {
        PulseNativeLog.debug(.liveListenSession, "publisher \(message)")
    }

    private static func wavChunk(pcm16: Data, sampleRate: UInt32, channels: UInt32) -> Data {
        var data = Data()
        data.append("RIFF".data(using: .ascii)!)
        data.appendUInt32LE(UInt32(36 + pcm16.count))
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!)
        data.appendUInt32LE(16)
        data.appendUInt16LE(1)
        data.appendUInt16LE(UInt16(channels))
        data.appendUInt32LE(sampleRate)
        data.appendUInt32LE(sampleRate * channels * UInt32(MemoryLayout<Int16>.size))
        data.appendUInt16LE(UInt16(channels * UInt32(MemoryLayout<Int16>.size)))
        data.appendUInt16LE(16)
        data.append("data".data(using: .ascii)!)
        data.appendUInt32LE(UInt32(pcm16.count))
        data.append(pcm16)
        return data
    }

    private static func uint64Value(_ value: Any?) -> UInt64? {
        if let value = value as? UInt64 { return value }
        if let value = value as? Int, value >= 0 { return UInt64(value) }
        if let value = value as? NSNumber, value.int64Value >= 0 { return value.uint64Value }
        return nil
    }

    private static func uint32Value(_ value: Any?) -> UInt32? {
        if let value = value as? UInt32 { return value }
        if let value = value as? Int, value >= 0, value <= Int(UInt32.max) { return UInt32(value) }
        if let value = value as? NSNumber, value.int64Value >= 0, value.uint64Value <= UInt64(UInt32.max) { return value.uint32Value }
        return nil
    }

    private static func liveListenMediaPayload(_ media: MediaInfo) -> [String: Any] {
        var payload: [String: Any] = [
            "providerId": media.providerId,
            "itemType": media.itemType,
            "trackId": media.id,
            "title": media.title,
            "artist": media.artist,
            "playbackState": media.isPlaying ? "playing" : "paused",
        ]
        if let provider = liveListenProvider(media) { payload["provider"] = provider }
        if let album = media.album, !album.isEmpty { payload["album"] = album }
        if let artwork = Self.publicWebURL(media.artworkURL) { payload["artworkUrl"] = artwork }
        if let duration = media.durationSeconds, duration > 0 { payload["durationSeconds"] = duration }
        if let link = Self.publicWebURL(media.link) { payload["linkUrl"] = link }
        return payload
    }

    private static func publicWebURL(_ url: URL?) -> String? {
        guard let url else { return nil }
        return publicWebURL(url.absoluteString)
    }

    private static func publicWebURL(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed) else { return nil }
        guard url.scheme == "http" || url.scheme == "https" else { return nil }
        guard url.host != nil else { return nil }
        return trimmed
    }

    private static func liveListenProvider(_ media: MediaInfo) -> String? {
        let raw = "\(media.providerId) \(media.source)".lowercased()
        if raw.contains("spotify") { return "spotify" }
        if raw.contains("music") { return "apple-music" }
        return "other"
    }
}

private extension Data {
    mutating func appendUInt16LE(_ value: UInt16) {
        var littleEndian = value.littleEndian
        append(Data(bytes: &littleEndian, count: MemoryLayout<UInt16>.size))
    }

    mutating func appendUInt32LE(_ value: UInt32) {
        var littleEndian = value.littleEndian
        append(Data(bytes: &littleEndian, count: MemoryLayout<UInt32>.size))
    }
}

enum LiveListenPublisherError: LocalizedError {
    case missingWorkspaceId
    case missingApiKey
    case invalidWebSocketURL
    case webSocketNotConnected

    var errorDescription: String? {
        switch self {
        case .missingWorkspaceId:
            return "Missing workspace ID for Live Listen publisher."
        case .missingApiKey:
            return "Missing device API key for Live Listen publisher."
        case .invalidWebSocketURL:
            return "Invalid Live Listen device-session WebSocket URL."
        case .webSocketNotConnected:
            return "Live Listen device-session WebSocket did not connect."
        }
    }
}
