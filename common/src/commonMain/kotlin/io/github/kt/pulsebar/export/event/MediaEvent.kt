package io.github.kt.pulsebar.export.event

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.PlaybackStatus
import io.github.kt.pulsebar.model.stream.StreamBlockedReason
import io.github.kt.pulsebar.model.stream.StreamCaptureStatus
import io.github.kt.pulsebar.model.stream.StreamFormat
import io.github.kt.pulsebar.model.stream.StreamPermission
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.utils.nowInMillis


data class NativeFrontmostAppChanged(
    val bundleId: String,
    val name: String,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent {
    constructor(
        bundleId: String,
        name: String,
    ) : this(
        bundleId = bundleId,
        name = name,
        observedAtMillis = nowInMillis(),
    )
}

data class NativeNowPlayingChanged(
    val media: Media?,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent {
    constructor(media: Media?) : this(
        media = media,
        observedAtMillis = nowInMillis(),
    )
}

data class NativeMediaStateChanged(
    val permission: StreamPermission,
    val playbackStatus: PlaybackStatus,
    val captureStatus: StreamCaptureStatus,
    val reason: StreamBlockedReason?,
    val message: String?,
    val format: StreamFormat?,
    val media: Media?,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent {
    constructor(
        permission: StreamPermission,
        playbackStatus: PlaybackStatus,
        captureStatus: StreamCaptureStatus,
        reason: StreamBlockedReason?,
        message: String?,
        format: StreamFormat?,
        media: Media?,
    ) : this(
        permission = permission,
        playbackStatus = playbackStatus,
        captureStatus = captureStatus,
        reason = reason,
        message = message,
        format = format,
        media = media,
        observedAtMillis = nowInMillis(),
    )

}

data class NativeStreamPcmChunk(
    val chunkBase64: String,
    val mediaStartPositionMs: Long,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent {
    constructor(
        chunkBase64: String,
        mediaStartPositionMs: Long,
    ) : this(
        chunkBase64 = chunkBase64,
        mediaStartPositionMs = mediaStartPositionMs,
        observedAtMillis = nowInMillis(),
    )
}

data class NativeMediaStreamStopped(
    val reason: StreamStopReason,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent {
    constructor(reason: StreamStopReason) : this(
        reason = reason,
        observedAtMillis = nowInMillis(),
    )
}
