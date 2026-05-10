package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarLiveListenConnectionState
import kotlin.test.Test
import kotlin.test.assertEquals

class LiveListenPresentationTest {

    private fun input(
        state: PulseBarLiveListenConnectionState = PulseBarLiveListenConnectionState.IDLE,
        sending: Boolean = false,
        capturing: Boolean = false,
        capturedFrames: Long = 0L,
        nextReconnectAtMillis: Long? = null,
        endpointCount: Int = 1,
        connectedEndpointCount: Int = 0,
    ) = LiveListenStatusInput(
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
            "Connecting Live Listen server…",
            LiveListenPresentation.streamStatusText("Spotify", input(state = PulseBarLiveListenConnectionState.CONNECTING)),
        )
    }

    @Test fun streamStatusText_connectedSending() {
        assertEquals(
            "Sending Spotify audio…",
            LiveListenPresentation.streamStatusText("Spotify", input(state = PulseBarLiveListenConnectionState.CONNECTED, sending = true)),
        )
    }

    @Test fun streamStatusText_connectedIdle() {
        assertEquals(
            "Capturing Spotify…",
            LiveListenPresentation.streamStatusText("Spotify", input(state = PulseBarLiveListenConnectionState.CONNECTED)),
        )
    }

    @Test fun streamStatusText_idle_isPreparing() {
        assertEquals(
            "Preparing stream…",
            LiveListenPresentation.streamStatusText("x", input(state = PulseBarLiveListenConnectionState.IDLE)),
        )
    }

    @Test fun captureActivityText() {
        assertEquals("idle", LiveListenPresentation.captureActivityText(input()))
        assertEquals("starting", LiveListenPresentation.captureActivityText(input(capturing = true)))
        assertEquals("capturing", LiveListenPresentation.captureActivityText(input(capturing = true, capturedFrames = 1)))
        assertEquals("sending", LiveListenPresentation.captureActivityText(input(capturing = true, sending = true)))
    }

    @Test fun nextReconnectText_none() {
        assertEquals("-", LiveListenPresentation.nextReconnectText(input(), 1_000L))
    }

    @Test fun nextReconnectText_now() {
        assertEquals("now", LiveListenPresentation.nextReconnectText(input(nextReconnectAtMillis = 1_400L), 1_000L))
    }

    @Test fun nextReconnectText_rounded() {
        assertEquals("5s", LiveListenPresentation.nextReconnectText(input(nextReconnectAtMillis = 6_000L), 1_000L))
    }

    @Test fun serverConnectionText() {
        assertEquals("none", LiveListenPresentation.serverConnectionText(input(endpointCount = 0)))
        assertEquals("0/2", LiveListenPresentation.serverConnectionText(input(endpointCount = 2, connectedEndpointCount = 0)))
        assertEquals("2/2", LiveListenPresentation.serverConnectionText(input(endpointCount = 2, connectedEndpointCount = 2)))
    }
}
