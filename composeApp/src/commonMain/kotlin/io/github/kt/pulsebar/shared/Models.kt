package io.github.kt.pulsebar.shared

import io.github.kt.pulsebar.presence.MediaPlaybackScope
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.serialization.Serializable

@Serializable
data class MonitorConfig(
    val idleThresholdSeconds: Long = 300,
    val changeStabilityMillis: Long = 1200,
    val heartbeatSeconds: Long = 60,
    val appPollingMillis: Long = 500,
    val pagePollingMillis: Long = 2000,
    val mediaPollingMillis: Long = 500,
    val endpoint: EndpointConfig = EndpointConfig(),
    val appRules: List<AppRule> = emptyList()
)

@Serializable
data class EndpointConfig(
    val enabled: Boolean = false,
    val transport: EndpointTransport = EndpointTransport.WEBSOCKET,
    val workspaceId: String = "",
    val siteId: String = "",
    val url: String = "",
    val apiKey: String = "",
    val batchWindowSeconds: Long = 15
)

@Serializable
enum class EndpointTransport {
    WEBSOCKET,
    WEBHOOK,
    HTTP_BATCH
}

@Serializable
data class AppRule(
    val pattern: String,
    val matcher: RuleMatcher = RuleMatcher.BUNDLE_ID_CONTAINS,
    val mode: PrivacyMode = PrivacyMode.TRACK
)

@Serializable
enum class RuleMatcher {
    EXACT,
    CONTAINS,
    REGEX,
    BUNDLE_ID_CONTAINS,
    APP_NAME_CONTAINS
}

@Serializable
enum class PrivacyMode {
    TRACK,
    ANONYMIZE,
    EXCLUDE
}

@Serializable
enum class PresenceState {
    ACTIVE,
    AWAY
}

@Serializable
data class FocusTarget(
    val appName: String,
    val bundleId: String,
    val pid: Int? = null,
    val bundlePath: String? = null,
    val page: PageContext? = null,
    val privacyMode: PrivacyMode = PrivacyMode.TRACK
)

@Serializable
data class PageContext(
    val title: String? = null,
    val url: String? = null
)

@Serializable
data class MediaContext(
    val source: String,
    val state: String,
    val scope: MediaPlaybackScope = MediaPlaybackScope.LOCAL,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val albumArtist: String? = null,
    val trackId: String? = null,
    val linkUrl: String? = null,
    val artworkUrl: String? = null,
    val progressSeconds: Double? = null,
    val durationSeconds: Int? = null,
    val popularity: Int? = null,
    val trackNumber: Int? = null,
    val discNumber: Int? = null
)

@Serializable
data class ActivitySnapshot(
    val observedAt: Instant,
    val focus: FocusTarget,
    val presence: PresenceState,
    val idleSeconds: Long,
    val media: MediaContext? = null
)

@Serializable
enum class ActivityEventType {
    STATUS_CHANGED,
    HEARTBEAT,
    SESSION_ENDED
}

@Serializable
data class ClientIdentity(
    val deviceName: String,
    val userName: String? = null,
    val appVersion: String = "0.1.0",
    val platform: String = "macOS",
    val appMode: String = "LSUIElement"
)

@Serializable
data class ActivityEnvelope(
    val protocol: String = "presence.v1",
    val sequence: Long,
    val eventType: ActivityEventType,
    val sentAt: Instant,
    val stableSince: Instant,
    val stableForSeconds: Long,
    val client: ClientIdentity,
    val snapshot: ActivitySnapshot
)

@Serializable
data class ActivityLogEntry(
    val id: String,
    val recordedAt: Instant,
    val type: ActivityEventType,
    val message: String,
    val snapshot: ActivitySnapshot? = null
)

@Serializable
data class UsageSummaryRow(
    val day: LocalDate,
    val key: String,
    val label: String,
    val privacyMode: PrivacyMode,
    val totalSeconds: Long,
    val lastSeenAt: Instant
)

private val reservedSystemBundleIds = setOf(
    "com.apple.loginwindow",
    "com.apple.FollowUpUI",
    "unknown"
)

fun AppRule.matches(focus: FocusTarget): Boolean {
    if (pattern.isBlank()) return false
    return when (matcher) {
        RuleMatcher.EXACT -> focus.bundleId == pattern || focus.appName == pattern
        RuleMatcher.CONTAINS -> focus.bundleId.contains(pattern, ignoreCase = true) ||
            focus.appName.contains(pattern, ignoreCase = true)
        RuleMatcher.REGEX -> Regex(pattern).containsMatchIn(focus.bundleId) ||
            Regex(pattern).containsMatchIn(focus.appName)
        RuleMatcher.BUNDLE_ID_CONTAINS -> focus.bundleId.contains(pattern, ignoreCase = true)
        RuleMatcher.APP_NAME_CONTAINS -> focus.appName.contains(pattern, ignoreCase = true)
    }
}

fun List<AppRule>.resolvePrivacyMode(focus: FocusTarget): PrivacyMode =
    firstOrNull { it.matches(focus) }?.mode ?: PrivacyMode.TRACK

fun ActivitySnapshot.applyPrivacy(mode: PrivacyMode): ActivitySnapshot? =
    when (mode) {
        PrivacyMode.TRACK -> this
        PrivacyMode.EXCLUDE -> null
        PrivacyMode.ANONYMIZE -> {
            val anonymousKey = focus.bundleId.hashCode().toUInt().toString(16)
            copy(
                focus = focus.copy(
                    appName = "Anonymous App $anonymousKey",
                    bundleId = "anonymous:$anonymousKey",
                    page = null,
                    privacyMode = PrivacyMode.ANONYMIZE
                ),
                media = media?.copy(
                    title = null,
                    artist = null,
                    album = null,
                    albumArtist = null,
                    trackId = null,
                    linkUrl = null,
                    artworkUrl = null
                )
            )
        }
    }

fun ActivitySnapshot.signature(): String {
    val pagePart = listOfNotNull(focus.page?.title, focus.page?.url).joinToString("|")
    val mediaPart = listOfNotNull(media?.source, media?.state, media?.title, media?.artist).joinToString("|")
    return listOf(
        presence.name,
        focus.bundleId,
        focus.appName,
        pagePart,
        mediaPart
    ).joinToString("::")
}

fun ActivitySnapshot.displayName(): String =
    buildString {
        append(focus.appName)
        focus.page?.title?.takeIf { it.isNotBlank() }?.let {
            append(" / ")
            append(it)
        }
        if (presence == PresenceState.AWAY) {
            append(" (Away)")
        }
    }

fun ActivitySnapshot.isReservedSystemApp(): Boolean =
    focus.bundleId in reservedSystemBundleIds

fun ActivitySnapshot.shouldAggregateUsage(): Boolean =
    presence == PresenceState.ACTIVE && !isReservedSystemApp()

fun formatDuration(totalSeconds: Long): String {
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return when {
        hours > 0 -> "%dh %02dm".format(hours, minutes)
        minutes > 0 -> "%dm %02ds".format(minutes, seconds)
        else -> "%ds".format(seconds)
    }
}

fun formatPlaybackProgress(progressSeconds: Double?, durationSeconds: Int?): String? {
    val progress = progressSeconds?.toLong() ?: return null
    val left = formatClock(progress)
    val right = durationSeconds?.let(::formatClock) ?: return left
    return "$left / $right"
}

private fun formatClock(totalSeconds: Long): String {
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}

private fun formatClock(totalSeconds: Int): String = formatClock(totalSeconds.toLong())
