package io.github.kt.pulsebar.export

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.content.TextContent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import platform.Foundation.NSUserDefaults
import platform.Foundation.NSUserName

@OptIn(ExperimentalForeignApi::class)
internal class PulseBarEndpointReporter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client = HttpClient(Darwin)
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
    }
    private val workspaceId = "pulse-demo"
    private val sessionId = randomId()
    private val deviceId = slugify("macos-${NSUserName()}")
    private val rawJournal = PulseBarRawJournalStore()
    private val replayMutex = Mutex()
    private val defaults = NSUserDefaults.standardUserDefaults
    private var lastSignature: String? = null
    private var lastPublishedAtMillis: Long? = null
    private var lastMediaState: MediaReporterState? = null

    fun sync(snapshot: PulseBarSnapshot, config: PulseBarConfig) {
        if (!config.endpointEnabled) {
            defaults.setObject("skip:endpoint_disabled", "pulsebar.debug.endpoint.lastStatus")
            defaults.synchronize()
            return
        }
        val endpointUrl = resolvedEndpointUrl(config.endpointUrl)
        if (endpointUrl == null) {
            defaults.setObject("skip:invalid_endpoint_url", "pulsebar.debug.endpoint.lastStatus")
            defaults.synchronize()
            return
        }
        replayPending(endpointUrl, config.apiKey)
        val signature = buildString {
            append(snapshot.bundleId)
            append("::")
            append(snapshot.pageTitle ?: "")
            append("::")
            append(snapshot.media?.trackId ?: snapshot.media?.title ?: "")
            append("::")
            append(snapshot.media?.isPlaying ?: false)
        }
        val nowMillis = nativeCurrentTimeMillis()
        val mediaJump = hasSignificantMediaJump(snapshot, nowMillis)
        val shouldSendSnapshot = lastSignature != signature || mediaJump
        val shouldSendHeartbeat = !shouldSendSnapshot && (
            lastPublishedAtMillis == null ||
                nowMillis - (lastPublishedAtMillis ?: nowMillis) >= config.heartbeatSeconds.toLong() * 1000L
        )

        if (!shouldSendSnapshot && !shouldSendHeartbeat) {
            defaults.setObject("skip:no_change", "pulsebar.debug.endpoint.lastStatus")
            defaults.synchronize()
            return
        }

        val eventKind = if (shouldSendSnapshot) "snapshot" else "heartbeat"
        enqueue(
            endpointUrl = endpointUrl,
            apiKey = config.apiKey,
            entry = buildJournalEntry(endpointUrl, snapshot, eventKind)
        )
        rememberPublishedSnapshot(snapshot, signature, nowMillis)
    }

    fun forceSync(snapshot: PulseBarSnapshot, config: PulseBarConfig) {
        if (!config.endpointEnabled) return
        val endpointUrl = resolvedEndpointUrl(config.endpointUrl) ?: return
        replayPending(endpointUrl, config.apiKey)
        val signature = buildString {
            append(snapshot.bundleId)
            append("::")
            append(snapshot.pageTitle ?: "")
            append("::")
            append(snapshot.media?.trackId ?: snapshot.media?.title ?: "")
            append("::")
            append(snapshot.media?.isPlaying ?: false)
        }
        val nowMillis = nativeCurrentTimeMillis()
        enqueue(
            endpointUrl = endpointUrl,
            apiKey = config.apiKey,
            entry = buildJournalEntry(endpointUrl, snapshot, "snapshot")
        )
        rememberPublishedSnapshot(snapshot, signature, nowMillis)
    }

    fun resetIfDisabled(config: PulseBarConfig) {
        if (!config.endpointEnabled) {
            lastSignature = null
            lastPublishedAtMillis = null
            lastMediaState = null
        }
    }

    private fun rememberPublishedSnapshot(snapshot: PulseBarSnapshot, signature: String, nowMillis: Long) {
        lastSignature = signature
        lastPublishedAtMillis = nowMillis
        lastMediaState = snapshot.media?.let { media ->
            MediaReporterState(
                key = media.trackId ?: media.title ?: "unknown-media",
                progressSeconds = media.progressSeconds,
                isPlaying = media.isPlaying,
                capturedAtMillis = nowMillis
            )
        }
    }

    private fun hasSignificantMediaJump(snapshot: PulseBarSnapshot, nowMillis: Long): Boolean {
        val media = snapshot.media ?: return false
        val previous = lastMediaState ?: return false
        val currentKey = media.trackId ?: media.title ?: "unknown-media"
        if (currentKey != previous.key) return false

        val expectedProgress = if (previous.isPlaying) {
            previous.progressSeconds + ((nowMillis - previous.capturedAtMillis).coerceAtLeast(0L) / 1000.0)
        } else {
            previous.progressSeconds
        }

        return kotlin.math.abs(media.progressSeconds - expectedProgress) >= 2.0
    }

    private fun buildJournalEntry(endpointUrl: String, snapshot: PulseBarSnapshot, eventKind: String): RawJournalEntry {
        val sequence = rawJournal.nextSequence()
        val event = buildJsonObject {
            put("eventId", "$deviceId:$sequence")
            put("seq", sequence)
            put("kind", eventKind)
            put("observedAt", snapshot.observedAtIso8601)
            put("sentAt", nativeIso8601Now())
            putJsonObject("state") {
                putJsonObject("availability") {
                    put("state", "active")
                }
                putJsonObject("focus") {
                    put("state", "foreground")
                    putJsonObject("app") {
                        put("name", snapshot.appName)
                        put("id", snapshot.bundleId)
                    }
                    snapshot.pageTitle?.let { pageTitle ->
                        putJsonObject("page") {
                            put("title", pageTitle)
                        }
                    }
                }
                put("presenceKind", if (snapshot.media?.isPlaying == true) "media" else "interactive")
                putJsonArray("mediaSessions") {
                    snapshot.media?.let { add(it.toPresenceMediaSession()) }
                }
                putJsonObject("device") {
                    put("name", NSUserName())
                    put("platform", "macos")
                    put("mode", "menu-bar")
                    put("userName", NSUserName())
                }
                putJsonObject("capabilities") {
                    put("pageTitle", snapshot.pageTitle != null)
                    put("pageUrl", false)
                    put("media", snapshot.media != null)
                    put("localPlayback", snapshot.media != null)
                    put("remotePlayback", false)
                }
            }
        }
        return RawJournalEntry(
            protocol = "presence.v2",
            endpointKey = endpointUrl,
            workspaceId = workspaceId,
            deviceId = deviceId,
            sessionId = sessionId,
            eventId = event["eventId"]?.jsonPrimitive?.content ?: "$deviceId:$sequence",
            seq = sequence,
            observedAt = snapshot.observedAtIso8601,
            sentAt = event["sentAt"]?.jsonPrimitive?.content ?: nativeIso8601Now(),
            kind = eventKind,
            event = event,
            queuedAtMillis = nativeCurrentTimeMillis()
        )
    }

    private fun PulseBarMedia.toPresenceMediaSession(): JsonObject {
        val providerSlug = providerId.ifBlank { slugify(source) }
        return buildJsonObject {
            putJsonObject("provider") {
                put("id", providerSlug)
                put("kind", if (providerSlug in setOf("spotify", "music", "apple-music", "netease-music", "qq-music", "tencent-music")) "music" else "other")
            }
            putJsonObject("item") {
                put("type", itemType.ifBlank { "track" })
                trackId?.let { put("id", it) }
                (linkUrl ?: trackId)?.let { put("uri", it) }
                put("title", title)
                put("artist", artist)
                album?.let { put("album", it) }
                artworkUrl?.let { put("artworkUrl", it) }
                linkUrl?.let { put("linkUrl", it) }
            }
            putJsonObject("playback") {
                put("state", if (isPlaying) "playing" else "paused")
                put("progressSeconds", JsonPrimitive(progressSeconds))
                put("durationSeconds", durationSeconds)
                put("scope", "local")
            }
            if (
                albumArtist != null ||
                trackNumber != null ||
                discNumber != null ||
                collectionId != null ||
                collectionTitle != null ||
                collectionLinkUrl != null
            ) {
                putJsonObject("extensions") {
                    putJsonObject("values") {
                        putJsonObject("provider") {
                            albumArtist?.let { put("albumArtist", it) }
                            trackNumber?.let { put("trackNumber", it) }
                            discNumber?.let { put("discNumber", it) }
                            collectionId?.let { put("collectionId", it) }
                            collectionTitle?.let { put("collectionTitle", it) }
                            collectionLinkUrl?.let { put("collectionLinkUrl", it) }
                        }
                    }
                }
            }
        }
    }

    private fun resolvedEndpointUrl(raw: String): String? {
        val trimmed = raw.trim()
        return when {
            trimmed.isBlank() -> "http://localhost:8900/api/v2/presence/ingest"
            trimmed.endsWith("/") -> "${trimmed}api/v2/presence/ingest"
            trimmed.endsWith("/api/v2/presence/ingest") -> trimmed
            trimmed.endsWith("/v2/presence/ingest") -> trimmed.replace("/v2/presence/ingest", "/api/v2/presence/ingest")
            !trimmed.contains("/api/v2/") -> "$trimmed/api/v2/presence/ingest"
            else -> trimmed
        }
    }

    private fun enqueue(endpointUrl: String, apiKey: String, entry: RawJournalEntry) {
        rawJournal.append(entry)
        replayPending(endpointUrl, apiKey)
    }

    private fun replayPending(endpointUrl: String, apiKey: String) {
        scope.launch {
            if (!replayMutex.tryLock()) return@launch
            try {
                rawJournal.prune(nativeCurrentTimeMillis())
                while (true) {
                    val batch = rawJournal.nextReplayBatch(endpointUrl, nativeCurrentTimeMillis())
                    if (batch.isEmpty()) break
                    val body = buildReplayBody(batch)
                    val bodyText = json.encodeToString(JsonObject.serializer(), body)
                    val ackSeq = runCatching {
                        val response = client.post {
                            url(endpointUrl)
                            contentType(ContentType.Application.Json)
                            header("X-PulseBar-Protocol", "presence.v2")
                            if (apiKey.isNotBlank()) {
                                header("Authorization", "Bearer $apiKey")
                            }
                            setBody(TextContent(bodyText, ContentType.Application.Json))
                        }
                        val responseText = response.bodyAsText()
                        json.parseToJsonElement(responseText)
                            .jsonObject["acceptedSeqMax"]
                            ?.jsonPrimitive
                            ?.content
                            ?.toLongOrNull()
                    }.getOrElse { error ->
                        defaults.setObject(
                            "error:${error::class.simpleName}:${error.message ?: "unknown"}",
                            "pulsebar.debug.endpoint.lastStatus"
                        )
                        defaults.setObject(bodyText, "pulsebar.debug.endpoint.lastBody")
                        defaults.synchronize()
                        null
                    }
                    if (ackSeq == null) break
                    val checkpoint = rawJournal.acknowledge(
                        endpointKey = endpointUrl,
                        acknowledgedSeqMax = ackSeq,
                        acknowledgedAtIso8601 = nativeIso8601Now()
                    )
                    defaults.setObject(
                        "ok:${checkpoint.acknowledgedSeqMax}:${nativeIso8601Now()}",
                        "pulsebar.debug.endpoint.lastStatus"
                    )
                    defaults.synchronize()
                }
            } finally {
                replayMutex.unlock()
            }
        }
    }

    private fun buildReplayBody(entries: List<RawJournalEntry>): JsonObject {
        val first = entries.first()
        return buildJsonObject {
            put("protocol", "presence.v2")
            put("workspaceId", first.workspaceId)
            put("deviceId", first.deviceId)
            put("sessionId", first.sessionId)
            putJsonArray("events") {
                entries.forEach { add(it.event) }
            }
        }
    }
}
