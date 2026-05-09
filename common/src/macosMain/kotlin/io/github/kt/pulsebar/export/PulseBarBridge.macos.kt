package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.core.config.PulseBarConfigStore
import io.github.kt.pulsebar.core.config.pulseBarConfigFileSystem
import io.github.kt.pulsebar.core.config.pulseBarConfigPath
import io.github.kt.pulsebar.core.config.toExport
import io.github.kt.pulsebar.core.config.toProto
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
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
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import platform.AppKit.NSWorkspace
import platform.Foundation.NSAppleScript
import platform.Foundation.NSBundle
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSJSONReadingMutableContainers
import platform.Foundation.NSJSONSerialization
import platform.Foundation.NSNumber
import platform.Foundation.NSUserDefaults
import platform.Foundation.NSUserName

private data class SessionState(
    val signature: String,
    val statKey: String,
    val label: String,
    val startedAtMillis: Long
)

private data class FrontApp(
    val appName: String,
    val bundleId: String
)

private data class MediaProbeSpec(
    val providerId: String,
    val sourceLabel: String,
    val bundleIds: List<String>,
    val parser: (List<String>) -> PulseBarMedia?
)

@OptIn(ExperimentalForeignApi::class)
actual class PulseBarBridge actual constructor() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store = PulseBarPreferencesStore()
    private val configStore = PulseBarConfigStore(
        fileSystem = pulseBarConfigFileSystem(),
        path = pulseBarConfigPath(),
    )
    private val reporter = PulseBarEndpointReporter()
    private val interactionClient: PulseBarInteractionClient
    private val mediaProbes by lazy {
        listOf(
            MediaProbeSpec(
                providerId = "spotify",
                sourceLabel = "Spotify",
                bundleIds = listOf("com.spotify.client"),
                parser = ::parseSpotifyMedia
            ),
            MediaProbeSpec(
                providerId = "apple-music",
                sourceLabel = "Music",
                bundleIds = listOf("com.apple.Music"),
                parser = ::parseITunesStyleMedia
            ),
            MediaProbeSpec(
                providerId = "netease-music",
                sourceLabel = "Netease Music",
                bundleIds = listOf("com.netease.163music", "com.netease.music"),
                parser = ::parseITunesStyleMedia
            ),
            MediaProbeSpec(
                providerId = "qq-music",
                sourceLabel = "QQ Music",
                bundleIds = listOf("com.tencent.qqmusic", "com.tencent.qqmusic.mac"),
                parser = ::parseITunesStyleMedia
            )
        )
    }
    private var currentSession: SessionState? = null
    private var lastObservedAtMillis: Long? = null
    private var lastVisibleApp: FrontApp? = null
    private var lastSelectedMediaProviderId: String? = null
    private var pendingElapsedMillis: Long = 0L

    init {
        val initial = currentConfig()
        interactionClient = PulseBarInteractionClient(initial)
        reporter.updateConfig(initial)
        logger(PulseLogCategory.AppLifecycle).i {
            "bridge.initialized endpoints=${initial.endpoints.size} enabled=${initial.endpoints.count { it.enabled }}"
        }
        scope.launch {
            configStore.configs.collect { proto ->
                val export = proto.toExport()
                reporter.updateConfig(export)
                reporter.resetIfDisabled(export)
                interactionClient.updateConfig(export)
                logger(PulseLogCategory.ConfigStore).d {
                    "config.observed endpoints=${export.endpoints.size}" +
                        " enabled=${export.endpoints.count { it.enabled }}" +
                        " disconnected=${export.endpoints.count { it.disconnected }}"
                }
            }
        }
    }

    actual fun readMenuState(): PulseBarMenuState {
        val config = currentConfig()
        val snapshot = readSnapshot()
        interactionClient.reconcilePlayback(snapshot.media)
        updateUsage(snapshot)
        reporter.capture(snapshot, config)
        reporter.sync(config)
        val rows = store.topRowsForDay(todayKey(), 3)
        return PulseBarMenuState(
            snapshot = snapshot,
            firstUsage = rows.getOrNull(0),
            secondUsage = rows.getOrNull(1),
            thirdUsage = rows.getOrNull(2)
        )
    }

    actual fun readStats(dayIso: String, limit: Int): PulseBarStatsPage {
        val rows = store.topRowsForDay(dayIso, limit)
        return PulseBarStatsPage(
            dayIso = dayIso,
            totalSeconds = rows.sumOf { it.totalSeconds },
            items = rows
        )
    }

    actual fun readLocalStats(dayIso: String, limit: Int): PulseBarLocalStats =
        PulseBarLocalStats(
            dayIso = dayIso,
            appFocusSeconds = store.totalSecondsForDay(dayIso, UsageSlice.APP),
            pageFocusSeconds = store.totalSecondsForDay(dayIso, UsageSlice.PAGE),
            mediaPlaybackSeconds = store.totalSecondsForDay(dayIso, UsageSlice.MEDIA),
            idleSeconds = 0,
            focusSwitchCount = store.readCounter(dayIso, "focus_switch_count"),
            pageSwitchCount = store.readCounter(dayIso, "page_switch_count"),
            mediaSwitchCount = store.readCounter(dayIso, "media_switch_count"),
            sessionCount = store.readCounter(dayIso, "session_count"),
            longestFocusStreakSeconds = store.readCounter(dayIso, "longest_focus_streak_seconds"),
            topApps = store.rowsForDay(dayIso, UsageSlice.APP, limit),
            topPages = store.rowsForDay(dayIso, UsageSlice.PAGE, limit),
            topMedia = store.rowsForDay(dayIso, UsageSlice.MEDIA, limit)
        )

    actual fun readConfig(): PulseBarConfig = currentConfig()

    actual fun updateConfig(config: PulseBarConfig) {
        // Writes hit DataStore; the `configs` flow subscriber in init() fans
        // out to reporter and interactionClient. No imperative updates here.
        configStore.replace(config.toProto())
    }

    actual fun readInteractionState(): PulseBarInteractionState =
        interactionClient.readState()

    actual fun readSyncState(): PulseBarSyncState =
        reporter.readSyncState(currentConfig())

    actual fun retryEndpoint(): Boolean =
        reporter.retry(readSnapshot(), currentConfig())

    actual fun acceptInteraction(requestId: String): Boolean =
        interactionClient.accept(requestId)

    actual fun dismissInteraction(requestId: String): Boolean =
        interactionClient.dismiss(requestId)

    actual fun mediaCommand(command: PulseBarPlaybackCommand): Boolean {
        val spotifyCommand = when (command) {
            PulseBarPlaybackCommand.PREVIOUS -> "previous track"
            PulseBarPlaybackCommand.TOGGLE_PLAY_PAUSE -> "playpause"
            PulseBarPlaybackCommand.NEXT -> "next track"
        }
        val spotifyScript = """
            tell application "Spotify"
                if it is running then
                    $spotifyCommand
                    return "ok"
                end if
            end tell
        """.trimIndent()
        if (runAppleScript(spotifyScript) == "ok") {
            pushRealtimeSnapshot()
            return true
        }

        val musicCommand = when (command) {
            PulseBarPlaybackCommand.PREVIOUS -> "previous track"
            PulseBarPlaybackCommand.TOGGLE_PLAY_PAUSE -> "playpause"
            PulseBarPlaybackCommand.NEXT -> "next track"
        }
        val musicScript = """
            tell application "Music"
                if it is running then
                    $musicCommand
                    return "ok"
                end if
            end tell
        """.trimIndent()
        val success = runAppleScript(musicScript) == "ok"
        if (success) {
            pushRealtimeSnapshot()
        }
        return success
    }

    actual fun seekMedia(progressSeconds: Double): Boolean {
        val normalized = progressSeconds.toString()
        val spotifyScript = """
            tell application "Spotify"
                if it is running then
                    set player position to $normalized
                    return "ok"
                end if
            end tell
        """.trimIndent()
        if (runAppleScript(spotifyScript) == "ok") {
            pushRealtimeSnapshot()
            return true
        }

        val musicScript = """
            tell application "Music"
                if it is running then
                    set player position to $normalized
                    return "ok"
                end if
            end tell
        """.trimIndent()
        val success = runAppleScript(musicScript) == "ok"
        if (success) {
            pushRealtimeSnapshot()
        }
        return success
    }

    private fun readSnapshot(): PulseBarSnapshot {
        val frontApp = resolvedFrontmostApplication()
        val effectiveApp = if (frontApp.bundleId in excludedStatsBundleIds || frontApp.appName == "Unknown App") {
            lastVisibleApp ?: frontApp
        } else {
            frontApp.also { lastVisibleApp = it }
        }
        val pageTitle = browserPageTitle(effectiveApp.bundleId)
        val media = mediaContext(effectiveApp.bundleId)
        return PulseBarSnapshot(
            appName = effectiveApp.appName,
            bundleId = effectiveApp.bundleId,
            pageTitle = pageTitle,
            observedAtIso8601 = iso8601Now(),
            media = media
        )
    }

    private fun resolvedFrontmostApplication(): FrontApp {
        val app = NSWorkspace.sharedWorkspace.frontmostApplication
        val bundleId = app?.bundleIdentifier ?: "unknown"
        val name = resolvedApplicationName(
            bundleId = bundleId,
            fallbackName = app?.localizedName
        )
        if (bundleId !in excludedStatsBundleIds && name != "PulseBarNative") {
            return FrontApp(name, bundleId)
        }

        val script = """
            tell application "System Events"
                tell first application process whose frontmost is true
                    return name & linefeed & bundle identifier
                end tell
            end tell
        """.trimIndent()
        val resolved = runAppleScript(script)?.lines().orEmpty()
        return FrontApp(
            appName = resolved.getOrNull(0)?.ifBlank { name } ?: name,
            bundleId = resolved.getOrNull(1)?.ifBlank { bundleId } ?: bundleId
        )
    }

    private fun resolvedApplicationName(bundleId: String, fallbackName: String?): String {
        val bundleName = bundleId
            .takeIf { it.isNotBlank() && it != "unknown" }
            ?.let(NSBundle::bundleWithIdentifier)
            ?.infoDictionary
            ?.let { info ->
                sequenceOf(
                    info["CFBundleDisplayName"] as? String,
                    info["CFBundleName"] as? String
                ).firstOrNull { !it.isNullOrBlank() }
            }
        val candidate = bundleName
            ?: fallbackName?.takeIf { it.isNotBlank() }
            ?: "Unknown App"
        return candidate
    }

    private fun updateUsage(snapshot: PulseBarSnapshot) {
        val nowMillis = currentTimeMillis()
        val day = todayKey()
        val label = buildString {
            append(snapshot.appName)
            snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
                append(" / ")
                append(it)
            }
        }
        val statKey = buildString {
            append(snapshot.bundleId)
            snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
                append("::")
                append(it)
            }
            snapshot.media?.trackId?.takeIf { it.isNotBlank() }?.let {
                append("::media:")
                append(it)
            }
        }
        val signature = buildString {
            append(snapshot.bundleId)
            append("::")
            append(snapshot.pageTitle ?: "")
            append("::")
            append(snapshot.media?.trackId ?: snapshot.media?.title ?: "")
        }

        currentSession?.let { session ->
            val deltaMillis = (nowMillis - (lastObservedAtMillis ?: session.startedAtMillis)).coerceAtLeast(0L)
            val accumulatedMillis = pendingElapsedMillis + deltaMillis
            val elapsedSeconds = (accumulatedMillis / 1000L).toInt()
            pendingElapsedMillis = accumulatedMillis % 1000L
            if (elapsedSeconds > 0) {
                store.incrementUsage(
                    day = day,
                    key = session.statKey,
                    label = session.label,
                    seconds = elapsedSeconds
                )
            }
        }

        if (currentSession?.signature != signature) {
            currentSession?.let { previous ->
                val previousParts = parseSessionParts(previous)
                val nextParts = SessionParts(
                    bundleId = snapshot.bundleId,
                    pageTitle = snapshot.pageTitle,
                    mediaKey = snapshot.media?.trackId ?: snapshot.media?.title
                )
                val streakSeconds = ((nowMillis - previous.startedAtMillis).coerceAtLeast(0L) / 1000L).toInt()
                store.updateMaxCounter(day, "longest_focus_streak_seconds", streakSeconds)
                store.incrementCounter(day, "session_count")
                if (previousParts.bundleId != nextParts.bundleId) {
                    store.incrementCounter(day, "focus_switch_count")
                }
                if (previousParts.pageTitle != nextParts.pageTitle) {
                    store.incrementCounter(day, "page_switch_count")
                }
                if (previousParts.mediaKey != nextParts.mediaKey && !previousParts.mediaKey.isNullOrBlank()) {
                    store.incrementCounter(day, "media_switch_count")
                }
            } ?: store.incrementCounter(day, "session_count")
            currentSession = SessionState(
                signature = signature,
                statKey = statKey,
                label = label,
                startedAtMillis = nowMillis
            )
            pendingElapsedMillis = 0L
        }

        lastObservedAtMillis = nowMillis
    }

    private fun browserPageTitle(bundleId: String): String? {
        val script = when (bundleId) {
            "com.apple.Safari" -> """
                tell application "Safari"
                    if it is running and (count of documents) > 0 then
                        return name of front document
                    end if
                end tell
            """.trimIndent()

            "com.google.Chrome" -> """
                tell application "Google Chrome"
                    if it is running and (count of windows) > 0 then
                        return title of active tab of front window
                    end if
                end tell
            """.trimIndent()

            else -> return null
        }
        return runAppleScript(script)?.takeIf { it.isNotBlank() }
    }

    private fun mediaContext(frontBundleId: String): PulseBarMedia? {
        val candidates = mediaProbes.mapNotNull { probe ->
            val media = probe.bundleIds.firstNotNullOfOrNull { bundleId ->
                val raw = runAppleScript(buildMediaProbeScript(bundleId, probe.providerId, probe.sourceLabel))
                raw?.lines()?.let(probe.parser)
            }
            media?.let { probe to it }
        }
        if (candidates.isEmpty()) return null

        candidates.firstOrNull { (probe, media) ->
            frontBundleId in probe.bundleIds && media.isPlaying
        }?.let {
            lastSelectedMediaProviderId = it.first.providerId
            return it.second
        }

        candidates.firstOrNull { (_, media) ->
            media.isPlaying
        }?.let {
            lastSelectedMediaProviderId = it.first.providerId
            return it.second
        }

        candidates.firstOrNull { (probe, _) ->
            probe.providerId == lastSelectedMediaProviderId
        }?.let { return it.second }

        candidates.firstOrNull { (probe, _) ->
            frontBundleId in probe.bundleIds
        }?.let {
            lastSelectedMediaProviderId = it.first.providerId
            return it.second
        }

        return candidates.firstOrNull()?.also {
            lastSelectedMediaProviderId = it.first.providerId
        }?.second
    }

    private fun buildMediaProbeScript(bundleId: String, providerId: String, sourceLabel: String): String =
        when (providerId) {
            "spotify" -> """
                tell application id "$bundleId"
                    if it is running then
                        if player state is playing or player state is paused then
                            return "$providerId" & linefeed & "$sourceLabel" & linefeed & "track" & linefeed & (player state as text) & linefeed & (player position as text) & linefeed & (id of current track) & linefeed & (spotify url of current track) & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (album artist of current track) & linefeed & (duration of current track as text) & linefeed & (track number of current track as text) & linefeed & (disc number of current track as text) & linefeed & (artwork url of current track)
                        end if
                    end if
                end tell
            """.trimIndent()

            "apple-music" -> """
                tell application id "$bundleId"
                    if it is running then
                        if player state is playing or player state is paused then
                            set trackId to ""
                            set artworkLink to ""
                            set playlistId to ""
                            set playlistName to ""
                            try
                                set trackId to (persistent ID of current track)
                            end try
                            try
                                set artworkLink to (artwork url of current track)
                            end try
                            try
                                set playlistId to (persistent ID of current playlist)
                                set playlistName to (name of current playlist)
                            end try
                            return "$providerId" & linefeed & "$sourceLabel" & linefeed & (class of current track as text) & linefeed & (player state as text) & linefeed & (player position as text) & linefeed & trackId & linefeed & "" & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (album artist of current track) & linefeed & (duration of current track as text) & linefeed & (track number of current track as text) & linefeed & (disc number of current track as text) & linefeed & artworkLink & linefeed & playlistId & linefeed & playlistName
                        end if
                    end if
                end tell
            """.trimIndent()

            else -> """
                tell application id "$bundleId"
                    if it is running then
                        if player state is playing or player state is paused then
                            set trackId to ""
                            set artworkLink to ""
                            set playlistId to ""
                            set playlistName to ""
                            try
                                set trackId to (persistent ID of current track)
                            end try
                            try
                                set artworkLink to (artwork url of current track)
                            end try
                            try
                                set playlistId to (persistent ID of current playlist)
                                set playlistName to (name of current playlist)
                            end try
                            return "$providerId" & linefeed & "$sourceLabel" & linefeed & "track" & linefeed & (player state as text) & linefeed & (player position as text) & linefeed & trackId & linefeed & "" & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (album artist of current track) & linefeed & (duration of current track as text) & linefeed & (track number of current track as text) & linefeed & (disc number of current track as text) & linefeed & artworkLink & linefeed & playlistId & linefeed & playlistName
                        end if
                    end if
                end tell
            """.trimIndent()

        }

    private fun parseSpotifyMedia(lines: List<String>): PulseBarMedia? {
        val values = lines.map { it.trim() }
        if (values.size < 8) return null
        val padded = values + List((15 - values.size).coerceAtLeast(0)) { "" }
        val rawDuration = padded[11].toIntOrNull() ?: 0
        val durationSeconds = if (rawDuration > 10_000) rawDuration / 1000 else rawDuration
        return PulseBarMedia(
            providerId = padded[0],
            source = padded[1],
            itemType = normalizeItemType(padded[2]),
            title = padded[7],
            artist = padded[8],
            album = padded[9].ifBlank { null },
            albumArtist = padded[10].ifBlank { null },
            artworkUrl = padded[14].ifBlank { null },
            progressSeconds = padded[4].replace(',', '.').toDoubleOrNull() ?: 0.0,
            durationSeconds = durationSeconds,
            linkUrl = padded[6].ifBlank { null },
            trackId = padded[5].ifBlank { null },
            isPlaying = padded[3] == "playing",
            trackNumber = padded[12].toIntOrNull(),
            discNumber = padded[13].toIntOrNull(),
            collectionId = null,
            collectionTitle = null,
            collectionLinkUrl = null
        )
    }

    private fun parseITunesStyleMedia(lines: List<String>): PulseBarMedia? {
        val values = lines.map { it.trim() }
        if (values.size < 17) return null
        val durationSeconds = values[11].replace(',', '.').toDoubleOrNull()?.toInt() ?: 0
        val playlistId = values.getOrNull(15)?.ifBlank { null }
        val playlistTitle = values.getOrNull(16)?.ifBlank { null }
        return PulseBarMedia(
            providerId = values[0],
            source = values[1],
            itemType = normalizeItemType(values[2]),
            title = values[7],
            artist = values[8],
            album = values[9].ifBlank { null },
            albumArtist = values[10].ifBlank { null },
            artworkUrl = values[14].ifBlank { null },
            progressSeconds = values[4].replace(',', '.').toDoubleOrNull() ?: 0.0,
            durationSeconds = durationSeconds,
            linkUrl = null,
            trackId = values[5].ifBlank { null },
            isPlaying = values[3] == "playing",
            trackNumber = values[12].toIntOrNull(),
            discNumber = values[13].toIntOrNull(),
            collectionId = playlistId,
            collectionTitle = playlistTitle,
            collectionLinkUrl = playlistId?.let { "music://playlist/$it" }
        )
    }

    private fun normalizeItemType(raw: String?): String {
        val value = raw?.trim()?.lowercase().orEmpty()
        return when {
            value.contains("track") || value.contains("song") || value.contains("file") -> "track"
            value.contains("album") -> "album"
            value.contains("playlist") -> "playlist"
            value.contains("episode") || value.contains("podcast") -> "episode"
            value.contains("stream") || value.contains("radio") -> "stream"
            else -> "unknown"
        }
    }

    private fun runAppleScript(script: String): String? {
        val appleScript = NSAppleScript(source = script)
        val result = appleScript.executeAndReturnError(null)
        if (result.stringValue == null) {
            logger(PulseLogCategory.PlatformAdapter).d { "applescript.empty_result" }
        }
        return result.stringValue?.trim()
    }

    private fun pushRealtimeSnapshot() {
        val config = currentConfig()
        if (config.endpoints.none { it.enabled }) return
        reporter.forceSync(readSnapshot(), config)
    }

    private fun currentConfig(): PulseBarConfig = configStore.snapshot().toExport()

    private fun currentTimeMillis(): Long =
        (NSDate().timeIntervalSinceReferenceDate * 1000.0).toLong()

    private fun iso8601Now(): String {
        val formatter = NSDateFormatter().apply {
            dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        }
        return formatter.stringFromDate(NSDate())
    }

    private fun todayKey(): String = iso8601Now().substring(0, 10)
}

private data class SessionParts(
    val bundleId: String,
    val pageTitle: String?,
    val mediaKey: String?
)

private fun parseSessionParts(session: SessionState): SessionParts {
    val parts = session.signature.split("::")
    return SessionParts(
        bundleId = parts.getOrElse(0) { "unknown" },
        pageTitle = parts.getOrNull(1)?.takeIf { it.isNotBlank() },
        mediaKey = parts.getOrNull(2)?.takeIf { it.isNotBlank() }
    )
}
