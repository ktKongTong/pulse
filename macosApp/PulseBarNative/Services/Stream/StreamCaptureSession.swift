import Foundation
@preconcurrency import PulseBarShared

/// Captures one of three modes — server-driven stream, manual stream, or
/// one-shot sample — with a single reusable task body. The model chooses
/// the mode and supplies the callbacks; this type runs the CoreAudio loop.
///
/// Why this exists: the model used to have three ~100-line methods
/// (`startServerDrivenCapture` / `startNativeStream` / `startCaptureOnly`)
/// that differed in four lines each — source selection, permission pre-
/// flight, PCM handler, and the meter-yield tail. Consolidated here so
/// the model is pure policy.
@MainActor
final class StreamCaptureSession {
    private let service: StreamCaptureService
    private var meterTask: Task<Void, Never>?

    init(service: StreamCaptureService) {
        self.service = service
    }

    deinit {
        meterTask?.cancel()
    }

    /// Is a capture currently running?
    var isActive: Bool { meterTask != nil }

    /// Cancel the active task + stop CoreAudio.
    func cancel() {
        meterTask?.cancel()
        meterTask = nil
        service.stop()
    }

    /// Run a streaming capture (server-driven or manual). `pcmHandler`
    /// is called on the CoreAudio render thread for every chunk;
    /// implementations must be real-time safe.
    func runStreaming(
        source: StreamCaptureSource,
        preflightPermission: Bool,
        pcmHandler: @escaping @Sendable (Data) -> Void,
        onMeter: @escaping @MainActor (StreamCaptureMeter) -> Void,
        onError: @escaping @MainActor (Error) -> Void,
        onFinish: @escaping @MainActor () -> Void
    ) {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            guard let self else { return }
            do {
                if preflightPermission {
                    try service.ensureAudioCapturePermissionForBackgroundStart()
                }
                let stream = try await service.capture(source: source, pcmHandler: pcmHandler)
                for try await update in stream {
                    onMeter(update.meter)
                }
            } catch {
                onError(error)
            }
            onFinish()
        }
    }

    /// Run a fixed-duration capture to a WAV file (debug sample).
    func runSample(
        source: StreamCaptureSource,
        outputURL: URL,
        seconds: Double,
        onMeter: @escaping @MainActor (StreamCaptureMeter) -> Void,
        onStatus: @escaping @MainActor (String) -> Void,
        onError: @escaping @MainActor (Error) -> Void,
        onFinish: @escaping @MainActor () -> Void
    ) {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            guard let self else { return }
            do {
                let stream = try await service.capture(source: source, outputURL: outputURL, seconds: seconds)
                for try await update in stream {
                    onMeter(update.meter)
                    onStatus(update.statusText)
                }
            } catch {
                onError(error)
            }
            onFinish()
        }
    }
}
