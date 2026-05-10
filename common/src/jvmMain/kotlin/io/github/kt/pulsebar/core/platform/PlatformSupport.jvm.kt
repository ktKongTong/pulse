package io.github.kt.pulsebar.core.platform

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// JVM has no bundle catalogue — callers fall back to the untouched name.
internal actual fun resolveAppDisplayName(bundleId: String): String? = null

private val jvmWallClockTimeFormatter: DateTimeFormatter =
    DateTimeFormatter.ofPattern("HH:mm:ss", Locale.ROOT).withZone(ZoneId.systemDefault())

actual fun formatWallClockTime(epochMillis: Long?): String {
    if (epochMillis == null || epochMillis == 0L) return "-"
    return jvmWallClockTimeFormatter.format(Instant.ofEpochMilli(epochMillis))
}

actual fun parseIso8601ToMillis(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return runCatching { Instant.parse(value).toEpochMilli() }
        .recoverCatching {
            // Fallback — the fractional seconds variant isn't always accepted.
            java.time.OffsetDateTime.parse(value).toInstant().toEpochMilli()
        }
        .getOrNull()
}

actual fun newPulseUuid(): String = java.util.UUID.randomUUID().toString().lowercase()
