package io.github.kt.pulsebar.core.presentation

/**
 * Primitive view of the Live Listen publisher stats. Mirrors the subset
 * of `LiveListenStats` the presentation layer actually needs, so the
 * helpers in this file are free of dependencies on macosMain code.
 */
data class LiveListenStatusInput(
    val connectionStateName: String, // "IDLE" | "CONNECTING" | "CONNECTED" | "RECONNECTING" | "STOPPING" | "STOPPED" | "FAILED"
    val isSending: Boolean,
    val isCapturing: Boolean,
    val capturedFrames: Long,
    val nextReconnectAtMillis: Long?,
    val endpointCount: Int,
    val connectedEndpointCount: Int,
)

object LiveListenPresentation {

    /** Swift's `streamStatusText`. */
    fun streamStatusText(sourceName: String, input: LiveListenStatusInput): String = when (input.connectionStateName) {
        "CONNECTING" -> "Connecting Live Listen server…"
        "CONNECTED" -> if (input.isSending) "Sending $sourceName audio…" else "Capturing $sourceName…"
        "RECONNECTING" -> "Reconnecting Live Listen server…"
        "FAILED" -> "Live Listen connection failed"
        "STOPPING" -> "Stopping stream…"
        "STOPPED" -> "Stream stopped"
        else -> "Preparing stream…"
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
}
