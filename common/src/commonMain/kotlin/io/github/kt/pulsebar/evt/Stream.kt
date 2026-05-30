package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.export.ui.InitialMediaState
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.MediaState
import io.github.kt.pulsebar.model.stream.MediaStateSnapshot
import io.github.kt.pulsebar.model.stream.StreamState
import io.github.kt.pulsebar.model.stream.getStreamState
import kotlin.time.Duration
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update




internal class Stream(
    initialMediaState: InitialMediaState
) {

    val mediaFlow = MutableStateFlow(initialMediaState.media)
    val audioChannel: Channel<ByteArray> = Channel(capacity = 256)
    private val _mediaStateFlow: MutableStateFlow<MediaState> = MutableStateFlow(MediaState(
        pcmChannel = audioChannel,
        streamState = initialMediaState.streamState,
        chunkDuration = initialMediaState.chunkDuration,
        chunkBytes = initialMediaState.chunkBytes,
        mediaFlow = mediaFlow,
    ))

    val mediaStateFlow: StateFlow<MediaState> = _mediaStateFlow

    private val mutableStreamStateFlow = MutableStateFlow(initialMediaState.streamState)

    val streamStateFlow: StateFlow<StreamState> = mutableStreamStateFlow

    fun updateMedia(media: Media?) {
        mediaFlow.value = media
    }

    fun updateMediaState(state: MediaStateSnapshot) {
        _mediaStateFlow.update { current ->
            // 需要去重
            mediaFlow.value = state.media
            current.copy(
                streamState = state.getStreamState(),
            )
        }
    }
}
