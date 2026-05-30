package io.github.kt.pulsebar.export.event

import io.github.kt.pulsebar.evt.AppEvent
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.PlaybackStatus
import io.github.kt.pulsebar.model.stream.StreamCaptureStatus
import io.github.kt.pulsebar.model.stream.StreamPermission
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.utils.nowInMillis


data class NativeFrontmostAppChanged(
    val bundleId: String,
    val name: String,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent

data class NativeNowPlayingChanged(
    val media: Media?,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent

data class NativeMediaStateChanged(
    val permission: StreamPermission,
    val playbackStatus: PlaybackStatus,
    val captureStatus: StreamCaptureStatus,
    val reason: String?,
    val message: String?,
    val media: Media?,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent

data class NativeAudioCaptureStarted(
    val sampleRate: Int,
    val channels: Int,
    val sourceName: String?,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent

data class NativeAudioCaptureStopped(
    val reason: StreamStopReason,
    val observedAtMillis: Long = nowInMillis()
) : AppEvent


