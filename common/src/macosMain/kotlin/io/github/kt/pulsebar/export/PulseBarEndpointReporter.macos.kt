package io.github.kt.pulsebar.export

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.ktor.http.contentType
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
    private val client = HttpClient(Darwin) {
        install(HttpTimeout) {
            requestTimeoutMillis = 5_000
        }
    }
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
    }
    private val workspaceId = "pulse-demo"
    private val healthyProbeIntervalMillis = 30_000L
    private val unhealthyProbeIntervalMillis = 5_000L
    private val sessionId = randomId()
    private val deviceId = slugify("macos-${NSUserName()}")
    private val rawJournal = PulseBarRawJournalStore()
    private val defaults = NSUserDefaults.standardUserDefaults
    private val replayMutexes = mutableMapOf<String, Mutex>()
    private val probeMutexes = mutableMapOf<String, Mutex>()
    private val lastProbeIssuedAtMillis = mutableMapOf<String, Long>()
    private val lastReplayIssuedAtMillis = mutableMapOf<String, Long>()
    private val syncStates = mutableMapOf<String, EndpointSyncSnapshot>()
    private var lastSignature: String? = null
    private var lastPublishedAtMillis: Long? = null
    private var lastMediaState: MediaReporterState? = null
    private var lastEndpointFingerprints: Set<String> = emptySet()

    fun migrateStorageIfNeeded() {
        rawJournal.migrateToRoomIfNeeded()
    }

    fun sync(snapshot: PulseBarSnapshot, config: PulseBarConfig) {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpoints = config.enabledReporterEndpoints()
        if (enabledEndpoints.isEmpty()) {
            defaults.setObject("skip:endpoint_disabled", "pulsebar.debug.endpoint.lastStatus")
            defaults.synchronize()
            lastEndpointFingerprints = emptySet()
            config.endpoints.forEach { endpoint ->
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "disabled",
                    lastStatus = "skip:endpoint_disabled",
                    lastErrorMessage = null
                )
            }
            return
        }

        enabledEndpoints.forEach { endpoint ->
            scheduleHealthProbe(endpoint, force = false)
            maybeReplayPending(endpoint, force = false)
        }

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
        val endpointFingerprints = enabledEndpoints.map(ReporterEndpoint::runtimeFingerprint).toSet()
        val shouldSendSnapshot = lastSignature != signature || mediaJump || lastEndpointFingerprints != endpointFingerprints
        val shouldSendHeartbeat = !shouldSendSnapshot && (
            lastPublishedAtMillis == null ||
                nowMillis - (lastPublishedAtMillis ?: nowMillis) >= config.heartbeatSeconds.toLong() * 1000L
        )

        if (!shouldSendSnapshot && !shouldSendHeartbeat) {
            defaults.setObject("skip:no_change", "pulsebar.debug.endpoint.lastStatus")
            defaults.synchronize()
            enabledEndpoints.forEach { endpoint ->
                val current = stateFor(endpoint.id)
                if (current.status == "idle") {
                    syncStates[endpoint.id] = current.copy(lastStatus = "skip:no_change")
                }
            }
            return
        }

        val eventKind = if (shouldSendSnapshot) "snapshot" else "heartbeat"
        enabledEndpoints.forEach { endpoint ->
            enqueue(
                endpoint = endpoint,
                entry = buildJournalEntry(endpoint.id, snapshot, eventKind)
            )
        }
        rememberPublishedSnapshot(snapshot, signature, nowMillis)
        lastEndpointFingerprints = endpointFingerprints
    }

    fun forceSync(snapshot: PulseBarSnapshot, config: PulseBarConfig) {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpoints = config.enabledReporterEndpoints()
        if (enabledEndpoints.isEmpty()) return

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
        enabledEndpoints.forEach { endpoint ->
            scheduleHealthProbe(endpoint, force = true)
            maybeReplayPending(endpoint, force = true)
            enqueue(
                endpoint = endpoint,
                entry = buildJournalEntry(endpoint.id, snapshot, "snapshot")
            )
        }
        rememberPublishedSnapshot(snapshot, signature, nowMillis)
        lastEndpointFingerprints = enabledEndpoints.map(ReporterEndpoint::runtimeFingerprint).toSet()
    }

    fun readSyncState(config: PulseBarConfig): PulseBarSyncState {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val endpointStates = config.endpoints.map { endpoint ->
            val runtimeState = stateFor(endpoint.id)
            val pendingCount = rawJournal.pendingCount(endpoint.id)
            val checkpoint = rawJournal.readCheckpoint(endpoint.id)
            val status = when {
                !endpoint.enabled -> "disabled"
                runtimeState.status == "disabled" -> "idle"
                else -> runtimeState.status
            }
            PulseBarEndpointSyncState(
                id = endpoint.id,
                name = endpoint.name,
                enabled = endpoint.enabled,
                transportName = endpoint.transportName,
                endpointUrl = endpoint.endpointUrl,
                status = status,
                lastStatus = runtimeState.lastStatus,
                pendingCount = pendingCount,
                needsAttention = endpoint.enabled && (
                    status == "degraded" ||
                        status == "misconfigured" ||
                        pendingCount > 0
                    ),
                lastAttemptAtIso8601 = runtimeState.lastAttemptAtIso8601,
                lastProbeAtIso8601 = runtimeState.lastProbeAtIso8601,
                lastSuccessAtIso8601 = runtimeState.lastSuccessAtIso8601 ?: checkpoint?.acknowledgedAtIso8601,
                lastFailureAtIso8601 = runtimeState.lastFailureAtIso8601,
                lastErrorMessage = runtimeState.lastErrorMessage,
                acknowledgedSeqMax = checkpoint?.acknowledgedSeqMax ?: 0L,
                acknowledgedAtIso8601 = checkpoint?.acknowledgedAtIso8601
            )
        }
        val enabledStates = endpointStates.filter { it.enabled }
        return PulseBarSyncState(
            enabled = enabledStates.isNotEmpty(),
            enabledEndpointCount = enabledStates.size,
            totalEndpointCount = endpointStates.size,
            status = aggregateStatus(endpointStates),
            lastStatus = enabledStates.firstOrNull { it.needsAttention }?.lastStatus
                ?: enabledStates.firstOrNull { it.lastStatus != null }?.lastStatus,
            pendingCount = endpointStates.sumOf { it.pendingCount },
            needsAttention = endpointStates.any { it.needsAttention },
            endpoints = endpointStates
        )
    }

    fun retry(snapshot: PulseBarSnapshot, config: PulseBarConfig): Boolean {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpoints = config.enabledReporterEndpoints()
        if (enabledEndpoints.isEmpty()) {
            syncStates["default-endpoint"] = EndpointSyncSnapshot(
                status = "disabled",
                lastStatus = "retry:disabled",
                lastErrorMessage = "All endpoints are disabled"
            )
            return false
        }
        forceSync(snapshot, config)
        return true
    }

    fun resetIfDisabled(config: PulseBarConfig) {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpointIds = config.endpoints.filter { it.enabled }.map { it.id }.toSet()
        if (enabledEndpointIds.isEmpty()) {
            lastSignature = null
            lastPublishedAtMillis = null
            lastMediaState = null
            lastEndpointFingerprints = emptySet()
        }
        config.endpoints.forEach { endpoint ->
            if (!endpoint.enabled) {
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "disabled",
                    lastStatus = "skip:endpoint_disabled"
                )
                lastProbeIssuedAtMillis.remove(endpoint.id)
                lastReplayIssuedAtMillis.remove(endpoint.id)
            }
        }
    }

    private fun rememberPublishedSnapshot(snapshot: PulseBarSnapshot, signature: String, nowMillis: Long) {
        lastSignature = signature
        lastPublishedAtMillis = nowMillis
        lastMediaState = snapshot.media?.let { media ->
            MediaReporterState(
                key = media.trackId ?: media.title,
                progressSeconds = media.progressSeconds,
                isPlaying = media.isPlaying,
                capturedAtMillis = nowMillis
            )
        }
    }

    private fun hasSignificantMediaJump(snapshot: PulseBarSnapshot, nowMillis: Long): Boolean {
        val media = snapshot.media ?: return false
        val previous = lastMediaState ?: return false
        val currentKey = media.trackId ?: media.title
        if (currentKey != previous.key) return false

        val expectedProgress = if (previous.isPlaying) {
            previous.progressSeconds + ((nowMillis - previous.capturedAtMillis).coerceAtLeast(0L) / 1000.0)
        } else {
            previous.progressSeconds
        }

        return kotlin.math.abs(media.progressSeconds - expectedProgress) >= 2.0
    }

    private fun buildJournalEntry(endpointKey: String, snapshot: PulseBarSnapshot, eventKind: String): RawJournalEntry {
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
            endpointKey = endpointKey,
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
                put(
                    "kind",
                    if (providerSlug in setOf("spotify", "music", "apple-music", "netease-music", "qq-music", "tencent-music")) {
                        "music"
                    } else {
                        "other"
                    }
                )
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

    private fun enqueue(endpoint: ReporterEndpoint, entry: RawJournalEntry) {
        rawJournal.append(entry)
        maybeReplayPending(endpoint, force = true)
    }

    private fun scheduleHealthProbe(endpoint: ReporterEndpoint, force: Boolean) {
        val nowMillis = nativeCurrentTimeMillis()
        val currentState = stateFor(endpoint.id)
        val intervalMillis = if (currentState.status == "healthy") healthyProbeIntervalMillis else unhealthyProbeIntervalMillis
        if (!force) {
            val lastIssuedAt = lastProbeIssuedAtMillis[endpoint.id]
            if (lastIssuedAt != null && nowMillis - lastIssuedAt < intervalMillis) return
        }
        lastProbeIssuedAtMillis[endpoint.id] = nowMillis
        val probeAtIso8601 = nativeIso8601Now()
        scope.launch {
            val probeMutex = probeMutexes.getOrPut(endpoint.id) { Mutex() }
            if (!probeMutex.tryLock()) return@launch
            try {
                syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                    status = if (stateFor(endpoint.id).status == "healthy") "healthy" else "probing",
                    lastAttemptAtIso8601 = probeAtIso8601,
                    lastProbeAtIso8601 = probeAtIso8601,
                    lastStatus = "probe:started"
                )
                val statusCode = runCatching {
                    client.get {
                        url(resolvedProbeUrl(endpoint.resolvedUrl))
                        if (endpoint.apiKey.isNotBlank()) {
                            header("Authorization", "Bearer ${endpoint.apiKey}")
                        }
                    }.status.value
                }.getOrElse { error ->
                    writeDebugStatus(endpoint.id, "probe:error:${error.message ?: error::class.simpleName ?: "unknown"}")
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        status = "degraded",
                        lastStatus = "probe:error",
                        lastFailureAtIso8601 = probeAtIso8601,
                        lastErrorMessage = error.message ?: error::class.simpleName ?: "unknown"
                    )
                    null
                }

                if (statusCode == null) return@launch

                if (statusCode in 200..299) {
                    writeDebugStatus(endpoint.id, "probe:ok:$statusCode")
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        status = "healthy",
                        lastStatus = "probe:ok:$statusCode",
                        lastSuccessAtIso8601 = probeAtIso8601,
                        lastErrorMessage = null
                    )
                    replayPending(endpoint)
                } else {
                    writeDebugStatus(endpoint.id, "probe:http:$statusCode")
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        status = "degraded",
                        lastStatus = "probe:http:$statusCode",
                        lastFailureAtIso8601 = probeAtIso8601,
                        lastErrorMessage = "Health probe returned HTTP $statusCode"
                    )
                }
            } finally {
                probeMutex.unlock()
            }
        }
    }

    private fun replayPending(endpoint: ReporterEndpoint) {
        scope.launch {
            val replayMutex = replayMutexes.getOrPut(endpoint.id) { Mutex() }
            if (!replayMutex.tryLock()) return@launch
            try {
                rawJournal.prune(nativeCurrentTimeMillis())
                while (true) {
                    val batch = rawJournal.nextReplayBatch(endpoint.id, nativeCurrentTimeMillis())
                    if (batch.isEmpty()) break
                    val body = buildReplayBody(batch)
                    val bodyText = json.encodeToString(JsonObject.serializer(), body)
                    val attemptAtIso8601 = nativeIso8601Now()
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        lastAttemptAtIso8601 = attemptAtIso8601,
                        lastStatus = "replay:attempt:${batch.size}"
                    )
                    val ackSeq = runCatching {
                        val response = client.post {
                            url(endpoint.resolvedUrl)
                            contentType(ContentType.Application.Json)
                            header("X-PulseBar-Protocol", "presence.v2")
                            if (endpoint.apiKey.isNotBlank()) {
                                header("Authorization", "Bearer ${endpoint.apiKey}")
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
                        writeDebugStatus(endpoint.id, "error:${error::class.simpleName}:${error.message ?: "unknown"}")
                        defaults.setObject(bodyText, debugBodyKey(endpoint.id))
                        defaults.synchronize()
                        syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                            status = "degraded",
                            lastStatus = "replay:error",
                            lastFailureAtIso8601 = attemptAtIso8601,
                            lastErrorMessage = error.message ?: error::class.simpleName ?: "unknown"
                        )
                        null
                    }
                    if (ackSeq == null) break
                    val checkpoint = rawJournal.acknowledge(
                        endpointKey = endpoint.id,
                        acknowledgedSeqMax = ackSeq,
                        acknowledgedAtIso8601 = nativeIso8601Now()
                    )
                    writeDebugStatus(endpoint.id, "ok:${checkpoint.acknowledgedSeqMax}:${nativeIso8601Now()}")
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        status = "healthy",
                        lastStatus = "replay:ok:${checkpoint.acknowledgedSeqMax}",
                        lastSuccessAtIso8601 = attemptAtIso8601,
                        lastErrorMessage = null
                    )
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

    private fun resolvedProbeUrl(endpointUrl: String): String =
        endpointUrl.replace("/api/v2/presence/ingest", "/api/v1/meta")

    private fun maybeReplayPending(endpoint: ReporterEndpoint, force: Boolean) {
        val nowMillis = nativeCurrentTimeMillis()
        if (!force) {
            val lastIssuedAt = lastReplayIssuedAtMillis[endpoint.id]
            val replayIntervalMillis = when (stateFor(endpoint.id).status) {
                "healthy", "idle" -> healthyProbeIntervalMillis
                else -> unhealthyProbeIntervalMillis
            }
            if (lastIssuedAt != null && nowMillis - lastIssuedAt < replayIntervalMillis) {
                return
            }
        }
        lastReplayIssuedAtMillis[endpoint.id] = nowMillis
        replayPending(endpoint)
    }

    private fun stateFor(endpointId: String): EndpointSyncSnapshot =
        syncStates.getOrPut(endpointId) { EndpointSyncSnapshot() }

    private fun pruneRuntimeState(activeEndpointIds: Set<String>) {
        syncStates.keys.retainAll(activeEndpointIds)
        replayMutexes.keys.retainAll(activeEndpointIds)
        probeMutexes.keys.retainAll(activeEndpointIds)
        lastProbeIssuedAtMillis.keys.retainAll(activeEndpointIds)
        lastReplayIssuedAtMillis.keys.retainAll(activeEndpointIds)
    }

    private fun aggregateStatus(endpointStates: List<PulseBarEndpointSyncState>): String {
        val enabledStates = endpointStates.filter { it.enabled }
        if (enabledStates.isEmpty()) return "disabled"
        return when {
            enabledStates.any { it.status == "degraded" || it.status == "misconfigured" } -> "degraded"
            enabledStates.any { it.status == "probing" } -> "probing"
            enabledStates.all { it.status == "healthy" } -> "healthy"
            enabledStates.any { it.status == "healthy" } -> "healthy"
            else -> "idle"
        }
    }

    private fun writeDebugStatus(endpointId: String, value: String) {
        defaults.setObject(value, debugStatusKey(endpointId))
        defaults.setObject(value, "pulsebar.debug.endpoint.lastStatus")
        defaults.synchronize()
    }

    private fun debugStatusKey(endpointId: String): String =
        "pulsebar.debug.endpoint.${slugify(endpointId)}.lastStatus"

    private fun debugBodyKey(endpointId: String): String =
        "pulsebar.debug.endpoint.${slugify(endpointId)}.lastBody"
}

private data class ReporterEndpoint(
    val id: String,
    val name: String,
    val transportName: String,
    val endpointUrl: String,
    val apiKey: String
) {
    val resolvedUrl: String = resolvedEndpointIngestUrl(endpointUrl)

    fun runtimeFingerprint(): String =
        "$id::$transportName::$resolvedUrl::$apiKey"
}

private data class EndpointSyncSnapshot(
    val status: String = "idle",
    val lastStatus: String? = null,
    val lastAttemptAtIso8601: String? = null,
    val lastProbeAtIso8601: String? = null,
    val lastSuccessAtIso8601: String? = null,
    val lastFailureAtIso8601: String? = null,
    val lastErrorMessage: String? = null
)

private fun PulseBarConfig.enabledReporterEndpoints(): List<ReporterEndpoint> =
    endpoints
        .filter { it.enabled }
        .map { endpoint ->
            ReporterEndpoint(
                id = endpoint.id,
                name = endpoint.name,
                transportName = endpoint.transportName,
                endpointUrl = endpoint.endpointUrl,
                apiKey = endpoint.apiKey
            )
        }
