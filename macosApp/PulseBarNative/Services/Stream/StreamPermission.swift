import AppKit
import Darwin
import Foundation

// MARK: - Permission plumbing for audio capture (private TCC SPI)
//
// Lives in `Services/Stream/` because it's a platform capability, no
// SwiftUI involvement. Exposed as an enum with `@MainActor` + blocking
// flavors so the capture service can call into it from either a UI
// pre-flight or a background render-start path.

private typealias StreamTCCPreflightFunc = @convention(c) (CFString, CFDictionary?) -> Int32
private typealias StreamTCCRequestFunc = @convention(c) (CFString, CFDictionary?, @escaping (Bool) -> Void) -> Void

enum StreamAudioCapturePermissionStatus: String {
    case authorized
    case denied
    case unknown
}

private final class StreamPermissionContinuationBox: @unchecked Sendable {
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

enum StreamPermission {
    private static func tccSymbol<T>(_ name: String, as type: T.Type) -> T? {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW) else {
            return nil
        }
        guard let symbol = dlsym(handle, name) else { return nil }
        return unsafeBitCast(symbol, to: type)
    }

    static func preflightAudioCapturePermission() -> StreamAudioCapturePermissionStatus {
        guard let preflight = tccSymbol("TCCAccessPreflight", as: StreamTCCPreflightFunc.self) else {
            return .unknown
        }
        let result = preflight("kTCCServiceAudioCapture" as CFString, nil)
        if result == 0 { return .authorized }
        if result == 1 { return .denied }
        return .unknown
    }

    /// UI pre-flight. Returns only after the TCC prompt is answered.
    static func requestAudioCapturePermission() async -> Bool? {
        guard let request = tccSymbol("TCCAccessRequest", as: StreamTCCRequestFunc.self) else {
            return nil
        }
        return await withCheckedContinuation { continuation in
            let box = StreamPermissionContinuationBox(continuation)
            request("kTCCServiceAudioCapture" as CFString, nil) { allowed in
                box.resume(allowed)
            }
        }
    }

}
