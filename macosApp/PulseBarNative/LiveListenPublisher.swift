import Foundation

struct LiveListenPublisherConfig: Equatable, Sendable {
    let roomId: String
    let deviceId: String
    let baseURL: URL
    let workspaceId: String
    let apiKey: String
    var sampleRate: UInt32 = 48_000
    var channels: UInt32 = 2
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
    var chunksSent: UInt64 = 0
    var bytesSent: UInt64 = 0
    var sendBitrateKbps: Double?
    var lastChunkBytes: UInt64 = 0
}

protocol LiveListenPublisher: LiveListenPCMConsumer {
    var statusText: String { get }
    var stats: LiveListenPublisherStats { get }

    func start(config: LiveListenPublisherConfig) async throws
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
    private var reconnectScheduled = false
    private var mutableStats = LiveListenPublisherStats()
    private var mutableStatusText = "Native WebSocket publisher idle"
    private var chunkFrameCount: UInt32 = 48_000
    private var chunkByteCount: Int = 48_000 * 2 * MemoryLayout<Int16>.size
    private var lastBitrateSampleAt = Date()
    private var lastBitrateSampleBytes: UInt64 = 0
    private let maxQueuedChunks = 30

    var statusText: String {
        lock.withLock { mutableStatusText }
    }

    var stats: LiveListenPublisherStats {
        lock.withLock { mutableStats }
    }

    func start(config: LiveListenPublisherConfig) async throws {
        appendLiveListenPublisherDebugLog("ws publisher.start begin base=\(config.baseURL.absoluteString) room=room-test-1")
        lock.withLock {
            currentConfig = config
            pcmBuffer.removeAll(keepingCapacity: true)
            pendingChunks.removeAll(keepingCapacity: true)
            nextChunkSequence = 1
            isSending = false
            reconnectScheduled = false
            mutableStats = LiveListenPublisherStats()
            mutableStats.connectionState = .connecting
            mutableStats.maxQueuedChunks = UInt64(maxQueuedChunks)
            mutableStatusText = "Connecting WebSocket media room…"
            chunkFrameCount = config.sampleRate
            chunkByteCount = Int(config.sampleRate * config.channels) * MemoryLayout<Int16>.size
            lastBitrateSampleAt = Date()
            lastBitrateSampleBytes = 0
            isRunning = true
        }

        try await connectWebSocket(config: config, countReconnect: false)
    }

    func consume(_ frame: LiveListenPCMFrame) {
        let chunks: [QueuedChunk] = lock.withLock {
            guard isRunning else {
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
            reconnectScheduled = false
            return (task, session)
        }

        handles.0?.cancel(with: .normalClosure, reason: "publisher stopped".data(using: .utf8))
        handles.1?.invalidateAndCancel()
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
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        appendLiveListenPublisherDebugLog("ws didClose code=\(closeCode.rawValue)")
        lock.withLock {
            mutableStats.lastDisconnectedAt = Date()
            if isRunning && mutableStats.connectionState != .stopping && mutableStats.connectionState != .stopped {
                mutableStats.connectionState = .reconnecting
            }
        }
    }

    private func mediaRoomProducerURL(baseURL: URL, roomId: String) throws -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        guard components != nil else { throw LiveListenPublisherError.invalidWebSocketURL }
        components?.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components?.path = "/api/v1/media-room/\(roomId)"
        components?.queryItems = [URLQueryItem(name: "role", value: "producer")]
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
                    if self.shouldStopForControlMessage(text) {
                        self.stopForRemoteReason("producer.stop")
                        return
                    }
                }
                self.receiveControlLoop(task)
            case let .failure(error):
                self.appendLiveListenPublisherDebugLog("ws receive failed \(error.localizedDescription)")
            }
        }
    }


    private func shouldStopForControlMessage(_ text: String) -> Bool {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return object["type"] as? String == "producer.stop"
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
            reconnectScheduled = false
            return (task, session)
        }
        handles.0?.cancel(with: .normalClosure, reason: reason.data(using: .utf8))
        handles.1?.invalidateAndCancel()
        appendLiveListenPublisherDebugLog("ws stopped by server reason=\(reason)")
    }

    private func connectWebSocket(config: LiveListenPublisherConfig, countReconnect: Bool) async throws {
        let wsURL = try mediaRoomProducerURL(baseURL: config.baseURL, roomId: "room-test-1")
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: wsURL)
        lock.withLock {
            self.session = session
            webSocketTask = task
            mutableStats.webSocketURL = wsURL.absoluteString
            mutableStats.connectionState = countReconnect ? .reconnecting : .connecting
            mutableStats.lastErrorMessage = nil
            mutableStatusText = countReconnect ? "Reconnecting WebSocket media room…" : "Connecting WebSocket media room…"
            if countReconnect { mutableStats.reconnectCount += 1 }
        }
        task.resume()
        try await waitForOpen(task)
        appendLiveListenPublisherDebugLog("ws publisher connected url=\(wsURL.absoluteString) reconnect=\(countReconnect)")
        lock.withLock {
            mutableStats.connectionState = .connected
            mutableStats.lastConnectedAt = Date()
            mutableStatusText = "Native WebSocket publisher connected"
            reconnectScheduled = false
        }
        receiveControlLoop(task)
        flushPendingChunks()
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
            shouldFlush = webSocketTask != nil && !isSending
        }
        if shouldFlush { flushPendingChunks() }
    }

    private func flushPendingChunks() {
        let next: QueuedChunk?
        let task: URLSessionWebSocketTask?
        lock.lock()
        guard isRunning, !isSending, let currentTask = webSocketTask, !pendingChunks.isEmpty else {
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
                self.scheduleReconnect()
            } else if shouldContinue {
                self.flushPendingChunks()
            }
        }
    }

    private func scheduleReconnect() {
        let config: LiveListenPublisherConfig? = lock.withLock {
            guard isRunning, !reconnectScheduled, let config = currentConfig else { return nil }
            reconnectScheduled = true
            mutableStats.connectionState = .reconnecting
            mutableStatusText = "WebSocket disconnected; reconnect scheduled"
            return config
        }
        guard let config else { return }
        Task.detached { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self else { return }
            do {
                try await self.connectWebSocket(config: config, countReconnect: true)
            } catch {
                self.appendLiveListenPublisherDebugLog("ws reconnect failed \(error.localizedDescription)")
                self.lock.withLock { self.reconnectScheduled = false }
                self.scheduleReconnect()
            }
        }
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

    private func appendLiveListenPublisherDebugLog(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) publisher \(message)\n"
        let url = URL(fileURLWithPath: "/tmp/pulse-live-listen-native-debug.log")
        guard let data = line.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: url.path), let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            _ = try? handle.write(contentsOf: data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
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
            return "Invalid MediaRoom WebSocket URL."
        case .webSocketNotConnected:
            return "MediaRoom WebSocket did not connect."
        }
    }
}
