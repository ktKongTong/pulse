import Foundation
@preconcurrency import PulseBarShared

/// Abstracts over the Kotlin bridge so StreamCaptureStore can be unit
/// tested with a fake and so Swift doesn't spawn a second `PulseBarBridge`
/// instance. The shapes match Kotlin's method signatures exactly so
/// `PulseBarBridge` can conform directly.
///
/// Kotlin 2.4's Swift Export exposes `Flow<T>` properties as
/// `AsyncSequence<T, Error>`. We wrap that behind an `AsyncStream` so the
/// protocol stays test-friendly and doesn't leak Kotlin-specific types.
protocol StreamBridge: AnyObject, Sendable {
    func startStream(
        roomId: String,
        deviceId: String,
        baseUrl: String,
        workspaceId: String,
        apiKey: String,
        sampleRate: Int32,
        channels: Int32,
        chunkDurationMs: Int32
    )
    func stopStream()
    func emitStreamLocalStop()
    func submitStreamPcmBase64(chunkBase64: String)
    func updateStreamMediaState(permissionAllow: Bool, playbackPlaying: Bool, captureRunning: Bool)
    func updateStreamMedia(
        providerId: String?,
        trackId: String?,
        title: String?,
        artist: String?,
        album: String?,
        artworkUrl: String?,
        progressSeconds: Double,
        durationSeconds: Double,
        isPlaying: Bool
    )
    /// Returns an `AsyncStream` of Stream telemetry snapshots. Consumers
    /// should drive it from a `Task { @MainActor in for await ... }` loop and
    /// cancel the task on teardown to stop the underlying Kotlin coroutine.
    func streamStatsStream() -> AsyncStream<PulseBarStreamStats>
}

/// `PulseBarBridge` conforms directly. The stream is built from the
/// `streamStats` Kotlin `Flow` via Swift Export's `asAsyncSequence()`.
extension PulseBarBridge: @retroactive @unchecked Sendable {}
extension PulseBarBridge: StreamBridge {
    func streamStatsStream() -> AsyncStream<PulseBarStreamStats> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    for try await stats in streamStats.asAsyncSequence() {
                        continuation.yield(stats)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
