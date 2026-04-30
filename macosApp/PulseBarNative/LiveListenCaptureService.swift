import AudioToolbox
import AppKit
import CoreAudio
import Darwin
import Foundation

struct LiveListenCaptureSource: Identifiable, Equatable {
    enum Kind: String {
        case system
        case application
    }

    let id: String
    let name: String
    let kind: Kind
    let bundleId: String?
    let processIdentifier: pid_t?
}

struct LiveListenCaptureMeter: Equatable {
    var peak: Double = 0
    var rms: Double = 0
    var nonSilentSamples: UInt64 = 0
    var capturedFrames: UInt64 = 0
}

@MainActor
final class LiveListenCaptureModel: ObservableObject {
    @Published private(set) var sources: [LiveListenCaptureSource] = []
    @Published var selectedSourceId: String = "system"
    @Published private(set) var isCapturing = false
    @Published private(set) var statusText = "Idle"
    @Published private(set) var meter = LiveListenCaptureMeter()
    @Published private(set) var lastSampleURL: URL?
    @Published private(set) var errorMessage: String?

    private let service = LiveListenCaptureService()
    private var meterTask: Task<Void, Never>?

    var selectedSource: LiveListenCaptureSource? {
        sources.first { $0.id == selectedSourceId } ?? sources.first
    }

    init() {
        refreshSources()
    }

    deinit {
        meterTask?.cancel()
    }

    func refreshSources() {
        sources = service.availableSources()
        if !sources.contains(where: { $0.id == selectedSourceId }) {
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

    func stopCapture() {
        service.stop()
        meterTask?.cancel()
        meterTask = nil
        isCapturing = false
        statusText = "Stopped"
    }
}

struct LiveListenCaptureUpdate: Sendable {
    let meter: LiveListenCaptureMeter
    let statusText: String
}

final class LiveListenCaptureService: @unchecked Sendable {
    fileprivate final class CaptureContext {
        let channels: UInt32
        let writer: LiveListenWavWriter?
        let targetFrames: UInt64?
        let continuation: AsyncThrowingStream<LiveListenCaptureUpdate, Error>.Continuation
        var capturedFrames: UInt64 = 0
        var done = false
        var nonSilentSamples: UInt64 = 0
        var peakSample: Float = 0
        var sumSquares: Double = 0
        var sampleCount: UInt64 = 0
        var lastUpdateAt = Date()
        var ioProcID: AudioDeviceIOProcID?
        var aggregateID = AudioObjectID(kAudioObjectUnknown)
        var tapID = AudioObjectID(kAudioObjectUnknown)

        init(
            channels: UInt32,
            writer: LiveListenWavWriter?,
            targetFrames: UInt64?,
            continuation: AsyncThrowingStream<LiveListenCaptureUpdate, Error>.Continuation
        ) {
            self.channels = channels
            self.writer = writer
            self.targetFrames = targetFrames
            self.continuation = continuation
        }
    }

    private var context: CaptureContext?

    func availableSources() -> [LiveListenCaptureSource] {
        let applications = NSWorkspace.shared.runningApplications
            .filter { app in
                guard app.activationPolicy == .regular else { return false }
                return app.bundleIdentifier != nil
            }
            .compactMap { app -> LiveListenCaptureSource? in
                guard let bundleId = app.bundleIdentifier else { return nil }
                let processIdentifier = app.processIdentifier
                return LiveListenCaptureSource(
                    id: "app:\(bundleId):\(processIdentifier)",
                    name: app.localizedName ?? bundleId,
                    kind: .application,
                    bundleId: bundleId,
                    processIdentifier: processIdentifier
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        return [
            LiveListenCaptureSource(
                id: "system",
                name: "System Audio",
                kind: .system,
                bundleId: nil,
                processIdentifier: nil
            )
        ] + applications
    }

    func capture(
        source: LiveListenCaptureSource,
        outputURL: URL,
        seconds: Double
    ) async throws -> AsyncThrowingStream<LiveListenCaptureUpdate, Error> {
        stop()
        let stream = AsyncThrowingStream<LiveListenCaptureUpdate, Error> { continuation in
            do {
                let writer = try LiveListenWavWriter(path: outputURL.path, sampleRate: 48_000, channels: 2)
                let context = CaptureContext(
                    channels: 2,
                    writer: writer,
                    targetFrames: UInt64(48_000 * seconds),
                    continuation: continuation
                )
                self.context = context
                try self.startSystemTap(source: source, context: context)
                continuation.onTermination = { [weak self] _ in
                    self?.stop()
                }
            } catch {
                continuation.finish(throwing: error)
            }
        }
        return stream
    }

    func stop() {
        guard let context else { return }
        context.done = true
        if let ioProcID = context.ioProcID {
            AudioDeviceStop(context.aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(context.aggregateID, ioProcID)
        }
        if context.aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(context.aggregateID)
        }
        if context.tapID != kAudioObjectUnknown {
            if #available(macOS 14.2, *) {
                AudioHardwareDestroyProcessTap(context.tapID)
            }
        }
        try? context.writer?.close()
        self.context = nil
    }

    private func startSystemTap(source: LiveListenCaptureSource, context: CaptureContext) throws {
        guard #available(macOS 14.2, *) else {
            throw LiveListenCaptureError.unsupportedOS
        }

        let outputDeviceID = try Self.defaultOutputDeviceID()
        let outputUID = try Self.deviceUID(deviceID: outputDeviceID)
        let tapUUID = UUID()
        let description: CATapDescription
        if source.kind == .application, let processIdentifier = source.processIdentifier {
            let processObjectID = try Self.processObjectID(processIdentifier: processIdentifier)
            description = CATapDescription(stereoMixdownOfProcesses: [processObjectID])
            description.isExclusive = false
            description.isMixdown = true
        } else {
            description = CATapDescription(excludingProcesses: [], deviceUID: outputUID, stream: 0)
            description.isExclusive = true
            description.isMixdown = true
        }
        description.name = "Pulse Live Listen Capture"
        description.uuid = tapUUID
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var tapID = AudioObjectID(kAudioObjectUnknown)
        let tapStatus = AudioHardwareCreateProcessTap(description, &tapID)
        guard tapStatus == noErr else {
            throw LiveListenCaptureError.coreAudio("AudioHardwareCreateProcessTap", tapStatus)
        }
        context.tapID = tapID

        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Pulse Live Listen Tap Device",
            kAudioAggregateDeviceUIDKey: "io.github.kt.pulse.live-listen.tap.\(UUID().uuidString)",
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: tapUUID.uuidString,
                kAudioSubTapDriftCompensationKey: true
            ]]
        ]

        var aggregateID = AudioObjectID(kAudioObjectUnknown)
        let aggregateStatus = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID)
        guard aggregateStatus == noErr else {
            throw LiveListenCaptureError.coreAudio("AudioHardwareCreateAggregateDevice", aggregateStatus)
        }
        context.aggregateID = aggregateID

        let contextPointer = Unmanaged.passUnretained(context).toOpaque()
        var ioProcID: AudioDeviceIOProcID?
        let createStatus = AudioDeviceCreateIOProcID(aggregateID, liveListenCaptureIOProc, contextPointer, &ioProcID)
        guard createStatus == noErr, let ioProcID else {
            throw LiveListenCaptureError.coreAudio("AudioDeviceCreateIOProcID", createStatus)
        }
        context.ioProcID = ioProcID

        let startStatus = AudioDeviceStart(aggregateID, ioProcID)
        guard startStatus == noErr else {
            throw LiveListenCaptureError.coreAudio("AudioDeviceStart", startStatus)
        }
    }

    private static func defaultOutputDeviceID() throws -> AudioDeviceID {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
        guard status == noErr, deviceID != kAudioObjectUnknown else {
            throw LiveListenCaptureError.coreAudio("DefaultOutputDevice", status)
        }
        return deviceID
    }

    private static func processObjectID(processIdentifier: pid_t) throws -> AudioObjectID {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var pid = processIdentifier
        var processObjectID = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            UInt32(MemoryLayout<pid_t>.size),
            &pid,
            &size,
            &processObjectID
        )
        guard status == noErr, processObjectID != kAudioObjectUnknown else {
            throw LiveListenCaptureError.coreAudio("TranslatePIDToProcessObject", status)
        }
        return processObjectID
    }

    private static func deviceUID(deviceID: AudioDeviceID) throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uid: CFString?
        var size = UInt32(MemoryLayout<CFString?>.size)
        let status = withUnsafeMutablePointer(to: &uid) { pointer in
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer)
        }
        guard status == noErr, let uid else {
            throw LiveListenCaptureError.coreAudio("DeviceUID", status)
        }
        return uid as String
    }
}


private let liveListenCaptureIOProc: AudioDeviceIOProc = { _, _, inputData, _, outputData, _, clientData in
    guard let clientData else { return noErr }
    let context = Unmanaged<LiveListenCaptureService.CaptureContext>.fromOpaque(clientData).takeUnretainedValue()
    if context.done { return noErr }

    let sourceList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
    guard let firstBuffer = sourceList.first, let sourceData = firstBuffer.mData else { return noErr }
    let sourceChannels = max(1, Int(firstBuffer.mNumberChannels))
    let targetChannels = Int(context.channels)
    let frameCount = Int(firstBuffer.mDataByteSize) / (sourceChannels * MemoryLayout<Float32>.size)
    let floatSamples = sourceData.bindMemory(to: Float32.self, capacity: frameCount * sourceChannels)
    var int16 = [Int16](repeating: 0, count: frameCount * targetChannels)

    for frame in 0..<frameCount {
        for channel in 0..<targetChannels {
            let sourceChannel = min(channel, sourceChannels - 1)
            let sample = max(-1.0, min(1.0, floatSamples[frame * sourceChannels + sourceChannel]))
            let absSample = abs(sample)
            if absSample > 0.000_01 {
                context.nonSilentSamples += 1
                context.peakSample = max(context.peakSample, absSample)
            }
            context.sumSquares += Double(sample * sample)
            context.sampleCount += 1
            int16[frame * targetChannels + channel] = Int16(sample * Float(Int16.max))
        }
    }

    let data = Data(bytes: int16, count: int16.count * MemoryLayout<Int16>.size)
    do {
        try context.writer?.write(data)
    } catch {
        context.done = true
        context.continuation.finish(throwing: error)
        return noErr
    }

    for bufferIndex in 0..<Int(outputData.pointee.mNumberBuffers) {
        let buffer = UnsafeMutableAudioBufferListPointer(outputData)[bufferIndex]
        if let outputBuffer = buffer.mData {
            memset(outputBuffer, 0, Int(buffer.mDataByteSize))
        }
    }

    context.capturedFrames += UInt64(frameCount)
    liveListenEmitCaptureUpdateIfNeeded(context: context)
    if let targetFrames = context.targetFrames, context.capturedFrames >= targetFrames {
        context.done = true
        context.continuation.finish()
    }
    return noErr
}

private func liveListenEmitCaptureUpdateIfNeeded(context: LiveListenCaptureService.CaptureContext) {
    let now = Date()
    guard now.timeIntervalSince(context.lastUpdateAt) >= 0.1 || context.done else { return }
    context.lastUpdateAt = now
    let rms = context.sampleCount == 0 ? 0 : sqrt(context.sumSquares / Double(context.sampleCount))
    let meter = LiveListenCaptureMeter(
        peak: Double(context.peakSample),
        rms: rms,
        nonSilentSamples: context.nonSilentSamples,
        capturedFrames: context.capturedFrames
    )
    context.continuation.yield(LiveListenCaptureUpdate(meter: meter, statusText: "Capturing"))
}

enum LiveListenCaptureError: LocalizedError {
    case unsupportedOS
    case coreAudio(String, OSStatus)

    var errorDescription: String? {
        switch self {
        case .unsupportedOS:
            return "System audio capture requires macOS 14.2 or later."
        case let .coreAudio(operation, status):
            return "\(operation) failed with status \(status)."
        }
    }
}

final class LiveListenWavWriter {
    private let handle: FileHandle
    private let channels: UInt16
    private let sampleRate: UInt32
    private var dataBytes: UInt32 = 0

    init(path: String, sampleRate: UInt32, channels: UInt16) throws {
        FileManager.default.createFile(atPath: path, contents: nil)
        self.handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        self.channels = channels
        self.sampleRate = sampleRate
        try writeHeader(dataBytes: 0)
    }

    func write(_ data: Data) throws {
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
        dataBytes += UInt32(data.count)
    }

    func close() throws {
        try writeHeader(dataBytes: dataBytes)
        try handle.close()
    }

    private func writeHeader(dataBytes: UInt32) throws {
        let bitsPerSample: UInt16 = 16
        let blockAlign = channels * bitsPerSample / 8
        let byteRate = sampleRate * UInt32(blockAlign)
        let chunkSize = 36 + dataBytes
        var header = Data()
        header.append("RIFF".data(using: .ascii)!)
        header.append(contentsOf: withUnsafeBytes(of: chunkSize.littleEndian, Array.init))
        header.append("WAVE".data(using: .ascii)!)
        header.append("fmt ".data(using: .ascii)!)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(16).littleEndian, Array.init))
        header.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian, Array.init))
        header.append(contentsOf: withUnsafeBytes(of: channels.littleEndian, Array.init))
        header.append(contentsOf: withUnsafeBytes(of: sampleRate.littleEndian, Array.init))
        header.append(contentsOf: withUnsafeBytes(of: byteRate.littleEndian, Array.init))
        header.append(contentsOf: withUnsafeBytes(of: blockAlign.littleEndian, Array.init))
        header.append(contentsOf: withUnsafeBytes(of: bitsPerSample.littleEndian, Array.init))
        header.append("data".data(using: .ascii)!)
        header.append(contentsOf: withUnsafeBytes(of: dataBytes.littleEndian, Array.init))
        try handle.seek(toOffset: 0)
        try handle.write(contentsOf: header)
    }
}
