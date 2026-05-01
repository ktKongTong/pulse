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

struct LiveListenPublisherStats: Equatable, Sendable {
    var acceptedFrames: UInt64 = 0
    var acceptedBytes: UInt64 = 0
    var droppedFrames: UInt64 = 0
    var lastSequence: UInt64 = 0
    var bufferedFrames: UInt64 = 0
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
    private let lock = NSLock()
    private var isRunning = false
    private var currentConfig: LiveListenPublisherConfig?
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var pcmBuffer = Data()
    private var mutableStats = LiveListenPublisherStats()
    private var mutableStatusText = "Native WebSocket publisher idle"
    private var chunkFrameCount: UInt32 = 48_000
    private var chunkByteCount: Int = 48_000 * 2 * MemoryLayout<Int16>.size
    private var lastBitrateSampleAt = Date()
    private var lastBitrateSampleBytes: UInt64 = 0

    var statusText: String {
        lock.withLock { mutableStatusText }
    }

    var stats: LiveListenPublisherStats {
        lock.withLock { mutableStats }
    }

    func start(config: LiveListenPublisherConfig) async throws {
        appendLiveListenPublisherDebugLog("ws publisher.start begin base=\(config.baseURL.absoluteString) room=room-test-1")
        let wsURL = try mediaRoomProducerURL(baseURL: config.baseURL, roomId: "room-test-1")
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: wsURL)

        lock.withLock {
            currentConfig = config
            self.session = session
            webSocketTask = task
            pcmBuffer.removeAll(keepingCapacity: true)
            mutableStats = LiveListenPublisherStats()
            mutableStatusText = "Connecting WebSocket media room…"
            chunkFrameCount = config.sampleRate
            chunkByteCount = Int(config.sampleRate * config.channels) * MemoryLayout<Int16>.size
            lastBitrateSampleAt = Date()
            lastBitrateSampleBytes = 0
            isRunning = true
        }

        task.resume()
        try await waitForOpen(task)
        appendLiveListenPublisherDebugLog("ws publisher connected url=\(wsURL.absoluteString)")
        lock.withLock {
            mutableStatusText = "Native WebSocket publisher connected"
        }
        receiveControlLoop(task)
    }

    func consume(_ frame: LiveListenPCMFrame) {
        let chunks: [Data] = lock.withLock {
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

            var readyChunks: [Data] = []
            while pcmBuffer.count >= chunkByteCount {
                let pcmChunk = pcmBuffer.prefix(chunkByteCount)
                readyChunks.append(Self.wavChunk(
                    pcm16: Data(pcmChunk),
                    sampleRate: frame.sampleRate,
                    channels: frame.channels
                ))
                pcmBuffer.removeFirst(chunkByteCount)
            }
            mutableStats.bufferedFrames = UInt64(pcmBuffer.count / Int(frame.channels * UInt32(MemoryLayout<Int16>.size)))
            return readyChunks
        }

        for chunk in chunks {
            sendChunk(chunk)
        }
    }

    func stop() async {
        let trailingChunk: Data? = lock.withLock {
            isRunning = false
            mutableStatusText = "Native WebSocket publisher stopped"
            guard let config = currentConfig, !pcmBuffer.isEmpty else { return nil }
            let chunk = Self.wavChunk(pcm16: pcmBuffer, sampleRate: config.sampleRate, channels: config.channels)
            pcmBuffer.removeAll(keepingCapacity: true)
            return chunk
        }

        if let trailingChunk {
            sendChunk(trailingChunk)
        }

        webSocketTask?.cancel(with: .normalClosure, reason: "publisher stopped".data(using: .utf8))
        session?.invalidateAndCancel()
        lock.withLock {
            currentConfig = nil
            webSocketTask = nil
            session = nil
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        appendLiveListenPublisherDebugLog("ws didOpen protocol=\(`protocol` ?? "nil")")
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        appendLiveListenPublisherDebugLog("ws didClose code=\(closeCode.rawValue)")
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
                }
                self.receiveControlLoop(task)
            case let .failure(error):
                self.appendLiveListenPublisherDebugLog("ws receive failed \(error.localizedDescription)")
            }
        }
    }

    private func sendChunk(_ chunk: Data) {
        guard let task = lock.withLock({ webSocketTask }) else { return }
        task.send(.data(chunk)) { [weak self] error in
            guard let self else { return }
            self.lock.withLock {
                if let error {
                    self.mutableStatusText = "WebSocket send failed: \(error.localizedDescription)"
                    self.mutableStats.droppedFrames += UInt64(self.chunkFrameCount)
                    self.appendLiveListenPublisherDebugLog("ws send failed \(error.localizedDescription)")
                    return
                }

                self.mutableStats.chunksSent += 1
                self.mutableStats.bytesSent += UInt64(chunk.count)
                self.mutableStats.lastChunkBytes = UInt64(chunk.count)
                self.mutableStatusText = "WebSocket audio chunk sent"
                self.updateBitrateLocked()
            }
        }
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
