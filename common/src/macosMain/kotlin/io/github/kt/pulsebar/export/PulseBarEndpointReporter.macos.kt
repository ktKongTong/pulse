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
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.experimental.ExperimentalNativeApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.native.Platform
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSLog
import platform.Foundation.NSUserDefaults
import platform.Foundation.NSUserName
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fprintf
import platform.posix.mkdir

@OptIn(ExperimentalForeignApi::class, ExperimentalNativeApi::class)
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
    private val replayIntervalMillis = 30_000L
    private val probeIntervalMillis = 4_000L
    private val sessionId = randomId()
    private val deviceId = slugify("macos-${NSUserName()}")
    private val rawJournal = PulseBarRawJournalStore()
    private val defaults = NSUserDefaults.standardUserDefaults
    private val replayEvents = Channel<String>(capacity = Channel.UNLIMITED)
    private val replayMutexes = mutableMapOf<String, Mutex>()
    private val lastReplayIssuedAtMillis = mutableMapOf<String, Long>()
    private val lastReplaySkipLogAtMillis = mutableMapOf<String, Long>()
    private val replayQueuedCounts = mutableMapOf<String, Int>()
    private val replayStartedCounts = mutableMapOf<String, Int>()
    private val configurationBlocks = mutableMapOf<String, String>()
    private val syncStates = mutableMapOf<String, EndpointSyncSnapshot>()
    private var probeEndpoints: List<ReporterEndpoint> = emptyList()
    private var lastSignature: String? = null
    private var lastPublishedAtMillis: Long? = null
    private var lastMediaState: MediaReporterState? = null
    private var lastEndpointFingerprints: Set<String> = emptySet()

    init {
        writeHttpLog("logger initialized")
        startProbeLoop()
        startReplayLoop()
    }

    fun migrateStorageIfNeeded() {
        rawJournal.migrateToRoomIfNeeded()
    }

    fun updateConfig(config: PulseBarConfig) {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpoints = config.enabledReporterEndpoints()
        probeEndpoints = enabledEndpoints
        enabledEndpoints.forEach { endpoint ->
            if (!endpoint.isConfigured()) {
                markConfigurationBlocked(endpoint)
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "misconfigured",
                    serverStatus = "unknown",
                    clientStatus = "unavailable",
                    lastStatus = "skip:missing_workspace_site_or_api_key",
                    lastErrorMessage = "Workspace ID, Site ID, and API Key are required"
                )
            } else if (isConfigurationBlocked(endpoint)) {
                syncStates[endpoint.id] = stateFor(endpoint.id).copy(status = "misconfigured", clientStatus = "unavailable")
            } else {
                recoverConfigurationState(endpoint)
            }
        }
    }

    fun capture(snapshot: PulseBarSnapshot, config: PulseBarConfig) {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpoints = config.enabledReporterEndpoints()
        if (enabledEndpoints.isEmpty()) {
            defaults.setObject("skip:endpoint_disabled", "pulsebar.debug.endpoint.lastStatus")
            defaults.synchronize()
            lastEndpointFingerprints = emptySet()
            config.endpoints.forEach { endpoint ->
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "disabled",
                    serverStatus = "unknown",
                    clientStatus = "unknown",
                    lastStatus = "skip:endpoint_disabled",
                    lastErrorMessage = null
                )
            }
            return
        }

        enabledEndpoints.forEach { endpoint ->
            if (!endpoint.isConfigured()) {
                markConfigurationBlocked(endpoint)
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "misconfigured",
                    serverStatus = "unknown",
                    clientStatus = "unavailable",
                    lastStatus = "skip:missing_workspace_site_or_api_key",
                    lastErrorMessage = "Workspace ID, Site ID, and API Key are required"
                )
                return@forEach
            }
            if (isConfigurationBlocked(endpoint)) {
                syncStates[endpoint.id] = stateFor(endpoint.id).copy(status = "misconfigured", clientStatus = "unavailable")
                return@forEach
            }
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
        enabledEndpoints.filter { it.isConfigured() && !isConfigurationBlocked(it) }.forEach { endpoint ->
            enqueue(
                endpoint = endpoint,
                entry = buildJournalEntry(endpoint, snapshot, eventKind)
            )
        }
        rememberPublishedSnapshot(snapshot, signature, nowMillis)
        lastEndpointFingerprints = endpointFingerprints
    }

    fun sync(config: PulseBarConfig, forceReplay: Boolean = false) {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        val enabledEndpoints = config.enabledReporterEndpoints()
        if (enabledEndpoints.isEmpty()) return
        enabledEndpoints.forEach { endpoint ->
            if (!endpoint.isConfigured()) {
                markConfigurationBlocked(endpoint)
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "misconfigured",
                    serverStatus = "unknown",
                    clientStatus = "unavailable",
                    lastStatus = "skip:missing_workspace_site_or_api_key",
                    lastErrorMessage = "Workspace ID, Site ID, and API Key are required"
                )
                return@forEach
            }
            if (isConfigurationBlocked(endpoint)) {
                syncStates[endpoint.id] = stateFor(endpoint.id).copy(status = "misconfigured", clientStatus = "unavailable")
                return@forEach
            }
            maybeReplayPending(endpoint, force = forceReplay)
        }
    }

    fun forceSync(snapshot: PulseBarSnapshot, config: PulseBarConfig) {
        capture(snapshot, config)
        sync(config, forceReplay = true)
    }

    fun readSyncState(config: PulseBarConfig): PulseBarSyncState {
        pruneRuntimeState(config.endpoints.map { it.id }.toSet())
        config.enabledReporterEndpoints().forEach { endpoint ->
            drainPendingForRead(endpoint)
        }
        val endpointStates = config.endpoints.map { endpoint ->
            val reporterEndpoint = ReporterEndpoint(
                id = endpoint.id,
                name = endpoint.name,
                transportName = endpoint.transportName,
                endpointUrl = endpoint.endpointUrl,
                workspaceId = endpoint.workspaceId,
                siteId = endpoint.siteId,
                apiKey = endpoint.apiKey
            )
            val runtimeState = stateFor(endpoint.id)
            val pendingCount = rawJournal.pendingCount(endpoint.id)
            val checkpoint = rawJournal.readCheckpoint(endpoint.id)
            val serverStatus = when {
                !endpoint.enabled -> "unknown"
                else -> runtimeState.serverStatus
            }
            val clientStatus = when {
                !endpoint.enabled -> "unknown"
                !reporterEndpoint.isConfigured() -> "unavailable"
                isConfigurationBlocked(reporterEndpoint) -> "unavailable"
                else -> runtimeState.clientStatus
            }
            val status = combinedStatus(
                enabled = endpoint.enabled,
                serverStatus = serverStatus,
                clientStatus = clientStatus
            )
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
                    serverStatus == "unavailable" ||
                        clientStatus == "unavailable" ||
                        pendingCount > 0
                    ),
                lastAttemptAtIso8601 = runtimeState.lastAttemptAtIso8601,
                lastProbeAtIso8601 = runtimeState.lastProbeAtIso8601,
                lastSuccessAtIso8601 = runtimeState.lastSuccessAtIso8601 ?: checkpoint?.acknowledgedAtIso8601,
                lastFailureAtIso8601 = runtimeState.lastFailureAtIso8601,
                lastErrorMessage = runtimeState.lastErrorMessage,
                diagnosticMessage = buildDiagnosticMessage(endpoint.id, runtimeState, pendingCount, checkpoint?.acknowledgedSeqMax),
                acknowledgedSeqMax = checkpoint?.acknowledgedSeqMax ?: 0L,
                acknowledgedAtIso8601 = checkpoint?.acknowledgedAtIso8601
            )
        }
        val enabledStates = endpointStates.filter { it.enabled }
        val aggregateServerStatus = aggregateServerStatusFromCombined(enabledStates)
        val aggregateClientStatus = aggregateClientStatusFromCombined(enabledStates)
        return PulseBarSyncState(
            enabled = enabledStates.isNotEmpty(),
            enabledEndpointCount = enabledStates.size,
            totalEndpointCount = endpointStates.size,
            status = combinedStatus(
                enabled = enabledStates.isNotEmpty(),
                serverStatus = aggregateServerStatus,
                clientStatus = aggregateClientStatus
            ),
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
                clearConfigurationBlocked(endpoint.id)
                syncStates[endpoint.id] = EndpointSyncSnapshot(
                    status = "disabled",
                    serverStatus = "unknown",
                    clientStatus = "unknown",
                    lastStatus = "skip:endpoint_disabled"
                )
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

    private fun recoverConfigurationState(endpoint: ReporterEndpoint) {
        val current = stateFor(endpoint.id)
        if (!current.isConfigurationError() && current.lastStatus != "skip:missing_workspace_site_or_api_key") {
            return
        }
        val serverStatus = current.serverStatus.takeUnless { it == "checking" } ?: "unknown"
        syncStates[endpoint.id] = current.copy(
            status = combinedStatus(
                enabled = true,
                serverStatus = serverStatus,
                clientStatus = "available"
            ),
            serverStatus = serverStatus,
            clientStatus = "available",
            lastStatus = null,
            lastErrorMessage = null
        )
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

    private fun buildJournalEntry(endpoint: ReporterEndpoint, snapshot: PulseBarSnapshot, eventKind: String): RawJournalEntry {
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
            endpointKey = endpoint.id,
            workspaceId = endpoint.workspaceId,
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
        if (isConfigurationBlocked(endpoint)) {
            recordReplayDiagnostic(endpoint.id, "enqueue blocked: configuration_blocked")
            writeHttpLog("skip kind=enqueue endpoint=${endpoint.id} reason=configuration_blocked")
            return
        }
        rawJournal.append(entry)
        val pendingCount = rawJournal.pendingCount(endpoint.id)
        recordReplayDiagnostic(endpoint.id, "enqueue seq=${entry.seq} kind=${entry.kind} pending=$pendingCount")
        writeHttpLog("event kind=enqueue endpoint=${endpoint.id} entryKind=${entry.kind} seq=${entry.seq} pending=$pendingCount")
        requestReplay(endpoint.id, reason = "enqueue")
    }

    private fun buildReplayBody(endpoint: ReporterEndpoint, entries: List<RawJournalEntry>): JsonObject {
        val first = entries.first()
        return buildJsonObject {
            put("protocol", "presence.v2")
            put("workspaceId", endpoint.workspaceId)
            if (endpoint.siteId.isNotBlank()) {
                put("siteId", endpoint.siteId)
            }
            put("deviceId", first.deviceId)
            put("sessionId", first.sessionId)
            putJsonArray("events") {
                entries.forEach { add(it.event) }
            }
        }
    }

    private fun replayPending(endpoint: ReporterEndpoint) {
        scope.launch {
            drainPending(endpoint)
        }
    }

    private fun drainPendingForRead(endpoint: ReporterEndpoint) {
        if (stateFor(endpoint.id).serverStatus == "available") {
            runBlocking { drainPending(endpoint) }
        } else {
            val state = stateFor(endpoint.id)
            recordReplayDiagnostic(
                endpoint.id,
                "read drain skipped: serverStatus=${state.serverStatus} status=${state.status} pending=${rawJournal.pendingCount(endpoint.id)}"
            )
        }
    }

    private suspend fun drainPending(endpoint: ReporterEndpoint) {
        val replayMutex = replayMutexes.getOrPut(endpoint.id) { Mutex() }
        replayMutex.withLock {
                val startedCount = (replayStartedCounts[endpoint.id] ?: 0) + 1
                replayStartedCounts[endpoint.id] = startedCount
                val initialPending = rawJournal.pendingCount(endpoint.id)
                recordReplayDiagnostic(endpoint.id, "drain start #$startedCount pending=$initialPending server=${stateFor(endpoint.id).serverStatus}")
                writeHttpLog("event kind=drain_start endpoint=${endpoint.id} attempt=$startedCount pending=$initialPending serverStatus=${stateFor(endpoint.id).serverStatus}")
                rawJournal.prune(nativeCurrentTimeMillis())
                while (true) {
                    val currentState = stateFor(endpoint.id)
                    if (currentState.serverStatus != "available") {
                        logReplaySkip(
                            endpoint = endpoint,
                            reason = "replay_loop_server_not_available status=${currentState.status} serverStatus=${currentState.serverStatus} clientStatus=${currentState.clientStatus}"
                        )
                        break
                    }
                    val batch = rawJournal.nextReplayBatch(endpoint.id, nativeCurrentTimeMillis())
                    if (batch.isEmpty()) {
                        recordReplayDiagnostic(endpoint.id, "drain complete: no pending batch")
                        writeHttpLog("event kind=drain_complete endpoint=${endpoint.id} pending=0")
                        break
                    }
                    val body = buildReplayBody(endpoint, batch)
                    val bodyText = json.encodeToString(JsonObject.serializer(), body)
                    val attemptAtIso8601 = nativeIso8601Now()
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        lastAttemptAtIso8601 = attemptAtIso8601,
                        lastStatus = "replay:attempt:${batch.size}",
                        diagnosticMessage = "POST ${endpoint.resolvedUrl} events=${batch.size} seq=${batch.first().seq}..${batch.last().seq} bytes=${bodyText.length}"
                    )
                    logHttpRequest(
                        kind = "ingest",
                        endpoint = endpoint,
                        method = "POST",
                        url = endpoint.resolvedUrl,
                        detail = "events=${batch.size} seq=${batch.first().seq}..${batch.last().seq} bytes=${bodyText.length}"
                    )
                    val result = runCatching {
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
                        logHttpResult(
                            kind = "ingest",
                            endpoint = endpoint,
                            statusCode = response.status.value,
                            detail = responseText.take(400)
                        )
                        IngestAttemptResult(
                            statusCode = response.status.value,
                            errorCode = responseText.toJsonObjectOrNull()
                                ?.get("error")
                                ?.jsonPrimitive
                                ?.contentOrNull,
                            acceptedSeqMax = responseText.toJsonObjectOrNull()
                                ?.get("acceptedSeqMax")
                                ?.jsonPrimitive
                                ?.content
                                ?.toLongOrNull()
                        )
                    }.getOrElse { error ->
                        logHttpError("ingest", endpoint, error)
                        writeDebugStatus(endpoint.id, "error:${error::class.simpleName}:${error.message ?: "unknown"}")
                        defaults.setObject(bodyText, debugBodyKey(endpoint.id))
                        defaults.synchronize()
                        recordTransportFailure(endpoint, attemptAtIso8601, error)
                        null
                    }
                    if (result == null) break
                    when {
                        result.statusCode in 200..299 && result.acceptedSeqMax != null -> {
                            clearConfigurationBlocked(endpoint.id)
                        }
                        result.statusCode == 401 -> {
                            writeDebugStatus(endpoint.id, "replay:unauthorized")
                            markConfigurationBlocked(endpoint)
                            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                                status = "configuration_error",
                                serverStatus = "available",
                                clientStatus = "unavailable",
                                lastStatus = "replay:unauthorized",
                                lastFailureAtIso8601 = attemptAtIso8601,
                                lastErrorMessage = "API Key is invalid",
                                diagnosticMessage = "HTTP 401 while replaying seq=${batch.first().seq}..${batch.last().seq}"
                            )
                            break
                        }
                        result.statusCode == 403 && result.errorCode == "workspace_mismatch" -> {
                            writeDebugStatus(endpoint.id, "replay:workspace_mismatch")
                            markConfigurationBlocked(endpoint)
                            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                                status = "configuration_error",
                                serverStatus = "available",
                                clientStatus = "unavailable",
                                lastStatus = "replay:workspace_mismatch",
                                lastFailureAtIso8601 = attemptAtIso8601,
                                lastErrorMessage = "Workspace ID does not match the server",
                                diagnosticMessage = "HTTP 403 workspace_mismatch while replaying seq=${batch.first().seq}..${batch.last().seq}"
                            )
                            break
                        }
                        result.statusCode == 403 && result.errorCode == "site_mismatch" -> {
                            writeDebugStatus(endpoint.id, "replay:site_mismatch")
                            markConfigurationBlocked(endpoint)
                            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                                status = "configuration_error",
                                serverStatus = "available",
                                clientStatus = "unavailable",
                                lastStatus = "replay:site_mismatch",
                                lastFailureAtIso8601 = attemptAtIso8601,
                                lastErrorMessage = "Site ID does not match the server",
                                diagnosticMessage = "HTTP 403 site_mismatch while replaying seq=${batch.first().seq}..${batch.last().seq}"
                            )
                            break
                        }
                        result.statusCode == 403 -> {
                            writeDebugStatus(endpoint.id, "replay:forbidden")
                            markConfigurationBlocked(endpoint)
                            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                                status = "configuration_error",
                                serverStatus = "available",
                                clientStatus = "unavailable",
                                lastStatus = "replay:forbidden",
                                lastFailureAtIso8601 = attemptAtIso8601,
                                lastErrorMessage = "Server rejected this endpoint configuration",
                                diagnosticMessage = "HTTP 403 while replaying seq=${batch.first().seq}..${batch.last().seq}"
                            )
                            break
                        }
                        result.statusCode in 500..599 -> {
                            writeDebugStatus(endpoint.id, "replay:http:${result.statusCode}")
                            recordServerFailure(
                                endpoint = endpoint,
                                attemptAtIso8601 = attemptAtIso8601,
                                reason = "Server returned HTTP ${result.statusCode}"
                            )
                            break
                        }
                        else -> {
                            writeDebugStatus(endpoint.id, "replay:http:${result.statusCode}")
                            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                                status = "degraded",
                                serverStatus = "unavailable",
                                lastStatus = "replay:http:${result.statusCode}",
                                lastFailureAtIso8601 = attemptAtIso8601,
                                lastErrorMessage = "Ingest returned HTTP ${result.statusCode}",
                                diagnosticMessage = "HTTP ${result.statusCode} while replaying seq=${batch.first().seq}..${batch.last().seq}"
                            )
                            break
                        }
                    }
                    val checkpoint = rawJournal.acknowledge(
                        endpointKey = endpoint.id,
                        acknowledgedSeqMax = result.acceptedSeqMax,
                        acknowledgedAtIso8601 = nativeIso8601Now()
                    )
                    writeDebugStatus(endpoint.id, "ok:${checkpoint.acknowledgedSeqMax}:${nativeIso8601Now()}")
                    syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                        status = "healthy",
                        serverStatus = "available",
                        clientStatus = "available",
                        lastStatus = "replay:ok:${checkpoint.acknowledgedSeqMax}",
                        lastSuccessAtIso8601 = attemptAtIso8601,
                        lastErrorMessage = null,
                        diagnosticMessage = "ack acceptedSeqMax=${checkpoint.acknowledgedSeqMax} pending=${rawJournal.pendingCount(endpoint.id)}"
                    )
                    requestReplay(endpoint.id, reason = "ack")
                }
        }
    }

    private fun maybeReplayPending(endpoint: ReporterEndpoint, force: Boolean) {
        val nowMillis = nativeCurrentTimeMillis()
        if (isConfigurationBlocked(endpoint)) {
            recordReplayDiagnostic(endpoint.id, "replay skipped: configuration_blocked pending=${rawJournal.pendingCount(endpoint.id)}")
            logReplaySkip(endpoint, "configuration_blocked")
            return
        }
        val state = stateFor(endpoint.id)
        if (state.serverStatus != "available") {
            recordReplayDiagnostic(
                endpoint.id,
                "replay skipped: server_not_available status=${state.status} server=${state.serverStatus} client=${state.clientStatus} pending=${rawJournal.pendingCount(endpoint.id)} force=$force"
            )
            logReplaySkip(
                endpoint = endpoint,
                reason = "server_not_available status=${state.status} serverStatus=${state.serverStatus} clientStatus=${state.clientStatus}"
            )
            return
        }
        if (!force) {
            val lastIssuedAt = lastReplayIssuedAtMillis[endpoint.id]
            if (lastIssuedAt != null && nowMillis - lastIssuedAt < replayIntervalMillis) {
                recordReplayDiagnostic(endpoint.id, "replay skipped: interval remaining=${replayIntervalMillis - (nowMillis - lastIssuedAt)}ms pending=${rawJournal.pendingCount(endpoint.id)}")
                logReplaySkip(endpoint, "replay_interval")
                return
            }
        }
        lastReplayIssuedAtMillis[endpoint.id] = nowMillis
        requestReplay(endpoint.id, reason = if (force) "force" else "interval")
    }

    private fun requestReplay(endpointId: String, reason: String) {
        val result = replayEvents.trySend(endpointId)
        if (result.isSuccess) {
            val queuedCount = (replayQueuedCounts[endpointId] ?: 0) + 1
            replayQueuedCounts[endpointId] = queuedCount
            recordReplayDiagnostic(endpointId, "replay queued #$queuedCount reason=$reason pending=${rawJournal.pendingCount(endpointId)}")
            writeHttpLog("event kind=replay endpoint=$endpointId reason=$reason queued=$queuedCount pending=${rawJournal.pendingCount(endpointId)}")
        } else {
            recordReplayDiagnostic(endpointId, "replay queue failed reason=$reason error=${result.exceptionOrNull()?.message ?: "unknown"}")
            writeHttpLog("event kind=replay_drop endpoint=$endpointId reason=$reason error=${result.exceptionOrNull()?.message ?: "unknown"}")
        }
    }

    private fun startReplayLoop() {
        scope.launch {
            for (endpointId in replayEvents) {
                val endpoint = probeEndpoints.firstOrNull { it.id == endpointId }
                if (endpoint == null) {
                    recordReplayDiagnostic(endpointId, "replay dropped by loop: endpoint_not_active active=${probeEndpoints.map { it.id }.joinToString(",")}")
                    writeHttpLog("skip kind=ingest endpoint=$endpointId reason=endpoint_not_active")
                    continue
                }
                recordReplayDiagnostic(endpointId, "replay loop picked endpoint pending=${rawJournal.pendingCount(endpointId)}")
                replayPending(endpoint)
            }
        }
    }

    private fun startProbeLoop() {
        scope.launch {
            while (isActive) {
                probeEndpoints.forEach { endpoint ->
                    if (shouldProbeServer(endpoint)) {
                        probeServer(endpoint)
                    }
                }
                delay(probeIntervalMillis)
            }
        }
    }

    private fun shouldProbeServer(endpoint: ReporterEndpoint): Boolean {
        if (!endpoint.isConfigured()) return false
        if (isConfigurationBlocked(endpoint)) return false
        val state = stateFor(endpoint.id)
        if (state.isConfigurationError()) return false
        if (state.status == "local_unavailable") return false
        return state.clientStatus == "available" && (
            state.serverStatus == "unknown" ||
                state.status == "server_unavailable" && state.serverStatus == "unavailable"
        )
    }

    private suspend fun probeServer(endpoint: ReporterEndpoint) {
        if (!shouldProbeServer(endpoint)) return

        val probeAtIso8601 = nativeIso8601Now()
        syncStates[endpoint.id] = stateFor(endpoint.id).copy(
            status = "checking_server",
            serverStatus = "checking",
            clientStatus = "available",
            lastProbeAtIso8601 = probeAtIso8601,
            diagnosticMessage = "probe start GET ${endpoint.probeUrl}"
        )
        logHttpRequest(
            kind = "probe",
            endpoint = endpoint,
            method = "GET",
            url = endpoint.probeUrl,
            detail = "serverStatus=${stateFor(endpoint.id).serverStatus}"
        )
        val result = runCatching {
            val response = client.get {
                url(endpoint.probeUrl)
            }
            val responseText = response.bodyAsText()
            logHttpResult(
                kind = "probe",
                endpoint = endpoint,
                statusCode = response.status.value,
                detail = responseText.take(400)
            )
            ProbeAttemptResult(
                statusCode = response.status.value,
                body = responseText
            )
        }
        result.exceptionOrNull()?.let { logHttpError("probe", endpoint, it) }

        val probeResult = result.getOrNull()
        if (probeResult != null && isProbeServerAvailable(probeResult)) {
            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                status = "healthy",
                serverStatus = "available",
                clientStatus = "available",
                lastProbeAtIso8601 = probeAtIso8601,
                diagnosticMessage = "probe ok HTTP ${probeResult.statusCode}"
            )
        } else if (result.exceptionOrNull()?.let(::isLocalNetworkUnavailable) == true) {
            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                status = "local_unavailable",
                serverStatus = "unknown",
                clientStatus = "available",
                lastProbeAtIso8601 = probeAtIso8601,
                lastErrorMessage = result.exceptionOrNull()?.message ?: result.exceptionOrNull()?.let { it::class.simpleName },
                diagnosticMessage = "probe local unavailable: ${result.exceptionOrNull()?.message ?: "unknown"}"
            )
        } else {
            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                status = "server_unavailable",
                serverStatus = "unavailable",
                clientStatus = "available",
                lastProbeAtIso8601 = probeAtIso8601,
                diagnosticMessage = probeResult?.let { "probe unavailable HTTP ${it.statusCode}" }
                    ?: "probe failed: ${result.exceptionOrNull()?.message ?: "unknown"}"
            )
        }
    }

    private fun stateFor(endpointId: String): EndpointSyncSnapshot =
        syncStates.getOrPut(endpointId) { EndpointSyncSnapshot() }

    private fun pruneRuntimeState(activeEndpointIds: Set<String>) {
        syncStates.keys.retainAll(activeEndpointIds)
        replayMutexes.keys.retainAll(activeEndpointIds)
        lastReplayIssuedAtMillis.keys.retainAll(activeEndpointIds)
        lastReplaySkipLogAtMillis.keys.retainAll(activeEndpointIds)
        replayQueuedCounts.keys.retainAll(activeEndpointIds)
        replayStartedCounts.keys.retainAll(activeEndpointIds)
        configurationBlocks.keys.retainAll(activeEndpointIds)
        probeEndpoints = probeEndpoints.filter { it.id in activeEndpointIds }
    }

    private fun logReplaySkip(endpoint: ReporterEndpoint, reason: String) {
        val nowMillis = nativeCurrentTimeMillis()
        val lastLoggedAt = lastReplaySkipLogAtMillis[endpoint.id]
        if (lastLoggedAt != null && nowMillis - lastLoggedAt < 5_000L) return
        lastReplaySkipLogAtMillis[endpoint.id] = nowMillis
        writeHttpLog("skip kind=ingest endpoint=${endpoint.id} reason=$reason")
    }

    private fun recordReplayDiagnostic(endpointId: String, message: String) {
        syncStates[endpointId] = stateFor(endpointId).copy(diagnosticMessage = message.take(600))
    }

    private fun buildDiagnosticMessage(
        endpointId: String,
        runtimeState: EndpointSyncSnapshot,
        pendingCount: Int,
        acknowledgedSeqMax: Long?
    ): String = buildString {
        append(runtimeState.diagnosticMessage ?: "no diagnostic yet")
        append(" | pending=")
        append(pendingCount)
        append(" ack=")
        append(acknowledgedSeqMax ?: 0L)
        append(" queued=")
        append(replayQueuedCounts[endpointId] ?: 0)
        append(" started=")
        append(replayStartedCounts[endpointId] ?: 0)
    }

    private fun recordTransportFailure(endpoint: ReporterEndpoint, attemptAtIso8601: String, error: Throwable) {
        val reason = error.message ?: error::class.simpleName ?: "unknown"
        if (isLocalNetworkUnavailable(error)) {
            val current = stateFor(endpoint.id)
            syncStates[endpoint.id] = stateFor(endpoint.id).copy(
                status = "local_unavailable",
                serverStatus = current.serverStatus,
                clientStatus = "available",
                lastStatus = "replay:local_unavailable",
                lastFailureAtIso8601 = attemptAtIso8601,
                lastErrorMessage = reason,
                diagnosticMessage = "transport local unavailable: ${reason.take(300)}"
            )
            return
        }
        recordServerFailure(endpoint, attemptAtIso8601, reason)
    }

    private fun recordServerFailure(endpoint: ReporterEndpoint, attemptAtIso8601: String, reason: String) {
        syncStates[endpoint.id] = stateFor(endpoint.id).copy(
            status = "server_unavailable",
            serverStatus = "unavailable",
            clientStatus = "available",
            lastStatus = "replay:error",
            lastFailureAtIso8601 = attemptAtIso8601,
            lastErrorMessage = reason,
            diagnosticMessage = "transport/server failure: ${reason.take(300)}"
        )
    }

    private fun isLocalNetworkUnavailable(error: Throwable): Boolean {
        val text = buildString {
            append(error::class.simpleName.orEmpty())
            append(' ')
            append(error.message.orEmpty())
            error.cause?.let { cause ->
                append(' ')
                append(cause::class.simpleName.orEmpty())
                append(' ')
                append(cause.message.orEmpty())
            }
        }.lowercase()
        return listOf(
            "network is unreachable",
            "not connected to the internet",
            "offline",
            "no route to host",
            "network connection was lost",
            "dns server not available"
        ).any { it in text }
    }

    private fun isProbeServerAvailable(result: ProbeAttemptResult): Boolean {
        if (result.statusCode !in 200..299) return false
        val body = result.body.lowercase()
        val compactBody = body.filterNot(Char::isWhitespace)
        val explicitUnavailableMarkers = listOf(
            "\"serverstatus\":\"unavailable\"",
            "\"server_status\":\"unavailable\"",
            "\"status\":\"unavailable\"",
            "\"available\":false",
            "\"serveravailable\":false",
            "\"server_available\":false"
        )
        return explicitUnavailableMarkers.none { marker -> marker in compactBody } && "server unavailable" !in body
    }

    private fun isConfigurationBlocked(endpoint: ReporterEndpoint): Boolean {
        val blockedFingerprint = configurationBlocks[endpoint.id] ?: return false
        if (blockedFingerprint == endpoint.runtimeFingerprint()) {
            return true
        }
        configurationBlocks.remove(endpoint.id)
        return false
    }

    private fun markConfigurationBlocked(endpoint: ReporterEndpoint) {
        configurationBlocks[endpoint.id] = endpoint.runtimeFingerprint()
    }

    private fun clearConfigurationBlocked(endpointId: String) {
        configurationBlocks.remove(endpointId)
    }

    private fun writeDebugStatus(endpointId: String, value: String) {
        defaults.setObject(value, debugStatusKey(endpointId))
        defaults.setObject(value, "pulsebar.debug.endpoint.lastStatus")
        defaults.synchronize()
    }

    private fun logHttpRequest(kind: String, endpoint: ReporterEndpoint, method: String, url: String, detail: String) {
        writeHttpLog("request kind=$kind endpoint=${endpoint.id} method=$method url=$url $detail")
    }

    private fun logHttpResult(kind: String, endpoint: ReporterEndpoint, statusCode: Int, detail: String?) {
        val suffix = detail?.takeIf { it.isNotBlank() }?.let { " body=$it" }.orEmpty()
        writeHttpLog("result kind=$kind endpoint=${endpoint.id} status=$statusCode$suffix")
    }

    private fun logHttpError(kind: String, endpoint: ReporterEndpoint, error: Throwable) {
        writeHttpLog("error kind=$kind endpoint=${endpoint.id} type=${error::class.simpleName} message=${error.message ?: "unknown"}")
    }

    private fun writeHttpLog(message: String) {
        val line = "${nativeIso8601Now()} [pulsebar.http] $message"
        if (Platform.isDebugBinary) {
            NSLog(line)
        }
        val home = NSHomeDirectory()
        mkdir("$home/Library/Logs", 0x1EDu)
        val logDirectory = "$home/Library/Logs/PulseBarNative"
        mkdir(logDirectory, 0x1EDu)
        val file = fopen("$logDirectory/http.log", "a") ?: return
        try {
            fprintf(file, "%s\n", line)
        } finally {
            fclose(file)
        }
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
    val workspaceId: String,
    val siteId: String,
    val apiKey: String
) {
    val resolvedUrl: String = resolvedEndpointIngestUrl(endpointUrl)
    val probeUrl: String = resolvedEndpointProbeUrl(resolvedUrl)

    fun runtimeFingerprint(): String =
        "$id::$transportName::$resolvedUrl::$workspaceId::$siteId::$apiKey"

    fun isConfigured(): Boolean =
        resolvedUrl.isNotBlank() && workspaceId.isNotBlank() && siteId.isNotBlank() && apiKey.isNotBlank()
}

private data class EndpointSyncSnapshot(
    val status: String = "idle",
    val serverStatus: String = "unknown",
    val clientStatus: String = "available",
    val lastStatus: String? = null,
    val lastAttemptAtIso8601: String? = null,
    val lastProbeAtIso8601: String? = null,
    val lastSuccessAtIso8601: String? = null,
    val lastFailureAtIso8601: String? = null,
    val lastErrorMessage: String? = null,
    val diagnosticMessage: String? = null
)

private fun EndpointSyncSnapshot.isConfigurationError(): Boolean =
    status == "misconfigured" || status == "configuration_error" || clientStatus == "unavailable"

private fun combinedStatus(enabled: Boolean, serverStatus: String, clientStatus: String): String {
    if (!enabled) return "disabled"
    return when {
        clientStatus == "unavailable" && serverStatus == "available" -> "configuration_error"
        clientStatus == "unavailable" && serverStatus == "checking" -> "configuration_error"
        clientStatus == "unavailable" && serverStatus == "unavailable" -> "degraded"
        clientStatus == "available" && serverStatus == "unavailable" -> "server_unavailable"
        clientStatus == "available" && serverStatus == "checking" -> "checking_server"
        clientStatus == "available" && serverStatus == "available" -> "healthy"
        else -> "idle"
    }
}

private fun aggregateServerStatusFromCombined(endpointStates: List<PulseBarEndpointSyncState>): String =
    when {
        endpointStates.isEmpty() -> "unknown"
        endpointStates.any { derivedServerStatusFromCombined(it.status) == "checking" } -> "checking"
        endpointStates.any { derivedServerStatusFromCombined(it.status) == "unavailable" } &&
            endpointStates.any { derivedServerStatusFromCombined(it.status) == "available" } -> "unavailable"
        endpointStates.all { derivedServerStatusFromCombined(it.status) == "available" } -> "available"
        endpointStates.all { derivedServerStatusFromCombined(it.status) == "unavailable" } -> "unavailable"
        else -> "unknown"
    }

private fun aggregateClientStatusFromCombined(endpointStates: List<PulseBarEndpointSyncState>): String =
    when {
        endpointStates.isEmpty() -> "unknown"
        endpointStates.any { derivedClientStatusFromCombined(it.status) == "unavailable" } -> "unavailable"
        endpointStates.all { derivedClientStatusFromCombined(it.status) == "available" } -> "available"
        else -> "unknown"
    }

private fun derivedServerStatusFromCombined(status: String): String =
    when (status) {
        "healthy", "configuration_error" -> "available"
        "server_unavailable", "degraded" -> "unavailable"
        "checking_server" -> "checking"
        "local_unavailable" -> "unknown"
        else -> "unknown"
    }

private fun derivedClientStatusFromCombined(status: String): String =
    when (status) {
        "healthy", "server_unavailable", "checking_server", "local_unavailable" -> "available"
        "configuration_error", "misconfigured", "degraded" -> "unavailable"
        else -> "unknown"
    }

private data class IngestAttemptResult(
    val statusCode: Int,
    val errorCode: String?,
    val acceptedSeqMax: Long?
)

private data class ProbeAttemptResult(
    val statusCode: Int,
    val body: String
)

private fun String.toJsonObjectOrNull(): JsonObject? =
    runCatching { Json.parseToJsonElement(this).jsonObject }.getOrNull()

private fun PulseBarConfig.enabledReporterEndpoints(): List<ReporterEndpoint> =
    endpoints
        .filter { it.enabled }
        .map { endpoint ->
            ReporterEndpoint(
                id = endpoint.id,
                name = endpoint.name,
                transportName = endpoint.transportName,
                endpointUrl = endpoint.endpointUrl,
                workspaceId = endpoint.workspaceId,
                siteId = endpoint.siteId,
                apiKey = endpoint.apiKey
            )
        }
