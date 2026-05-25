import Foundation

// MARK: - WAV file writer for debug sample captures
//
// Used only by the one-shot `startCaptureOnly(seconds:)` debug path.
// Real-time streaming goes straight to Kotlin as Base64 PCM — no WAV
// framing happens in Swift for the hot path.

final class StreamWavWriter {
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
