import AudioToolbox
import CoreAudio
import Darwin
import Foundation

struct Args {
  let channels: UInt32
  let deviceName: String
  let outputPath: String?
  let sampleRate: Double
  let seconds: Double?
  let stdoutPCM: Bool
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
  let targetFrames: UInt64?
  let writer: WavWriter?
  let stdoutPCM: Bool
  var capturedFrames: UInt64 = 0
  var done = false
  weak var audioUnitHolder: AudioUnitHolder?

  init(targetFrames: UInt64?, writer: WavWriter?, stdoutPCM: Bool) {
    self.targetFrames = targetFrames
    self.writer = writer
    self.stdoutPCM = stdoutPCM
  }
}

final class AudioUnitHolder {
  var unit: AudioUnit?
}

func parseArgs() throws -> Args {
  var deviceName: String?
  var outputPath: String?
  var sampleRate: Double?
  var channels: UInt32?
  var seconds: Double?
  var stdoutPCM = false

  var iterator = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = iterator.next() {
    guard let value = iterator.next() else {
      throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing value for \(arg)"])
    }
    switch arg {
    case "--device-name":
      deviceName = value
    case "--output":
      outputPath = value
    case "--sample-rate":
      sampleRate = Double(value)
    case "--channels":
      channels = UInt32(value)
    case "--seconds":
      seconds = Double(value)
    case "--stdout-pcm":
      stdoutPCM = ["1", "true", "yes", "on"].contains(value.lowercased())
    default:
      throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown arg \(arg)"])
    }
  }

  guard let deviceName, let sampleRate, let channels else {
    throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing required args"])
  }
  if outputPath == nil && !stdoutPCM {
    throw NSError(domain: "coreaudio-capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Need --output or --stdout-pcm"])
  }
  return Args(channels: channels, deviceName: deviceName, outputPath: outputPath, sampleRate: sampleRate, seconds: seconds, stdoutPCM: stdoutPCM)
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
  var name: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &name) == noErr else {
    return nil
  }
  return name as String
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

let inputProc: AURenderCallback = { inRefCon, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, _ in
  let context = Unmanaged<CaptureContext>.fromOpaque(inRefCon).takeUnretainedValue()
  guard let holder = context.audioUnitHolder, let audioUnit = holder.unit else { return noErr }
  if context.done { return noErr }

  let channelCount = 2
  let bytesPerFrame = channelCount * MemoryLayout<Float32>.size
  let byteCount = Int(inNumberFrames) * bytesPerFrame

  let audioBuffer = UnsafeMutableRawPointer.allocate(byteCount: byteCount, alignment: MemoryLayout<Float32>.alignment)
  defer { audioBuffer.deallocate() }

  var bufferList = AudioBufferList(
    mNumberBuffers: 1,
    mBuffers: AudioBuffer(
      mNumberChannels: UInt32(channelCount),
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
  if let targetFrames = context.targetFrames, context.capturedFrames >= targetFrames {
    context.done = true
    AudioOutputUnitStop(audioUnit)
    CFRunLoopStop(CFRunLoopGetMain())
  }
  return noErr
}

func runCapture(_ args: Args) throws {
  let deviceID = try findDevice(named: args.deviceName)
  let writer = try args.outputPath.map {
    try WavWriter(path: $0, sampleRate: UInt32(args.sampleRate), channels: UInt16(args.channels))
  }
  let targetFrames = args.seconds.map { UInt64(args.sampleRate * $0) }
  let context = CaptureContext(targetFrames: targetFrames, writer: writer, stdoutPCM: args.stdoutPCM)
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

  AudioOutputUnitStop(audioUnit)
  AudioUnitUninitialize(audioUnit)
  AudioComponentInstanceDispose(audioUnit)
  try writer?.close()
}

do {
  try runCapture(try parseArgs())
} catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(1)
}
