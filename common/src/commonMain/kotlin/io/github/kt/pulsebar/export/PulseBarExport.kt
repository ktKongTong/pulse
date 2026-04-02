package io.github.kt.pulsebar.export

class PulseBarUsageRow(
    val label: String,
    val totalSeconds: Int
)

enum class PulseBarTransport {
    WEBSOCKET,
    WEBHOOK,
    HTTP_BATCH
}

class PulseBarConfig(
    val endpointEnabled: Boolean,
    val transport: PulseBarTransport,
    val transportName: String,
    val endpointUrl: String,
    val apiKey: String,
    val batchWindowSeconds: Int,
    val idleThresholdSeconds: Int,
    val changeStabilityMillis: Int,
    val heartbeatSeconds: Int,
    val appPollingMillis: Int,
    val pagePollingMillis: Int,
    val mediaPollingMillis: Int
)

class PulseBarMedia(
    val source: String,
    val title: String,
    val artist: String,
    val album: String?,
    val artworkUrl: String?,
    val progressSeconds: Double,
    val durationSeconds: Int,
    val linkUrl: String?,
    val trackId: String?,
    val isPlaying: Boolean
)

class PulseBarSnapshot(
    val appName: String,
    val bundleId: String,
    val pageTitle: String?,
    val observedAtIso8601: String,
    val media: PulseBarMedia?
)

class PulseBarMenuState(
    val snapshot: PulseBarSnapshot?,
    val firstUsage: PulseBarUsageRow?,
    val secondUsage: PulseBarUsageRow?,
    val thirdUsage: PulseBarUsageRow?
)

expect class PulseBarBridge() {
    fun readMenuState(): PulseBarMenuState
    fun readConfig(): PulseBarConfig
    fun updateConfig(config: PulseBarConfig)
}
