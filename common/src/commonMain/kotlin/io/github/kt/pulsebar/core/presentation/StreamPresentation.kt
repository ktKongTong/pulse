package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarMedia
import io.github.kt.pulsebar.export.PulseBarStreamConnectionState

/**
 * Primitive view of the Stream publisher stats. Mirrors the subset
 * of `StreamStats` the presentation layer actually needs, so the
 * helpers in this file are free of dependencies on macosMain code.
 */
data class StreamStatusInput(
    val connectionState: PulseBarStreamConnectionState,
    val isSending: Boolean,
    val isCapturing: Boolean,
    val capturedFrames: Long,
    val nextReconnectAtMillis: Long?,
    val endpointCount: Int,
    val connectedEndpointCount: Int,
)

object StreamPresentation {

    /** Swift's `streamStatusText`. */
    fun streamStatusText(sourceName: String, input: StreamStatusInput): String = when (input.connectionState) {
        PulseBarStreamConnectionState.CONNECTING -> "Connecting Stream server…"
        PulseBarStreamConnectionState.CONNECTED -> if (input.isSending) "Sending $sourceName audio…" else "Capturing $sourceName…"
        PulseBarStreamConnectionState.RECONNECTING -> "Reconnecting Stream server…"
        PulseBarStreamConnectionState.FAILED -> "Stream connection failed"
        PulseBarStreamConnectionState.STOPPING -> "Stopping stream…"
        PulseBarStreamConnectionState.STOPPED -> "Stream stopped"
        else -> "Preparing stream…"
    }

    /** Swift's `captureActivityText`. */
    fun captureActivityText(input: StreamStatusInput): String {
        if (!input.isCapturing) return "idle"
        if (input.isSending) return "sending"
        if (input.capturedFrames > 0L) return "capturing"
        return "starting"
    }

    /** Swift's `nextReconnectText`. */
    fun nextReconnectText(input: StreamStatusInput, nowMillis: Long): String {
        val at = input.nextReconnectAtMillis ?: return "-"
        val diffMs = (at - nowMillis).coerceAtLeast(0L)
        if (diffMs < 1_000L) return "now"
        val seconds = (diffMs + 500L) / 1_000L
        return "${seconds}s"
    }

    /** Swift's `serverConnectionText` — "2/3" / "none". */
    fun serverConnectionText(input: StreamStatusInput): String {
        if (input.endpointCount == 0) return "none"
        return "${input.connectedEndpointCount}/${input.endpointCount}"
    }

    /**
     * Compact string fingerprint for a [PulseBarMedia] — used by the
     * Swift shell to de-dupe "did the playing track change" events before
     * pushing to the server. Lives here so any future shell gets the
     * same definition of "same media" for free.
     */
    fun mediaSignature(media: PulseBarMedia?): String {
        if (media == null) return "none"
        val trackId = media.trackId ?: "${media.providerId}|${media.title}|${media.artist}"
        return listOf(
            trackId,
            media.providerId,
            media.source,
            media.title,
            media.artist,
            media.album ?: "",
            media.linkUrl ?: "",
            media.durationSeconds.toString(),
            if (media.isPlaying) "playing" else "paused",
        ).joinToString("|")
    }
}
