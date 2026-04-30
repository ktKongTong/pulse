import AudioToolbox
import CoreAudio
import Darwin
import Foundation

typealias TCCPreflightFunc = @convention(c) (CFString, CFDictionary?) -> Int32
typealias TCCRequestFunc = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void

enum AudioCapturePermissionStatus: String {
  case authorized
  case denied
  case unknown
}

struct Args {
  enum Mode: String {
    case device
    case systemTap = "system-tap"
  }

  let channels: UInt32
  let deviceName: String?
  let mode: Mode
  let outputPath: String?
  let permissionOnly: Bool
  let sampleRate: Double
  let seconds: Double?
  let stdoutPCM: Bool
  let stdoutPath: String?
}

final class WavWriter {
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

final class CaptureContext {
  let channels: UInt32
  let targetFrames: UInt64?
  let writer: WavWriter?
  let stdoutPCM: Bool
  var capturedFrames: UInt64 = 0
  var done = false
  var nonSilentSamples: UInt64 = 0
  var peakSample: Float = 0
  var lastStatsAt = Date()
  weak var audioUnitHolder: AudioUnitHolder?

  init(channels: UInt32, targetFrames: UInt64?, writer: WavWriter?, stdoutPCM: Bool) {
    self.channels = channels
    self.targetFrames = targetFrames
    self.writer = writer
    self.stdoutPCM = stdoutPCM
  }
}

final class IOProcContext {
  let targetFrames: UInt64?
  let writer: WavWriter?
  let stdoutPCM: Bool
  let channels: UInt32
  var capturedFrames: UInt64 = 0
  var done = false
  var nonSilentSamples: UInt64 = 0
  var peakSample: Float = 0
  var lastStatsAt = Date()

  init(channels: UInt32, targetFrames: UInt64?, writer: WavWriter?, stdoutPCM: Bool) {
    self.channels = channels
    self.targetFrames = targetFrames
    self.writer = writer
    self.stdoutPCM = stdoutPCM
  }
}

final class AudioUnitHolder {
  var unit: AudioUnit?
}

struct TapResources {
  let aggregateID: AudioDeviceID
  let tapID: AudioObjectID
}

func tccSymbol<T>(_ name: String, as type: T.Type) -> T? {
  guard let handle = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW) else {
    return nil
  }
  guard let symbol = dlsym(handle, name) else { return nil }
  return unsafeBitCast(symbol, to: type)
}

func preflightAudioCapturePermission() -> AudioCapturePermissionStatus {
  guard let preflight = tccSymbol("TCCAccessPreflight", as: TCCPreflightFunc.self) else {
    return .unknown
  }
  let result = preflight("kTCCServiceAudioCapture" as CFString, nil)
  if result == 0 { return .authorized }
  if result == 1 { return .denied }
  return .unknown
}

func requestAudioCapturePermission() -> Bool? {
  guard let request = tccSymbol("TCCAccessRequest", as: TCCRequestFunc.self) else {
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

func ensureAudioCapturePermission() throws {
  let status = preflightAudioCapturePermission()
  fputs("coreaudio audio-capture permission=\(status.rawValue)\n", stderr)
  if status == .authorized { return }
  if status == .denied {
    throw NSError(domain: "coreaudio-capture", code: 9, userInfo: [NSLocalizedDescriptionKey: "System audio capture permission is denied. Enable it in System Settings > Privacy & Security > Screen & System Audio Recording for Pulse Live Listen Capture or Terminal."])
  }
  if let granted = requestAudioCapturePermission() {
    fputs("coreaudio audio-capture permission requested granted=\(granted)\n", stderr)
    if granted { return }
    throw NSError(domain: "coreaudio-capture", code: 9, userInfo: [NSLocalizedDescriptionKey: "System audio capture permission was not granted."])
  }
}

func parseArgs() throws -> Args {
  var deviceName: String?
  var mode = Args.Mode.device
  var outputPath: String?
  var permissionOnly = false
  var sampleRate: Double?
  var channels: UInt32?
  var seconds: Double?
  var stdoutPCM = false
  var stdoutPath: String?

  var iterator = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = iterator.next() {
    guard let value = iterator.next() else {
      throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing value for \(arg)"])
    }
    switch arg {
    case "--device-name":
      deviceName = value
    case "--mode":
      guard let parsed = Args.Mode(rawValue: value) else {
        throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid --mode: \(value)"])
      }
      mode = parsed
    case "--output":
      outputPath = value
    case "--permission-only":
      permissionOnly = ["1", "true", "yes", "on"].contains(value.lowercased())
    case "--sample-rate":
      sampleRate = Double(value)
    case "--channels":
      channels = UInt32(value)
    case "--seconds":
      seconds = Double(value)
    case "--stdout-pcm":
      stdoutPCM = ["1", "true", "yes", "on"].contains(value.lowercased())
    case "--stdout-path":
      stdoutPath = value == "/dev/null" ? nil : value
    default:
      throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown arg \(arg)"])
    }
  }

  guard let sampleRate, let channels else {
    throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing required args"])
  }
  if mode == .device && deviceName == nil {
    throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "--device-name is required in device mode"])
  }
  if outputPath == nil && !stdoutPCM && stdoutPath == nil && !permissionOnly {
    throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Need --output or --stdout-pcm"])
  }
  return Args(channels: channels, deviceName: deviceName, mode: mode, outputPath: outputPath, permissionOnly: permissionOnly, sampleRate: sampleRate, seconds: seconds, stdoutPCM: stdoutPCM, stdoutPath: stdoutPath)
}

func audioDeviceIDs() throws -> [AudioDeviceID] {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to get device list size"])
  }
  let count = Int(size) / MemoryLayout<AudioDeviceID>.size
  var deviceIDs = Array(repeating: AudioDeviceID(), count: count)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceIDs) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to get device list"])
  }
  return deviceIDs
}

func deviceName(deviceID: AudioDeviceID) -> String? {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioObjectPropertyName,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var name: CFString?
  var size = UInt32(MemoryLayout<CFString?>.size)
  let status = withUnsafeMutablePointer(to: &name) { pointer in
    AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer)
  }
  guard status == noErr else {
    return nil
  }
  return name as String?
}

func hasInput(deviceID: AudioDeviceID) -> Bool {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyStreamConfiguration,
    mScope: kAudioObjectPropertyScopeInput,
    mElement: kAudioObjectPropertyElementMain
  )
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr else {
    return false
  }
  let bufferListPointer = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
  defer { bufferListPointer.deallocate() }
  guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, bufferListPointer) == noErr else {
    return false
  }
  let bufferList = bufferListPointer.bindMemory(to: AudioBufferList.self, capacity: 1)
  let buffers = UnsafeMutableAudioBufferListPointer(bufferList)
  return buffers.reduce(0) { $0 + Int($1.mNumberChannels) } > 0
}

func findDevice(named wantedName: String) throws -> AudioDeviceID {
  for deviceID in try audioDeviceIDs() {
    guard hasInput(deviceID: deviceID) else { continue }
    if deviceName(deviceID: deviceID) == wantedName {
      return deviceID
    }
  }
  throw NSError(domain: "coreaudio-capture", code: 3, userInfo: [NSLocalizedDescriptionKey: "Input device not found: \(wantedName)"])
}

func defaultOutputDeviceID() throws -> AudioDeviceID {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var deviceID = AudioDeviceID(kAudioObjectUnknown)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
  guard status == noErr, deviceID != kAudioObjectUnknown else {
    throw NSError(domain: "coreaudio-capture", code: 7, userInfo: [NSLocalizedDescriptionKey: "Failed to read default output device: \(status)"])
  }
  return deviceID
}

func deviceUID(deviceID: AudioDeviceID) throws -> String {
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
    throw NSError(domain: "coreaudio-capture", code: 7, userInfo: [NSLocalizedDescriptionKey: "Failed to read device UID: \(status)"])
  }
  return uid as String
}

func tapUID(tapID: AudioObjectID) throws -> String {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioTapPropertyUID,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var uid: CFString?
  var size = UInt32(MemoryLayout<CFString?>.size)
  let status = withUnsafeMutablePointer(to: &uid) { pointer in
    AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, pointer)
  }
  guard status == noErr, let uid else {
    throw NSError(domain: "coreaudio-capture", code: 7, userInfo: [NSLocalizedDescriptionKey: "Failed to read tap UID: \(status)"])
  }
  return uid as String
}

func createSystemTapDevice() throws -> TapResources {
  guard #available(macOS 14.2, *) else {
    throw NSError(domain: "coreaudio-capture", code: 7, userInfo: [NSLocalizedDescriptionKey: "system-tap requires macOS 14.2 or later"])
  }

  let outputDeviceID = try defaultOutputDeviceID()
  let outputUID = try deviceUID(deviceID: outputDeviceID)
  let description = CATapDescription(excludingProcesses: [], deviceUID: outputUID, stream: 0)
  let tapUUID = UUID()
  description.name = "Pulse Live Listen System Tap"
  description.uuid = tapUUID
  description.isExclusive = true
  description.isMixdown = true
  description.isPrivate = true
  description.muteBehavior = .unmuted

  var tapID = AudioObjectID(kAudioObjectUnknown)
  let tapStatus = AudioHardwareCreateProcessTap(description, &tapID)
  guard tapStatus == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 7, userInfo: [NSLocalizedDescriptionKey: "AudioHardwareCreateProcessTap failed: \(tapStatus)"])
  }

  do {
    let uid = tapUUID.uuidString
    let aggregateDescription: [String: Any] = [
      kAudioAggregateDeviceNameKey: "Pulse Live Listen Tap Device",
      kAudioAggregateDeviceUIDKey: "io.github.kt.pulse.live-listen.tap.\(UUID().uuidString)",
      kAudioAggregateDeviceMainSubDeviceKey: outputUID,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceSubDeviceListKey: [
        [
          kAudioSubDeviceUIDKey: outputUID,
        ]
      ],
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceTapListKey: [
        [
          kAudioSubTapUIDKey: uid,
          kAudioSubTapDriftCompensationKey: true,
        ]
      ],
    ]

    var aggregateID = AudioObjectID(kAudioObjectUnknown)
    let aggregateStatus = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID)
    guard aggregateStatus == noErr else {
      throw NSError(domain: "coreaudio-capture", code: 7, userInfo: [NSLocalizedDescriptionKey: "AudioHardwareCreateAggregateDevice failed: \(aggregateStatus)"])
    }
    fputs("coreaudio system tap ready tapID=\(tapID) aggregateID=\(aggregateID) outputDevice=\(deviceName(deviceID: outputDeviceID) ?? outputUID)\n", stderr)
  return TapResources(aggregateID: aggregateID, tapID: tapID)
  } catch {
    AudioHardwareDestroyProcessTap(tapID)
    throw error
  }
}

func logCaptureStats(_ context: CaptureContext) {
  let now = Date()
  guard now.timeIntervalSince(context.lastStatsAt) >= 2 else { return }
  context.lastStatsAt = now
  fputs("coreaudio capture stats frames=\(context.capturedFrames) nonSilentSamples=\(context.nonSilentSamples) peak=\(String(format: "%.5f", context.peakSample))\n", stderr)
}

func logIOProcCaptureStats(_ context: IOProcContext) {
  let now = Date()
  guard now.timeIntervalSince(context.lastStatsAt) >= 2 else { return }
  context.lastStatsAt = now
  fputs("coreaudio tap stats frames=\(context.capturedFrames) nonSilentSamples=\(context.nonSilentSamples) peak=\(String(format: "%.5f", context.peakSample))\n", stderr)
}

func writeInt16Data(_ data: Data, writer: WavWriter?, stdoutPCM: Bool) throws {
  try writer?.write(data)
  if stdoutPCM {
    let writeResult = data.withUnsafeBytes { rawBuffer in
      Darwin.write(STDOUT_FILENO, rawBuffer.baseAddress, rawBuffer.count)
    }
    if writeResult < 0 {
      throw NSError(domain: "coreaudio-capture", code: 8, userInfo: [NSLocalizedDescriptionKey: "stdout write failed"])
    }
  }
}

let deviceIOProc: AudioDeviceIOProc = { _, _, inputData, _, outputData, _, clientData in
  let context = Unmanaged<IOProcContext>.fromOpaque(clientData!).takeUnretainedValue()
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
      int16[frame * targetChannels + channel] = Int16(sample * Float(Int16.max))
    }
  }

  let data = Data(bytes: int16, count: int16.count * MemoryLayout<Int16>.size)
  do {
    try writeInt16Data(data, writer: context.writer, stdoutPCM: context.stdoutPCM)
  } catch {
    context.done = true
    return noErr
  }

  for bufferIndex in 0..<Int(outputData.pointee.mNumberBuffers) {
    let buffer = UnsafeMutableAudioBufferListPointer(outputData)[bufferIndex]
    if let outputBuffer = buffer.mData {
      memset(outputBuffer, 0, Int(buffer.mDataByteSize))
    }
  }

  context.capturedFrames += UInt64(frameCount)
  logIOProcCaptureStats(context)
  if let targetFrames = context.targetFrames, context.capturedFrames >= targetFrames {
    context.done = true
    CFRunLoopStop(CFRunLoopGetMain())
  }
  return noErr
}

let inputProc: AURenderCallback = { inRefCon, ioActionFlags, inTimeStamp, _, inNumberFrames, _ in
  let context = Unmanaged<CaptureContext>.fromOpaque(inRefCon).takeUnretainedValue()
  guard let holder = context.audioUnitHolder, let audioUnit = holder.unit else { return noErr }
  if context.done { return noErr }

  let channelCount = Int(context.channels)
  let bytesPerFrame = channelCount * MemoryLayout<Float32>.size
  let byteCount = Int(inNumberFrames) * bytesPerFrame

  let audioBuffer = UnsafeMutableRawPointer.allocate(byteCount: byteCount, alignment: MemoryLayout<Float32>.alignment)
  defer { audioBuffer.deallocate() }

  var bufferList = AudioBufferList(
    mNumberBuffers: 1,
    mBuffers: AudioBuffer(
      mNumberChannels: context.channels,
      mDataByteSize: UInt32(byteCount),
      mData: audioBuffer
    )
  )

  let status = AudioUnitRender(audioUnit, ioActionFlags, inTimeStamp, 1, inNumberFrames, &bufferList)
  if status != noErr { return status }

  let floatSamples = audioBuffer.bindMemory(to: Float32.self, capacity: Int(inNumberFrames) * channelCount)
  var int16 = [Int16](repeating: 0, count: Int(inNumberFrames) * channelCount)
  for index in 0..<int16.count {
    let sample = max(-1.0, min(1.0, floatSamples[index]))
    let absSample = abs(sample)
    if absSample > 0.000_01 {
      context.nonSilentSamples += 1
      context.peakSample = max(context.peakSample, absSample)
    }
    int16[index] = Int16(sample * Float(Int16.max))
  }
  let data = Data(bytes: int16, count: int16.count * MemoryLayout<Int16>.size)
  if let writer = context.writer {
    do {
      try writer.write(data)
    } catch {
      context.done = true
      return noErr
    }
  }
  if context.stdoutPCM {
    let writeResult = data.withUnsafeBytes { rawBuffer in
      Darwin.write(STDOUT_FILENO, rawBuffer.baseAddress, rawBuffer.count)
    }
    if writeResult < 0 {
      context.done = true
      return noErr
    }
  }

  context.capturedFrames += UInt64(inNumberFrames)
  logCaptureStats(context)
  if let targetFrames = context.targetFrames, context.capturedFrames >= targetFrames {
    context.done = true
    AudioOutputUnitStop(audioUnit)
    CFRunLoopStop(CFRunLoopGetMain())
  }
  return noErr
}

func runCapture(_ args: Args) throws {
  if args.permissionOnly {
    try ensureAudioCapturePermission()
    return
  }
  if args.mode == .systemTap {
    try runSystemTapCapture(args)
    return
  }
  let deviceID = try findDevice(named: args.deviceName!)
  let writer = try args.outputPath.map {
    try WavWriter(path: $0, sampleRate: UInt32(args.sampleRate), channels: UInt16(args.channels))
  }
  let targetFrames = args.seconds.map { UInt64(args.sampleRate * $0) }
  let context = CaptureContext(channels: args.channels, targetFrames: targetFrames, writer: writer, stdoutPCM: args.stdoutPCM)
  let holder = AudioUnitHolder()
  context.audioUnitHolder = holder

  var description = AudioComponentDescription(
    componentType: kAudioUnitType_Output,
    componentSubType: kAudioUnitSubType_HALOutput,
    componentManufacturer: kAudioUnitManufacturer_Apple,
    componentFlags: 0,
    componentFlagsMask: 0
  )
  guard let component = AudioComponentFindNext(nil, &description) else {
    throw NSError(domain: "coreaudio-capture", code: 4, userInfo: [NSLocalizedDescriptionKey: "HALOutput component not found"])
  }

  var audioUnit: AudioUnit?
  guard AudioComponentInstanceNew(component, &audioUnit) == noErr, let audioUnit else {
    throw NSError(domain: "coreaudio-capture", code: 4, userInfo: [NSLocalizedDescriptionKey: "AudioComponentInstanceNew failed"])
  }
  holder.unit = audioUnit

  defer {
    AudioOutputUnitStop(audioUnit)
    AudioUnitUninitialize(audioUnit)
    AudioComponentInstanceDispose(audioUnit)
    try? writer?.close()
  }

  var enable: UInt32 = 1
  var disable: UInt32 = 0
  guard AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &enable, UInt32(MemoryLayout.size(ofValue: enable))) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Enable input failed"])
  }
  guard AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &disable, UInt32(MemoryLayout.size(ofValue: disable))) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Disable output failed"])
  }

  var mutableDeviceID = deviceID
  guard AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &mutableDeviceID, UInt32(MemoryLayout.size(ofValue: mutableDeviceID))) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Set current device failed"])
  }

  var format = AudioStreamBasicDescription(
    mSampleRate: args.sampleRate,
    mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
    mBytesPerPacket: args.channels * 4,
    mFramesPerPacket: 1,
    mBytesPerFrame: args.channels * 4,
    mChannelsPerFrame: args.channels,
    mBitsPerChannel: 32,
    mReserved: 0
  )
  guard AudioUnitSetProperty(audioUnit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &format, UInt32(MemoryLayout.size(ofValue: format))) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Set stream format failed"])
  }

  var callback = AURenderCallbackStruct(
    inputProc: inputProc,
    inputProcRefCon: Unmanaged.passUnretained(context).toOpaque()
  )
  guard AudioUnitSetProperty(audioUnit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &callback, UInt32(MemoryLayout.size(ofValue: callback))) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 5, userInfo: [NSLocalizedDescriptionKey: "Set input callback failed"])
  }

  guard AudioUnitInitialize(audioUnit) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 6, userInfo: [NSLocalizedDescriptionKey: "AudioUnitInitialize failed"])
  }
  guard AudioOutputUnitStart(audioUnit) == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 6, userInfo: [NSLocalizedDescriptionKey: "AudioOutputUnitStart failed"])
  }

  CFRunLoopRun()
}

func runSystemTapCapture(_ args: Args) throws {
  try ensureAudioCapturePermission()
  let tapResources = try createSystemTapDevice()
  let writer = try args.outputPath.map {
    try WavWriter(path: $0, sampleRate: UInt32(args.sampleRate), channels: UInt16(args.channels))
  }
  let targetFrames = args.seconds.map { UInt64(args.sampleRate * $0) }
  let context = IOProcContext(channels: args.channels, targetFrames: targetFrames, writer: writer, stdoutPCM: args.stdoutPCM)
  let contextPointer = Unmanaged.passUnretained(context).toOpaque()
  var ioProcID: AudioDeviceIOProcID?

  defer {
    if let ioProcID {
      AudioDeviceStop(tapResources.aggregateID, ioProcID)
      AudioDeviceDestroyIOProcID(tapResources.aggregateID, ioProcID)
    }
    try? writer?.close()
    AudioHardwareDestroyAggregateDevice(tapResources.aggregateID)
    if #available(macOS 14.2, *) {
      AudioHardwareDestroyProcessTap(tapResources.tapID)
    }
  }

  var mutableIOProcID: AudioDeviceIOProcID?
  let createStatus = AudioDeviceCreateIOProcID(tapResources.aggregateID, deviceIOProc, contextPointer, &mutableIOProcID)
  guard createStatus == noErr, let createdIOProcID = mutableIOProcID else {
    throw NSError(domain: "coreaudio-capture", code: 8, userInfo: [NSLocalizedDescriptionKey: "AudioDeviceCreateIOProcID failed: \(createStatus)"])
  }
  ioProcID = createdIOProcID

  let startStatus = AudioDeviceStart(tapResources.aggregateID, createdIOProcID)
  guard startStatus == noErr else {
    throw NSError(domain: "coreaudio-capture", code: 8, userInfo: [NSLocalizedDescriptionKey: "AudioDeviceStart failed: \(startStatus)"])
  }

  CFRunLoopRun()
}

do {
  try runCapture(try parseArgs())
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(1)
}
