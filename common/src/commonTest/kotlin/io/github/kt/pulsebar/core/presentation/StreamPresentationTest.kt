package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarStreamConnectionState
import kotlin.test.Test
import kotlin.test.assertEquals

class StreamPresentationTest {

    private fun input(
        state: PulseBarStreamConnectionState = PulseBarStreamConnectionState.IDLE,
        sending: Boolean = false,
        capturing: Boolean = false,
        capturedFrames: Long = 0L,
        nextReconnectAtMillis: Long? = null,
        endpointCount: Int = 1,
        connectedEndpointCount: Int = 0,
    ) = StreamStatusInput(
        connectionState = state,
        isSending = sending,
        isCapturing = capturing,
        capturedFrames = capturedFrames,
        nextReconnectAtMillis = nextReconnectAtMillis,
        endpointCount = endpointCount,
        connectedEndpointCount = connectedEndpointCount,
    )

    @Test fun streamStatusText_connecting() {
        assertEquals(
            "Connecting Stream server…",
            StreamPresentation.streamStatusText("Spotify", input(state = PulseBarStreamConnectionState.CONNECTING)),
        )
    }

    @Test fun streamStatusText_connectedSending() {
        assertEquals(
            "Sending Spotify audio…",
            StreamPresentation.streamStatusText("Spotify", input(state = PulseBarStreamConnectionState.CONNECTED, sending = true)),
        )
    }

    @Test fun streamStatusText_connectedIdle() {
        assertEquals(
            "Capturing Spotify…",
            StreamPresentation.streamStatusText("Spotify", input(state = PulseBarStreamConnectionState.CONNECTED)),
        )
    }

    @Test fun streamStatusText_unknown_isPreparing() {
        assertEquals("Preparing stream…", StreamPresentation.streamStatusText("x", input(state = PulseBarStreamConnectionState.IDLE)))
    }

    @Test fun captureActivityText() {
        assertEquals("idle", StreamPresentation.captureActivityText(input()))
        assertEquals("starting", StreamPresentation.captureActivityText(input(capturing = true)))
        assertEquals("capturing", StreamPresentation.captureActivityText(input(capturing = true, capturedFrames = 1)))
        assertEquals("sending", StreamPresentation.captureActivityText(input(capturing = true, sending = true)))
    }

    @Test fun nextReconnectText_none() {
        assertEquals("-", StreamPresentation.nextReconnectText(input(), 1_000L))
    }

    @Test fun nextReconnectText_now() {
        assertEquals("now", StreamPresentation.nextReconnectText(input(nextReconnectAtMillis = 1_400L), 1_000L))
    }

    @Test fun nextReconnectText_rounded() {
        assertEquals("5s", StreamPresentation.nextReconnectText(input(nextReconnectAtMillis = 6_000L), 1_000L))
    }

    @Test fun serverConnectionText() {
        assertEquals("none", StreamPresentation.serverConnectionText(input(endpointCount = 0)))
        assertEquals("0/2", StreamPresentation.serverConnectionText(input(endpointCount = 2, connectedEndpointCount = 0)))
        assertEquals("2/2", StreamPresentation.serverConnectionText(input(endpointCount = 2, connectedEndpointCount = 2)))
    }
}
