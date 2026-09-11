package io.github.kt.pulsebar.desktopipc

import io.github.kt.pulsebar.desktopipc.v1.ConnectionStateSnapshot
import io.github.kt.pulsebar.desktopipc.v1.ConfigSnapshot
import io.github.kt.pulsebar.desktopipc.v1.DesktopRuntimeGrpcKt
import io.github.kt.pulsebar.desktopipc.v1.PlatformEvent
import io.github.kt.pulsebar.desktopipc.v1.PublishSummary
import io.github.kt.pulsebar.desktopipc.v1.RuntimeStateSnapshot
import io.github.kt.pulsebar.desktopipc.v1.UserCommand
import io.github.kt.pulsebar.desktopipc.v1.WatchRequest
import io.github.kt.pulsebar.desktopipc.v1.configSnapshot
import io.github.kt.pulsebar.desktopipc.v1.connectionStateSnapshot
import io.github.kt.pulsebar.desktopipc.v1.publishSummary
import io.github.kt.pulsebar.desktopipc.v1.runtimeStateSnapshot
import io.github.kt.pulsebar.export.PulseBarBridge
import io.github.kt.pulsebar.export.event.ConnectCommand
import io.github.kt.pulsebar.export.event.DisconnectCommand
import io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
import io.github.kt.pulsebar.export.event.SetEndpointEnabledCommand
import io.github.kt.pulsebar.export.event.UpdateConfigCommand
import io.github.kt.pulsebar.model.EndpointConfig
import io.github.kt.pulsebar.model.FocusConfig
import io.github.kt.pulsebar.model.PulseConfig
import io.grpc.Status
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Real shared-runtime edge for the first Windows runtime slice. */
class RealDesktopRuntimeService(
    private val bridge: PulseBarBridge,
    private val authToken: String,
) : DesktopRuntimeGrpcKt.DesktopRuntimeCoroutineImplBase() {

    private val runtimeRevision = AtomicLong(0)
    private val configRevision = AtomicLong(0)
    private val connectionRevision = AtomicLong(0)
    private val acceptedPlatformEvents = AtomicInteger(0)

    override fun watchRuntimeState(request: WatchRequest): Flow<RuntimeStateSnapshot> {
        requireToken(request.authToken)
        return bridge.runtimeState
            .map { state ->
                runtimeStateSnapshot {
                    revision = runtimeRevision.incrementAndGet()
                    frontmostApp = state.focusState?.id ?: "unknown"
                    platformEventCount = acceptedPlatformEvents.get()
                }
            }
            .onStart { log("watch: runtime subscriber attached") }
            .onCompletion { cause -> log("watch: runtime subscriber detached cause=$cause") }
    }

    override fun watchConfig(request: WatchRequest): Flow<ConfigSnapshot> {
        requireToken(request.authToken)
        return bridge.config
            .map { config ->
                configSnapshot {
                    revision = configRevision.incrementAndGet()
                    url = config.endpoint.url
                    deviceId = config.endpoint.deviceId
                    apiKey = config.endpoint.apiKey
                    enabled = config.endpoint.enabled
                    idleThresholdSeconds = config.commonConfig.idleThresholdSeconds
                    changeStabilityMillis = config.commonConfig.changeStabilityMillis
                }
            }
            .onStart { log("watch: config subscriber attached") }
            .onCompletion { cause -> log("watch: config subscriber detached cause=$cause") }
    }

    override fun watchConnectionState(
        request: WatchRequest,
    ): Flow<ConnectionStateSnapshot> {
        requireToken(request.authToken)
        return bridge.connectionState
            .map { state ->
                connectionStateSnapshot {
                    revision = connectionRevision.incrementAndGet()
                    phase = state.connection.phase.name
                    url = state.endpointConfig.url
                    enabled = state.endpointConfig.enabled
                    reconnectCount = state.connection.reconnectCount
                    reconnectAttempt = state.connection.reconnectAttempt
                    state.connection.lastErrorMessage?.let { lastErrorMessage = it }
                }
            }
            .onStart { log("watch: connection subscriber attached") }
            .onCompletion { cause -> log("watch: connection subscriber detached cause=$cause") }
    }

    override suspend fun publishPlatformEvents(
        requests: Flow<PlatformEvent>,
    ): PublishSummary {
        var accepted = 0
        requests.collect { event ->
            requireToken(event.authToken)
            when (event.eventCase) {
                PlatformEvent.EventCase.FRONTMOST_APP_CHANGED -> {
                    val appId = event.frontmostAppChanged.appId
                    log("event.recv type=FrontmostAppChanged app=$appId")
                    bridge.emitNativeEvent(
                        NativeFrontmostAppChanged(bundleId = appId, name = appId)
                    )
                    accepted += 1
                    acceptedPlatformEvents.incrementAndGet()
                    log("publish: frontmostAppChanged -> $appId")
                }
                PlatformEvent.EventCase.EVENT_NOT_SET ->
                    log("publish: ignoring event without a known case")
            }
        }
        log("event.batch.completed accepted=$accepted")
        return publishSummary { acceptedEvents = accepted }
    }

    override suspend fun publishUserCommands(
        requests: Flow<UserCommand>,
    ): PublishSummary {
        var accepted = 0
        requests.collect { command ->
            requireToken(command.authToken)
            when (command.commandCase) {
                UserCommand.CommandCase.UPDATE_CONFIG -> {
                    val next = command.updateConfig
                    log(
                        "command.recv type=UpdateConfig url=${next.url} device=${next.deviceId} " +
                            "enabled=${next.enabled} idleSeconds=${next.idleThresholdSeconds} " +
                            "stabilityMillis=${next.changeStabilityMillis} apiKeyPresent=${next.apiKey.isNotEmpty()}"
                    )
                    bridge.emitNativeEvent(
                        UpdateConfigCommand(
                            PulseConfig(
                                endpoint = EndpointConfig(
                                    url = next.url,
                                    deviceId = next.deviceId,
                                    apiKey = next.apiKey,
                                    enabled = next.enabled,
                                ),
                                commonConfig = FocusConfig(
                                    idleThresholdSeconds = next.idleThresholdSeconds,
                                    changeStabilityMillis = next.changeStabilityMillis,
                                ),
                            )
                        )
                    )
                    accepted += 1
                }
                UserCommand.CommandCase.CONNECT -> {
                    log("command.recv type=Connect")
                    bridge.emitNativeEvent(ConnectCommand())
                    accepted += 1
                }
                UserCommand.CommandCase.DISCONNECT -> {
                    log("command.recv type=Disconnect")
                    bridge.emitNativeEvent(DisconnectCommand())
                    accepted += 1
                }
                UserCommand.CommandCase.SET_ENDPOINT_ENABLED -> {
                    log("command.recv type=SetEndpointEnabled enabled=${command.setEndpointEnabled.enabled}")
                    bridge.emitNativeEvent(
                        SetEndpointEnabledCommand(
                            command.setEndpointEnabled.enabled
                        )
                    )
                    accepted += 1
                }
                UserCommand.CommandCase.COMMAND_NOT_SET ->
                    log("command.recv type=Unknown ignored=true")
            }
        }
        log("command.batch.completed accepted=$accepted")
        return publishSummary { acceptedEvents = accepted }
    }

    private fun requireToken(token: String) {
        if (token != authToken) {
            log("auth.invalid_token")
            throw Status.UNAUTHENTICATED
                .withDescription("Invalid desktop IPC auth token")
                .asRuntimeException()
        }
        return
    }


    private fun log(message: String) = println("[desktop-daemon] $message")
}
