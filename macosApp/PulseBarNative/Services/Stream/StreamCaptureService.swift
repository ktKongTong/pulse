import AudioToolbox
import AppKit
import CoreAudio
import Darwin
import Foundation

// MARK: - Model types consumed by the debug pane

struct StreamCaptureSource: Identifiable, Equatable {
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

struct StreamCaptureMeter: Equatable {
    var peak: Double = 0
    var rms: Double = 0
    var nonSilentSamples: UInt64 = 0
    var capturedFrames: UInt64 = 0
}

struct StreamCaptureUpdate: Sendable {
    let meter: StreamCaptureMeter
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
/// machine, reconnect logic — lives in Kotlin's `StreamClient`.
final class StreamCaptureService: @unchecked Sendable {
    fileprivate final class CaptureContext: @unchecked Sendable {
        let channels: UInt32
        let writer: StreamWavWriter?
        let targetFrames: UInt64?
        let continuation: AsyncThrowingStream<StreamCaptureUpdate, Error>.Continuation
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
        var sampleRate: UInt32

        init(
            channels: UInt32,
            sampleRate: UInt32,
            writer: StreamWavWriter?,
            targetFrames: UInt64?,
            pcmHandler: (@Sendable (Data) -> Void)?,
            continuation: AsyncThrowingStream<StreamCaptureUpdate, Error>.Continuation
        ) {
            self.channels = channels
            self.sampleRate = sampleRate
            self.writer = writer
            self.targetFrames = targetFrames
            self.pcmHandler = pcmHandler
            self.continuation = continuation
        }
    }

    private var context: CaptureContext?

    @MainActor
    func ensureAudioCapturePermissionForUI() async throws {
        let status = StreamPermission.preflightAudioCapturePermission()
        appendStreamCaptureServiceLog("audio-capture ui permission=\(status.rawValue)")
        if status == .authorized { return }
        if status == .denied {
            throw StreamCaptureError.audioCapturePermissionDenied
        }
        NSApp.activate(ignoringOtherApps: true)
        if let granted = await StreamPermission.requestAudioCapturePermissionWithTimeout(seconds: 15) {
            appendStreamCaptureServiceLog("audio-capture ui permission requested granted=\(granted)")
            if granted { return }
            throw StreamCaptureError.audioCapturePermissionNotGranted
        }
        appendStreamCaptureServiceLog("audio-capture ui permission request timed out")
        throw StreamCaptureError.audioCapturePermissionNotGranted
    }

    func audioCapturePermissionStatus() -> StreamAudioCapturePermissionStatus {
        StreamPermission.preflightAudioCapturePermission()
    }

    func ensureAudioCapturePermissionForBackgroundStart() throws {
        let status = StreamPermission.preflightAudioCapturePermission()
        appendStreamCaptureServiceLog("audio-capture background permission=\(status.rawValue)")
        if status == .authorized { return }
        if status == .denied {
            throw StreamCaptureError.audioCapturePermissionDenied
        }
        throw StreamCaptureError.audioCapturePermissionNotGranted
    }

    func availableSources() -> [StreamCaptureSource] {
        let applications = NSWorkspace.shared.runningApplications
            .filter { app in
                guard app.activationPolicy == .regular else { return false }
                return app.bundleIdentifier != nil
            }
            .compactMap { app -> StreamCaptureSource? in
                guard let bundleId = app.bundleIdentifier else { return nil }
                let processIdentifier = app.processIdentifier
                return StreamCaptureSource(
                    id: "app:\(bundleId):\(processIdentifier)",
                    name: app.localizedName ?? bundleId,
                    kind: .application,
                    bundleId: bundleId,
                    processIdentifier: processIdentifier
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        return [
            StreamCaptureSource(
                id: "system",
                name: "System Audio",
                kind: .system,
                bundleId: nil,
                processIdentifier: nil
            )
        ] + applications
    }

    func streamSampleRate(for source: StreamCaptureSource?) -> UInt32 {
        do {
            let outputDeviceID = try Self.defaultOutputDeviceID()
            let sampleRate = try Self.nominalSampleRate(deviceID: outputDeviceID)
            appendStreamCaptureServiceLog("stream sampleRate=\(sampleRate) source=\(source?.name ?? "nil")")
            return sampleRate
        } catch {
            appendStreamCaptureServiceLog("stream sampleRate fallback=48000 error=\(error.localizedDescription)")
            return 48_000
        }
    }

    /// Capture a fixed-duration sample to `outputURL` (WAV) for diagnostics.
    func capture(
        source: StreamCaptureSource,
        outputURL: URL,
        seconds: Double
    ) async throws -> AsyncThrowingStream<StreamCaptureUpdate, Error> {
        try await capture(source: source, outputURL: outputURL, seconds: seconds, pcmHandler: nil)
    }

    /// Stream PCM16 chunks to [pcmHandler] for as long as the returned stream
    /// is consumed. The handler runs on the CoreAudio render thread — it must
    /// be real-time safe. Consumers typically do nothing but enqueue the bytes
    /// before emitting them into Kotlin as a native event.
    func capture(
        source: StreamCaptureSource,
        pcmHandler: @escaping @Sendable (Data) -> Void
    ) async throws -> AsyncThrowingStream<StreamCaptureUpdate, Error> {
        try await capture(source: source, outputURL: nil, seconds: nil, pcmHandler: pcmHandler)
    }

    private func capture(
        source: StreamCaptureSource,
        outputURL: URL?,
        seconds: Double?,
        pcmHandler: (@Sendable (Data) -> Void)?
    ) async throws -> AsyncThrowingStream<StreamCaptureUpdate, Error> {
        stop()
        let sampleRate = streamSampleRate(for: source)
        let stream = AsyncThrowingStream<StreamCaptureUpdate, Error> { continuation in
            do {
                let writer = try outputURL.map { try StreamWavWriter(path: $0.path, sampleRate: sampleRate, channels: 2) }
                let context = CaptureContext(
                    channels: 2,
                    sampleRate: sampleRate,
                    writer: writer,
                    targetFrames: seconds.map { UInt64(Double(sampleRate) * $0) },
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
                        appendStreamCaptureServiceLog("startSystemTap failed error=\(error.localizedDescription)")
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

    private func startSystemTap(source: StreamCaptureSource, context: CaptureContext) throws {
        guard #available(macOS 14.2, *) else {
            throw StreamCaptureError.unsupportedOS
        }

        appendStreamCaptureServiceLog("startSystemTap begin source=\(source.name) kind=\(source.kind.rawValue) pid=\(source.processIdentifier.map(String.init) ?? "nil")")
        try Self.ensureAudioCapturePermissionWithoutRequest()
        let outputDeviceID = try Self.defaultOutputDeviceID()
        let outputUID = try Self.deviceUID(deviceID: outputDeviceID)
        appendStreamCaptureServiceLog("default output id=\(outputDeviceID) uid=\(outputUID)")
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
        description.name = "Pulse Stream Capture"
        description.uuid = tapUUID
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var tapID = AudioObjectID(kAudioObjectUnknown)
        let tapStatus = AudioHardwareCreateProcessTap(description, &tapID)
        appendStreamCaptureServiceLog("create process tap status=\(tapStatus) tap=\(tapID)")
        guard tapStatus == noErr else {
            throw StreamCaptureError.coreAudio("AudioHardwareCreateProcessTap", tapStatus)
        }
        context.tapID = tapID

        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Pulse Stream Tap Device",
            kAudioAggregateDeviceUIDKey: "io.github.kt.pulse.stream.tap.\(UUID().uuidString)",
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
        appendStreamCaptureServiceLog("create aggregate status=\(aggregateStatus) aggregate=\(aggregateID)")
        guard aggregateStatus == noErr else {
            throw StreamCaptureError.coreAudio("AudioHardwareCreateAggregateDevice", aggregateStatus)
        }
        context.aggregateID = aggregateID
        try Self.setNominalSampleRate(deviceID: aggregateID, sampleRate: context.sampleRate)
        let actualSampleRate = try Self.nominalSampleRate(deviceID: aggregateID)
        if actualSampleRate != context.sampleRate {
            appendStreamCaptureServiceLog("aggregate sampleRate mismatch requested=\(context.sampleRate) actual=\(actualSampleRate)")
            context.sampleRate = actualSampleRate
        } else {
            appendStreamCaptureServiceLog("aggregate sampleRate=\(actualSampleRate)")
        }

        let contextPointer = Unmanaged.passUnretained(context).toOpaque()
        var ioProcID: AudioDeviceIOProcID?
        let createStatus = AudioDeviceCreateIOProcID(aggregateID, streamCaptureIOProc, contextPointer, &ioProcID)
        guard createStatus == noErr, let ioProcID else {
            throw StreamCaptureError.coreAudio("AudioDeviceCreateIOProcID", createStatus)
        }
        context.ioProcID = ioProcID

        let startStatus = AudioDeviceStart(aggregateID, ioProcID)
        appendStreamCaptureServiceLog("device start status=\(startStatus)")
        guard startStatus == noErr else {
            throw StreamCaptureError.coreAudio("AudioDeviceStart", startStatus)
        }
        appendStreamCaptureServiceLog("tap started source=\(source.name) kind=\(source.kind.rawValue) aggregate=\(aggregateID) tap=\(tapID) output=\(outputUID) handler=\(context.pcmHandler != nil)")
    }

    // MARK: - Permission plumbing
    //
    // Delegates to `StreamPermission`. The `WithoutRequest` helper is
    // kept here because it's the one call site that mixes preflight +
    // blocking request + throwing translation; it's specific to the
    // render-start path.

    private static func ensureAudioCapturePermissionWithoutRequest() throws {
        let status = StreamPermission.preflightAudioCapturePermission()
        appendStreamCaptureServiceLog("audio-capture permission=\(status.rawValue)")
        if status == .authorized { return }
        if status == .denied {
            throw StreamCaptureError.audioCapturePermissionDenied
        }
        if let granted = StreamPermission.requestAudioCapturePermissionBlocking() {
            if granted { return }
            throw StreamCaptureError.audioCapturePermissionNotGranted
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
            throw StreamCaptureError.coreAudio("DefaultOutputDevice", status)
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
            throw StreamCaptureError.coreAudio("TranslatePIDToProcessObject", status)
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
            throw StreamCaptureError.coreAudio("DeviceUID", status)
        }
        return uid as String
    }

    private static func nominalSampleRate(deviceID: AudioDeviceID) throws -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var sampleRate = Float64(0)
        var size = UInt32(MemoryLayout<Float64>.size)
        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &sampleRate)
        guard status == noErr, sampleRate > 0 else {
            throw StreamCaptureError.coreAudio("NominalSampleRate", status)
        }
        return UInt32(sampleRate.rounded())
    }

    private static func setNominalSampleRate(deviceID: AudioDeviceID, sampleRate: UInt32) throws {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value = Float64(sampleRate)
        let size = UInt32(MemoryLayout<Float64>.size)
        let status = AudioObjectSetPropertyData(deviceID, &address, 0, nil, size, &value)
        guard status == noErr else {
            throw StreamCaptureError.coreAudio("SetNominalSampleRate", status)
        }
    }

}

// MARK: - Render IOProc

private let streamCaptureIOProc: AudioDeviceIOProc = { _, _, inputData, _, outputData, _, clientData in
    guard let clientData else { return noErr }
    let context = Unmanaged<StreamCaptureService.CaptureContext>.fromOpaque(clientData).takeUnretainedValue()
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
    streamEmitCaptureUpdateIfNeeded(context: context)
    if let targetFrames = context.targetFrames, context.capturedFrames >= targetFrames {
        context.done = true
        context.continuation.finish()
    }
    return noErr
}

private func appendStreamCaptureServiceLog(_ message: String) {
    PulseNativeLog.debug(.streamSession, "capture.service \(message)")
}

private func streamEmitCaptureUpdateIfNeeded(context: StreamCaptureService.CaptureContext) {
    let now = Date()
    guard now.timeIntervalSince(context.lastUpdateAt) >= 0.1 || context.done else { return }
    context.lastUpdateAt = now
    let rms = context.sampleCount == 0 ? 0 : sqrt(context.sumSquares / Double(context.sampleCount))
    let meter = StreamCaptureMeter(
        peak: Double(context.peakSample),
        rms: rms,
        nonSilentSamples: context.nonSilentSamples,
        capturedFrames: context.capturedFrames
    )
    context.continuation.yield(StreamCaptureUpdate(meter: meter, statusText: "Capturing"))
}

// MARK: - Errors

enum StreamCaptureError: LocalizedError {
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
