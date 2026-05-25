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
        assertEquals("WEBSOCKET", draft.endpoints[0].transportName)
        assertEquals("ws", draft.endpoints[0].workspaceId)
        assertEquals(300, draft.idleThresholdSeconds)
        assertEquals("CONFIRM", draft.interactionExecutionModeName)
    }

    @Test fun fromDraftRoundTrips() {
        val original = sampleConfig()
        val rebuilt = PulseBarConfigFactory.fromDraft(PulseBarConfigFactory.toDraft(original))
        assertEquals(original.endpoints.size, rebuilt.endpoints.size)
        assertEquals(original.endpoints[0].id, rebuilt.endpoints[0].id)
        assertEquals(original.endpoints[0].transport, rebuilt.endpoints[0].transport)
        assertEquals(original.interactionExecutionMode, rebuilt.interactionExecutionMode)
        assertEquals(original.interactionPlaybackModeName, rebuilt.interactionPlaybackModeName)
    }

    @Test fun transportByName_default() {
        assertEquals(PulseBarTransport.WEBSOCKET, PulseBarConfigFactory.transportByName("anything"))
        assertEquals(PulseBarTransport.WEBHOOK, PulseBarConfigFactory.transportByName("WEBHOOK"))
        assertEquals(PulseBarTransport.HTTP_BATCH, PulseBarConfigFactory.transportByName("HTTP_BATCH"))
    }

    @Test fun streamCandidates_prefersEnabledAndCredentialed() {
        val draft = PulseBarConfigFactory.toDraft(sampleConfig())
        val candidates = PulseBarConfigFactory.streamCandidateEndpoints(draft)
        assertEquals(1, candidates.size)
        assertEquals("e-1", candidates[0].id)
    }

    @Test fun streamCandidates_excludesDisconnectedEndpoints() {
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
                interactionExecutionModeName = it.interactionExecutionModeName,
                interactionPlaybackModeName = it.interactionPlaybackModeName,
            )
        }
        val candidates = PulseBarConfigFactory.streamCandidateEndpoints(draft)
        assertEquals(0, candidates.size)
    }

    @Test fun streamCandidates_allowsEmptyApiKey() {
        val draft = PulseBarConfigFactory.toDraft(sampleConfig()).let {
            PulseBarConfigDraft(
                endpoints = listOf(it.endpoints[0].copy(apiKey = "")),
                idleThresholdSeconds = it.idleThresholdSeconds,
                changeStabilityMillis = it.changeStabilityMillis,
                heartbeatSeconds = it.heartbeatSeconds,
                appPollingMillis = it.appPollingMillis,
                pagePollingMillis = it.pagePollingMillis,
                mediaPollingMillis = it.mediaPollingMillis,
                allowWebInteractions = it.allowWebInteractions,
                interactionExecutionModeName = it.interactionExecutionModeName,
                interactionPlaybackModeName = it.interactionPlaybackModeName,
            )
        }
        val resolved = PulseBarConfigFactory.resolvedStreamEndpoints(draft)
        assertEquals(1, resolved.size)
        assertEquals("", resolved[0].apiKey)
    }

    @Test fun defaultEndpoint_shape() {
        val d = PulseBarConfigFactory.defaultEndpoint(2)
        assertEquals("Endpoint 3", d.name)
        assertEquals(false, d.enabled)
        assertEquals("WEBSOCKET", d.transportName)
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
    transportName: String = this.transportName,
    endpointUrl: String = this.endpointUrl,
    workspaceId: String = this.workspaceId,
    siteId: String = this.siteId,
    apiKey: String = this.apiKey,
    batchWindowSeconds: Int = this.batchWindowSeconds,
) = PulseBarEndpointDraft(id, name, enabled, disconnected, transportName, endpointUrl, workspaceId, siteId, apiKey, batchWindowSeconds)
