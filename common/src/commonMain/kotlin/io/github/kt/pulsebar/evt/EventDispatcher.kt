package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.logger.PulseBarLog
import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
import io.github.kt.pulsebar.export.event.NativeMediaStateChanged
import io.github.kt.pulsebar.export.event.NativeMediaStreamStopped
import io.github.kt.pulsebar.export.event.NativeNowPlayingChanged
import io.github.kt.pulsebar.export.event.NativeStreamPcmChunk
import io.github.kt.pulsebar.export.event.ConnectEndpointCommand
import io.github.kt.pulsebar.export.event.DisableEndpointCommand
import io.github.kt.pulsebar.export.event.DisconnectEndpointCommand
import io.github.kt.pulsebar.export.event.EnableEndpointCommand
import io.github.kt.pulsebar.export.event.RemoveEndpointCommand
import io.github.kt.pulsebar.export.event.UpdateConfigCommand
import io.github.kt.pulsebar.model.FocusState
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.MediaStateSnapshot
import io.github.kt.pulsebar.model.stream.StreamStopReason
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okio.ByteString.Companion.decodeBase64


internal class EventDispatcher(
    scope: CoroutineScope,
    private val focusState: MutableStateFlow<FocusState?>,
    private val stream: Stream,
    private val connectEndpoint: (String) -> Unit,
    private val disconnectEndpoint: (String) -> Unit,
    private val setEndpointEnabled: suspend (String, Boolean) -> Unit,
    private val removeEndpoint: suspend (String) -> Unit,
    private val updateConfig: suspend (PulseConfig) -> Unit,
    private val publishFocusChanged: suspend (NativeFrontmostAppChanged) -> Unit,
    private val handleMediaStreamStopped: (StreamStopReason) -> Unit,
) {
    private val eventBus: EventBus = EventBus()

    init {
        scope.launch {
            eventBus.events
                .collect { event ->
                    runCatching { routeNativeEvent(event) }
                        .onFailure { error ->
                            if (error is CancellationException) throw error
                            log.e(error) { "native.event.failed event=${event::class.simpleName}" }
                        }
                }
        }
    }
    private val log: PulseBarLog = logger(PulseLogCategory.NativeEvent)
    fun emitNativeEvent(event: AppEvent) {
        eventBus.emit(event)
    }

    private suspend fun routeNativeEvent(event: AppEvent) {
        log.i { event.toString() }
        when (event) {
            is NativeFrontmostAppChanged ->
                handleFrontmostAppChanged(event)

            is NativeNowPlayingChanged ->
                handleNowPlayingChanged(event.media)

            is NativeMediaStateChanged ->
                handleMediaStateChanged(event)

            is NativeStreamPcmChunk ->
                handleStreamPcmChunk(event)

            is NativeMediaStreamStopped ->
                handleMediaStreamStopped(event.reason)

            is ConnectEndpointCommand ->
                connectEndpoint(event.endpointId)

            is DisconnectEndpointCommand ->
                disconnectEndpoint(event.endpointId)

            is EnableEndpointCommand ->
                setEndpointEnabled(event.endpointId, true)

            is DisableEndpointCommand ->
                setEndpointEnabled(event.endpointId, false)

            is RemoveEndpointCommand ->
                removeEndpoint(event.endpointId)

            is UpdateConfigCommand ->
                updateConfig(event.config)
        }
    }

    private fun handleNowPlayingChanged(media: Media?) {
        stream.updateMedia(media)
    }

    private fun handleMediaStateChanged(event: NativeMediaStateChanged) {
        val next = MediaStateSnapshot(
            permission = event.permission,
            playbackStatus = event.playbackStatus,
            captureStatus = event.captureStatus,
            reason = event.reason,
            message = event.message,
            format = event.format,
            media = event.media,
        )
        stream.updateMediaState(next)
    }

    private fun handleStreamPcmChunk(event: NativeStreamPcmChunk) {
        val bytes = event.chunkBase64.decodeBase64()?.toByteArray()
        if (bytes == null) {
            log.w { "native.stream.pcm.invalid_base64 bytes=${event.chunkBase64.length}" }
            return
        }
        if (!stream.submitPcm(bytes)) {
            log.w { "native.stream.pcm.dropped bytes=${bytes.size}" }
        }
    }

    private suspend fun handleFrontmostAppChanged(event: NativeFrontmostAppChanged) {
        focusState.update { current ->
            if (current?.id == event.bundleId) {
                current.copy(
                    name = event.name,
                    id = event.bundleId,
                    lastActiveAt = event.observedAtMillis,
                )
            } else {
                FocusState(
                    name = event.name,
                    id = event.bundleId,
                    startedAt = event.observedAtMillis,
                    lastActiveAt = event.observedAtMillis,
                )
            }
        }
        publishFocusChanged(event)
    }
}
