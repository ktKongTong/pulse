import Foundation
@preconcurrency import PulseBarShared

/// Abstracts over the Kotlin bridge so LiveListenCaptureStore can be unit
/// tested with a fake and so Swift doesn't spawn a second `PulseBarBridge`
/// instance. The shapes match Kotlin's method signatures exactly so
/// `PulseBarBridge` can conform directly.
///
/// Kotlin 2.4's Swift Export exposes `Flow<T>` properties as
/// `AsyncSequence<T, Error>`. We wrap that behind an `AsyncStream` so the
/// protocol stays test-friendly and doesn't leak Kotlin-specific types.
protocol LiveListenBridge: AnyObject, Sendable {
    func startLiveListen(
        roomId: String,
        deviceId: String,
        baseUrl: String,
        workspaceId: String,
        apiKey: String,
        sampleRate: Int32,
        channels: Int32,
        chunkDurationMs: Int32
    )
    func stopLiveListen()
    func submitLiveListenPcmBase64(chunkBase64: String)
    func updateLiveListenMediaState(permissionAllow: Bool, playbackPlaying: Bool, captureRunning: Bool)
    func updateLiveListenMedia(
        providerId: String?,
        trackId: String?,
        title: String?,
        artist: String?,
        album: String?,
        artworkUrl: String?,
        durationSeconds: Double,
        isPlaying: Bool
    )
    /// Returns an `AsyncStream` of Live Listen telemetry snapshots. Consumers
    /// should drive it from a `Task { @MainActor in for await ... }` loop and
    /// cancel the task on teardown to stop the underlying Kotlin coroutine.
    func liveListenStatsStream() -> AsyncStream<PulseBarLiveListenStats>
}

/// `PulseBarBridge` conforms directly. The stream is built from the
/// `liveListenStats` Kotlin `Flow` via Swift Export's `asAsyncSequence()`.
extension PulseBarBridge: @retroactive @unchecked Sendable {}
extension PulseBarBridge: LiveListenBridge {
    func liveListenStatsStream() -> AsyncStream<PulseBarLiveListenStats> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    for try await stats in liveListenStats.asAsyncSequence() {
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
