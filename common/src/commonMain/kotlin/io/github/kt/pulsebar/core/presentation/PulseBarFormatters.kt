package io.github.kt.pulsebar.core.presentation

/**
 * Shared text formatting helpers that have no platform dependency and show
 * up in both the menubar and the dashboard. Keeping these in commonMain
 * means Swift only ever reads preformatted strings.
 *
 * All functions are pure and unit-tested in `commonTest`.
 */
object PulseBarFormatters {

    /**
     * Human-readable duration: `1h 23m` / `12m 34s` / `45s` for seconds.
     * Used in the menubar's usage rows.
     */
    fun formatDurationHuman(seconds: Int): String {
        val s = seconds.coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return when {
            h > 0 -> "${h}h ${m}m"
            m > 0 -> "${m}m ${sec}s"
            else -> "${sec}s"
        }
    }

    /**
     * `-1:23 / 4:56` style progress string for a media item. Uses the
     * remaining time from the head so the countdown pops out.
     */
    fun formatRemainingClock(progressSeconds: Double, durationSeconds: Int?): String {
        val duration = durationSeconds ?: 0
        val progress = progressSeconds.toInt().coerceIn(0, duration.coerceAtLeast(0))
        val remaining = (duration - progress).coerceAtLeast(0)
        return "-${formatClock(remaining)} / ${formatClock(duration)}"
    }

    /**
     * `M:SS` / `H:MM:SS` clock formatter. Internal helper, exposed for tests.
     */
    fun formatClock(seconds: Int): String {
        val s = seconds.coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) {
            "$h:${pad2(m)}:${pad2(sec)}"
        } else {
            "$m:${pad2(sec)}"
        }
    }

    /**
     * Relative age of a timestamp compared to [nowMillis]. Returns `"-"`
     * when [fromMillis] is null or explicitly zero (our sentinel for
     * "never happened").
     *
     * - `< 1s` → `"now"`
     * - `< 60s` → `"12s ago"`
     * - otherwise → `"5m ago"` (minute resolution)
     */
    fun formatAge(fromMillis: Long?, nowMillis: Long): String {
        if (fromMillis == null || fromMillis == 0L) return "-"
        val ageMs = (nowMillis - fromMillis).coerceAtLeast(0L)
        if (ageMs < 1_000L) return "now"
        val seconds = ageMs / 1_000L
        if (seconds < 60L) return "${seconds}s ago"
        val minutes = seconds / 60L
        return "${minutes}m ago"
    }

/**
 * Human sequence-range label: `-`, `#123`, or `#100-#123`. Both
 * sentinel inputs (`-1`) collapse to `-`; matching first/last collapse
 * to `#<seq>`.
 */
    fun formatQueueRange(firstSeq: Long, lastSeq: Long): String {
        if (firstSeq < 0L || lastSeq < 0L) return "-"
        if (firstSeq == lastSeq) return "#$firstSeq"
        return "#$firstSeq-#$lastSeq"
    }

    /**
     * Optional double → string. Returns `"-"` when [value] is null,
     * otherwise formats with one decimal place (e.g. kbps readouts).
     */
    fun formatOptionalDouble(value: Double?): String {
        if (value == null) return "-"
        // Manual formatting keeps us off platform-specific NumberFormatter.
        val rounded = kotlin.math.round(value * 10.0) / 10.0
        val whole = rounded.toLong()
        val frac = kotlin.math.round(kotlin.math.abs(rounded - whole) * 10.0).toLong()
        return "$whole.$frac"
    }

    private fun pad2(v: Int): String = if (v < 10) "0$v" else v.toString()
}
