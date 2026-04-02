package io.github.kt.pulsebar.monitor

import io.github.kt.pulsebar.shared.ActivitySnapshot
import io.github.kt.pulsebar.shared.FocusTarget
import io.github.kt.pulsebar.shared.MediaContext
import io.github.kt.pulsebar.shared.MonitorConfig
import io.github.kt.pulsebar.shared.PageContext
import io.github.kt.pulsebar.shared.PresenceState
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.datetime.Instant

data class LiveSample(
    val snapshot: ActivitySnapshot,
    val diagnostics: List<String> = emptyList()
)

class MacActivityMonitor {
    private var lastFrontBundleId: String? = null
    private var lastPageAtMillis: Long = 0L
    private var lastMediaAtMillis: Long = 0L
    private var cachedPage: PageContext? = null
    private var cachedMedia: MediaContext? = null

    suspend fun sample(config: MonitorConfig): LiveSample {
        val diagnostics = mutableListOf<String>()
        val frontApp = frontApp().getOrElse {
            diagnostics += "Front app probe failed: ${it.message}"
            FrontApp(
                name = "Unknown App",
                bundleId = "unknown",
                pid = null,
                bundlePath = null
            )
        }

        val nowMillis = System.currentTimeMillis()
        val idleSeconds = idleSeconds().getOrElse {
            diagnostics += "Idle probe failed: ${it.message}"
            0L
        }
        val presence = if (idleSeconds >= config.idleThresholdSeconds) PresenceState.AWAY else PresenceState.ACTIVE

        val shouldRefreshPage = frontApp.bundleId != lastFrontBundleId ||
            nowMillis - lastPageAtMillis >= config.pagePollingMillis
        val page = if (frontApp.bundleId in supportedBrowsers.keys) {
            if (shouldRefreshPage) {
                lastPageAtMillis = nowMillis
                browserPage(frontApp.bundleId).getOrElse {
                    diagnostics += "Browser probe failed: ${it.message}"
                    null
                }.also {
                    cachedPage = it
                }
            } else {
                cachedPage
            }
        } else {
            cachedPage = null
            null
        }

        val effectiveMediaPollingMillis = config.mediaPollingMillis.coerceAtMost(500L).coerceAtLeast(250L)
        val shouldRefreshMedia = nowMillis - lastMediaAtMillis >= effectiveMediaPollingMillis
        val media = if (shouldRefreshMedia) {
            lastMediaAtMillis = nowMillis
            mediaContext().getOrElse {
                diagnostics += "Media probe failed: ${it.message}"
                null
            }.also {
                cachedMedia = it
            }
        } else {
            cachedMedia
        }

        lastFrontBundleId = frontApp.bundleId

        return LiveSample(
            snapshot = ActivitySnapshot(
                observedAt = Instant.fromEpochMilliseconds(System.currentTimeMillis()),
                focus = FocusTarget(
                    appName = frontApp.name,
                    bundleId = frontApp.bundleId,
                    pid = frontApp.pid,
                    bundlePath = frontApp.bundlePath,
                    page = page
                ),
                presence = presence,
                idleSeconds = idleSeconds,
                media = media
            ),
            diagnostics = diagnostics
        )
    }

    private suspend fun frontApp(): Result<FrontApp> {
        val result = runShell(
            """lsappinfo info -app "$(lsappinfo front | awk -F': ' '{print $2}')" """.trimIndent()
        )
        if (!result.isSuccess) {
            return frontAppFromSystemEvents()
        }

        val lines = result.stdout.lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return frontAppFromSystemEvents()

        val name = Regex("^\"(.+)\"\\s+ASN:").find(lines.first())?.groupValues?.getOrNull(1) ?: "Unknown App"
        val bundleId = lines.firstNotNullOfOrNull { Regex("""bundleID="([^"]+)"""").find(it)?.groupValues?.getOrNull(1) }
            ?: "unknown"
        val bundlePath = lines.firstNotNullOfOrNull { Regex("""bundle path="([^"]+)"""").find(it)?.groupValues?.getOrNull(1) }
        val pid = lines.firstNotNullOfOrNull { Regex("""pid = (\d+)""").find(it)?.groupValues?.getOrNull(1)?.toIntOrNull() }

        if (bundleId == "unknown" && name == "Unknown App") {
            return frontAppFromSystemEvents()
        }

        return Result.success(
            FrontApp(
                name = name,
                bundleId = bundleId,
                pid = pid,
                bundlePath = bundlePath
            )
        )
    }

    private suspend fun frontAppFromSystemEvents(): Result<FrontApp> {
        val nameResult = runAppleScript(
            """
                tell application "System Events"
                    tell first application process whose frontmost is true
                        return name & linefeed & bundle identifier & linefeed & unix id
                    end tell
                end tell
            """.trimIndent(),
            timeoutMs = 2000
        )
        if (!nameResult.isSuccess) {
            return Result.failure(IllegalStateException(nameResult.stderr.ifBlank { "System Events fallback failed" }))
        }

        val lines = nameResult.stdout.lines().map { it.trim() }.filter { it.isNotBlank() }
        return Result.success(
            FrontApp(
                name = lines.getOrNull(0) ?: "Unknown App",
                bundleId = lines.getOrNull(1) ?: "unknown",
                pid = lines.getOrNull(2)?.toIntOrNull(),
                bundlePath = null
            )
        )
    }

    private suspend fun idleSeconds(): Result<Long> {
        val result = runShell("""ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int(${ '$' }NF/1000000000); exit}'""")
        if (!result.isSuccess) return Result.failure(IllegalStateException(result.stderr.ifBlank { "ioreg failed" }))
        return Result.success(result.stdout.trim().toLongOrNull() ?: 0L)
    }

    private suspend fun browserPage(bundleId: String): Result<PageContext?> {
        val appName = supportedBrowsers[bundleId] ?: return Result.success(null)
        val script = when (bundleId) {
            "com.apple.Safari" -> """
                tell application "$appName"
                    if it is running and (count of documents) > 0 then
                        return (name of front document) & linefeed & (URL of front document)
                    end if
                end tell
            """.trimIndent()

            else -> """
                tell application "$appName"
                    if it is running and (count of windows) > 0 then
                        return (title of active tab of front window) & linefeed & (URL of active tab of front window)
                    end if
                end tell
            """.trimIndent()
        }

        val result = runAppleScript(script, timeoutMs = 2500)
        if (!result.isSuccess) return Result.failure(IllegalStateException(result.stderr.ifBlank { "AppleScript failed" }))
        val lines = result.stdout.lines()
        if (lines.isEmpty() || lines.first().isBlank()) return Result.success(null)
        return Result.success(
            PageContext(
                title = lines.getOrNull(0)?.trim().takeIf { !it.isNullOrBlank() },
                url = lines.drop(1).joinToString("\n").trim().takeIf { it.isNotBlank() }
            )
        )
    }

    private suspend fun mediaContext(): Result<MediaContext?> {
        val spotify = runAppleScript(
            """
                tell application "Spotify"
                    if it is running then
                        if player state is playing or player state is paused then
                            return "Spotify" & linefeed & (player state as text) & linefeed & (player position as text) & linefeed & (id of current track) & linefeed & (spotify url of current track) & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (album artist of current track) & linefeed & (duration of current track as text) & linefeed & (track number of current track as text) & linefeed & (disc number of current track as text) & linefeed & (popularity of current track as text) & linefeed & (artwork url of current track)
                        end if
                    end if
                end tell
            """.trimIndent(),
            timeoutMs = 2500
        )
        parseSpotifyMedia(spotify)?.let { return Result.success(it) }

        val music = runAppleScript(
            """
                tell application "Music"
                    if it is running then
                        if player state is playing or player state is paused then
                            return "Music" & linefeed & (player state as text) & linefeed & (player position as text) & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track)
                        end if
                    end if
                end tell
            """.trimIndent(),
            timeoutMs = 2500
        )
        parseMusicMedia(music)?.let { return Result.success(it) }

        return Result.success(null)
    }

    private fun parseSpotifyMedia(result: ShellResult): MediaContext? {
        if (!result.isSuccess) return null
        val lines = result.stdout.lines().filter { it.isNotBlank() }
        if (lines.size < 14) return null
        return MediaContext(
            source = "Spotify",
            state = lines.getOrNull(1).orEmpty(),
            progressSeconds = lines.getOrNull(2)?.normalizedDouble(),
            trackId = lines.getOrNull(3),
            linkUrl = lines.getOrNull(4),
            title = lines.getOrNull(5),
            artist = lines.getOrNull(6),
            album = lines.getOrNull(7),
            albumArtist = lines.getOrNull(8),
            durationSeconds = lines.getOrNull(9)?.toIntOrNull()?.let { raw ->
                if (raw > 10_000) raw / 1000 else raw
            },
            trackNumber = lines.getOrNull(10)?.toIntOrNull(),
            discNumber = lines.getOrNull(11)?.toIntOrNull(),
            popularity = lines.getOrNull(12)?.toIntOrNull(),
            artworkUrl = lines.getOrNull(13)
        )
    }

    private fun parseMusicMedia(result: ShellResult): MediaContext? {
        if (!result.isSuccess) return null
        val lines = result.stdout.lines().filter { it.isNotBlank() }
        if (lines.size < 6) return null
        return MediaContext(
            source = "Music",
            state = lines.getOrNull(1).orEmpty(),
            progressSeconds = lines.getOrNull(2)?.normalizedDouble(),
            title = lines.getOrNull(3),
            artist = lines.getOrNull(4),
            album = lines.getOrNull(5)
        )
    }

    private fun String.normalizedDouble(): Double? =
        trim().replace(',', '.').toDoubleOrNull()

    private suspend fun runAppleScript(script: String, timeoutMs: Long): ShellResult =
        runShell(
            """
                osascript <<'APPLESCRIPT'
                $script
                APPLESCRIPT
            """.trimIndent(),
            timeoutMs = timeoutMs
        )

    private suspend fun runShell(command: String, timeoutMs: Long = 1500): ShellResult =
        withContext(Dispatchers.IO) {
            val process = ProcessBuilder("/bin/zsh", "-lc", command)
                .redirectErrorStream(false)
                .start()

            val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
            if (!finished) {
                process.destroyForcibly()
                return@withContext ShellResult(
                    isSuccess = false,
                    stdout = "",
                    stderr = "Command timed out after ${timeoutMs}ms"
                )
            }

            ShellResult(
                isSuccess = process.exitValue() == 0,
                stdout = process.inputStream.bufferedReader().readText().trim(),
                stderr = process.errorStream.bufferedReader().readText().trim()
            )
        }

    private data class FrontApp(
        val name: String,
        val bundleId: String,
        val pid: Int?,
        val bundlePath: String?
    )

    private data class ShellResult(
        val isSuccess: Boolean,
        val stdout: String,
        val stderr: String
    )

    companion object {
        private val supportedBrowsers = mapOf(
            "com.apple.Safari" to "Safari",
            "com.google.Chrome" to "Google Chrome",
            "com.brave.Browser" to "Brave Browser",
            "com.microsoft.edgemac" to "Microsoft Edge",
            "org.chromium.Chromium" to "Chromium",
            "com.vivaldi.Vivaldi" to "Vivaldi",
            "company.thebrowser.Browser" to "Arc"
        )
    }
}
