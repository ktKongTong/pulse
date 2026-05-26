package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.core.config.PulseBarConfigStore
import io.github.kt.pulsebar.core.log.PulseBarLog
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.github.kt.pulsebar.export.ConnectEndpointCommand
import io.github.kt.pulsebar.export.DisableEndpointCommand
import io.github.kt.pulsebar.export.DisconnectEndpointCommand
import io.github.kt.pulsebar.export.EnableEndpointCommand
import io.github.kt.pulsebar.export.NativeDeviceEvent
import io.github.kt.pulsebar.export.NativeFrontmostAppChanged
import io.github.kt.pulsebar.export.NativeMediaSnapshot
import io.github.kt.pulsebar.export.NativeMediaStateChanged
import io.github.kt.pulsebar.export.NativeNowPlayingChanged
import io.github.kt.pulsebar.export.RemoveEndpointCommand
import io.github.kt.pulsebar.core.stream.StreamCaptureRuntime
import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamMediaPermission
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.stream.StreamPlaybackWire
import io.github.kt.pulsebar.focus.DeviceV2Availability
import io.github.kt.pulsebar.focus.DeviceV2Focus
import io.github.kt.pulsebar.focus.DeviceV2PresenceState
import io.github.kt.pulsebar.platform.App
import io.github.kt.pulsebar.platform.newPulseUuid
import io.github.kt.pulsebar.ws.DeviceV2Client
import io.github.kt.pulsebar.ws.updateMedia
import io.github.kt.pulsebar.ws.updateMediaState
import io.github.kt.pulsebar.ws.common.DeviceV2PresencePayload
import io.github.kt.pulsebar.ws.common.epochMillisToIso8601
import io.github.kt.pulsebar.ws.connection.DeviceWsPhase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch


internal class EventDispatcher(
    private val scope: CoroutineScope,
    private val state: MutableStateFlow<RuntimeState>,
    private val configStore: PulseBarConfigStore,
    private val connectEndpoint: (String) -> Unit,
) {
    private val eventBus: NativeDeviceEventBus = NativeDeviceEventBus()
    internal val streamClients: MutableStateFlow<Map<String, DeviceV2Client>> = MutableStateFlow(emptyMap())
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
    fun emitNativeEvent(event: NativeDeviceEvent) {
        eventBus.emit(event)
    }

    private suspend fun routeNativeEvent(event: NativeDeviceEvent) {
        log.i { event.toString() }
        when (event) {
            is NativeFrontmostAppChanged ->
                handleFrontmostAppChanged(event)

            is NativeNowPlayingChanged ->
                handleNowPlayingChanged(event.media)

            is NativeMediaStateChanged ->
                handleMediaStateChanged(event)

            is ConnectEndpointCommand ->
                connectEndpoint(event.endpointId)

            is DisconnectEndpointCommand ->
                removeClient(event.endpointId)

            is EnableEndpointCommand ->
                setEndpointEnabled(event.endpointId, enabled = true)

            is DisableEndpointCommand -> {
                setEndpointEnabled(event.endpointId, enabled = false)
                removeClient(event.endpointId)
            }

            is RemoveEndpointCommand -> {
                removeClient(event.endpointId)
                configStore.update { current ->
                    current.copy(endpoints = current.endpoints.filterNot { it.id == event.endpointId })
                }
            }
        }
    }

    private fun handleNowPlayingChanged(media: NativeMediaSnapshot?) {
        Stream.mediaStateFlow.value = media?.toStreamMedia()
        streamClients.value.values.forEach { it.updateMedia(media?.toStreamMedia()) }
    }

    private fun handleMediaStateChanged(event: NativeMediaStateChanged) {
        val media = event.media?.toStreamMedia()
        val next = StreamNativeMediaState(
            permission = if (event.permissionAllow) StreamMediaPermission.ALLOW else StreamMediaPermission.DISALLOW,
            playback = if (event.playbackPlaying) StreamPlaybackWire.PLAYING else StreamPlaybackWire.PAUSED,
            capture = if (event.captureRunning) StreamCaptureRuntime.CAPTURING else StreamCaptureRuntime.NO_CAPTURE,
            media = media,
            message = event.message,
        )
        Stream.mediaStateFlow.value = media
        streamClients.value.values.forEach {
            it.updateMediaState(next)
            it.updateMedia(media)
        }
    }

    private suspend fun handleFrontmostAppChanged(event: NativeFrontmostAppChanged) {
        state.update {
            it.copy(
                focusSate = (it.focusSate ?: FocusSate(name = event.name, id = event.bundleId)).copy(
                    name = event.name,
                    id = event.bundleId
                )
            )
        }
        // save2sqlite
        streamClients.value.entries
            .filter { it.value.deviceWsState.value.phase == DeviceWsPhase.Connected }
            .forEach { entry ->
                runCatching {
                    entry.value.connectedCommonWS.presenceOutbound.send(
                        DeviceV2PresencePayload(
                            eventId = newPulseUuid(),
                            seq = 1,
                            observedAt = epochMillisToIso8601(event.observedAtMillis),
                            state = DeviceV2PresenceState(
                                availability = DeviceV2Availability(state = "active", idleSeconds = 0),
                                focus = DeviceV2Focus(App(event.name, event.bundleId)),
                            ),
                        )
                    )
                }.onFailure { error ->
                    if (error is CancellationException) throw error
                    log.w(error) { "presence.enqueue.failed endpointId=${entry.key}" }
                }
            }
    }

    private fun removeClient(endpointId: String) {
        streamClients.value[endpointId]?.dispose()
        streamClients.update { it - endpointId }
    }

    private suspend fun setEndpointEnabled(endpointId: String, enabled: Boolean) {
        configStore.update { current ->
            current.copy(
                endpoints = current.endpoints.map { endpoint ->
                    if (endpoint.id == endpointId) endpoint.copy(enabled = enabled) else endpoint
                },
            )
        }
    }
}

private fun NativeMediaSnapshot.toStreamMedia(): StreamMedia =
    StreamMedia(
        providerId = providerId,
        itemType = itemType,
        trackId = trackId,
        uri = uri,
        linkUrl = linkUrl,
        title = title,
        artist = artist,
        album = album,
        artworkUrl = artworkUrl,
        progressSeconds = progressSeconds,
        durationSeconds = durationSeconds,
        playbackState = if (isPlaying) StreamPlaybackWire.PLAYING else StreamPlaybackWire.PAUSED,
    )
