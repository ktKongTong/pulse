import Foundation
@preconcurrency import PulseBarShared

/// Runs a single server-driven CoreAudio capture task.
@MainActor
final class StreamCaptureSession {
    private let service: StreamCaptureService
    private var captureTask: Task<Void, Never>?

    init(service: StreamCaptureService) {
        self.service = service
    }

    deinit {
        captureTask?.cancel()
    }

    /// Cancel the active task + stop CoreAudio.
    func cancel() {
        captureTask?.cancel()
        captureTask = nil
        service.stop()
    }

    /// `pcmHandler` is called on the CoreAudio render thread for every chunk;
    /// implementations must be real-time safe.
    func runStreaming(
        source: StreamCaptureSource,
        pcmHandler: @escaping @Sendable (Data) -> Void,
        onError: @escaping @MainActor (Error) -> Void,
        onFinish: @escaping @MainActor () -> Void
    ) {
        captureTask?.cancel()
        captureTask = Task { [weak self] in
            guard let self else { return }
            do {
                try service.ensureAudioCapturePermissionForBackgroundStart()
                let stream = try await service.capture(source: source, pcmHandler: pcmHandler)
                for try await _ in stream {
                }
            } catch {
                onError(error)
            }
            onFinish()
        }
    }
}
