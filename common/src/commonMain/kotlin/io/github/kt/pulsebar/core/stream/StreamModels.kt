package io.github.kt.pulsebar.core.stream

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal enum class StreamMediaPermission {
    @SerialName("allow") ALLOW,
    @SerialName("disallow") DISALLOW,
}

@Serializable
internal enum class StreamCaptureRuntime {
    @SerialName("capturing") CAPTURING,
    @SerialName("no-capture") NO_CAPTURE,
}

@Serializable
internal enum class StreamPlaybackWire {
    @SerialName("playing") PLAYING,
    @SerialName("paused") PAUSED,
}

@Serializable
internal enum class StreamBlockedReason {
    @SerialName("device_offline") DEVICE_OFFLINE,
    @SerialName("stream_disabled") STREAM_DISABLED,
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_permission_revoked") CAPTURE_PERMISSION_REVOKED,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("capture_source_lost") CAPTURE_SOURCE_LOST,
    @SerialName("unsupported_app") UNSUPPORTED_APP,
    @SerialName("native_error") NATIVE_ERROR,
    @SerialName("connection_lost") CONNECTION_LOST,
    @SerialName("snapshot_unavailable") SNAPSHOT_UNAVAILABLE,
    @SerialName("auth_failed") AUTH_FAILED,
    @SerialName("protocol_error") PROTOCOL_ERROR,
    @SerialName("session_rejected") SESSION_REJECTED,
}

@Serializable
internal enum class StreamStopReason {
    @SerialName("last_listener_disconnected") LAST_LISTENER_DISCONNECTED,
    @SerialName("stream_disabled") STREAM_DISABLED,
    @SerialName("capture_permission_revoked") CAPTURE_PERMISSION_REVOKED,
    @SerialName("capture_source_lost") CAPTURE_SOURCE_LOST,
    @SerialName("native_shutdown") NATIVE_SHUTDOWN,
    @SerialName("manual_stop") MANUAL_STOP,
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("unsupported_app") UNSUPPORTED_APP,
}

@Serializable
internal data class StreamMedia(
    val providerId: String? = null,
    val itemType: String? = null,
    val trackId: String? = null,
    val uri: String? = null,
    val linkUrl: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUrl: String? = null,
    val progressSeconds: Double = 0.0,
    val durationSeconds: Double? = null,
    val playbackState: StreamPlaybackWire? = null,
)

@Serializable
internal data class StreamNativeMediaState(
    val permission: StreamMediaPermission = StreamMediaPermission.ALLOW,
    val playback: StreamPlaybackWire = StreamPlaybackWire.PAUSED,
    val capture: StreamCaptureRuntime = StreamCaptureRuntime.NO_CAPTURE,
    val reason: StreamBlockedReason? = null,
    val message: String? = null,
    val media: StreamMedia? = null,
)
