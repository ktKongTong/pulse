package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.livelisten.LiveListenCaptureRuntime
import io.github.kt.pulsebar.core.livelisten.LiveListenConnectionConfig
import io.github.kt.pulsebar.core.livelisten.LiveListenMedia
import io.github.kt.pulsebar.core.livelisten.LiveListenMediaPermission
import io.github.kt.pulsebar.core.livelisten.LiveListenNativeMediaState
import io.github.kt.pulsebar.core.livelisten.LiveListenPlaybackWire
import io.github.kt.pulsebar.core.livelisten.LiveListenStats
import io.github.kt.pulsebar.core.livelisten.LiveListenStopReason
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class DeviceV2Client(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    internal val log = logger(PulseLogCategory.LiveListenSession)
    internal val http = HttpClient(Darwin) { install(WebSockets) }
    private val mutex = Mutex()
    internal val pcmChannel = Channel<ByteArray>(capacity = 256)
    internal val mediaOutbound = Channel<String>(capacity = 64)
    private val _stats = MutableStateFlow(LiveListenStats())
    val stats: StateFlow<LiveListenStats> = _stats.asStateFlow()

    private var connectionJob: Job? = null
    private var currentConfig: LiveListenConnectionConfig? = null
    internal var mediaState = defaultMediaState()
    internal var currentMedia: LiveListenMedia? = null
    internal var reconnectAttempt = 0
    internal var pcmBuffer = ByteArray(0)
    internal var activeStream: DeviceV2ActiveStream? = null
    internal var sampleRate = 48_000
    internal var channels = 2
    internal var chunkDurationMs = 500
    internal var chunkBytes = deviceV2ChunkBytesFor(chunkDurationMs, sampleRate, channels)

    fun start(config: LiveListenConnectionConfig) {
        scope.launch {
            mutex.withLock {
                if (currentConfig == config && connectionJob?.isActive == true) return@withLock
                connectionJob?.cancelAndJoin()
                currentConfig = config
                reconnectAttempt = 0
                sampleRate = config.sampleRate
                channels = config.channels
                chunkDurationMs = config.chunkDurationMs
                chunkBytes = deviceV2ChunkBytesFor(chunkDurationMs, sampleRate, channels)
                pcmBuffer = ByteArray(0)
                activeStream = null
                _stats.update { it.copy(maxQueuedChunks = 30, chunkDurationMs = chunkDurationMs) }
                connectionJob = scope.launch { runLoop(config) }
            }
        }
    }

    fun stop() {
        scope.launch {
            mutex.withLock {
                connectionJob?.cancelAndJoin()
                connectionJob = null
                currentConfig = null
                activeStream = null
                pcmBuffer = ByteArray(0)
                _stats.update { stoppedStats(it) }
            }
        }
    }

    fun submitPcm(bytes: ByteArray) {
        if (!pcmChannel.trySend(bytes).isSuccess) {
            _stats.update { it.copy(droppedFrames = it.droppedFrames + (bytes.size / deviceV2BytesPerFrame(channels)).toLong()) }
        }
    }

    fun updateMediaState(next: LiveListenNativeMediaState) {
        mediaState = next
        mediaOutbound.trySend(currentStreamStateFrame())
    }

    fun updateMedia(next: LiveListenMedia?) {
        currentMedia = next
        if (next != null) mediaOutbound.trySend(currentMediaFrame(next))
    }

    fun emitLocalStop(reason: LiveListenStopReason) {
        val stream = activeStream ?: return
        activeStream = null
        pcmBuffer = ByteArray(0)
        _stats.update { it.copy(captureRequested = false) }
        mediaOutbound.trySend(
            deviceV2StreamStoppedFrame(
                DeviceV2StreamStoppedPayload(
                    streamId = stream.streamId,
                    generation = stream.generation,
                    reason = "manual_stop",
                    sentAt = deviceV2NowIso(),
                ),
            ),
        )
        log.i { "local.stop reason=$reason streamId=${stream.streamId}" }
    }

    internal fun updateStats(transform: (LiveListenStats) -> LiveListenStats) {
        _stats.update(transform)
    }

    private suspend fun runLoop(config: LiveListenConnectionConfig) {
        while (scope.isActive) {
            if (reconnectAttempt > 0) sleepBeforeReconnect()
            _stats.update { connectingStats(it) }
            val result = runCatching { runSession(config) }
            val err = result.exceptionOrNull()?.takeIf { it !is CancellationException }
            val reason = err?.let { "${it::class.simpleName}: ${it.message ?: "(no message)"}" }
                ?: "socket closed"
            if (err != null) log.w(err) { "device.v2.failed reason=$reason" }
            activeStream = null
            pcmBuffer = ByteArray(0)
            _stats.update { disconnectedStats(it, reason) }
            if (!scope.isActive) return
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(6)
        }
    }

    private suspend fun runSession(config: LiveListenConnectionConfig) {
        val common = openCommon(config)
        val deviceSessionId = readCommonAck(common)
        coroutineScope {
            val commonInboundJob = launch { runCommonInbound(common) }
            val presenceJob = launch { runPresence(common) }
            val mediaJob = launch { runMedia(config, deviceSessionId) }
            mediaJob.join()
            presenceJob.cancel()
            commonInboundJob.cancel()
        }
    }
}
