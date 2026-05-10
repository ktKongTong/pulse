package io.github.kt.pulsebar.core.presentation

import kotlin.test.Test
import kotlin.test.assertEquals

class PulseBarFormattersTest {

    @Test fun durationHuman_seconds() {
        assertEquals("0s", PulseBarFormatters.formatDurationHuman(0))
        assertEquals("45s", PulseBarFormatters.formatDurationHuman(45))
    }

    @Test fun durationHuman_minutes() {
        assertEquals("1m 0s", PulseBarFormatters.formatDurationHuman(60))
        assertEquals("12m 34s", PulseBarFormatters.formatDurationHuman(12 * 60 + 34))
    }

    @Test fun durationHuman_hours() {
        assertEquals("1h 0m", PulseBarFormatters.formatDurationHuman(3600))
        assertEquals("1h 23m", PulseBarFormatters.formatDurationHuman(3600 + 23 * 60 + 45))
        assertEquals("10h 5m", PulseBarFormatters.formatDurationHuman(10 * 3600 + 5 * 60))
    }

    @Test fun durationHuman_clampsNegative() {
        assertEquals("0s", PulseBarFormatters.formatDurationHuman(-42))
    }

    @Test fun remainingClock_basic() {
        assertEquals("-1:30 / 3:00", PulseBarFormatters.formatRemainingClock(90.0, 180))
        assertEquals("-0:00 / 3:00", PulseBarFormatters.formatRemainingClock(180.0, 180))
        assertEquals("-3:00 / 3:00", PulseBarFormatters.formatRemainingClock(0.0, 180))
    }

    @Test fun remainingClock_progressPastDurationIsClamped() {
        assertEquals("-0:00 / 1:00", PulseBarFormatters.formatRemainingClock(999.0, 60))
    }

    @Test fun remainingClock_nullDuration() {
        assertEquals("-0:00 / 0:00", PulseBarFormatters.formatRemainingClock(12.0, null))
        assertEquals("-0:00 / 0:00", PulseBarFormatters.formatRemainingClock(12.0, 0))
    }

    @Test fun clock_hours() {
        assertEquals("1:02:03", PulseBarFormatters.formatClock(3723))
    }

    @Test fun age_absent() {
        assertEquals("-", PulseBarFormatters.formatAge(null, 0))
        assertEquals("-", PulseBarFormatters.formatAge(0, 0))
    }

    @Test fun age_recent() {
        val now = 10_000L
        assertEquals("now", PulseBarFormatters.formatAge(now - 500, now))
        assertEquals("2s ago", PulseBarFormatters.formatAge(now - 2_000, now))
        assertEquals("59s ago", PulseBarFormatters.formatAge(now - 59_000, now))
    }

    @Test fun age_minutes() {
        val now = 600_000L
        assertEquals("1m ago", PulseBarFormatters.formatAge(now - 60_000, now))
        assertEquals("9m ago", PulseBarFormatters.formatAge(now - 9 * 60_000, now))
    }

    @Test fun age_nonMonotonic_clampsToNow() {
        // future timestamp should not explode
        assertEquals("now", PulseBarFormatters.formatAge(100, 50))
    }
}
