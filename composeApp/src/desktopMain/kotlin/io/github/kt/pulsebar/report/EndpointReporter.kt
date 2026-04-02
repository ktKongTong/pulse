package io.github.kt.pulsebar.report

import io.github.kt.pulsebar.presence.PRESENCE_PROTOCOL_V2
import io.github.kt.pulsebar.presence.PresenceEvent
import io.github.kt.pulsebar.presence.PresenceIngestRequest
import io.github.kt.pulsebar.shared.ActivityEnvelope
import io.github.kt.pulsebar.shared.EndpointConfig
import io.github.kt.pulsebar.shared.EndpointTransport
import io.github.kt.pulsebar.shared.toPresenceEvent
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.DEFAULT
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logger
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import java.io.Closeable
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.datetime.Instant
import kotlinx.serialization.json.Json

class EndpointReporter : Closeable {
    private val codec = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    private val client = HttpClient(CIO) {
        install(ContentNegotiation) {
            json(codec)
        }
        install(Logging) {
            logger = Logger.DEFAULT
            level = LogLevel.NONE
        }
    }

    private val mutex = Mutex()
    private val sessionId = UUID.randomUUID().toString()
    private var config: EndpointConfig = EndpointConfig()
    private var batchQueue = mutableListOf<QueuedPresenceEvent>()
    private var lastBatchFlushAt: Instant = nowInstant()

    suspend fun updateConfig(newConfig: EndpointConfig) {
        mutex.withLock {
            if (
                config.transport != newConfig.transport ||
                config.url != newConfig.url ||
                config.workspaceId != newConfig.workspaceId
            ) {
                batchQueue = mutableListOf()
            }
            config = newConfig
            if (!newConfig.enabled) {
                batchQueue = mutableListOf()
            }
        }
    }

    suspend fun publish(envelope: ActivityEnvelope): String? = mutex.withLock {
        if (!config.enabled || config.url.isBlank()) {
            return null
        }

        return try {
            when (config.transport) {
                EndpointTransport.HTTP_BATCH -> enqueueBatch(envelope, force = false)
                EndpointTransport.WEBSOCKET,
                EndpointTransport.WEBHOOK -> sendAppend(envelope)
            }
            null
        } catch (error: Exception) {
            "Push failed: ${error.message ?: error::class.simpleName}"
        }
    }

    suspend fun flush(): String? = mutex.withLock {
        if (!config.enabled || config.transport != EndpointTransport.HTTP_BATCH) {
            return null
        }
        return try {
            enqueueBatch(null, force = true)
            null
        } catch (error: Exception) {
            "Batch flush failed: ${error.message ?: error::class.simpleName}"
        }
    }

    private suspend fun sendAppend(envelope: ActivityEnvelope) {
        val deviceId = deviceIdFor(envelope)
        postEvents(
            deviceId = deviceId,
            events = listOf(envelope.toPresenceEvent(deviceId))
        )
    }

    private suspend fun enqueueBatch(envelope: ActivityEnvelope?, force: Boolean) {
        envelope?.let {
            val deviceId = deviceIdFor(it)
            batchQueue += QueuedPresenceEvent(
                deviceId = deviceId,
                event = it.toPresenceEvent(deviceId)
            )
        }
        val now = nowInstant()
        val elapsedMillis = now.toEpochMilliseconds() - lastBatchFlushAt.toEpochMilliseconds()
        val shouldFlush = force || batchQueue.isNotEmpty() && (
            batchQueue.size >= 20 ||
                elapsedMillis >= config.batchWindowSeconds * 1000
        )

        if (!shouldFlush) return

        batchQueue
            .groupBy { it.deviceId }
            .forEach { (deviceId, items) ->
                postEvents(deviceId, items.map { it.event })
            }

        batchQueue = mutableListOf()
        lastBatchFlushAt = now
    }

    private suspend fun postEvents(deviceId: String, events: List<PresenceEvent>) {
        val request = PresenceIngestRequest(
            workspaceId = config.workspaceId.ifBlank { "default" },
            deviceId = deviceId,
            sessionId = sessionId,
            events = events
        )
        client.post(config.url) {
            applyHeaders()
            contentType(ContentType.Application.Json)
            setBody(request)
        }.bodyAsText()
    }

    private fun deviceIdFor(envelope: ActivityEnvelope): String =
        normalizeSlug("${envelope.client.platform}-${envelope.client.deviceName}")

    private fun normalizeSlug(value: String): String =
        value.trim()
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .ifBlank { "unknown-device" }

    private fun io.ktor.client.request.HttpRequestBuilder.applyHeaders() {
        header("X-PulseBar-Protocol", PRESENCE_PROTOCOL_V2)
        if (config.apiKey.isNotBlank()) {
            header("Authorization", "Bearer ${config.apiKey}")
        }
    }

    override fun close() {
        client.close()
    }

    private fun nowInstant(): Instant =
        Instant.fromEpochMilliseconds(System.currentTimeMillis())
}

private data class QueuedPresenceEvent(
    val deviceId: String,
    val event: PresenceEvent
)
