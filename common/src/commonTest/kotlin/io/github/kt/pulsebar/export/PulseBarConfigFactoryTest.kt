package io.github.kt.pulsebar.export

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PulseBarConfigFactoryTest {

    private fun sampleConfig() = PulseBarConfig(
        endpoints = listOf(
            PulseBarEndpointConfig(
                id = "e-1",
                name = "Primary",
                enabled = true,
                disconnected = false,
                transport = PulseBarTransport.WEBSOCKET,
                transportName = "WEBSOCKET",
                endpointUrl = "https://pulse.example.com",
                workspaceId = "ws",
                siteId = "site",
                apiKey = "key",
                batchWindowSeconds = 15,
            ),
            PulseBarEndpointConfig(
                id = "e-2",
                name = "Secondary",
                enabled = false,
                disconnected = true,
                transport = PulseBarTransport.WEBHOOK,
                transportName = "WEBHOOK",
                endpointUrl = "",
                workspaceId = "",
                siteId = "",
                apiKey = "",
                batchWindowSeconds = 10,
            ),
        ),
        idleThresholdSeconds = 300,
        changeStabilityMillis = 1200,
        heartbeatSeconds = 60,
        appPollingMillis = 500,
        pagePollingMillis = 2000,
        mediaPollingMillis = 500,
        allowWebInteractions = true,
        interactionExecutionMode = PulseBarInteractionExecutionMode.CONFIRM,
        interactionExecutionModeName = "CONFIRM",
        interactionPlaybackMode = PulseBarInteractionPlaybackMode.PLAY_NEXT,
        interactionPlaybackModeName = "PLAY_NEXT",
    )

    @Test fun toDraftPreservesFields() {
        val draft = PulseBarConfigFactory.toDraft(sampleConfig())
        assertEquals(2, draft.endpoints.size)
        assertEquals("e-1", draft.endpoints[0].id)
        assertEquals(PulseBarTransport.WEBSOCKET, draft.endpoints[0].transport)
        assertEquals("ws", draft.endpoints[0].workspaceId)
        assertEquals(300, draft.idleThresholdSeconds)
        assertEquals(PulseBarInteractionExecutionMode.CONFIRM, draft.interactionExecutionMode)
    }

    @Test fun fromDraftRoundTrips() {
        val original = sampleConfig()
        val rebuilt = PulseBarConfigFactory.fromDraft(PulseBarConfigFactory.toDraft(original))
        assertEquals(original.endpoints.size, rebuilt.endpoints.size)
        assertEquals(original.endpoints[0].id, rebuilt.endpoints[0].id)
        assertEquals(original.endpoints[0].transport, rebuilt.endpoints[0].transport)
        assertEquals(original.interactionExecutionMode, rebuilt.interactionExecutionMode)
        assertEquals(original.interactionPlaybackMode, rebuilt.interactionPlaybackMode)
    }

    @Test fun liveListenCandidates_prefersEnabledAndCredentialed() {
        val draft = PulseBarConfigFactory.toDraft(sampleConfig())
        val candidates = PulseBarConfigFactory.liveListenCandidateEndpoints(draft)
        assertEquals(1, candidates.size)
        assertEquals("e-1", candidates[0].id)
    }

    @Test fun liveListenCandidates_fallsBackToAnyWithCreds() {
        val draft = PulseBarConfigFactory.toDraft(sampleConfig()).let {
            PulseBarConfigDraft(
                endpoints = listOf(it.endpoints[0].copy(enabled = false, disconnected = true)),
                idleThresholdSeconds = it.idleThresholdSeconds,
                changeStabilityMillis = it.changeStabilityMillis,
                heartbeatSeconds = it.heartbeatSeconds,
                appPollingMillis = it.appPollingMillis,
                pagePollingMillis = it.pagePollingMillis,
                mediaPollingMillis = it.mediaPollingMillis,
                allowWebInteractions = it.allowWebInteractions,
                interactionExecutionMode = it.interactionExecutionMode,
                interactionPlaybackMode = it.interactionPlaybackMode,
            )
        }
        val candidates = PulseBarConfigFactory.liveListenCandidateEndpoints(draft)
        assertEquals(1, candidates.size)
        assertTrue(!candidates[0].enabled)
    }

    @Test fun defaultEndpoint_shape() {
        val d = PulseBarConfigFactory.defaultEndpoint(2)
        assertEquals("Endpoint 3", d.name)
        assertEquals(false, d.enabled)
        assertEquals(PulseBarTransport.WEBSOCKET, d.transport)
        assertEquals(15, d.batchWindowSeconds)
        // id is a platform-generated UUID — just check it's non-empty.
        assertTrue(d.id.isNotEmpty())
    }
}

// Convenience copy for data-class-like draft mutation in tests
private fun PulseBarEndpointDraft.copy(
    id: String = this.id,
    name: String = this.name,
    enabled: Boolean = this.enabled,
    disconnected: Boolean = this.disconnected,
    transport: PulseBarTransport = this.transport,
    endpointUrl: String = this.endpointUrl,
    workspaceId: String = this.workspaceId,
    siteId: String = this.siteId,
    apiKey: String = this.apiKey,
    batchWindowSeconds: Int = this.batchWindowSeconds,
) = PulseBarEndpointDraft(id, name, enabled, disconnected, transport, endpointUrl, workspaceId, siteId, apiKey, batchWindowSeconds)
