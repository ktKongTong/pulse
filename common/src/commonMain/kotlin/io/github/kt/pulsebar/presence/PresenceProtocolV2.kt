package io.github.kt.pulsebar.presence

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

const val PRESENCE_PROTOCOL_V2 = "presence.v2"
const val PRESENCE_STREAM_PROTOCOL_V2 = "presence.v2-stream"
const val PRESENCE_ACK_PROTOCOL_V2 = "presence.v2-ack"

@Serializable
enum class PresencePlatform {
    @SerialName("macos")
    MACOS,

    @SerialName("windows")
    WINDOWS,

    @SerialName("linux")
    LINUX,

    @SerialName("other")
    OTHER
}

@Serializable
enum class PresenceAvailabilityState {
    @SerialName("active")
    ACTIVE,

    @SerialName("idle")
    IDLE,

    @SerialName("locked")
    LOCKED,

    @SerialName("sleeping")
    SLEEPING,

    @SerialName("offline")
    OFFLINE
}

@Serializable
enum class PresenceFocusState {
    @SerialName("foreground")
    FOREGROUND,

    @SerialName("background")
    BACKGROUND,

    @SerialName("none")
    NONE
}

@Serializable
enum class PresenceKind {
    @SerialName("interactive")
    INTERACTIVE,

    @SerialName("passive")
    PASSIVE,

    @SerialName("media")
    MEDIA
}

@Serializable
enum class PresenceEventKind {
    @SerialName("snapshot")
    SNAPSHOT,

    @SerialName("heartbeat")
    HEARTBEAT,

    @SerialName("session_end")
    SESSION_END
}

@Serializable
enum class MediaProviderKind {
    @SerialName("music")
    MUSIC,

    @SerialName("video")
    VIDEO,

    @SerialName("other")
    OTHER
}

@Serializable
enum class MediaItemType {
    @SerialName("track")
    TRACK,

    @SerialName("album")
    ALBUM,

    @SerialName("playlist")
    PLAYLIST,

    @SerialName("episode")
    EPISODE,

    @SerialName("stream")
    STREAM,

    @SerialName("unknown")
    UNKNOWN
}

@Serializable
enum class MediaPlaybackState {
    @SerialName("playing")
    PLAYING,

    @SerialName("paused")
    PAUSED,

    @SerialName("stopped")
    STOPPED
}

@Serializable
enum class MediaPlaybackScope {
    @SerialName("local")
    LOCAL,

    @SerialName("remote")
    REMOTE
}

@Serializable
enum class PresenceStreamKind {
    @SerialName("snapshot.updated")
    SNAPSHOT_UPDATED,

    @SerialName("stats.updated")
    STATS_UPDATED,

    @SerialName("sync.reset")
    SYNC_RESET,

    @SerialName("error")
    ERROR
}

@Serializable
data class PresenceIngestRequest(
    val protocol: String = PRESENCE_PROTOCOL_V2,
    val workspaceId: String,
    val deviceId: String,
    val sessionId: String,
    val events: List<PresenceEvent>
)

@Serializable
data class PresenceIngestAck(
    val protocol: String = PRESENCE_ACK_PROTOCOL_V2,
    val workspaceId: String,
    val deviceId: String,
    val acceptedSeqMax: Long,
    val dedupedEventIds: List<String> = emptyList(),
    val rejected: List<PresenceRejectedEvent> = emptyList(),
    val workspaceRevision: Long
)

@Serializable
data class PresenceRejectedEvent(
    val eventId: String,
    val reason: String
)

@Serializable
data class PresenceEvent(
    val eventId: String,
    val seq: Long,
    val kind: PresenceEventKind,
    val observedAt: String,
    val sentAt: String,
    val state: PresenceStatePayload? = null
)

@Serializable
data class PresenceStatePayload(
    val availability: PresenceAvailability,
    val focus: PresenceFocus,
    val presenceKind: PresenceKind,
    val mediaSessions: List<PresenceMediaSession> = emptyList(),
    val device: PresenceDevice,
    val capabilities: PresenceCapabilities,
    val extensions: PresenceExtensions? = null
)

@Serializable
data class PresenceAvailability(
    val state: PresenceAvailabilityState,
    val idleSeconds: Long? = null
)

@Serializable
data class PresenceFocus(
    val state: PresenceFocusState,
    val app: PresenceApp? = null,
    val window: PresenceWindow? = null,
    val page: PresencePage? = null
)

@Serializable
data class PresenceApp(
    val name: String? = null,
    val id: String? = null,
    val category: String? = null
)

@Serializable
data class PresenceWindow(
    val title: String? = null
)

@Serializable
data class PresencePage(
    val title: String? = null,
    val url: String? = null
)

@Serializable
data class PresenceMediaSession(
    val provider: MediaProvider,
    val item: MediaItem,
    val playback: MediaPlayback,
    val extensions: PresenceExtensions? = null
)

@Serializable
data class MediaProvider(
    val id: String,
    val kind: MediaProviderKind
)

@Serializable
data class MediaItem(
    val type: MediaItemType,
    val id: String? = null,
    val uri: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUrl: String? = null,
    val linkUrl: String? = null
)

@Serializable
data class MediaPlayback(
    val state: MediaPlaybackState,
    val progressSeconds: Double? = null,
    val durationSeconds: Int? = null,
    val scope: MediaPlaybackScope
)

@Serializable
data class PresenceDevice(
    val platform: PresencePlatform,
    val osVersion: String? = null,
    val appVersion: String,
    val deviceName: String
)

@Serializable
data class PresenceCapabilities(
    val focusApp: Boolean,
    val focusWindow: Boolean,
    val browserPage: Boolean,
    val mediaNowPlaying: Boolean
)

@Serializable
data class PresenceExtensions(
    val platform: JsonObject? = null,
    val providers: JsonObject? = null
)

@Serializable
data class PresenceStreamEnvelope(
    val protocol: String = PRESENCE_STREAM_PROTOCOL_V2,
    val workspaceId: String,
    val revision: Long,
    val kind: PresenceStreamKind,
    val sentAt: String,
    val payload: PresenceStreamPayload
)

@Serializable
sealed class PresenceStreamPayload

@Serializable
@SerialName("snapshot")
data class PresenceSnapshotUpdatedPayload(
    val current: PresenceCurrentState,
    val devices: List<PresenceDeviceState>
) : PresenceStreamPayload()

@Serializable
@SerialName("stats")
data class PresenceStatsUpdatedPayload(
    val today: PresenceStatsToday
) : PresenceStreamPayload()

@Serializable
@SerialName("sync_reset")
data class PresenceSyncResetPayload(
    val current: PresenceCurrentState,
    val devices: List<PresenceDeviceState>,
    val today: PresenceStatsToday
) : PresenceStreamPayload()

@Serializable
@SerialName("error")
data class PresenceStreamErrorPayload(
    val code: String,
    val message: String
) : PresenceStreamPayload()

@Serializable
data class PresenceCurrentState(
    val deviceId: String,
    val state: PresenceStatePayload,
    val anchor: PresenceAnchor
)

@Serializable
data class PresenceDeviceState(
    val deviceId: String,
    val state: PresenceStatePayload,
    val anchor: PresenceAnchor
)

@Serializable
data class PresenceAnchor(
    val observedAt: String,
    val serverReceivedAt: String,
    val mediaProgressSeconds: Double? = null,
    val mediaProgressRate: Double,
    val validUntil: String? = null
)

@Serializable
data class PresenceStatsToday(
    val apps: List<PresenceAggregateRow> = emptyList(),
    val pages: List<PresenceAggregateRow> = emptyList(),
    val media: List<PresenceAggregateRow> = emptyList()
)

@Serializable
data class PresenceAggregateRow(
    val id: String,
    val label: String,
    val totalSeconds: Long
)
