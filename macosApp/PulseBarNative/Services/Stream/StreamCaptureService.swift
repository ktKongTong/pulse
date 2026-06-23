import AudioToolbox
import AppKit
import CoreAudio
import Darwin
import Foundation

// MARK: - Model types

struct StreamCaptureSource: Identifiable, Equatable, Sendable {
    enum Kind: String, Sendable {
        case system
        case application
    }

    let id: String
    let name: String
    let kind: Kind
    let bundleId: String?
    let processIdentifier: pid_t?
}

private struct SupportedApplicationCaptureSource {
    let bundleId: String
    let name: String
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
final class StreamCaptureService: @unchecked Sendable {
    private static let supportedApplicationCaptureSources: [SupportedApplicationCaptureSource] = [
        SupportedApplicationCaptureSource(bundleId: "com.spotify.client", name: "Spotify"),
        SupportedApplicationCaptureSource(bundleId: "com.apple.Music", name: "Music"),
    ]

    fileprivate final class CaptureContext: @unchecked Sendable {
        let channels: UInt32
        let continuation: AsyncThrowingStream<Void, Error>.Continuation
        var done = false
        var ioProcID: AudioDeviceIOProcID?
        var aggregateID = AudioObjectID(kAudioObjectUnknown)
        var tapID = AudioObjectID(kAudioObjectUnknown)
        var pcmHandler: (@Sendable (Data) -> Void)?
        var sampleRate: UInt32

        init(
            channels: UInt32,
            sampleRate: UInt32,
            pcmHandler: (@Sendable (Data) -> Void)?,
            continuation: AsyncThrowingStream<Void, Error>.Continuation
        ) {
            self.channels = channels
            self.sampleRate = sampleRate
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
        var runningApplicationsByBundleId: [String: NSRunningApplication] = [:]
        for app in NSWorkspace.shared.runningApplications {
            guard app.activationPolicy == .regular,
                  let bundleId = app.bundleIdentifier else {
                continue
            }
            runningApplicationsByBundleId[bundleId] = app
        }

        let applications = Self.supportedApplicationCaptureSources.compactMap { supported -> StreamCaptureSource? in
            guard let app = runningApplicationsByBundleId[supported.bundleId] else { return nil }
            let processIdentifier = app.processIdentifier
            return StreamCaptureSource(
                id: "app:\(supported.bundleId):\(processIdentifier)",
                name: supported.name,
                kind: .application,
                bundleId: supported.bundleId,
                processIdentifier: processIdentifier
            )
        }

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

    /// Stream PCM16 chunks to [pcmHandler] for as long as the returned stream
    /// is consumed. The handler runs on the CoreAudio render thread — it must
    /// be real-time safe. Consumers typically do nothing but enqueue the bytes
    /// before emitting them into Kotlin as a native event.
    func capture(
        source: StreamCaptureSource,
        pcmHandler: @escaping @Sendable (Data) -> Void
    ) async throws -> AsyncThrowingStream<Void, Error> {
        stop()
        let sampleRate = streamSampleRate(for: source)
        let stream = AsyncThrowingStream<Void, Error> { continuation in
            let context = CaptureContext(
                channels: 2,
                sampleRate: sampleRate,
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
            int16[frame * targetChannels + channel] = Int16(sample * Float(Int16.max))
        }
    }

    let data = Data(bytes: int16, count: int16.count * MemoryLayout<Int16>.size)
    context.pcmHandler?(data)

    for bufferIndex in 0..<Int(outputData.pointee.mNumberBuffers) {
        let buffer = UnsafeMutableAudioBufferListPointer(outputData)[bufferIndex]
        if let outputBuffer = buffer.mData {
            memset(outputBuffer, 0, Int(buffer.mDataByteSize))
        }
    }

    context.continuation.yield(())
    return noErr
}

private func appendStreamCaptureServiceLog(_ message: String) {
    PulseNativeLog.debug(.streamSession, "capture.service \(message)")
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
