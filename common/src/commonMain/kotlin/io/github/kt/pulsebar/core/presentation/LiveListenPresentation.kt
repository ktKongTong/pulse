package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarLiveListenConnectionState
import io.github.kt.pulsebar.export.PulseBarMedia

/**
 * Primitive view of the Live Listen publisher stats. Mirrors the subset
 * of `LiveListenStats` the presentation layer actually needs, so the
 * helpers in this file are free of dependencies on macosMain code.
 */
data class LiveListenStatusInput(
    val connectionState: PulseBarLiveListenConnectionState,
    val isSending: Boolean,
    val isCapturing: Boolean,
    val capturedFrames: Long,
    val nextReconnectAtMillis: Long?,
    val endpointCount: Int,
    val connectedEndpointCount: Int,
)

object LiveListenPresentation {

    /** Swift's `streamStatusText`. */
    fun streamStatusText(sourceName: String, input: LiveListenStatusInput): String = when (input.connectionState) {
        PulseBarLiveListenConnectionState.CONNECTING -> "Connecting Live Listen server…"
        PulseBarLiveListenConnectionState.CONNECTED -> if (input.isSending) "Sending $sourceName audio…" else "Capturing $sourceName…"
        PulseBarLiveListenConnectionState.RECONNECTING -> "Reconnecting Live Listen server…"
        PulseBarLiveListenConnectionState.FAILED -> "Live Listen connection failed"
        PulseBarLiveListenConnectionState.STOPPING -> "Stopping stream…"
        PulseBarLiveListenConnectionState.STOPPED -> "Stream stopped"
        PulseBarLiveListenConnectionState.IDLE -> "Preparing stream…"
    }

    /** Swift's `captureActivityText`. */
    fun captureActivityText(input: LiveListenStatusInput): String {
        if (!input.isCapturing) return "idle"
        if (input.isSending) return "sending"
        if (input.capturedFrames > 0L) return "capturing"
        return "starting"
    }

    /** Swift's `nextReconnectText`. */
    fun nextReconnectText(input: LiveListenStatusInput, nowMillis: Long): String {
        val at = input.nextReconnectAtMillis ?: return "-"
        val diffMs = (at - nowMillis).coerceAtLeast(0L)
        if (diffMs < 1_000L) return "now"
        val seconds = (diffMs + 500L) / 1_000L
        return "${seconds}s"
    }

    /** Swift's `serverConnectionText` — "2/3" / "none". */
    fun serverConnectionText(input: LiveListenStatusInput): String {
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
