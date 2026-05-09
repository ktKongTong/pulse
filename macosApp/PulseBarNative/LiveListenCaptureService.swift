import AudioToolbox
import AppKit
import CoreAudio
import Darwin
import Foundation

// MARK: - Permission helpers

private typealias LiveListenTCCPreflightFunc = @convention(c) (CFString, CFDictionary?) -> Int32
private typealias LiveListenTCCRequestFunc = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void

enum LiveListenAudioCapturePermissionStatus: String {
    case authorized
    case denied
    case unknown
}

private final class LiveListenPermissionContinuationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var didResume = false
    private let continuation: CheckedContinuation<Bool?, Never>

    init(_ continuation: CheckedContinuation<Bool?, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: Bool?) {
        lock.lock()
        defer { lock.unlock() }
        guard !didResume else { return }
        didResume = true
        continuation.resume(returning: value)
    }
}

// MARK: - Model types consumed by the debug pane

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

struct LiveListenCaptureUpdate: Sendable {
    let meter: LiveListenCaptureMeter
    let statusText: String
}

// MARK: - CoreAudio capture service

/// Thin Swift shell around CoreAudio process-tap capture. Responsibilities are
/// limited to:
///
/// - Enumerating capture sources (system audio / per-app tap)
/// - Requesting and verifying the audio-capture permission
/// - Running `AudioHardwareCreateProcessTap` + aggregate device + render IOProc
/// - Converting Float32 samples to Int16 PCM in the real-time render thread
/// - Forwarding each captured chunk to a caller-supplied `(Data) -> Void`
///
/// Everything else — batching, WAV framing, WebSocket transport, state
/// machine, reconnect logic — lives in Kotlin's `LiveListenClient`.
final class LiveListenCaptureService: @unchecked Sendable {
    fileprivate final class CaptureContext: @unchecked Sendable {
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
        var pcmHandler: (@Sendable (Data) -> Void)?
        var ioProcSequence: UInt64 = 0
        let sampleRate: UInt32 = 48_000

        init(
            channels: UInt32,
            writer: LiveListenWavWriter?,
            targetFrames: UInt64?,
            pcmHandler: (@Sendable (Data) -> Void)?,
            continuation: AsyncThrowingStream<LiveListenCaptureUpdate, Error>.Continuation
        ) {
            self.channels = channels
            self.writer = writer
            self.targetFrames = targetFrames
            self.pcmHandler = pcmHandler
            self.continuation = continuation
        }
    }

    private var context: CaptureContext?

    @MainActor
    func ensureAudioCapturePermissionForUI() async throws {
        let status = Self.preflightAudioCapturePermission()
        appendLiveListenCaptureServiceLog("audio-capture ui permission=\(status.rawValue)")
        if status == .authorized { return }
        if status == .denied {
            throw LiveListenCaptureError.audioCapturePermissionDenied
        }
        NSApp.activate(ignoringOtherApps: true)
        if let granted = await Self.requestAudioCapturePermissionWithTimeout(seconds: 15) {
            appendLiveListenCaptureServiceLog("audio-capture ui permission requested granted=\(granted)")
            if granted { return }
            throw LiveListenCaptureError.audioCapturePermissionNotGranted
        }
        appendLiveListenCaptureServiceLog("audio-capture ui permission request timed out")
        throw LiveListenCaptureError.audioCapturePermissionNotGranted
    }

    func audioCapturePermissionStatus() -> LiveListenAudioCapturePermissionStatus {
        Self.preflightAudioCapturePermission()
    }

    func ensureAudioCapturePermissionForBackgroundStart() throws {
        let status = Self.preflightAudioCapturePermission()
        appendLiveListenCaptureServiceLog("audio-capture background permission=\(status.rawValue)")
        if status == .authorized { return }
        if status == .denied {
            throw LiveListenCaptureError.audioCapturePermissionDenied
        }
        throw LiveListenCaptureError.audioCapturePermissionNotGranted
    }

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

    /// Capture a fixed-duration sample to `outputURL` (WAV) for diagnostics.
    func capture(
        source: LiveListenCaptureSource,
        outputURL: URL,
        seconds: Double
    ) async throws -> AsyncThrowingStream<LiveListenCaptureUpdate, Error> {
        try await capture(source: source, outputURL: outputURL, seconds: seconds, pcmHandler: nil)
    }

    /// Stream PCM16 chunks to [pcmHandler] for as long as the returned stream
    /// is consumed. The handler runs on the CoreAudio render thread — it must
    /// be real-time safe. Consumers typically do nothing but forward the
    /// bytes into Kotlin via `bridge.submitLiveListenPcmBase64(...)`.
    func capture(
        source: LiveListenCaptureSource,
        pcmHandler: @escaping @Sendable (Data) -> Void
    ) async throws -> AsyncThrowingStream<LiveListenCaptureUpdate, Error> {
        try await capture(source: source, outputURL: nil, seconds: nil, pcmHandler: pcmHandler)
    }

    private func capture(
        source: LiveListenCaptureSource,
        outputURL: URL?,
        seconds: Double?,
        pcmHandler: (@Sendable (Data) -> Void)?
    ) async throws -> AsyncThrowingStream<LiveListenCaptureUpdate, Error> {
        stop()
        let stream = AsyncThrowingStream<LiveListenCaptureUpdate, Error> { continuation in
            do {
                let writer = try outputURL.map { try LiveListenWavWriter(path: $0.path, sampleRate: 48_000, channels: 2) }
                let context = CaptureContext(
                    channels: 2,
                    writer: writer,
                    targetFrames: seconds.map { UInt64(48_000 * $0) },
                    pcmHandler: pcmHandler,
                    continuation: continuation
                )
                continuation.onTermination = { [weak self] _ in
                    self?.stop()
                }
                self.context = context
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    guard let self else { return }
                    do {
                        try self.startSystemTap(source: source, context: context)
                    } catch {
                        appendLiveListenCaptureServiceLog("startSystemTap failed error=\(error.localizedDescription)")
                        continuation.finish(throwing: error)
                    }
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

        appendLiveListenCaptureServiceLog("startSystemTap begin source=\(source.name) kind=\(source.kind.rawValue) pid=\(source.processIdentifier.map(String.init) ?? "nil")")
        try Self.ensureAudioCapturePermissionWithoutRequest()
        let outputDeviceID = try Self.defaultOutputDeviceID()
        let outputUID = try Self.deviceUID(deviceID: outputDeviceID)
        appendLiveListenCaptureServiceLog("default output id=\(outputDeviceID) uid=\(outputUID)")
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
        appendLiveListenCaptureServiceLog("create process tap status=\(tapStatus) tap=\(tapID)")
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
        appendLiveListenCaptureServiceLog("create aggregate status=\(aggregateStatus) aggregate=\(aggregateID)")
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
        appendLiveListenCaptureServiceLog("device start status=\(startStatus)")
        guard startStatus == noErr else {
            throw LiveListenCaptureError.coreAudio("AudioDeviceStart", startStatus)
        }
        appendLiveListenCaptureServiceLog("tap started source=\(source.name) kind=\(source.kind.rawValue) aggregate=\(aggregateID) tap=\(tapID) output=\(outputUID) handler=\(context.pcmHandler != nil)")
    }

    // MARK: - Permission plumbing (unchanged from legacy)

    private static func tccSymbol<T>(_ name: String, as type: T.Type) -> T? {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW) else {
            return nil
        }
        guard let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: type)
    }

    private static func preflightAudioCapturePermission() -> LiveListenAudioCapturePermissionStatus {
        guard let preflight = tccSymbol("TCCAccessPreflight", as: LiveListenTCCPreflightFunc.self) else {
            return .unknown
        }
        let result = preflight("kTCCServiceAudioCapture" as CFString, nil)
        if result == 0 { return .authorized }
        if result == 1 { return .denied }
        return .unknown
    }

    private static func requestAudioCapturePermissionWithTimeout(seconds: UInt64) async -> Bool? {
        guard let request = tccSymbol("TCCAccessRequest", as: LiveListenTCCRequestFunc.self) else {
            return nil
        }
        return await withCheckedContinuation { continuation in
            let box = LiveListenPermissionContinuationBox(continuation)
            request("kTCCServiceAudioCapture" as CFString, nil) { allowed in
                box.resume(allowed)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(Int(seconds))) {
                box.resume(nil)
            }
        }
    }

    private static func requestAudioCapturePermissionBlocking() -> Bool? {
        guard let request = tccSymbol("TCCAccessRequest", as: LiveListenTCCRequestFunc.self) else {
            return nil
        }
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        request("kTCCServiceAudioCapture" as CFString, nil) { allowed in
            granted = allowed
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 60)
        return granted
    }

    private static func ensureAudioCapturePermissionWithoutRequest() throws {
        let status = preflightAudioCapturePermission()
        appendLiveListenCaptureServiceLog("audio-capture permission=\(status.rawValue)")
        if status == .authorized { return }
        if status == .denied {
            throw LiveListenCaptureError.audioCapturePermissionDenied
        }
        if let granted = requestAudioCapturePermissionBlocking() {
            if granted { return }
            throw LiveListenCaptureError.audioCapturePermissionNotGranted
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

// MARK: - Render IOProc

private let liveListenCaptureIOProc: AudioDeviceIOProc = { _, _, inputData, _, outputData, _, clientData in
    guard let clientData else { return noErr }
    let context = Unmanaged<LiveListenCaptureService.CaptureContext>.fromOpaque(clientData).takeUnretainedValue()
    if context.done { return noErr }

    let sourceList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
    guard let firstBuffer = sourceList.first, firstBuffer.mData != nil else { return noErr }
    let targetChannels = Int(context.channels)
    let firstBufferChannels = max(1, Int(firstBuffer.mNumberChannels))
    let isPlanarFloat32 = sourceList.count > 1 && sourceList.allSatisfy { buffer in
        buffer.mData != nil && max(1, Int(buffer.mNumberChannels)) == 1
    }
    let frameCount: Int
    if isPlanarFloat32 {
        frameCount = sourceList.reduce(Int.max) { partial, buffer in
            min(partial, Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size)
        }
    } else {
        frameCount = Int(firstBuffer.mDataByteSize) / (firstBufferChannels * MemoryLayout<Float32>.size)
    }
    guard frameCount > 0 else { return noErr }
    var int16 = [Int16](repeating: 0, count: frameCount * targetChannels)

    for frame in 0..<frameCount {
        for channel in 0..<targetChannels {
            let rawSample: Float
            if isPlanarFloat32 {
                let sourceBufferIndex = min(channel, sourceList.count - 1)
                guard let sourceData = sourceList[sourceBufferIndex].mData else { continue }
                let floatSamples = sourceData.bindMemory(to: Float32.self, capacity: frameCount)
                rawSample = floatSamples[frame]
            } else {
                guard let sourceData = firstBuffer.mData else { continue }
                let sourceChannel = min(channel, firstBufferChannels - 1)
                let floatSamples = sourceData.bindMemory(to: Float32.self, capacity: frameCount * firstBufferChannels)
                rawSample = floatSamples[frame * firstBufferChannels + sourceChannel]
            }
            let sample = max(-1.0, min(1.0, rawSample))
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

    if let handler = context.pcmHandler {
        context.ioProcSequence &+= 1
        handler(data)
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

private func appendLiveListenCaptureServiceLog(_ message: String) {
    PulseNativeLog.debug(.liveListenSession, "capture.service \(message)")
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

// MARK: - Errors + WAV writer (for debug one-shot samples)

enum LiveListenCaptureError: LocalizedError {
    case unsupportedOS
    case audioCapturePermissionDenied
    case audioCapturePermissionNotGranted
    case coreAudio(String, OSStatus)

    var errorDescription: String? {
        switch self {
        case .unsupportedOS:
            return "System audio capture requires macOS 14.2 or later."
        case .audioCapturePermissionDenied:
            return "System audio capture permission is denied. Enable PulseBarNative in System Settings > Privacy & Security > Screen & System Audio Recording."
        case .audioCapturePermissionNotGranted:
            return "System audio capture permission was not granted."
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
