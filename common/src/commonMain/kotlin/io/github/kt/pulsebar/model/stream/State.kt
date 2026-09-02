package io.github.kt.pulsebar.model.stream

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable


@Serializable
data class StreamFormat(
    val codec: String,
    val sampleRate: Int,
    val channels: Int,
    val bitDepth: Int? = null,
)

internal data class MediaState(
    val pcmChannel: Channel<StreamPcmChunk> = Channel(capacity = 256),
    val streamState: StreamState,
    val chunkDuration: Duration = 0.5.seconds,
    val mediaFlow: StateFlow<Media?>,
)

internal data class StreamPcmChunk(
    val bytes: ByteArray,
    val mediaStartPositionMs: Long,
)

internal fun MediaState.getSnapshot(): MediaStateSnapshot = MediaStateSnapshot(
    permission = streamState.permission,
    playbackStatus = streamState.playbackStatus,
    captureStatus = streamState.captureStatus,
    reason = streamState.reason,
    message = streamState.message,
    format = streamState.streamFormat,
    media = mediaFlow.value,
)

@Serializable
data class MediaStateSnapshot(
    val permission: StreamPermission = StreamPermission.ALLOW,
    val playbackStatus: PlaybackStatus = PlaybackStatus.PAUSED,
    val captureStatus: StreamCaptureStatus = StreamCaptureStatus.IDLE,
    val reason: StreamBlockedReason? = null,
    val message: String? = null,
    val format: StreamFormat? = null,
    val media: Media? = null,
)

data class MediaFlowState(
    val permission: StreamPermission = StreamPermission.ALLOW,
    val playbackStatus: PlaybackStatus = PlaybackStatus.PAUSED,
    val captureStatus: StreamCaptureStatus = StreamCaptureStatus.IDLE,
    val reason: StreamBlockedReason? = null,
    val message: String? = null,
    val format: StreamFormat? = null,
    val media: StateFlow<Media?>,
)

internal fun MediaState.toMediaFlowState(): MediaFlowState = MediaFlowState(
    permission = streamState.permission,
    playbackStatus = streamState.playbackStatus,
    captureStatus = streamState.captureStatus,
    reason = streamState.reason,
    message = streamState.message,
    format = streamState.streamFormat,
    media = mediaFlow,
)

fun MediaStateSnapshot.toStreamState(previousFormat: StreamFormat? = null): StreamState = StreamState(
    permission = permission,
    playbackStatus = playbackStatus,
    captureStatus = captureStatus,
    reason = reason,
    message = message,
    streamFormat = when {
        format != null -> format
        captureStatus == StreamCaptureStatus.CAPTURING -> previousFormat
        else -> null
    },
)

@Serializable
data class StreamState(
    val permission: StreamPermission = StreamPermission.ALLOW,
    @SerialName("playback") val playbackStatus: PlaybackStatus = PlaybackStatus.PAUSED,
    @SerialName("capture") val captureStatus: StreamCaptureStatus = StreamCaptureStatus.IDLE,
    val streamFormat: StreamFormat? = null,
    val reason: StreamBlockedReason? = null,
    val message: String? = null,
)

fun StreamState.rejectionReason(): StreamRejectedReason? = when {
    permission != StreamPermission.ALLOW -> StreamRejectedReason.CAPTURE_PERMISSION_MISSING
    playbackStatus != PlaybackStatus.PLAYING -> StreamRejectedReason.NO_PLAYABLE_MEDIA
    else -> null
}
