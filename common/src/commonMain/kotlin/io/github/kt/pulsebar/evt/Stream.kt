package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.core.devicev2.DeviceV2StreamFormat
import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.media.StreamState
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow


internal object Stream {
    val mediaStateFlow = MutableStateFlow<StreamMedia?>(null)
    val audioChannel: Channel<ByteArray> = Channel(capacity = 256)
    val streamStateFlow: StateFlow<StreamState> = MutableStateFlow(StreamState(
        audioChannel,
        StreamNativeMediaState(),
        sampleRate = 48_000,
        channels = 2,
        chunkDuration = 0.5.seconds,
        chunkBytes = 0,
        mediaFlow = mediaStateFlow,
        streamFormat = DeviceV2StreamFormat("pcm16-wav", 48_000, 2, 16),
    ))
}
