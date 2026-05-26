package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.github.kt.pulsebar.platform.resolveAppDisplayName
import io.github.kt.pulsebar.utils.nowInIso8601
import kotlinx.cinterop.ExperimentalForeignApi
import platform.AppKit.NSWorkspace
import platform.Foundation.NSAppleScript


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


object Probe {

    fun mediaCommand(command: PulseBarPlaybackCommand): Boolean {
        val appleScriptVerb = when (command) {
            PulseBarPlaybackCommand.PREVIOUS -> "previous track"
            PulseBarPlaybackCommand.TOGGLE_PLAY_PAUSE -> "playpause"
            PulseBarPlaybackCommand.NEXT -> "next track"
        }
        val spotifyScript = """
            tell application "Spotify"
                if it is running then
                    $appleScriptVerb
                    return "ok"
                end if
            end tell
        """.trimIndent()
        if (runAppleScript(spotifyScript) == "ok") {
            // emit event
            return true
        }

        val musicScript = """
            tell application "Music"
                if it is running then
                    $appleScriptVerb
                    return "ok"
                end if
            end tell
        """.trimIndent()
        val success = runAppleScript(musicScript) == "ok"
        // emit event
        return success
    }

    fun seekMedia(progressSeconds: Double): Boolean {
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
        // emit seekEvent
        return success
    }

    private var lastVisibleApp: FrontApp? = null
    private var lastSelectedMediaProviderId: String? = null
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
            observedAtIso8601 = nowInIso8601(),
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
        val resolved = resolveAppDisplayName(bundleId)
        return resolved
            ?: fallbackName?.takeIf { it.isNotBlank() }
            ?: "Unknown App"
    }
    @OptIn(ExperimentalForeignApi::class)
    private fun runAppleScript(script: String): String? {
        val appleScript = NSAppleScript(source = script)
        val result = appleScript.executeAndReturnError(null)
        if (result.stringValue == null) {
            logger(PulseLogCategory.PlatformAdapter).d { "applescript.empty_result" }
        }
        return result.stringValue?.trim()
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

}

