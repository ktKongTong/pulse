package io.github.kt.pulsebar.model.stream

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable


@Serializable
internal data class StreamAvailabilityState(
    val permission: StreamPermission,
    val playbackStatus: PlaybackStatus,
    val captureStatus: StreamCaptureStatus
)

@Serializable
internal data class CaptureInfo(
    val provider: String? = null,
    val displayName: String? = null,
    val appId: String? = null,
)

@Serializable
enum class StreamRejectedReason {
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("native_error") NATIVE_ERROR,
}