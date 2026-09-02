package io.github.kt.pulsebar.utils

import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.format.DateTimeComponents
import kotlinx.datetime.parse
import kotlinx.datetime.toLocalDateTime


fun currentTimeMillis() = Clock.System.now().epochSeconds

fun iso8601(time: Long = currentTimeMillis()): String {
    val instant = Instant.fromEpochMilliseconds(time)
    return instant.toString()
}

internal fun nowInIso8601(): String {
    return Clock.System.now().toString()
}

internal fun nowInMillis(): Long = Clock.System.now().toEpochMilliseconds()



/**
 * Format a millisecond timestamp as a wall-clock (time-only)
 * string for the dashboard's "last probe / last success / last failure"
 * rows. Returns `"-"` for null or zero millis (the "never happened"
 * sentinel used elsewhere).
 */
fun formatWallClockTime(epochMillis: Long?): String {
    if (epochMillis == null || epochMillis == 0L) return "-"
    val local = Instant.fromEpochMilliseconds(epochMillis)
        .toLocalDateTime(TimeZone.currentSystemDefault())
    return "${local.hour.twoDigits()}:${local.minute.twoDigits()}:${local.second.twoDigits()}"
}

/**
 * Parse an ISO8601 timestamp string (with or without fractional seconds)
 * into an epoch millisecond count. Returns null for null/empty/unparseable
 * input. Centralised so Swift (and any future shell) doesn't need to keep
 * a cached `ISO8601DateFormatter` around.
 */
fun parseIso8601ToMillis(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return runCatching {
        Instant.parse(value, DateTimeComponents.Formats.ISO_DATE_TIME_OFFSET)
            .toEpochMilliseconds()
    }.getOrNull()
}

fun formatClockSeconds(seconds: Int): String {
    val value = seconds.coerceAtLeast(0)
    val hours = value / 3600
    val minutes = (value % 3600) / 60
    val remainingSeconds = value % 60
    return if (hours > 0) {
        "$hours:${minutes.twoDigits()}:${remainingSeconds.twoDigits()}"
    } else {
        "$minutes:${remainingSeconds.twoDigits()}"
    }
}

fun formatDurationHuman(seconds: Int): String {
    val value = seconds.coerceAtLeast(0)
    if (value >= 3600) {
        val hours = value / 3600
        val minutes = (value % 3600) / 60
        return if (minutes > 0) "${hours}h ${minutes}m" else "${hours}h"
    }
    if (value >= 60) {
        return "${value / 60}m"
    }
    return "${value}s"
}

fun takeIfNotBlank(value: String?): String? =
    value?.takeIf { it.isNotBlank() }

private fun Int.twoDigits(): String = if (this < 10) "0$this" else toString()
