package io.github.kt.pulsebar.export

import io.github.kt.pulsebar.utils.nowInMillis

interface NativeDeviceEvent

data class NativeFrontmostAppChanged(
    val bundleId: String,
    val name: String,
    val observedAtMillis: Long = nowInMillis()
) : NativeDeviceEvent

data class NativeMediaSnapshot(
    val providerId: String?,
    val itemType: String?,
    val trackId: String?,
    val uri: String?,
    val linkUrl: String?,
    val title: String?,
    val artist: String?,
    val album: String?,
    val artworkUrl: String?,
    val progressSeconds: Double,
    val durationSeconds: Double?,
    val isPlaying: Boolean,
)

data class NativeNowPlayingChanged(
    val media: NativeMediaSnapshot?,
    val observedAtMillis: Long = nowInMillis()
) : NativeDeviceEvent

data class NativeMediaStateChanged(
    val permissionAllow: Boolean,
    val playbackPlaying: Boolean,
    val captureRunning: Boolean,
    val reason: String?,
    val message: String?,
    val media: NativeMediaSnapshot?,
    val observedAtMillis: Long = nowInMillis()
) : NativeDeviceEvent

data class NativeAudioCaptureStarted(
    val sampleRate: Int,
    val channels: Int,
    val sourceName: String?,
    val observedAtMillis: Long = nowInMillis()
) : NativeDeviceEvent

data class NativeAudioCaptureStopped(
    val reason: String,
    val observedAtMillis: Long = nowInMillis()
) : NativeDeviceEvent
