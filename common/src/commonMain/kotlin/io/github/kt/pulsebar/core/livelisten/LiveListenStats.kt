package io.github.kt.pulsebar.core.livelisten

/**
 * Aggregated publisher telemetry shared with the platform layer. Mirrors
 * the `LiveListenPublisherStats` struct the Swift UI consumed so existing
 * dashboards keep working.
 */
data class LiveListenStats(
    val connectionState: ConnectionState = ConnectionState.Idle,
    val webSocketUrl: String? = null,
    val lastConnectedAtMillis: Long? = null,
    val lastDisconnectedAtMillis: Long? = null,
    val nextReconnectAtMillis: Long? = null,
    val reconnectDelaySeconds: Double? = null,
    val lastSendAtMillis: Long? = null,
    val lastErrorMessage: String? = null,
    val acceptedFrames: Long = 0L,
    val acceptedBytes: Long = 0L,
    val droppedFrames: Long = 0L,
    val droppedChunks: Long = 0L,
    val lastSequence: Long = 0L,
    val bufferedFrames: Long = 0L,
    val queuedChunks: Int = 0,
    val queuedBytes: Long = 0L,
    val queuedFirstSequence: Long? = null,
    val queuedLastSequence: Long? = null,
    val isSending: Boolean = false,
    val maxQueuedChunks: Int = 0,
    val reconnectCount: Long = 0L,
    val reconnectAttempt: Int = 0,
    val chunksSent: Long = 0L,
    val bytesSent: Long = 0L,
    val sendBitrateKbps: Double? = null,
    val lastChunkBytes: Long = 0L,
    val chunkDurationMs: Int = 500,
    val statusText: String = "Live Listen client idle",
    /**
     * True when the server has issued `stream.start` and expects the host
     * to pump PCM. Hosts should start CoreAudio capture when this flips
     * true and stop when it flips back to false.
     */
    val captureRequested: Boolean = false,
) {
    enum class ConnectionState { Idle, Connecting, Connected, Reconnecting, Stopping, Stopped, Failed }
}
