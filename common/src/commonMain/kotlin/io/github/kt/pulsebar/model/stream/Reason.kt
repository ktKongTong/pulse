package io.github.kt.pulsebar.model.stream

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class StreamBlockedReason {
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
enum class StreamStopReason {
    @SerialName("last_listener_disconnected") LAST_LISTENER_DISCONNECTED,
    @SerialName("stream_disabled") STREAM_DISABLED,
    @SerialName("capture_permission_revoked") CAPTURE_PERMISSION_REVOKED,
    @SerialName("capture_source_lost") CAPTURE_SOURCE_LOST,
    @SerialName("native_shutdown") NATIVE_SHUTDOWN,
    @SerialName("manual_stop") MANUAL_STOP,
    @SerialName("server_stream_stopped") SERVER_STOPPED,
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("unsupported_app") UNSUPPORTED_APP,
    @SerialName("connection_lost") CONNECTION_LOST,
}
