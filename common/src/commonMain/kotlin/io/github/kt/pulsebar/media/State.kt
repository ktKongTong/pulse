package io.github.kt.pulsebar.media

import io.github.kt.pulsebar.core.devicev2.DeviceV2StreamFormat
import io.github.kt.pulsebar.core.stream.StreamCaptureRuntime
import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamMediaPermission
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.stream.StreamPlaybackWire
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.StateFlow


internal fun defaultMediaState() = StreamNativeMediaState(
    permission = StreamMediaPermission.ALLOW,
    playback = StreamPlaybackWire.PAUSED,
    capture = StreamCaptureRuntime.NO_CAPTURE,
)

internal data class StreamState(
    val pcmChannel: Channel<ByteArray> = Channel(capacity = 256),
    val mediaState: StreamNativeMediaState,
    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDuration: Duration = 0.5.seconds,
    val chunkBytes: Int,
    val mediaFlow: StateFlow<StreamMedia?>,
    val streamFormat: DeviceV2StreamFormat
    // ("pcm16-wav", this.sampleRate, this.channels, 16)
)
