package io.github.kt.pulsebar.export

import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter

internal val excludedStatsBundleIds = setOf(
    "io.github.kt.pulsebar.native",
    "com.apple.FollowUpUI",
    "com.apple.loginwindow"
)

internal enum class UsageSlice {
    APP,
    PAGE,
    MEDIA
}

internal data class MediaReporterState(
    val key: String,
    val progressSeconds: Double,
    val isPlaying: Boolean,
    val capturedAtMillis: Long
)

internal data class QueueActionResult(
    val status: String,
    val errorCode: String? = null,
    val errorMessage: String? = null
)

internal fun randomId(): String =
    buildString {
        repeat(4) {
            append((1..9999).random().toString(16))
        }
    }

internal fun slugify(value: String): String =
    value.trim()
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .ifBlank { "unknown-device" }

internal fun resolvedEndpointBase(rawEndpoint: String): String? {
    val trimmed = rawEndpoint.trim()
    if (trimmed.isBlank()) return null
    return if (trimmed.endsWith("/")) trimmed.dropLast(1) else trimmed
}

internal fun resolvedEndpointIngestUrl(rawEndpoint: String): String {
    val trimmed = rawEndpoint.trim()
    return when {
        trimmed.isBlank() -> "http://localhost:8900/api/v2/presence/ingest"
        trimmed.endsWith("/") -> "${trimmed}api/v2/presence/ingest"
        trimmed.endsWith("/api/v2/presence/ingest") -> trimmed
        trimmed.endsWith("/v2/presence/ingest") -> trimmed.replace("/v2/presence/ingest", "/api/v2/presence/ingest")
        !trimmed.contains("/api/v2/") -> "$trimmed/api/v2/presence/ingest"
        else -> trimmed
    }
}

internal fun nativeCurrentTimeMillis(): Long =
    (NSDate().timeIntervalSinceReferenceDate * 1000.0).toLong()

internal fun nativeIso8601Now(): String {
    val formatter = NSDateFormatter().apply {
        dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
    }
    return formatter.stringFromDate(NSDate())
}
