package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.stream.StreamCaptureRuntime
import io.github.kt.pulsebar.core.stream.StreamConnectionConfig
import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamMediaPermission
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.stream.StreamPlaybackWire
import io.github.kt.pulsebar.core.stream.StreamStats
import io.github.kt.pulsebar.core.stream.StreamStopReason
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
import kotlinx.coroutines.channels.onFailure
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class DeviceV2Client(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    internal val log = logger(PulseLogCategory.StreamSession)
    internal val http = HttpClient(Darwin) { install(WebSockets) }
    private val mutex = Mutex()
    internal val pcmChannel = Channel<ByteArray>(capacity = 256)
    internal val mediaOutbound = Channel<String>(capacity = 64)
    internal val presenceOutbound = Channel<Unit>(capacity = Channel.CONFLATED)
    private val _stats = MutableStateFlow(StreamStats())
    val stats: StateFlow<StreamStats> = _stats.asStateFlow()

    private var connectionJob: Job? = null
    private var currentConfig: StreamConnectionConfig? = null
    internal var mediaState = defaultMediaState()
    internal var currentMedia: StreamMedia? = null
    internal var reconnectAttempt = 0
    internal var pcmBuffer = ByteArray(0)
    internal var activeStream: DeviceV2ActiveStream? = null
    internal var sampleRate = 48_000
    internal var channels = 2
    internal var chunkDurationMs = 500
    internal var chunkBytes = deviceV2ChunkBytesFor(chunkDurationMs, sampleRate, channels)

    fun start(config: StreamConnectionConfig) {
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

    fun updateMediaState(next: StreamNativeMediaState) {
        mediaState = next
        mediaOutbound.trySend(currentStreamStateFrame())
    }

    fun updateMedia(next: StreamMedia?) {
        currentMedia = next
        if (next != null) mediaOutbound.trySend(currentMediaFrame(next))
    }

    fun publishPresence() {
        presenceOutbound.trySend(Unit)
    }

    fun emitLocalStop(reason: StreamStopReason) {
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

    internal fun updateStats(transform: (StreamStats) -> StreamStats) {
        _stats.update(transform)
    }

    private suspend fun runLoop(config: StreamConnectionConfig) {
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
            if (!scope.isActive) return
            if (shouldFailPermanently(reason, reconnectAttempt)) {
                _stats.update { failedStats(it, reason) }
                return
            }
            _stats.update { disconnectedStats(it, reason) }
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(6)
        }
    }

    private suspend fun runSession(config: StreamConnectionConfig) {
        val common = openCommon(config)
        val deviceSessionId = readCommonAck(common)
        coroutineScope {
            val commonInboundJob = launch { runCommonInbound(common) }
            var presenceJob: Job? = null
            val mediaReady = Channel<Unit>(capacity = 1)
            val mediaJob = launch {
                runMedia(config, deviceSessionId) {
                    mediaReady.trySend(Unit).onFailure {
                        log.w { "device.v2.media.ready signal dropped" }
                    }
                }
            }
            try {
                select<Unit> {
                    commonInboundJob.onJoin { }
                    mediaReady.onReceive {
                        presenceJob = launch { runPresence(common) }
                        publishPresence()
                    }
                    mediaJob.onJoin { }
                }
                if (presenceJob != null) {
                    select<Unit> {
                        commonInboundJob.onJoin { }
                        mediaJob.onJoin { }
                    }
                }
            } finally {
                mediaReady.close()
                presenceJob?.cancelAndJoin()
                commonInboundJob.cancelAndJoin()
                mediaJob.cancelAndJoin()
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
}
