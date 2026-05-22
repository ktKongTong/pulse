package io.github.kt.pulsebar.export

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import platform.Foundation.NSAppleScript
import platform.Foundation.NSUserName

private data class PendingInteraction(
    val requestId: String,
    val provider: String,
    val uri: String,
    val title: String?,
    val issuedAtIso8601: String,
    val updatedAtIso8601: String,
    val targetDeviceId: String?,
    val expiresAtMillis: Long
)

private data class LocalQueueItem(
    val requestId: String,
    val provider: String,
    val uri: String,
    val title: String?,
    val issuedAtIso8601: String,
    val updatedAtIso8601: String,
    val targetDeviceId: String?,
    val waitForTrackId: String?,
    val waitForProviderId: String?
)

@OptIn(ExperimentalForeignApi::class)
internal class PulseBarInteractionClient(
    initialConfig: PulseBarConfig,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client = HttpClient(Darwin) {
        install(WebSockets)
    }
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val deviceId = slugify("macos-${NSUserName()}")
    private var config: PulseBarConfig = initialConfig
    private var connectionJob: Job? = null
    private var activeSocket: io.ktor.client.plugins.websocket.DefaultClientWebSocketSession? = null
    private var pending = linkedMapOf<String, PendingInteraction>()
    private var localQueue = ArrayDeque<LocalQueueItem>()
    private var lastStatus: String? = null
    private var latestMedia: PulseBarMedia? = null

    fun updateConfig(newConfig: PulseBarConfig) {
        val previousEndpoint = config.primaryInteractionEndpoint()?.interactionFingerprint()
        val nextEndpoint = newConfig.primaryInteractionEndpoint()?.interactionFingerprint()
        config = newConfig
        if (!newConfig.allowWebInteractions || nextEndpoint == null) {
            connectionJob?.cancel()
            connectionJob = null
            activeSocket = null
            return
        }
        if (previousEndpoint != nextEndpoint) {
            connectionJob?.cancel()
            connectionJob = null
            activeSocket = null
        }
        if (connectionJob?.isActive == true) return
        connectionJob = scope.launch {
            while (isActive) {
                val endpoint = config.primaryInteractionEndpoint()?.let { resolvedInteractionWsUrl(it) }
                if (endpoint == null || !config.allowWebInteractions) {
                    delay(2000)
                    continue
                }
                runCatching {
                    client.webSocket(endpoint) {
                        activeSocket = this
                        send(Frame.Text(buildHello()))
                        for (frame in incoming) {
                            if (frame is Frame.Text) {
                                handleServerMessage(frame.readText())
                            }
                        }
                    }
                }.onFailure { error ->
                    lastStatus = "interaction_error:${error::class.simpleName}:${error.message ?: "unknown"}"
                }
                activeSocket = null
                delay(1500)
            }
        }
    }

    fun readState(): PulseBarInteractionState =
        PulseBarInteractionState(
            pendingCount = pending.size + localQueue.size,
            items = pending.values.map {
                PulseBarInteractionItem(
                    requestId = it.requestId,
                    status = "awaiting_confirmation",
                    provider = it.provider,
                    uri = it.uri,
                    title = it.title,
                    issuedAtIso8601 = it.issuedAtIso8601,
                    updatedAtIso8601 = it.updatedAtIso8601,
                    targetDeviceId = it.targetDeviceId,
                    errorCode = null,
                    errorMessage = null
                )
            } + localQueue.map {
                PulseBarInteractionItem(
                    requestId = it.requestId,
                    status = "queued_locally",
                    provider = it.provider,
                    uri = it.uri,
                    title = it.title,
                    issuedAtIso8601 = it.issuedAtIso8601,
                    updatedAtIso8601 = it.updatedAtIso8601,
                    targetDeviceId = it.targetDeviceId,
                    errorCode = null,
                    errorMessage = null
                )
            },
            lastStatus = lastStatus
        )

    fun accept(requestId: String): Boolean {
        val item = pending.remove(requestId) ?: return false
        scope.launch {
            val result = queueOrPlayLocally(
                requestId = item.requestId,
                provider = item.provider,
                uri = item.uri,
                title = item.title,
                issuedAtIso8601 = item.issuedAtIso8601,
                updatedAtIso8601 = nativeIso8601Now(),
                targetDeviceId = item.targetDeviceId,
                currentMedia = latestMedia
            )
            sendResult(
                requestId = requestId,
                status = result.status,
                errorCode = result.errorCode,
                errorMessage = result.errorMessage
            )
        }
        lastStatus = "interaction_accept:$requestId"
        return true
    }

    fun dismiss(requestId: String): Boolean {
        val item = pending.remove(requestId) ?: return false
        scope.launch {
            sendResult(
                requestId = requestId,
                status = "rejected",
                errorCode = "user_declined",
                errorMessage = "User declined the recommendation."
            )
        }
        lastStatus = "interaction_dismiss:${item.requestId}"
        return true
    }

    fun reconcilePlayback(currentMedia: PulseBarMedia?) {
        latestMedia = currentMedia
        if (localQueue.isEmpty()) return
        val next = localQueue.firstOrNull() ?: return
        if (currentMedia?.isPlaying == true) {
            if (currentMedia.providerId != next.provider) {
                return
            }
            if (next.waitForTrackId != null && currentMedia.trackId == next.waitForTrackId) {
                return
            }
        }
        scope.launch {
            val result = playUsingSystemApis(next.provider, next.uri)
            if (result.status == "succeeded") {
                localQueue.removeFirstOrNull()
                lastStatus = "interaction_local_queue_played:${next.uri}"
            } else {
                lastStatus = "interaction_local_queue_failed:${result.errorCode ?: "unknown"}"
            }
        }
    }

    private suspend fun handleServerMessage(text: String) {
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        when (root["type"]?.jsonPrimitive?.content) {
            "hello_ack" -> {
                lastStatus = "interaction_ready"
            }
            "command.request" -> {
                val request = root["request"]?.jsonObject ?: return
                val requestId = request["requestId"]?.jsonPrimitive?.content ?: return
                val command = request["command"]?.jsonObject ?: return
                val provider = command["provider"]?.jsonPrimitive?.content ?: return
                val uri = command["uri"]?.jsonPrimitive?.content ?: return
                val issuedAt = request["issuedAt"]?.jsonPrimitive?.content ?: nativeIso8601Now()
                val updatedAt = request["updatedAt"]?.jsonPrimitive?.content ?: nativeIso8601Now()
                val targetDeviceId = request["targetDeviceId"]?.jsonPrimitive?.content
                val title = command["title"]?.jsonPrimitive?.content
                val expiresInSeconds = request["constraints"]?.jsonObject?.get("expiresInSeconds")?.jsonPrimitive?.content?.toLongOrNull() ?: 30L

                if (!config.allowWebInteractions) {
                    sendAck(requestId, accepted = false, status = "rejected")
                    sendResult(requestId, "rejected", "interactions_disabled", "Web interactions are disabled on this device.")
                    return
                }
                if (provider == "spotify") {
                    sendAck(requestId, accepted = false, status = "rejected")
                    sendResult(requestId, "rejected", "unsupported_provider", "Spotify recommendations are disabled because system playback steals focus.")
                    return
                }
                if (provider != "apple-music") {
                    sendAck(requestId, accepted = false, status = "rejected")
                    sendResult(requestId, "rejected", "unsupported_provider", "Only Apple Music recommendations are supported in the current system-API mode.")
                    return
                }

                if (config.interactionExecutionMode == PulseBarInteractionExecutionMode.AUTO_ENQUEUE) {
                    sendAck(requestId, accepted = true, status = "executing")
                    val result = queueOrPlayLocally(
                        requestId = requestId,
                        provider = provider,
                        uri = uri,
                        title = title,
                        issuedAtIso8601 = issuedAt,
                        updatedAtIso8601 = updatedAt,
                        targetDeviceId = targetDeviceId,
                        currentMedia = latestMedia
                    )
                    sendResult(
                        requestId = requestId,
                        status = result.status,
                        errorCode = result.errorCode,
                        errorMessage = result.errorMessage
                    )
                    return
                }

                pending[requestId] = PendingInteraction(
                    requestId = requestId,
                    provider = provider,
                    uri = uri,
                    title = title,
                    issuedAtIso8601 = issuedAt,
                    updatedAtIso8601 = updatedAt,
                    targetDeviceId = targetDeviceId,
                    expiresAtMillis = nativeCurrentTimeMillis() + expiresInSeconds * 1000L
                )
                lastStatus = "interaction_pending:$requestId"
                sendAck(requestId, accepted = true, status = "awaiting_confirmation")
            }
        }
    }

    private suspend fun sendAck(requestId: String, accepted: Boolean, status: String) {
        activeSocket?.send(
            Frame.Text(
                buildJsonObject {
                    put("protocol", "interaction.ws.v1")
                    put("type", "command.ack")
                    put("requestId", requestId)
                    put("deviceId", deviceId)
                    put("accepted", accepted)
                    put("status", status)
                }.toString()
            )
        )
    }

    private suspend fun sendResult(
        requestId: String,
        status: String,
        errorCode: String? = null,
        errorMessage: String? = null
    ) {
        activeSocket?.send(
            Frame.Text(
                buildJsonObject {
                    put("protocol", "interaction.ws.v1")
                    put("type", "command.result")
                    put("requestId", requestId)
                    put("deviceId", deviceId)
                    put("status", status)
                    if (errorCode != null || errorMessage != null) {
                        putJsonObject("error") {
                            errorCode?.let { put("code", it) }
                            errorMessage?.let { put("message", it) }
                        }
                    }
                }.toString()
            )
        )
    }

    private fun buildHello(): String =
        buildJsonObject {
            put("protocol", "interaction.ws.v1")
            put("type", "hello")
            put("workspaceId", config.primaryInteractionEndpoint()?.workspaceId.orEmpty())
            put("deviceId", deviceId)
            putJsonArray("supportedProtocols") {
                add(JsonPrimitive("interaction.ws.v1"))
            }
            putJsonObject("capabilities") {
                put("mediaRecommendTrack", true)
                put("providersSpotify", false)
                put("providersAppleMusic", true)
                put("autoEnqueue", config.interactionExecutionMode == PulseBarInteractionExecutionMode.AUTO_ENQUEUE)
            }
        }.toString()

    private fun resolvedInteractionWsUrl(endpoint: PulseBarEndpointConfig): String? {
        val base = resolvedEndpointBase(endpoint.endpointUrl) ?: return null
        val scheme = if (base.startsWith("https://")) "wss://" else "ws://"
        val hostAndPath = base.removePrefix("https://").removePrefix("http://")
        val host = hostAndPath.substringBefore("/")
        return "${scheme}${host}/api/v1/device-interactions/ws?workspaceId=${endpoint.workspaceId}&deviceId=$deviceId"
    }

    private fun PulseBarConfig.primaryInteractionEndpoint(): PulseBarEndpointConfig? =
        endpoints.firstOrNull { endpoint ->
            endpoint.enabled &&
                !endpoint.isRealtimeV2DeviceEndpoint() &&
                endpoint.workspaceId.isNotBlank() &&
                resolvedInteractionWsUrl(endpoint) != null
        }

    private fun PulseBarEndpointConfig.interactionFingerprint(): String =
        "${endpointUrl}::${workspaceId}::${apiKey}"

    private fun PulseBarEndpointConfig.isRealtimeV2DeviceEndpoint(): Boolean =
        endpointUrl.isLocalRealtimeV2WorkerUrl()

    private fun String.isLocalRealtimeV2WorkerUrl(): Boolean {
        val base = resolvedEndpointBase(this) ?: trim()
        val hostAndPath = base.removePrefix("https://").removePrefix("http://")
        val host = hostAndPath.substringBefore("/").lowercase()
        return host == "localhost:8787" || host == "127.0.0.1:8787" || host == "[::1]:8787"
    }

    private suspend fun queueOrPlayLocally(
        requestId: String,
        provider: String,
        uri: String,
        title: String?,
        issuedAtIso8601: String,
        updatedAtIso8601: String,
        targetDeviceId: String?,
        currentMedia: PulseBarMedia?
    ): QueueActionResult =
        when (provider) {
            "apple-music" -> {
                if (!isApplicationInstalled("com.apple.Music")) {
                    lastStatus = "interaction_enqueue_missing_music"
                    QueueActionResult(
                        status = "rejected",
                        errorCode = "unsupported_provider",
                        errorMessage = "Apple Music is not installed on this device."
                    )
                } else {
                    when (config.interactionPlaybackMode) {
                        PulseBarInteractionPlaybackMode.PLAY_NOW -> {
                            val result = playUsingSystemApis(provider, uri)
                            if (result.status == "succeeded") {
                                lastStatus = "interaction_play_now_succeeded"
                            }
                            result
                        }
                        PulseBarInteractionPlaybackMode.PLAY_NEXT -> {
                            if (currentMedia?.providerId == provider && currentMedia.isPlaying) {
                                localQueue.addLast(
                                    LocalQueueItem(
                                        requestId = requestId,
                                        provider = provider,
                                        uri = uri,
                                        title = title,
                                        issuedAtIso8601 = issuedAtIso8601,
                                        updatedAtIso8601 = updatedAtIso8601,
                                        targetDeviceId = targetDeviceId,
                                        waitForTrackId = currentMedia.trackId,
                                        waitForProviderId = currentMedia.providerId
                                    )
                                )
                                lastStatus = "interaction_local_queue_enqueued"
                                QueueActionResult(status = "succeeded")
                            } else {
                                val result = playUsingSystemApis(provider, uri)
                                if (result.status == "succeeded") {
                                    lastStatus = "interaction_play_next_immediate"
                                }
                                result
                            }
                        }
                    }
                }
            }
            else -> QueueActionResult(
                status = "rejected",
                errorCode = "unsupported_provider",
                errorMessage = "Provider '$provider' is not supported for local queueing in v1."
            )
        }

    private suspend fun playUsingSystemApis(provider: String, uri: String): QueueActionResult =
        when (provider) {
            "apple-music" -> playAppleMusicUsingSystemApi(uri)
            else -> QueueActionResult(
                status = "rejected",
                errorCode = "unsupported_provider",
                errorMessage = "Provider '$provider' is not supported for direct playback in v1."
            )
        }

    private suspend fun playAppleMusicUsingSystemApi(reference: String): QueueActionResult {
        if (!isApplicationInstalled("com.apple.Music")) {
            lastStatus = "interaction_play_missing_music"
            return QueueActionResult(
                status = "rejected",
                errorCode = "unsupported_provider",
                errorMessage = "Apple Music is not installed on this device."
            )
        }
        val result = runAppleScriptLocal(
            """
            tell application id "com.apple.Music"
                set requestedReference to "$reference"
                set matchedTrack to missing value
                if requestedReference is not "" and requestedReference is not "apple-music:search" then
                    try
                        set matchedTrack to (first track of library playlist 1 whose persistent ID is requestedReference)
                    end try
                    if matchedTrack is missing value then
                        try
                            set matchedTrack to (first track of library playlist 1 whose database ID as text is requestedReference)
                        end try
                    end if
                end if
                if matchedTrack is missing value then
                    set matchedTrack to (first track of library playlist 1 whose name is requestedReference)
                end if
                play matchedTrack
                return "ok"
            end tell
            """.trimIndent()
        )
        return if (result == "ok") {
            lastStatus = "interaction_play_succeeded"
            QueueActionResult(status = "succeeded")
        } else {
            lastStatus = "interaction_play_failed"
            QueueActionResult(
                status = "failed",
                errorCode = "playback_failed",
                errorMessage = "Apple Music could not start playback for the recommended track."
            )
        }
    }

    private fun isApplicationInstalled(bundleId: String): Boolean =
        runAppleScriptLocal(
            """
            tell application id "$bundleId"
                return "ok"
            end tell
            """.trimIndent()
        ) == "ok"

    private fun runAppleScriptLocal(script: String): String? {
        val appleScript = NSAppleScript(source = script)
        val result = appleScript.executeAndReturnError(null)
        return result.stringValue?.trim()
    }
}
