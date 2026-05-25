package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.stream.StreamCaptureRuntime
import io.github.kt.pulsebar.core.stream.StreamMediaPermission
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.stream.StreamPlaybackWire
import io.github.kt.pulsebar.core.stream.StreamStats

internal fun defaultMediaState() = StreamNativeMediaState(
    permission = StreamMediaPermission.ALLOW,
    playback = StreamPlaybackWire.PAUSED,
    capture = StreamCaptureRuntime.NO_CAPTURE,
)

internal fun DeviceV2Client.connectingStats(stats: StreamStats): StreamStats =
    stats.copy(
        connectionState = if (reconnectAttempt == 0) StreamStats.ConnectionState.Connecting
        else StreamStats.ConnectionState.Reconnecting,
        lastErrorMessage = null,
        statusText = "Connecting to device v2 server...",
    )

internal fun DeviceV2Client.connectedStats(stats: StreamStats, url: String): StreamStats =
    stats.copy(
        connectionState = StreamStats.ConnectionState.Connected,
        webSocketUrl = url,
        lastConnectedAtMillis = deviceV2NowMillis(),
        reconnectCount = stats.reconnectCount + if (reconnectAttempt > 0) 1 else 0,
        reconnectDelaySeconds = null,
        nextReconnectAtMillis = null,
        statusText = "Connected",
        lastErrorMessage = null,
    )

internal fun DeviceV2Client.disconnectedStats(stats: StreamStats, reason: String): StreamStats =
    stats.copy(
        connectionState = StreamStats.ConnectionState.Reconnecting,
        lastDisconnectedAtMillis = deviceV2NowMillis(),
        lastErrorMessage = reason,
        statusText = "Disconnected: $reason",
        isSending = false,
        captureRequested = false,
    )

internal fun failedStats(stats: StreamStats, reason: String): StreamStats =
    stats.copy(
        connectionState = StreamStats.ConnectionState.Failed,
        lastDisconnectedAtMillis = deviceV2NowMillis(),
        lastErrorMessage = reason,
        reconnectDelaySeconds = null,
        nextReconnectAtMillis = null,
        statusText = "Failed: $reason",
        isSending = false,
        captureRequested = false,
    )

internal fun stoppedStats(stats: StreamStats): StreamStats =
    stats.copy(
        connectionState = StreamStats.ConnectionState.Stopped,
        statusText = "Device v2 client stopped",
        isSending = false,
        captureRequested = false,
        queuedChunks = 0,
        queuedBytes = 0L,
        queuedFirstSequence = null,
        queuedLastSequence = null,
    )

internal suspend fun DeviceV2Client.sleepBeforeReconnect() {
    val seconds = reconnectDelaySeconds(reconnectAttempt)
    updateStats {
        it.copy(
            connectionState = StreamStats.ConnectionState.Reconnecting,
            reconnectAttempt = reconnectAttempt,
            reconnectDelaySeconds = seconds.toDouble(),
            nextReconnectAtMillis = deviceV2NowMillis() + seconds * 1_000L,
            statusText = "Reconnecting in ${seconds}s",
        )
    }
    kotlinx.coroutines.delay(seconds * 1_000L)
}

internal fun reconnectDelaySeconds(attempt: Int): Long {
    val schedule = longArrayOf(1, 2, 5, 10, 30, 60)
    return schedule[attempt.coerceIn(0, schedule.size - 1)]
}

internal fun deviceV2BytesPerFrame(channels: Int): Int = channels * 2
