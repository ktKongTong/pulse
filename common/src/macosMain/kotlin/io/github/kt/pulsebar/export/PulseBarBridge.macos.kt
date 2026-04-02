package io.github.kt.pulsebar.export

import kotlinx.cinterop.ExperimentalForeignApi
import platform.AppKit.NSWorkspace
import platform.Foundation.NSAppleScript
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter
import platform.Foundation.NSFileManager
import platform.Foundation.NSHomeDirectory
import platform.Foundation.NSJSONReadingMutableContainers
import platform.Foundation.NSJSONSerialization
import platform.Foundation.NSNumber
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.timeIntervalSinceReferenceDate
import platform.Foundation.writeToFile

private data class SessionState(
    val signature: String,
    val label: String,
    val startedAtMillis: Long
)

actual class PulseBarBridge actual constructor() {
    private var currentSession: SessionState? = null
    private var lastObservedAtMillis: Long? = null
    private val statsByKey = linkedMapOf<String, PulseBarUsageRow>()
    private var lastVisibleApp: Pair<String, String>? = null

    actual fun readMenuState(): PulseBarMenuState {
        val snapshot = readSnapshot()
        updateUsage(snapshot)
        val rows = topRows()
        return PulseBarMenuState(
            snapshot = snapshot,
            firstUsage = rows.getOrNull(0),
            secondUsage = rows.getOrNull(1),
            thirdUsage = rows.getOrNull(2)
        )
    }

    @OptIn(ExperimentalForeignApi::class)
    actual fun readConfig(): PulseBarConfig {
        val path = configPath()
        val data = NSFileManager.defaultManager.contentsAtPath(path)
        if (data == null) {
            return defaultConfig()
        }
        val json = NSJSONSerialization.JSONObjectWithData(data, NSJSONReadingMutableContainers, null) as? Map<*, *>
            ?: return defaultConfig()

        val endpoint = json["endpoint"] as? Map<*, *>
        val transport = when (endpoint?.get("transport") as? String) {
            "WEBHOOK" -> PulseBarTransport.WEBHOOK
            "HTTP_BATCH" -> PulseBarTransport.HTTP_BATCH
            else -> PulseBarTransport.WEBSOCKET
        }

        return PulseBarConfig(
            endpointEnabled = endpoint?.get("enabled") as? Boolean ?: false,
            transport = transport,
            transportName = transport.name,
            endpointUrl = endpoint?.get("url") as? String ?: "",
            apiKey = endpoint?.get("apiKey") as? String ?: "",
            batchWindowSeconds = numberValue(endpoint?.get("batchWindowSeconds")).ifZero(15),
            idleThresholdSeconds = numberValue(json["idleThresholdSeconds"]).ifZero(300),
            changeStabilityMillis = numberValue(json["changeStabilityMillis"]).ifZero(1200),
            heartbeatSeconds = numberValue(json["heartbeatSeconds"]).ifZero(60),
            appPollingMillis = numberValue(json["appPollingMillis"]).ifZero(500),
            pagePollingMillis = numberValue(json["pagePollingMillis"]).ifZero(2000),
            mediaPollingMillis = numberValue(json["mediaPollingMillis"]).ifZero(500)
        )
    }

    @OptIn(ExperimentalForeignApi::class)
    actual fun updateConfig(config: PulseBarConfig) {
        val root = NSHomeDirectory() + "/Library/Application Support/PulseBar"
        NSFileManager.defaultManager.createDirectoryAtPath(root, true, null, null)
        val json = """
            {
              "idleThresholdSeconds": ${config.idleThresholdSeconds},
              "changeStabilityMillis": ${config.changeStabilityMillis},
              "heartbeatSeconds": ${config.heartbeatSeconds},
              "appPollingMillis": ${config.appPollingMillis},
              "pagePollingMillis": ${config.pagePollingMillis},
              "mediaPollingMillis": ${config.mediaPollingMillis},
              "endpoint": {
                "enabled": ${config.endpointEnabled},
                "transport": "${config.transport.name}",
                "url": "${escapeJson(config.endpointUrl)}",
                "apiKey": "${escapeJson(config.apiKey)}",
                "batchWindowSeconds": ${config.batchWindowSeconds}
              },
              "appRules": []
            }
        """.trimIndent()
        (json as NSString).writeToFile(configPath(), true, NSUTF8StringEncoding, null)
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun readSnapshot(): PulseBarSnapshot {
        val frontApp = resolvedFrontmostApplication()
        val effectiveApp = if (frontApp.second in excludedBundleIds || frontApp.first == "Unknown App") {
            lastVisibleApp ?: frontApp
        } else {
            frontApp.also { lastVisibleApp = it }
        }
        val appName = effectiveApp.first
        val bundleId = effectiveApp.second
        val observedAt = iso8601Now()
        val pageTitle = browserPageTitle(bundleId)
        val media = spotifyMedia()

        return PulseBarSnapshot(
            appName = appName,
            bundleId = bundleId,
            pageTitle = pageTitle,
            observedAtIso8601 = observedAt,
            media = media
        )
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun resolvedFrontmostApplication(): Pair<String, String> {
        val app = NSWorkspace.sharedWorkspace.frontmostApplication
        val name = app?.localizedName ?: "Unknown App"
        val bundleId = app?.bundleIdentifier ?: "unknown"
        if (bundleId !in excludedBundleIds && name != "PulseBarNative") {
            return name to bundleId
        }

        val script = """
            tell application "System Events"
                tell first application process whose frontmost is true
                    return name & linefeed & bundle identifier
                end tell
            end tell
        """.trimIndent()
        val resolved = runAppleScript(script)?.lines() ?: return name to bundleId
        val fallbackName = resolved.getOrNull(0)?.ifBlank { name } ?: name
        val fallbackBundle = resolved.getOrNull(1)?.ifBlank { bundleId } ?: bundleId
        return fallbackName to fallbackBundle
    }

    private fun updateUsage(snapshot: PulseBarSnapshot) {
        val nowMillis = currentTimeMillis()
        val label = buildString {
            append(snapshot.appName)
            snapshot.pageTitle?.takeIf { it.isNotBlank() }?.let {
                append(" / ")
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
            val elapsedSeconds = (((nowMillis - (lastObservedAtMillis ?: session.startedAtMillis)).coerceAtLeast(0L)) / 1000L).toInt()
            if (elapsedSeconds > 0) {
                val sessionKey = "live:${session.signature}"
                val previous = statsByKey[sessionKey]
                statsByKey[sessionKey] = PulseBarUsageRow(
                    label = session.label,
                    totalSeconds = (previous?.totalSeconds ?: 0) + elapsedSeconds
                )
            }
        }

        if (currentSession?.signature != signature) {
            currentSession = SessionState(
                signature = signature,
                label = label,
                startedAtMillis = nowMillis
            )
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

    private fun spotifyMedia(): PulseBarMedia? {
        val script = """
            tell application "Spotify"
                if it is running then
                    if player state is playing or player state is paused then
                        return (id of current track) & linefeed & (player state as text) & linefeed & (name of current track) & linefeed & (artist of current track) & linefeed & (album of current track) & linefeed & (artwork url of current track) & linefeed & (player position as text) & linefeed & (duration of current track as text) & linefeed & (spotify url of current track)
                    end if
                end if
            end tell
        """.trimIndent()
        val raw = runAppleScript(script) ?: return null
        val lines = raw.lines()
        if (lines.size < 9) return null
        val rawDuration = lines[7].toIntOrNull() ?: 0
        val durationSeconds = if (rawDuration > 10_000) rawDuration / 1000 else rawDuration
        return PulseBarMedia(
            source = "Spotify",
            title = lines[2],
            artist = lines[3],
            album = lines[4].ifBlank { null },
            artworkUrl = lines[5].ifBlank { null },
            progressSeconds = lines[6].replace(',', '.').toDoubleOrNull() ?: 0.0,
            durationSeconds = durationSeconds,
            linkUrl = lines[8].ifBlank { null },
            trackId = lines[0].ifBlank { null },
            isPlaying = lines[1] == "playing"
        )
    }

    private fun currentTimeMillis(): Long =
        (NSDate().timeIntervalSinceReferenceDate * 1000.0).toLong()

    private fun topRows(): List<PulseBarUsageRow> =
        statsByKey.values.sortedByDescending { it.totalSeconds }.take(3)

    private fun configPath(): String =
        NSHomeDirectory() + "/Library/Application Support/PulseBar/config.json"

    private fun defaultConfig() = PulseBarConfig(
        endpointEnabled = false,
        transport = PulseBarTransport.WEBSOCKET,
        transportName = PulseBarTransport.WEBSOCKET.name,
        endpointUrl = "",
        apiKey = "",
        batchWindowSeconds = 15,
        idleThresholdSeconds = 300,
        changeStabilityMillis = 1200,
        heartbeatSeconds = 60,
        appPollingMillis = 500,
        pagePollingMillis = 2000,
        mediaPollingMillis = 500
    )

    private fun numberValue(value: Any?): Int =
        when (value) {
            is NSNumber -> value.intValue
            is Int -> value
            is Long -> value.toInt()
            is Double -> value.toInt()
            else -> 0
        }

    private fun Int.ifZero(defaultValue: Int): Int =
        if (this == 0) defaultValue else this

    companion object {
        private val excludedBundleIds = setOf(
            "io.github.kt.pulsebar.native",
            "com.apple.FollowUpUI"
        )
    }

    private fun escapeJson(text: String): String =
        text.replace("\\", "\\\\").replace("\"", "\\\"")

    @OptIn(ExperimentalForeignApi::class)
    private fun runAppleScript(script: String): String? {
        val appleScript = NSAppleScript(source = script) ?: return null
        val result = appleScript.executeAndReturnError(null) ?: return null
        return result.stringValue?.trim()
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun iso8601Now(): String {
        val formatter = NSDateFormatter().apply {
            dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
        }
        return formatter.stringFromDate(NSDate())
    }
}
