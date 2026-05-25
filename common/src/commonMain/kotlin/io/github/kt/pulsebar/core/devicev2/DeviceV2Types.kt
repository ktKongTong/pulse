package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.stream.StreamCaptureRuntime
import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamMediaPermission
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.stream.StreamPlaybackWire
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class DeviceV2StreamFormat(
    val codec: String,
    val sampleRate: Int,
    val channels: Int,
    val bitDepth: Int? = null,
)

@Serializable
internal data class DeviceV2StreamState(
    val permission: String,
    val playback: String,
    val capture: String,
    val streamFormat: DeviceV2StreamFormat? = null,
    val reason: String? = null,
    val message: String? = null,
)

@Serializable
internal data class DeviceV2MediaItem(
    val provider: String? = null,
    val providerId: String? = null,
    val itemType: String? = null,
    val id: String? = null,
    val trackId: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUrl: String? = null,
    val linkUrl: String? = null,
    val progressSeconds: Double? = null,
    val durationSeconds: Double? = null,
    val playbackState: String? = null,
)

@Serializable
internal data class DeviceV2CaptureInfo(
    val provider: String? = null,
    val displayName: String? = null,
    val appId: String? = null,
)

@Serializable
internal enum class DeviceV2RejectedReason {
    @SerialName("no_playable_media") NO_PLAYABLE_MEDIA,
    @SerialName("capture_permission_missing") CAPTURE_PERMISSION_MISSING,
    @SerialName("capture_source_unavailable") CAPTURE_SOURCE_UNAVAILABLE,
    @SerialName("native_error") NATIVE_ERROR,
}

internal fun StreamNativeMediaState.toDeviceV2StreamState(format: DeviceV2StreamFormat): DeviceV2StreamState =
    DeviceV2StreamState(
        permission = if (permission == StreamMediaPermission.ALLOW) "allow" else "disallow",
        playback = if (playback == StreamPlaybackWire.PLAYING) "playing" else "paused",
        capture = if (capture == StreamCaptureRuntime.CAPTURING) "capturing" else "no-capture",
        streamFormat = format,
        reason = reason?.serialName(),
        message = message,
    )

internal fun StreamMedia.toDeviceV2MediaItem(): DeviceV2MediaItem =
    DeviceV2MediaItem(
        provider = providerId,
        providerId = providerId,
        itemType = itemType,
        id = trackId,
        trackId = trackId,
        title = title,
        artist = artist,
        album = album,
        artworkUrl = artworkUrl,
        linkUrl = linkUrl,
        progressSeconds = progressSeconds.takeIf { it >= 0.0 },
        durationSeconds = durationSeconds,
        playbackState = if (playbackState == StreamPlaybackWire.PLAYING) "playing" else "paused",
    )

private fun io.github.kt.pulsebar.core.stream.StreamBlockedReason.serialName(): String = when (this) {
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.NO_PLAYABLE_MEDIA -> "no_playable_media"
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.CAPTURE_PERMISSION_MISSING -> "capture_permission_missing"
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.CAPTURE_PERMISSION_REVOKED -> "capture_permission_revoked"
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.CAPTURE_SOURCE_UNAVAILABLE -> "capture_source_unavailable"
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.CAPTURE_SOURCE_LOST -> "capture_source_lost"
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.UNSUPPORTED_APP -> "unsupported_app"
    io.github.kt.pulsebar.core.stream.StreamBlockedReason.NATIVE_ERROR -> "native_error"
    else -> null
} ?: "native_error"
