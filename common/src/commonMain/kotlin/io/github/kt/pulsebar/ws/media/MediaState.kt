package io.github.kt.pulsebar.ws.media

import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.MediaStateSnapshot
import io.github.kt.pulsebar.model.stream.PlaybackStatus
import io.github.kt.pulsebar.model.stream.StreamCaptureStatus
import io.github.kt.pulsebar.model.stream.StreamPermission
import io.github.kt.pulsebar.model.stream.StreamRejectedReason
import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.ws.connection.WsConnectionState


internal sealed interface MediaRuntimeEvent {
    data class StreamRequested(val streamId: String, val generation: Int) : MediaRuntimeEvent
    data class StreamRejected(val reason: StreamRejectedReason) : MediaRuntimeEvent
    data class StreamStopped(val reason: StreamStopReason) : MediaRuntimeEvent

    data class PcmAccepted(val bytes: Int, val frames: Int) : MediaRuntimeEvent
    data class ChunkSent(val seq: Long, val bytes: Int, val sentAtMillis: Long = nowInMillis()) : MediaRuntimeEvent

    data class MediaStateChanged(val state: MediaStateSnapshot) : MediaRuntimeEvent
    data class PlayingChanged(val media: Media?) : MediaRuntimeEvent
}

data class MediaRuntimeState(
    val deviceSessionId: String? = null,
    val streamPermission: StreamPermission = StreamPermission.DISALLOW,
    val playbackStatus: PlaybackStatus = PlaybackStatus.PAUSED,
    val captureStatus: StreamCaptureStatus = StreamCaptureStatus.IDLE,

    val currentMedia: Media? = null,

    val activeStreamId: String? = null,
    val activeGeneration: Int? = null,
    val captureRequested: Boolean = false,

    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDurationMs: Int = 500,
    val chunkBytes: Int = 0,

    val acceptedFrames: Long = 0L,
    val acceptedBytes: Long = 0L,
    val droppedFrames: Long = 0L,
    val droppedChunks: Long = 0L,

    val bufferedFrames: Long = 0L,
    val bufferedBytes: Long = 0L,

    val queuedChunks: Int = 0,
    val queuedBytes: Long = 0L,
    val queuedFirstSequence: Long? = null,
    val queuedLastSequence: Long? = null,
    val maxQueuedChunks: Int = 0,

    val isSending: Boolean = false,
    val chunksSent: Long = 0L,
    val bytesSent: Long = 0L,
    val sendBitrateKbps: Double? = null,

    val lastSequence: Long = 0L,
    val lastChunkBytes: Long = 0L,
    val lastChunkSentAtMillis: Long? = null,

    val serverCommandsReceived: Long = 0L,
    val streamRequestCount: Long = 0L,
    val streamResumeCount: Long = 0L,
    val streamStopCount: Long = 0L,

    val lastRejectedReason: StreamRejectedReason? = null,
    val lastStopReason: StreamStopReason? = null,
)

data class MediaWSState(
    val runtimeState: MediaRuntimeState = MediaRuntimeState(),
    val connection: WsConnectionState = WsConnectionState(),
)

internal fun MediaRuntimeState.reduce(event: MediaRuntimeEvent): MediaRuntimeState =
    when (event) {
        is MediaRuntimeEvent.StreamRequested -> copy(
            activeStreamId = event.streamId,
            activeGeneration = event.generation,
            captureRequested = true,
            lastRejectedReason = null,
        )

        is MediaRuntimeEvent.StreamRejected -> copy(
            activeStreamId = null,
            activeGeneration = null,
            captureRequested = false,
            lastRejectedReason = event.reason,
        )

        is MediaRuntimeEvent.StreamStopped -> copy(
            activeStreamId = null,
            activeGeneration = null,
            captureRequested = false,
            bufferedFrames = 0,
            bufferedBytes = 0,
            queuedChunks = 0,
            queuedBytes = 0,
            queuedFirstSequence = null,
            queuedLastSequence = null,
            isSending = false,
            lastStopReason = event.reason,
        )
        is MediaRuntimeEvent.PcmAccepted -> copy(
            acceptedBytes = acceptedBytes + event.bytes,
            acceptedFrames = acceptedFrames + event.frames,
        )

        is MediaRuntimeEvent.ChunkSent -> copy(
            chunksSent = chunksSent + 1,
            bytesSent = bytesSent + event.bytes,
            lastSequence = event.seq,
            lastChunkBytes = event.bytes.toLong(),
            lastChunkSentAtMillis = event.sentAtMillis,
            isSending = true,
        )

        is MediaRuntimeEvent.MediaStateChanged -> copy(
            streamPermission = event.state.permission,
            playbackStatus = event.state.playbackStatus,
            captureStatus = event.state.captureStatus,
        )

        is MediaRuntimeEvent.PlayingChanged -> copy(
            currentMedia = event.media,
        )
    }
