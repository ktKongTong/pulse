package io.github.kt.pulsebar.export

/**
 * Primitive-typed view of [PulseBarConfig] + [PulseBarEndpointConfig] that
 * Swift edits directly. Building the Kotlin-side [PulseBarConfig] from a
 * draft and projecting a draft from a fresh config both live in Kotlin so
 * the platform shell doesn't have to implement its own mapping or know
 * about the enum name conventions.
 *
 * This is the type Swift's Settings UI (or any future desktop shell)
 * binds to. All fields are value-types the Swift export can round-trip
 * without externalRCRef reflection.
 */
class PulseBarEndpointDraft(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val disconnected: Boolean,
    val transportName: String,
    val endpointUrl: String,
    val workspaceId: String,
    val siteId: String,
    val apiKey: String,
    val batchWindowSeconds: Int,
)

class PulseBarConfigDraft(
    val endpoints: List<PulseBarEndpointDraft>,
    val idleThresholdSeconds: Int,
    val changeStabilityMillis: Int,
    val heartbeatSeconds: Int,
    val appPollingMillis: Int,
    val pagePollingMillis: Int,
    val mediaPollingMillis: Int,
    val allowWebInteractions: Boolean,
    val interactionExecutionModeName: String,
    val interactionPlaybackModeName: String,
)

/**
 * Builders / projectors used by the platform shell. Keeping these on the
 * Kotlin side means Swift doesn't need its own enum-name switches and
 * can't silently diverge from the schema.
 */
object PulseBarConfigFactory {

    fun toDraft(config: PulseBarConfig): PulseBarConfigDraft = PulseBarConfigDraft(
        endpoints = config.endpoints.map { endpoint ->
            PulseBarEndpointDraft(
                id = endpoint.id,
                name = endpoint.name,
                enabled = endpoint.enabled,
                disconnected = endpoint.disconnected,
                transportName = endpoint.transportName,
                endpointUrl = endpoint.endpointUrl,
                workspaceId = endpoint.workspaceId,
                siteId = endpoint.siteId,
                apiKey = endpoint.apiKey,
                batchWindowSeconds = endpoint.batchWindowSeconds,
            )
        },
        idleThresholdSeconds = config.idleThresholdSeconds,
        changeStabilityMillis = config.changeStabilityMillis,
        heartbeatSeconds = config.heartbeatSeconds,
        appPollingMillis = config.appPollingMillis,
        pagePollingMillis = config.pagePollingMillis,
        mediaPollingMillis = config.mediaPollingMillis,
        allowWebInteractions = config.allowWebInteractions,
        interactionExecutionModeName = config.interactionExecutionModeName,
        interactionPlaybackModeName = config.interactionPlaybackModeName,
    )

    fun fromDraft(draft: PulseBarConfigDraft): PulseBarConfig = PulseBarConfig(
        endpoints = draft.endpoints.map { endpoint ->
            PulseBarEndpointConfig(
                id = endpoint.id,
                name = endpoint.name,
                enabled = endpoint.enabled,
                disconnected = endpoint.disconnected,
                transport = transportByName(endpoint.transportName),
                transportName = endpoint.transportName,
                endpointUrl = endpoint.endpointUrl,
                workspaceId = endpoint.workspaceId,
                siteId = endpoint.siteId,
                apiKey = endpoint.apiKey,
                batchWindowSeconds = endpoint.batchWindowSeconds,
            )
        },
        idleThresholdSeconds = draft.idleThresholdSeconds,
        changeStabilityMillis = draft.changeStabilityMillis,
        heartbeatSeconds = draft.heartbeatSeconds,
        appPollingMillis = draft.appPollingMillis,
        pagePollingMillis = draft.pagePollingMillis,
        mediaPollingMillis = draft.mediaPollingMillis,
        allowWebInteractions = draft.allowWebInteractions,
        interactionExecutionMode = interactionExecutionModeByName(draft.interactionExecutionModeName),
        interactionExecutionModeName = draft.interactionExecutionModeName,
        interactionPlaybackMode = interactionPlaybackModeByName(draft.interactionPlaybackModeName),
        interactionPlaybackModeName = draft.interactionPlaybackModeName,
    )

    /** Used by the Live Listen presentation code — "connectable" endpoints are those that have creds + URL. */
    fun liveListenCandidateEndpoints(draft: PulseBarConfigDraft): List<PulseBarEndpointDraft> {
        val enabled = draft.endpoints.filter { it.enabled && !it.disconnected && hasLiveListenCredentials(it) }
        if (enabled.isNotEmpty()) return enabled
        // Fall back to any endpoint with credentials (disabled/disconnected still wired for debug panes).
        return draft.endpoints.filter { hasLiveListenCredentials(it) }
    }

    private fun hasLiveListenCredentials(endpoint: PulseBarEndpointDraft): Boolean =
        endpoint.workspaceId.trim().isNotEmpty() && endpoint.apiKey.isNotEmpty() && endpoint.endpointUrl.trim().isNotEmpty()

    fun transportByName(raw: String): PulseBarTransport = when (raw) {
        "WEBHOOK" -> PulseBarTransport.WEBHOOK
        "HTTP_BATCH" -> PulseBarTransport.HTTP_BATCH
        else -> PulseBarTransport.WEBSOCKET
    }

    fun interactionExecutionModeByName(raw: String): PulseBarInteractionExecutionMode = when (raw) {
        "AUTO_ENQUEUE" -> PulseBarInteractionExecutionMode.AUTO_ENQUEUE
        else -> PulseBarInteractionExecutionMode.CONFIRM
    }

    fun interactionPlaybackModeByName(raw: String): PulseBarInteractionPlaybackMode = when (raw) {
        "PLAY_NOW" -> PulseBarInteractionPlaybackMode.PLAY_NOW
        else -> PulseBarInteractionPlaybackMode.PLAY_NEXT
    }

    /** Shared defaults for a fresh endpoint row. */
    fun defaultEndpoint(index: Int, randomId: String): PulseBarEndpointDraft = PulseBarEndpointDraft(
        id = randomId,
        name = "Endpoint ${index + 1}",
        enabled = false,
        disconnected = false,
        transportName = PulseBarTransport.WEBSOCKET.name,
        endpointUrl = "",
        workspaceId = "",
        siteId = "",
        apiKey = "",
        batchWindowSeconds = 15,
    )

    fun defaultPrimaryEndpoint(randomId: String): PulseBarEndpointDraft =
        defaultEndpoint(index = 0, randomId = randomId).let {
            PulseBarEndpointDraft(
                id = it.id,
                name = "Primary endpoint",
                enabled = it.enabled,
                disconnected = it.disconnected,
                transportName = it.transportName,
                endpointUrl = it.endpointUrl,
                workspaceId = it.workspaceId,
                siteId = it.siteId,
                apiKey = it.apiKey,
                batchWindowSeconds = it.batchWindowSeconds,
            )
        }
}
