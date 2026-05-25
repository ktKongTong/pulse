package io.github.kt.pulsebar.core.platform

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PlatformSupportTest {

    @Test fun emptyIsNull() {
        assertNull(normalizePulseBaseUrl(""))
        assertNull(normalizePulseBaseUrl("   "))
    }

    @Test fun stripsPresenceIngestV2() {
        assertEquals(
            "https://pulse.example.com",
            normalizePulseBaseUrl("https://pulse.example.com/api/v2/presence/ingest"),
        )
        assertEquals(
            "https://pulse.example.com",
            normalizePulseBaseUrl("https://pulse.example.com/v2/presence/ingest"),
        )
    }

    @Test fun stripsMetaAndStream() {
        assertEquals(
            "http://localhost:8900",
            normalizePulseBaseUrl("http://localhost:8900/api/v1/meta"),
        )
        assertEquals(
            "http://localhost:8900",
            normalizePulseBaseUrl("http://localhost:8900/api/v1/stream"),
        )
        assertEquals(
            "http://localhost:8900",
            normalizePulseBaseUrl("http://localhost:8900/api/v1/live-listen"),
        )
    }

    @Test fun stripsQueryAndFragment() {
        assertEquals(
            "https://pulse.example.com",
            normalizePulseBaseUrl("https://pulse.example.com/?foo=bar#baz"),
        )
    }

    @Test fun dropsTrailingSlashButKeepsScheme() {
        assertEquals(
            "https://pulse.example.com",
            normalizePulseBaseUrl("https://pulse.example.com/"),
        )
        assertEquals(
            "https://",
            normalizePulseBaseUrl("https://"),
        )
    }

    @Test fun preservesOpaqueHostPath() {
        assertEquals(
            "https://pulse.example.com/custom/path",
            normalizePulseBaseUrl("https://pulse.example.com/custom/path"),
        )
    }
}

class Iso8601ParserTest {

    @Test fun fractionalSecondsZulu() {
        assertEquals(1778416496789L, parseIso8601ToMillis("2026-05-10T12:34:56.789Z"))
    }

    @Test fun withoutFractionalSeconds() {
        assertEquals(1778416496000L, parseIso8601ToMillis("2026-05-10T12:34:56Z"))
    }

    @Test fun offsetTimezone() {
        assertEquals(1778416496000L, parseIso8601ToMillis("2026-05-10T20:34:56+08:00"))
    }

    @Test fun nullOrBlankReturnsNull() {
        assertNull(parseIso8601ToMillis(null))
        assertNull(parseIso8601ToMillis(""))
        assertNull(parseIso8601ToMillis("   "))
    }

    @Test fun malformedReturnsNull() {
        assertNull(parseIso8601ToMillis("not a date"))
        assertNull(parseIso8601ToMillis("2026-05"))
    }
}

class WallClockFormatTest {

    @Test fun nullOrZeroRendersDash() {
        assertEquals("-", formatWallClockTime(null))
        assertEquals("-", formatWallClockTime(0))
    }

    @Test fun nonZeroHasHHMMSSShape() {
        // JVM stub returns "HH:mm:ss" so we can assert the shape directly.
        val result = formatWallClockTime(1778416496000L)
        assertEquals(8, result.length)
        assertEquals(':', result[2])
        assertEquals(':', result[5])
    }
}
