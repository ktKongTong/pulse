package io.github.kt.pulsebar.logger

import kotlin.test.Test
import kotlin.test.assertEquals

class PulseNativeLogTest {
    @Test
    fun mapsSwiftFacingCategoriesToPulseLogCategories() {
        assertEquals(PulseLogCategory.PlatformAdapter, PulseNativeLogCategory.platformAdapter.logCategory)
        assertEquals(PulseLogCategory.StreamSession, PulseNativeLogCategory.streamSession.logCategory)
    }
}
