package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.export.ui.InitialMediaState
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.MediaFlowState
import io.github.kt.pulsebar.model.stream.MediaState
import io.github.kt.pulsebar.model.stream.MediaStateSnapshot
import io.github.kt.pulsebar.model.stream.StreamPcmChunk
import io.github.kt.pulsebar.model.stream.StreamState
import io.github.kt.pulsebar.model.stream.getSnapshot
import io.github.kt.pulsebar.model.stream.toMediaFlowState
import io.github.kt.pulsebar.model.stream.toStreamState
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update




internal class Stream(
    initialMediaState: InitialMediaState
) {

    val mediaFlow = MutableStateFlow(initialMediaState.media)
    val audioChannel: Channel<StreamPcmChunk> = Channel(capacity = 256)
    private val _mediaState: MutableStateFlow<MediaState> = MutableStateFlow(MediaState(
        pcmChannel = audioChannel,
        streamState = initialMediaState.streamState,
        mediaFlow = mediaFlow,
    ))

    val mediaState: StateFlow<MediaState> = _mediaState
    val mediaFlowState: Flow<MediaFlowState> =
        combine(_mediaState, mediaFlow) { state, _ ->
            state.toMediaFlowState()
        }.distinctUntilChanged()
    val mediaStateSnapshotFlow: Flow<MediaStateSnapshot> =
        combine(_mediaState, mediaFlow) { state, _ ->
            state.getSnapshot()
        }.distinctUntilChanged()

    private val mutableStreamStateFlow = MutableStateFlow(initialMediaState.streamState)

    val streamStateFlow: StateFlow<StreamState> = mutableStreamStateFlow

    fun updateMedia(media: Media?) {
        mediaFlow.value = media
    }

    fun updateMediaState(state: MediaStateSnapshot) {
        _mediaState.update { current ->
            // 需要去重
            mediaFlow.value = state.media
            current.copy(
                streamState = state.toStreamState(current.streamState.streamFormat),
            )
        }
    }

    fun submitPcm(bytes: ByteArray, mediaStartPositionMs: Long): Boolean =
        audioChannel.trySend(StreamPcmChunk(bytes, mediaStartPositionMs)).isSuccess
}
