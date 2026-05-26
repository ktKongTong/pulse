package io.github.kt.pulsebar.export

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

actual class PulseBarBridge actual constructor() {
    actual fun readMenuState(): PulseBarMenuState {
        TODO("Not yet implemented")
    }

    actual fun readConfig(): PulseBarConfig {
        TODO("Not yet implemented")
    }

    actual fun updateConfig(config: PulseBarConfig) {
    }

    actual fun readStats(dayIso: String, limit: Int): PulseBarStatsPage {
        TODO("Not yet implemented")
    }

    actual fun readLocalStats(dayIso: String, limit: Int): PulseBarLocalStats {
        TODO("Not yet implemented")
    }

    actual fun readSyncState(): PulseBarSyncState {
        TODO("Not yet implemented")
    }

    actual fun retryEndpoint(): Boolean {
        TODO("Not yet implemented")
    }


    actual fun mediaCommand(command: PulseBarPlaybackCommand): Boolean {
        TODO("Not yet implemented")
    }

    actual fun seekMedia(progressSeconds: Double): Boolean {
        TODO("Not yet implemented")
    }


    actual val menuState: Flow<PulseBarMenuState>
        get() = TODO("Not yet implemented")
    actual val config: Flow<PulseBarConfig>
        get() = TODO("Not yet implemented")
    actual val syncState: Flow<PulseBarSyncState>
        get() = TODO("Not yet implemented")
    actual val todayStats: Flow<PulseBarTodayStats>
        get() = TODO("Not yet implemented")

    actual fun stopStream() {
    }

    actual fun emitStreamLocalStop() {
    }

    actual fun submitStreamPcmBase64(chunkBase64: String) {
    }

    actual fun updateStreamMediaState(permissionAllow: Boolean, playbackPlaying: Boolean, captureRunning: Boolean) {
    }

    actual fun updateStreamMedia(
        providerId: String?,
        trackId: String?,
        title: String?,
        artist: String?,
        album: String?,
        artworkUrl: String?,
        progressSeconds: Double,
        durationSeconds: Double,
        isPlaying: Boolean
    ) {
    }

    actual fun connect(endpointId: String) {
    }

    actual fun emitNativeEvent(event: NativeDeviceEvent) {
    }
}
