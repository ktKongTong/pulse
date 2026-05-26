package io.github.kt.pulsebar.core.stream

import io.github.kt.pulsebar.export.PulseBarStreamConnectionState
import io.github.kt.pulsebar.utils.nowInMillis

/**
 * Aggregated publisher telemetry shared with the platform layer. Mirrors
 * the `StreamPublisherStats` struct the Swift UI consumed so existing
 * dashboards keep working.
 */
data class StreamStats(
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
    val statusText: String = "Stream client idle",
    /**
     * True when the server has issued `stream.start` and expects the host
     * to pump PCM. Hosts should start CoreAudio capture when this flips
     * true and stop when it flips back to false.
     */
    val captureRequested: Boolean = false,
) {

//    enum class ConnectionState { Idle, Connecting, Connected, Reconnecting, Stopping, Stopped, Failed }
}
enum class ConnectionState { Idle, Connecting, Connected, Reconnecting, Stopping, Stopped, Failed;

    fun toExport(): PulseBarStreamConnectionState = when (this) {
        ConnectionState.Idle -> PulseBarStreamConnectionState.IDLE
        ConnectionState.Connecting -> PulseBarStreamConnectionState.CONNECTING
        ConnectionState.Connected -> PulseBarStreamConnectionState.CONNECTED
        ConnectionState.Reconnecting -> PulseBarStreamConnectionState.RECONNECTING
        ConnectionState.Stopping -> PulseBarStreamConnectionState.STOPPING
        ConnectionState.Stopped -> PulseBarStreamConnectionState.STOPPED
        ConnectionState.Failed -> PulseBarStreamConnectionState.FAILED
    }
}


fun StreamStats.stopped(): StreamStats = this.copy(
    connectionState = ConnectionState.Stopped,
    statusText = "stopped",
    isSending = false,
    captureRequested = false,
    queuedChunks = 0,
    queuedBytes = 0L,
    queuedFirstSequence = null,
    queuedLastSequence = null,
)


fun StreamStats.connecting(): StreamStats = this.copy(
        connectionState = if (reconnectAttempt == 0) ConnectionState.Connecting
        else ConnectionState.Reconnecting,
        statusText = "Connecting to device v2 server...",
        lastErrorMessage = null,
    )

fun StreamStats.connected(url: String): StreamStats = this.copy(
        connectionState = ConnectionState.Connected,
        statusText = "Connected",
        webSocketUrl = url,
        lastConnectedAtMillis = nowInMillis(),
        reconnectCount = this.reconnectCount + if (reconnectAttempt > 0) 1 else 0,
        reconnectDelaySeconds = null,
        nextReconnectAtMillis = null,
        lastErrorMessage = null,
    )

fun StreamStats.disconnected(reason: String): StreamStats =
    this.copy(
        connectionState = ConnectionState.Idle,
        statusText = "Disconnected: $reason",
        lastDisconnectedAtMillis = nowInMillis(),
        lastErrorMessage = reason,
        isSending = false,
        captureRequested = false,
    )

fun StreamStats.failed(reason: String): StreamStats = this.copy(
        connectionState = ConnectionState.Failed,
        lastDisconnectedAtMillis = nowInMillis(),
        lastErrorMessage = reason,
        reconnectDelaySeconds = null,
        nextReconnectAtMillis = null,
        statusText = "Failed: $reason",
        isSending = false,
        captureRequested = false,
    )