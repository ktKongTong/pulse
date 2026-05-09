package io.github.kt.pulsebar.core.presentation

import io.github.kt.pulsebar.export.PulseBarEndpointConfig
import io.github.kt.pulsebar.export.PulseBarEndpointSyncState
import io.github.kt.pulsebar.export.PulseBarTransport
import kotlin.test.Test
import kotlin.test.assertEquals

class ConnectionStatusTest {

    @Test
    fun disabledEndpointIsDisconnected() {
        assertEquals(
            ConnectionRuntimeStatus.Disconnected,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = false),
                sync = null,
                manuallyDisconnected = false,
            ),
        )
    }

    @Test
    fun manuallyDisconnectedOverridesEnabled() {
        assertEquals(
            ConnectionRuntimeStatus.Disconnected,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = true),
                sync = sync(status = "healthy"),
                manuallyDisconnected = true,
            ),
        )
    }

    @Test
    fun enabledWithBlankUrlIsDisconnectedWhenSyncMissing() {
        assertEquals(
            ConnectionRuntimeStatus.Disconnected,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = true, endpointUrl = ""),
                sync = null,
                manuallyDisconnected = false,
            ),
        )
    }

    @Test
    fun enabledWithUrlIsReconnectingWhenSyncMissing() {
        assertEquals(
            ConnectionRuntimeStatus.Reconnecting,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = true, endpointUrl = "https://example"),
                sync = null,
                manuallyDisconnected = false,
            ),
        )
    }

    @Test
    fun healthySyncMeansConnected() {
        assertEquals(
            ConnectionRuntimeStatus.Connected,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = true),
                sync = sync(status = "healthy"),
                manuallyDisconnected = false,
            ),
        )
    }

    @Test
    fun probingIsReconnecting() {
        for (status in listOf("probing", "checking_server", "idle")) {
            assertEquals(
                ConnectionRuntimeStatus.Reconnecting,
                resolveConnectionStatus(
                    endpoint = endpoint(enabled = true),
                    sync = sync(status = status),
                    manuallyDisconnected = false,
                ),
                message = "status=$status",
            )
        }
    }

    @Test
    fun skipDisabledHintFlipsToReconnecting() {
        assertEquals(
            ConnectionRuntimeStatus.Reconnecting,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = true),
                sync = sync(status = "idle", lastStatus = "skip:endpoint_disconnected"),
                manuallyDisconnected = false,
            ),
        )
    }

    @Test
    fun unknownStatusFallsBackToDisconnected() {
        assertEquals(
            ConnectionRuntimeStatus.Disconnected,
            resolveConnectionStatus(
                endpoint = endpoint(enabled = true),
                sync = sync(status = "degraded"),
                manuallyDisconnected = false,
            ),
        )
    }

    private fun endpoint(
        enabled: Boolean,
        endpointUrl: String = "https://ingest.example",
    ): PulseBarEndpointConfig = PulseBarEndpointConfig(
        id = "default-endpoint",
        name = "Primary",
        enabled = enabled,
        disconnected = false,
        transport = PulseBarTransport.WEBSOCKET,
        transportName = PulseBarTransport.WEBSOCKET.name,
        endpointUrl = endpointUrl,
        workspaceId = "ws",
        siteId = "site",
        apiKey = "k",
        batchWindowSeconds = 15,
    )

    private fun sync(
        status: String,
        lastStatus: String? = null,
    ): PulseBarEndpointSyncState = PulseBarEndpointSyncState(
        id = "default-endpoint",
        name = "Primary",
        enabled = true,
        transportName = PulseBarTransport.WEBSOCKET.name,
        endpointUrl = "https://ingest.example",
        status = status,
        lastStatus = lastStatus,
        pendingCount = 0,
        needsAttention = false,
        lastAttemptAtIso8601 = null,
        lastProbeAtIso8601 = null,
        lastSuccessAtIso8601 = null,
        lastFailureAtIso8601 = null,
        lastErrorMessage = null,
        diagnosticMessage = null,
        acknowledgedSeqMax = 0L,
        acknowledgedAtIso8601 = null,
    )
}
