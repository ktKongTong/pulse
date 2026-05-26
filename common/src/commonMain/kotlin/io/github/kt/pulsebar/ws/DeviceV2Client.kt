package io.github.kt.pulsebar.ws

import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.github.kt.pulsebar.core.stream.PulseConfig
import io.github.kt.pulsebar.media.StreamState
import io.github.kt.pulsebar.platform.getHttpClient
import io.github.kt.pulsebar.ws.common.CommonWS
import io.github.kt.pulsebar.ws.connection.DeviceWsState
import io.github.kt.pulsebar.ws.connection.deriveDevicePhase
import io.github.kt.pulsebar.ws.media.MediaWS
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class DeviceV2Client(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val configFlow: StateFlow<PulseConfig>,
    streamFlow: StateFlow<StreamState>,
) {
    internal val log = logger(PulseLogCategory.StreamSession)
    internal val http = getHttpClient()
    private val mutex = Mutex()
    private var connectionJob: Job? = null
//    private var currentConfig: PulseConfig? = null
    var connectedMediaWS: MediaWS = MediaWS(http, scope, streamFlow)
    private var connectedCommonWS: CommonWS = CommonWS(http, scope)
    var reconnectAttempts = 0

    val deviceWsState: StateFlow<DeviceWsState> by lazy {
        combine(connectedCommonWS.state, connectedMediaWS.state) { common, media ->
            DeviceWsState(
                phase = deriveDevicePhase(common, media),
                common = common,
                media = media,
                reconnectAttempt = reconnectAttempts,
            )
        }.stateIn(scope, SharingStarted.Eagerly, DeviceWsState())
    }


    fun start(onReady: (suspend () -> Unit)? = null) {
        scope.launch {
            mutex.withLock {
                if (connectionJob?.isActive == true) return@withLock
                connectionJob?.cancelAndJoin()
//                updateStats { it.copy(maxQueuedChunks = 30, chunkDurationMs = 1000) }
                connectionJob = scope.launch { connect(configFlow.value, onReady) }
            }
        }
    }

    fun stop() {
        scope.launch {
            mutex.withLock {
                connectionJob?.cancelAndJoin()
                connectionJob = null
            }
        }
    }

    private suspend fun connect(config: PulseConfig, onReady: (suspend () -> Unit)? = null) {
        while (scope.isActive) {
            if (reconnectAttempts > 0) sleepBeforeReconnect()
//            updateStats { it.connecting() }
            val result = runCatching { initConnection(config, onReady) }
            val err = result.exceptionOrNull()?.takeIf { it !is CancellationException }
            val reason = err?.let { "${it::class.simpleName}: ${it.message ?: "(no message)"}" }
                ?: "socket closed"
            if (err != null) log.w(err) { "device.v2.failed reason=$reason" }
            if (!scope.isActive) return
            if (shouldFailPermanently(reason, reconnectAttempts)) {
//                updateStats { it.failed(reason) }
                return
            }
//            updateStats { it.disconnected(reason) }
            reconnectAttempts = (reconnectAttempts + 1).coerceAtMost(6)
        }
    }


    private suspend fun initConnection(config: PulseConfig, onReady: (suspend () -> Unit)? = null) {
        val deviceSessionId = connectedCommonWS.connect(config.endpoint)
        connectedMediaWS.connect(deviceSessionId, config, onReady)
        coroutineScope {
            try {
                select {
                    connectedCommonWS.wsManager.listenJob.onJoin {}
                    connectedMediaWS.wsManager.listenJob.onJoin {}
                }
            } finally {
                connectedCommonWS.wsManager.listenJob.cancelAndJoin()
                connectedMediaWS.wsManager.listenJob.cancelAndJoin()
            }
        }
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
//        updateStats {
//            it.copy(
//                connectionState = StreamStats.ConnectionState.Reconnecting,
//                reconnectAttempt = reconnectAttempts,
//                reconnectDelaySeconds = seconds.toDouble(),
//                nextReconnectAtMillis = nowInMillis() + seconds * 1_000L,
//                statusText = "Reconnecting in ${seconds}s",
//            )
//        }
        delay(seconds.seconds)
    }
}

internal fun reconnectDelaySeconds(attempt: Int): Long {
    val schedule = longArrayOf(1, 2, 5, 10, 30, 60)
    return schedule[attempt.coerceIn(0, schedule.size - 1)]
}


internal fun DeviceV2Client.submitPcm(bytes: ByteArray) {
//    if (!pcmChannel.trySend(bytes).isSuccess) {
//        updateStats { it.copy(droppedFrames = it.droppedFrames + (bytes.size / deviceV2BytesPerFrame(channels)).toLong()) }
//    }
}

internal fun DeviceV2Client.updateMediaState(next: StreamNativeMediaState) {
//        connectedMediaWS?.mediaOutbound?.trySend(currentStreamStateFrame())
}

internal fun DeviceV2Client.updateMedia(next: StreamMedia?) {
//        if (next != null) connectedMediaWS.mediaOutbound.trySend(DeviceV2MediaUpdatePayload(next))
}

// updateStats { it.copy(statusText = "Device common connected, connecting stream") }
//        log.i { "device.v2.common.ack deviceSessionId=${commonWS.deviceSessionId}" }
//        val url = config.getCommonWSUrl()
//        log.i { "device.v2.common.open url=$url" }
//        updateStats {
//            it.copy(
//                webSocketUrl = url.toString(),
//                statusText = "Device common websocket open, waiting for ack",
//            )
//        }