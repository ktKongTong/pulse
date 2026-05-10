package io.github.kt.pulsebar.export

/**
 * Primitive-typed view of [PulseBarConfig] + [PulseBarEndpointConfig] that
 * Swift edits directly. Building the Kotlin-side [PulseBarConfig] from a
 * draft and projecting a draft from a fresh config both live in Kotlin so
 * the platform shell doesn't have to implement its own mapping or know
 * about the enum name conventions.
 *
 * This is the type Swift's Settings UI (or any future desktop shell)
 * binds to. Fields are `var` so SwiftUI can mutate them through
 * `ReferenceWritableKeyPath` bindings without a Swift-side mirror struct.
 */
class PulseBarEndpointDraft(
    var id: String,
    var name: String,
    var enabled: Boolean,
    var disconnected: Boolean,
    var transportName: String,
    var endpointUrl: String,
    var workspaceId: String,
    var siteId: String,
    var apiKey: String,
    var batchWindowSeconds: Int,
)

class PulseBarConfigDraft(
    var endpoints: List<PulseBarEndpointDraft>,
    var idleThresholdSeconds: Int,
    var changeStabilityMillis: Int,
    var heartbeatSeconds: Int,
    var appPollingMillis: Int,
    var pagePollingMillis: Int,
    var mediaPollingMillis: Int,
    var allowWebInteractions: Boolean,
    var interactionExecutionModeName: String,
    var interactionPlaybackModeName: String,
)

/**
 * Live Listen endpoint pre-resolved for the platform shell — all string
 * trimming + URL normalization done on the Kotlin side. Swift only wraps
 * [baseUrl] in a `URL`.
 */
class LiveListenEndpointResolved(
    val id: String,
    val name: String,
    val baseUrl: String,
    /** The name to show in UI (falls back to host or the full URL). */
    val displayName: String,
    val workspaceId: String,
    val apiKey: String,
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

    /**
     * Live Listen endpoints resolved into what Swift actually needs:
     * normalized `baseUrl` (shared `normalizePulseBaseUrl` output), trimmed
     * `name` / `workspaceId`, the raw `apiKey`. Swift wraps `baseUrl` in
     * `URL(string:)` — no more trimming / normalizing on the Swift side.
     *
     * Returns an empty list when none of the candidates have a valid URL.
     */
    fun resolvedLiveListenEndpoints(draft: PulseBarConfigDraft): List<LiveListenEndpointResolved> =
        liveListenCandidateEndpoints(draft).mapNotNull { candidate ->
            val workspaceId = candidate.workspaceId.trim()
            val apiKey = candidate.apiKey
            if (workspaceId.isEmpty() || apiKey.isEmpty()) return@mapNotNull null
            val baseUrl = io.github.kt.pulsebar.core.platform.normalizePulseBaseUrl(candidate.endpointUrl)
                ?: return@mapNotNull null
            LiveListenEndpointResolved(
                id = candidate.id,
                name = candidate.name.trim(),
                baseUrl = baseUrl,
                displayName = candidate.name.trim().ifEmpty { extractHostOrUrl(baseUrl) },
                workspaceId = workspaceId,
                apiKey = apiKey,
            )
        }

    /** Pull the `host` portion out of `scheme://host[:port]/...`, or the
     *  whole string if there's no `://`. Swift used `URL.host ?? absoluteString`
     *  for the same effect. */
    private fun extractHostOrUrl(baseUrl: String): String {
        val schemeEnd = baseUrl.indexOf("://")
        if (schemeEnd < 0) return baseUrl
        val afterScheme = baseUrl.substring(schemeEnd + 3)
        val endIndex = afterScheme.indexOfAny(charArrayOf('/', '?', '#'))
        val hostPort = if (endIndex < 0) afterScheme else afterScheme.substring(0, endIndex)
        val colonIndex = hostPort.indexOf(':')
        return if (colonIndex < 0) hostPort.ifEmpty { baseUrl } else hostPort.substring(0, colonIndex).ifEmpty { baseUrl }
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
    fun defaultEndpoint(index: Int): PulseBarEndpointDraft = PulseBarEndpointDraft(
        id = io.github.kt.pulsebar.core.platform.newPulseUuid(),
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

    fun defaultPrimaryEndpoint(): PulseBarEndpointDraft =
        defaultEndpoint(index = 0).let {
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
