package io.github.kt.pulsebar.core.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EndpointPresentationTest {

    private fun input(
        enabled: Boolean = true,
        disconnected: Boolean = false,
        endpointUrl: String = "https://pulse.example.com",
        isConnecting: Boolean = false,
        status: String? = "healthy",
        lastStatus: String? = null,
        lastErrorMessage: String? = null,
        pendingCount: Int = 0,
    ) = EndpointRuntimeInput(
        enabled = enabled,
        disconnected = disconnected,
        endpointUrl = endpointUrl,
        isConnecting = isConnecting,
        status = status,
        lastStatus = lastStatus,
        lastErrorMessage = lastErrorMessage,
        pendingCount = pendingCount,
    )

    @Test fun disconnectedReason_connecting_isDash() {
        assertEquals("-", EndpointPresentation.disconnectedReason(input(isConnecting = true)))
    }

    @Test fun disconnectedReason_disabled() {
        assertEquals("Endpoint disabled", EndpointPresentation.disconnectedReason(input(enabled = false)))
    }

    @Test fun disconnectedReason_manuallyDisconnected() {
        assertEquals("Disconnected manually", EndpointPresentation.disconnectedReason(input(disconnected = true)))
    }

    @Test fun disconnectedReason_missingUrl() {
        assertEquals("Missing endpoint URL", EndpointPresentation.disconnectedReason(
            input(endpointUrl = "", status = null),
        ))
    }

    @Test fun disconnectedReason_healthy() {
        assertEquals("-", EndpointPresentation.disconnectedReason(input(status = "healthy")))
    }

    @Test fun disconnectedReason_localUnavailable() {
        assertEquals("Local server unavailable", EndpointPresentation.disconnectedReason(input(status = "local_unavailable")))
    }

    @Test fun disconnectedReason_misconfigured() {
        assertEquals("Configuration needs attention", EndpointPresentation.disconnectedReason(input(status = "misconfigured")))
    }

    @Test fun disconnectedReason_degradedDelegatesToDetail() {
        assertEquals("Delivery degraded", EndpointPresentation.disconnectedReason(input(status = "degraded")))
    }

    @Test fun disconnectedReason_staleInactive_isDash() {
        assertEquals("-", EndpointPresentation.disconnectedReason(input(status = "disabled")))
        assertEquals("-", EndpointPresentation.disconnectedReason(input(status = "disconnected")))
    }

    @Test fun connectionActionTitle_connecting() {
        assertEquals(
            "Connecting…",
            EndpointPresentation.connectionActionTitle(
                input(isConnecting = true),
                ConnectionRuntimeStatus.Disconnected,
            ),
        )
    }

    @Test fun connectionActionTitle_perStatus() {
        val base = input()
        assertEquals("Disconnect", EndpointPresentation.connectionActionTitle(base, ConnectionRuntimeStatus.Connected))
        assertEquals("Reconnect", EndpointPresentation.connectionActionTitle(base, ConnectionRuntimeStatus.Reconnecting))
        assertEquals("Connect", EndpointPresentation.connectionActionTitle(base, ConnectionRuntimeStatus.Disconnected))
    }

    @Test fun deliveryDetail_healthy_noPending() {
        assertEquals("Ready", EndpointPresentation.deliveryDetail(input()))
    }

    @Test fun deliveryDetail_healthy_withPending() {
        assertEquals("Delivering queued events", EndpointPresentation.deliveryDetail(input(pendingCount = 3)))
    }

    @Test fun deliveryDetail_replayOk() {
        assertEquals(
            "Events delivered successfully",
            EndpointPresentation.deliveryDetail(input(lastStatus = "replay:ok:17")),
        )
    }

    @Test fun deliveryDetail_replayHttpWithErrorText() {
        assertEquals(
            "403 forbidden",
            EndpointPresentation.deliveryDetail(
                input(lastStatus = "replay:http:403", lastErrorMessage = "403 forbidden"),
            ),
        )
    }

    @Test fun deliveryDetail_replayHttpWithoutErrorText() {
        assertEquals(
            "Server rejected the ingest request",
            EndpointPresentation.deliveryDetail(input(lastStatus = "replay:http:500")),
        )
    }

    @Test fun deliveryDetail_skipMissingCreds() {
        assertEquals(
            "Missing Workspace ID, Site ID, or API Key",
            EndpointPresentation.deliveryDetail(input(lastStatus = "skip:missing_workspace_site_or_api_key")),
        )
    }

    @Test fun deliveryDetail_skipNoChange_pendingBacklog() {
        assertEquals(
            "Waiting to deliver queued events",
            EndpointPresentation.deliveryDetail(input(lastStatus = "skip:no_change", pendingCount = 1)),
        )
    }

    @Test fun deliveryDetail_skipNoChange_empty() {
        assertEquals(
            "No new events",
            EndpointPresentation.deliveryDetail(input(lastStatus = "skip:no_change")),
        )
    }

    @Test fun deliveryDetail_unknownStatus_isTitleCased() {
        assertEquals(
            "Weird status",
            EndpointPresentation.deliveryDetail(input(status = "weird_status")),
        )
    }

    @Test fun deliveryDetail_disabledEndpoint() {
        assertEquals(
            "Endpoint disabled",
            EndpointPresentation.deliveryDetail(input(enabled = false)),
        )
    }

    @Test fun isStaleInactive() {
        assertTrue(EndpointPresentation.isStaleInactive("disabled", null))
        assertTrue(EndpointPresentation.isStaleInactive("disconnected", null))
        assertTrue(EndpointPresentation.isStaleInactive("whatever", "skip:endpoint_disabled"))
        assertTrue(EndpointPresentation.isStaleInactive("whatever", "skip:endpoint_disconnected"))
        assertFalse(EndpointPresentation.isStaleInactive("healthy", null))
    }
}
