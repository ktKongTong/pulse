package io.github.kt.pulsebar.ws

import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.model.PulseConfig
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.export.event.NativeFrontmostAppChanged
import io.github.kt.pulsebar.model.getEndpoint
import io.github.kt.pulsebar.model.stream.MediaState
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.platform.getHttpClient
import io.github.kt.pulsebar.utils.newPulseUuid
import io.github.kt.pulsebar.ws.common.DeviceV2Availability
import io.github.kt.pulsebar.ws.common.DeviceV2Focus
import io.github.kt.pulsebar.ws.common.DeviceV2PresencePayload
import io.github.kt.pulsebar.ws.common.DeviceV2PresenceState
import io.github.kt.pulsebar.ws.common.App
import io.github.kt.pulsebar.ws.common.epochMillisToIso8601
import io.github.kt.pulsebar.ws.connection.DeviceWsState
import io.github.kt.pulsebar.ws.connection.ConnectionStatus
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class DeviceV2Client(
    val configFlow: StateFlow<PulseConfig>,
    mediaStateFlow: StateFlow<MediaState>,
    private val networkOnline: StateFlow<Boolean>,
    val endpointId: String = "",
    hostCommandSink: (ServerCommandEvent) -> Unit,
) {

    internal val log = logger(PulseLogCategory.StreamSession)
    private val coroutineExceptionHandler = CoroutineExceptionHandler { _, error ->
        log.e(error) { "device.client.coroutine.failed endpoint=${configFlow.value.endpoint.url}" }
    }
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + coroutineExceptionHandler)
    internal val http = getHttpClient()
    private val mutex = Mutex()
    private var connectionJob: Job? = null
    private var stopRequested = false
    private var networkPaused = !networkOnline.value
    var connectedDeviceWS: DeviceWS = DeviceWS(http, scope, mediaStateFlow, endpointId, hostCommandSink)
    var reconnectAttempts = 0
    private val devicePhase = MutableStateFlow(ConnectionStatus.Idle)

    val deviceWsState: StateFlow<DeviceWsState> by lazy {
        combine(connectedDeviceWS.commonState, connectedDeviceWS.mediaState, devicePhase) { common, media, phase ->
            DeviceWsState(
                phase = phase,
                common = common,
                media = media,
                reconnectAttempt = reconnectAttempts,
            )
        }.stateIn(scope, SharingStarted.Eagerly, DeviceWsState())
    }


    fun start(onReady: (suspend () -> Unit)? = null) {
        stopRequested = false
        scope.launch {
            mutex.withLock {
                val config = configFlow.value
                val configError = config.endpoint.validationError()
                if (configError != null) {
                    log.w { "device.v2.config.invalid endpointId=$endpointId reason=$configError" }
                    return@withLock
                }
                if (!networkOnline.value) {
                    networkPaused = true
                    devicePhase.value = ConnectionStatus.Offline
                    log.i { "device.v2.start.deferred.offline endpointId=$endpointId" }
                    return@withLock
                }
                log.d { "start ${this@DeviceV2Client::class.simpleName}" }
                if (connectionJob?.isActive == true) return@withLock
                reconnectAttempts = 0
                connectionJob?.cancelAndJoin()
                log.d { "connecting to endpoint ${config.endpoint.url}" }
                devicePhase.value = ConnectionStatus.Connecting
                connectionJob = scope.launch { connect(config, onReady) }
            }
        }
    }

    fun setNetworkOnline(online: Boolean) {
        scope.launch {
            mutex.withLock {
                if (online) {
                    if (!networkPaused && connectionJob?.isActive == true) return@withLock
                    networkPaused = false
                    if (stopRequested || !configFlow.value.endpoint.enabled) return@withLock
                    reconnectAttempts = 0
                    connectionJob?.cancelAndJoin()
                    devicePhase.value = ConnectionStatus.Connecting
                    connectionJob = scope.launch { connect(configFlow.value) }
                    return@withLock
                }
                if (networkPaused) return@withLock
                networkPaused = true
                log.i { "device.v2.network.offline endpointId=$endpointId cancel connection" }
                connectedDeviceWS.stopActiveStream(StreamStopReason.CONNECTION_LOST)
                connectionJob?.cancelAndJoin()
                connectionJob = null
                reconnectAttempts = 0
                devicePhase.value = ConnectionStatus.Offline
            }
        }
    }

    fun stop() {
        stopRequested = true
        devicePhase.value = ConnectionStatus.Closing
        scope.launch {
            mutex.withLock {
                connectionJob?.cancelAndJoin()
                connectionJob = null
                devicePhase.value = ConnectionStatus.Closed
            }
        }
    }

    fun dispose() {
        stopRequested = true
        devicePhase.value = ConnectionStatus.Closed
        scope.cancel("device client disposed")
    }

    suspend fun publishFocusChanged(event: NativeFrontmostAppChanged) {
        if (deviceWsState.value.phase != ConnectionStatus.Connected) return
        runCatching {
            connectedDeviceWS.presenceOutbound.send(
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
            log.w(error) { "presence.enqueue.failed endpointId=$endpointId" }
        }
    }

    fun stopActiveStream(reason: StreamStopReason) {
        connectedDeviceWS.stopActiveStream(reason)
    }

    private suspend fun connect(config: PulseConfig, onReady: (suspend () -> Unit)? = null) {
        while (scope.isActive && !stopRequested) {
            if (!networkOnline.value) {
                networkPaused = true
                devicePhase.value = ConnectionStatus.Offline
                return
            }
            if (reconnectAttempts > 0) {
                devicePhase.value = ConnectionStatus.Reconnecting
                sleepBeforeReconnect()
            } else {
                devicePhase.value = ConnectionStatus.Connecting
            }
            if (stopRequested) return
            if (!networkOnline.value) {
                networkPaused = true
                devicePhase.value = ConnectionStatus.Offline
                return
            }
            log.d { "connecting ${config.endpoint.url}" }
            val result = runCatching { initConnection(config, onReady) }
            val failure = result.exceptionOrNull()
            val expectedClose = failure?.takeIf { it.isExpectedSocketCloseNoise() }
            val err = failure?.takeIf { it !is CancellationException && !it.isExpectedSocketCloseNoise() }
            val reason = when {
                err != null -> err.reasonText()
                expectedClose != null -> "socket closed: ${expectedClose.reasonText()}"
                else -> "socket closed"
            }
            when {
                err != null -> log.w(err) { "device.v2.failed reason=$reason" }
                expectedClose != null -> log.i { "device.v2.closed reason=$reason" }
                failure == null -> log.i { "device.v2.closed reason=$reason" }
            }
            if (!scope.isActive || stopRequested) {
                log.d { "scope not active anymore" }
                return
            }
            if (!networkOnline.value) {
                networkPaused = true
                devicePhase.value = ConnectionStatus.Offline
                return
            }
            if (shouldFailPermanently(reason, reconnectAttempts)) {
                log.d { "failed to connect permanently" }
                devicePhase.value = ConnectionStatus.Failed
                return
            }

            devicePhase.value = ConnectionStatus.Reconnecting
            reconnectAttempts = (reconnectAttempts + 1).coerceAtMost(6)
        }
    }


    private suspend fun initConnection(config: PulseConfig, onReady: (suspend () -> Unit)? = null) {
        connectedDeviceWS.resetConnection("connect")
        log.d { "connecting to unified device ws" }
        val deviceSessionId = connectedDeviceWS.connect(config.endpoint.getEndpoint(), onReady)
        log.d { "device ws connected:$deviceSessionId" }
        if (!isConnectionStable(500.milliseconds)) {
            log.i { "device.v2.connect.unstable endpointId=$endpointId" }
            return
        }
        devicePhase.value = ConnectionStatus.Connected
        log.d { "connected" }
        coroutineScope {
            try {
                log.d { "listen on unified device ws" }
                select {
                    connectedDeviceWS.wsManager.listenJob.onJoin {
                        log.i { "device.v2.listen.ended endpointId=$endpointId" }
                    }
                }
            } finally {
                log.d { "cancelled" }
                connectedDeviceWS.wsManager.listenJob.cancelAndJoin()
            }
        }
    }

    private suspend fun isConnectionStable(duration: Duration): Boolean {
        delay(duration)
        return connectedDeviceWS.wsManager.listenJob.isActive
    }

    private fun shouldFailPermanently(reason: String, attempt: Int): Boolean {
        if (attempt >= 6) return true
        return reason.contains("invalid_session", ignoreCase = true) ||
            reason.contains("hello rejected", ignoreCase = true) ||
            reason.contains("unsupported", ignoreCase = true) ||
            reason.contains("policy", ignoreCase = true)
    }

    private suspend fun sleepBeforeReconnect() {
        val seconds = reconnectDelaySeconds(reconnectAttempts)
        log.d { "reconnect after $seconds" }
        delay(seconds.seconds)
    }
}

internal fun reconnectDelaySeconds(attempt: Int): Long {
    val schedule = longArrayOf(1, 2, 5, 10, 30, 60)
    return schedule[attempt.coerceIn(0, schedule.size - 1)]
}

private fun Throwable.isExpectedSocketCloseNoise(): Boolean {
    var current: Throwable? = this
    while (current != null) {
        val name = current::class.simpleName.orEmpty()
        if (current is ClosedReceiveChannelException || name == "ClosedReceiveChannelException") return true
        current = current.cause
    }
    return false
}

private fun Throwable.reasonText(): String =
    "${this::class.simpleName}: ${message ?: "(no message)"}"

private fun PulseConfig.validationError(): String? =
    endpoint.validationError()


private fun io.github.kt.pulsebar.model.EndpointConfig.validationError(): String? =
    when {
        url.isBlank() -> "empty_url"
        deviceId.isBlank() -> "empty_device_id"
        else -> null
    }
