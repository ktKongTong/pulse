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

    @Test fun stripsMetaAndLiveListen() {
        assertEquals(
            "http://localhost:8900",
            normalizePulseBaseUrl("http://localhost:8900/api/v1/meta"),
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
