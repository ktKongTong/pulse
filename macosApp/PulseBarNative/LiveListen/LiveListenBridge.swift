import Foundation
@preconcurrency import PulseBarShared

/// Abstracts over the Kotlin bridge so LiveListenCaptureModel can be unit
/// tested with a fake and so Swift doesn't spawn a second `PulseBarBridge`
/// instance. The shapes match Kotlin's method signatures exactly so
/// `PulseBarBridge` can conform directly.
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
    /// Observer plumbing needs a bit more ceremony because Kotlin delivers
    /// values on `Dispatchers.Default`. Implementations must hop onto main.
    func observeLiveListenStats(
        onSnapshot: @escaping @MainActor (PulseBarLiveListenStats) -> Void,
        cancellableReceived: @escaping @MainActor (PulseBarCancellable) -> Void
    )
}

/// Make the Kotlin bridge a `LiveListenBridge` directly. Most methods are
/// pass-through; only `observeLiveListenStats` needs a trampoline because
/// the Kotlin callback is unlabeled + arrives off the main thread.
extension PulseBarBridge: @retroactive @unchecked Sendable {}
extension PulseBarBridge: LiveListenBridge {
    func observeLiveListenStats(
        onSnapshot: @escaping @MainActor (PulseBarLiveListenStats) -> Void,
        cancellableReceived: @escaping @MainActor (PulseBarCancellable) -> Void
    ) {
        let cancellable = observeLiveListenStats { stats in
            DispatchQueue.main.async { MainActor.assumeIsolated { onSnapshot(stats) } }
        }
        DispatchQueue.main.async { MainActor.assumeIsolated { cancellableReceived(cancellable) } }
    }
}
