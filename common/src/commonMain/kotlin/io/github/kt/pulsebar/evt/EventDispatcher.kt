package io.github.kt.pulsebar.evt

import io.github.kt.pulsebar.store.config.PulseBarConfigStore
import io.github.kt.pulsebar.logger.PulseBarLog
import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
import io.github.kt.pulsebar.export.event.NativeMediaStateChanged
import io.github.kt.pulsebar.export.event.NativeNowPlayingChanged
import io.github.kt.pulsebar.export.event.ConnectEndpointCommand
import io.github.kt.pulsebar.export.event.DisableEndpointCommand
import io.github.kt.pulsebar.export.event.DisconnectEndpointCommand
import io.github.kt.pulsebar.export.event.EnableEndpointCommand
import io.github.kt.pulsebar.export.event.RemoveEndpointCommand
import io.github.kt.pulsebar.model.FocusState
import io.github.kt.pulsebar.model.RuntimeState
import io.github.kt.pulsebar.model.stream.Media
import io.github.kt.pulsebar.model.stream.MediaStateSnapshot
import io.github.kt.pulsebar.utils.newPulseUuid

import io.github.kt.pulsebar.ws.DeviceV2Client
import io.github.kt.pulsebar.ws.common.App
import io.github.kt.pulsebar.ws.common.DeviceV2Availability
import io.github.kt.pulsebar.ws.common.DeviceV2Focus
import io.github.kt.pulsebar.ws.common.DeviceV2PresencePayload
import io.github.kt.pulsebar.ws.common.DeviceV2PresenceState
import io.github.kt.pulsebar.ws.common.epochMillisToIso8601
import io.github.kt.pulsebar.ws.connection.ConnectionStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch


internal class EventDispatcher(
    scope: CoroutineScope,
    private val state: MutableStateFlow<RuntimeState>,
    private val configStore: PulseBarConfigStore,
    private val stream: Stream,
    private val connectEndpoint: (String) -> Unit,
    internal val streamClients: MutableStateFlow<Map<String, DeviceV2Client>>
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

            is ConnectEndpointCommand ->
                connectEndpoint(event.endpointId)

            is DisconnectEndpointCommand ->
                streamClients.value[event.endpointId]?.dispose()

            is EnableEndpointCommand ->
                setEndpointEnabled(event.endpointId, enabled = true)

            // streamClient 就是当前
            is DisableEndpointCommand -> {
                setEndpointEnabled(event.endpointId, enabled = false)
            }

            is RemoveEndpointCommand -> {
                // stop client
                // remove config store
//                configStore.update { current ->
//                    current.copy(endpoints = current.endpoints.filterNot { it.id == event.endpointId })
//                }
            }
        }
    }

    private fun handleNowPlayingChanged(media: Media?) {
        stream.updateMedia(media)
    }

    private fun fanoutToStreamClients(foreach: (streamClient: DeviceV2Client) -> Unit) {
        streamClients.value.values.forEach { foreach(it) }
    }

    private fun handleMediaStateChanged(event: NativeMediaStateChanged) {
//        val media = event.media?.toStreamMedia()
        val next = MediaStateSnapshot(
            permission = event.permission,
            playbackStatus = event.playbackStatus,
            captureStatus = event.captureStatus,
//            media = media,
            message = event.message,
        )
        stream.updateMediaState(next)
    }

    private suspend fun handleFrontmostAppChanged(event: NativeFrontmostAppChanged) {
        state.update {
            it.copy(
                focusState = (it.focusState ?: FocusState(name = event.name, id = event.bundleId)).copy(
                    name = event.name,
                    id = event.bundleId
                )
            )
        }
        // save2sqlite
        streamClients.value.entries
            .filter { it.value.deviceWsState.value.phase == ConnectionStatus.Connected }
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

    private suspend fun setEndpointEnabled(endpointId: String, enabled: Boolean) {
//        configStore.update { current ->
//            current.copy(
//                endpoints = current.endpoints.map { endpoint ->
//                    if (endpoint.id == endpointId) endpoint.copy(enabled = enabled) else endpoint
//                },
//            )
//        }
    }
}