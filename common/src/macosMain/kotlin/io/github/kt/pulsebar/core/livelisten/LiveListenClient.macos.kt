package io.github.kt.pulsebar.core.livelisten

import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.websocket.Frame
import io.ktor.websocket.readBytes
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.consumeEach
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import platform.Foundation.NSDate
import platform.Foundation.NSDateFormatter

/**
 * Kotlin-owned Live Listen device session. Replaces Swift's
 * `NativeLiveListenPublisher`. Responsibilities:
 *
 * - Maintain the WebSocket to `/api/v1/live-listen/device-session`
 * - Drive [LiveListenStateMachine] with control frames, connection events,
 *   and PCM chunks fed from Swift
 * - Frame PCM into WAV chunks, send as binary frames
 * - Reconnect with exponential backoff
 * - Publish [LiveListenStats] through [stats]
 *
 * The Swift layer is responsible only for CoreAudio capture: each captured
 * PCM16 chunk is forwarded via [submitPcm]. Every other Live Listen concern
 * lives here.
 */
@OptIn(ExperimentalForeignApi::class)
internal class LiveListenClient(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val log = logger(PulseLogCategory.LiveListenSession)
    private var stateMachine = LiveListenStateMachine(deviceId = "uninitialized")
    private val _stats = MutableStateFlow(LiveListenStats())
    val stats: StateFlow<LiveListenStats> = _stats.asStateFlow()

    private val http = HttpClient(Darwin) { install(WebSockets) }
    private val json = liveListenWireJson

    private val mutex = Mutex()
    private var currentConfig: LiveListenConnectionConfig? = null
    private var currentDeviceId: String = "uninitialized"
    private var currentMediaState: LiveListenNativeMediaState = defaultMediaState()
    private var currentMedia: LiveListenMedia? = null
    private var connectionJob: Job? = null
    private var reconnectAttempt = 0
    private var pcmBuffer = ByteArray(0)
    private var chunkBytes: Int = DEFAULT_CHUNK_BYTES
    private var sampleRate: Int = 48_000
    private var channels: Int = 2

    // Outbound envelopes & PCM handoff channels. Coroutines serve them to the active session.
    private val outbound = Channel<OutboundMessage>(capacity = 64)
    private val pcmChannel = Channel<ByteArray>(capacity = 256)

    private sealed interface OutboundMessage {
        data class Text(val frame: LiveListenDeviceOutbound) : OutboundMessage
        data class Binary(val bytes: ByteArray, val seq: Long) : OutboundMessage
    }

    /** Start or restart the client with the given [config]. Safe to call repeatedly. */
    fun start(config: LiveListenConnectionConfig) {
        scope.launch {
            mutex.withLock {
                if (currentConfig == config && connectionJob?.isActive == true) return@withLock
                connectionJob?.cancelAndJoin()
                currentConfig = config
                currentDeviceId = config.deviceId
                stateMachine = LiveListenStateMachine(deviceId = config.deviceId)
                sampleRate = config.sampleRate
                channels = config.channels
                chunkBytes = chunkBytesFor(config.chunkDurationMs, config.sampleRate, config.channels)
                pcmBuffer = ByteArray(0)
                reconnectAttempt = 0
                _stats.update { it.copy(maxQueuedChunks = MAX_QUEUED_CHUNKS, chunkDurationMs = config.chunkDurationMs) }
                connectionJob = scope.launch { runConnectionLoop(config) }
            }
        }
    }

    /** Stop the client. Cancels reconnects, closes the socket, drops pending chunks. */
    fun stop() {
        scope.launch {
            mutex.withLock {
                connectionJob?.cancelAndJoin()
                connectionJob = null
                currentConfig = null
                pcmBuffer = ByteArray(0)
                _stats.update {
                    it.copy(
                        connectionState = LiveListenStats.ConnectionState.Stopped,
                        statusText = "Live Listen client stopped",
                        isSending = false,
                        queuedChunks = 0,
                        queuedBytes = 0L,
                        queuedFirstSequence = null,
                        queuedLastSequence = null,
                    )
                }
            }
        }
    }

    /** Permanently shuts down the client and its coroutine scope. */
    suspend fun close() {
        connectionJob?.cancelAndJoin()
        outbound.close()
        pcmChannel.close()
        http.close()
        scope.cancel("LiveListenClient.close")
    }

    /** PCM chunk from the CoreAudio render callback's drain queue. */
    fun submitPcm(bytes: ByteArray) {
        val result = pcmChannel.trySend(bytes)
        if (!result.isSuccess) {
            _stats.update { it.copy(droppedFrames = it.droppedFrames + (bytes.size / bytesPerFrame()).toLong()) }
            log.d { "pcm.dropped reason=channel_full size=${bytes.size}" }
        }
    }

    /** Owner-side media state (e.g. what Spotify is playing) — forwarded to the server. */
    fun updateMediaState(next: LiveListenNativeMediaState) {
        log.i { "updateMediaState permission=${next.permission} playback=${next.playback} capture=${next.capture}" }
        currentMediaState = next
        scope.launch {
            apply(stateMachine.handle(LiveListenStateMachine.Input.MediaStateChanged(next), nowIso()))
        }
    }

    /**
     * Owner-side media *metadata* change (title / artist / album / trackId / ...).
     * Triggers a `media.updated` frame whenever connected. Callers may pass null
     * when nothing is playing; we only transmit when we have something to say.
     */
    fun updateMedia(next: LiveListenMedia?) {
        log.i { "updateMedia title=${next?.title} artist=${next?.artist} trackId=${next?.trackId}" }
        currentMedia = next
        if (next == null) return
        scope.launch {
            apply(stateMachine.handle(LiveListenStateMachine.Input.MediaMetadataChanged(next), nowIso()))
        }
    }

    /** Device-initiated stop (user pressed Stop, capture source lost, etc). */
    fun emitLocalStop(reason: LiveListenStopReason) {
        scope.launch {
            apply(stateMachine.handle(LiveListenStateMachine.Input.LocalStop(reason), nowIso()))
        }
    }

    // --- core connection + message pumps -----------------------------------

    private suspend fun runConnectionLoop(config: LiveListenConnectionConfig) {
        while (scope.isActive) {
            val backoffSeconds = reconnectDelaySeconds(reconnectAttempt)
            if (reconnectAttempt > 0) {
                _stats.update {
                    it.copy(
                        connectionState = LiveListenStats.ConnectionState.Reconnecting,
                        reconnectAttempt = reconnectAttempt,
                        reconnectDelaySeconds = backoffSeconds.toDouble(),
                        nextReconnectAtMillis = nowMillis() + backoffSeconds * 1_000L,
                        statusText = "Reconnecting in ${backoffSeconds}s",
                    )
                }
                log.i { "reconnect.sleep attempt=$reconnectAttempt seconds=$backoffSeconds" }
                delay(backoffSeconds * 1_000L)
            }
            if (!scope.isActive) return

            _stats.update {
                it.copy(
                    connectionState = if (reconnectAttempt == 0) LiveListenStats.ConnectionState.Connecting
                    else LiveListenStats.ConnectionState.Reconnecting,
                    statusText = "Connecting to Live Listen server…",
                    lastErrorMessage = null,
                )
            }

            val url = buildSessionUrl(config)
            val reason = runCatching { runSingleSession(config, url) }
                .exceptionOrNull()
                ?.takeIf { it !is CancellationException }
                ?.message
                ?: "socket closed"

            // Connection lost (either normally or via exception). Update state machine.
            apply(stateMachine.handle(LiveListenStateMachine.Input.ConnectionLost, nowIso()))

            _stats.update {
                it.copy(
                    connectionState = if (scope.isActive) LiveListenStats.ConnectionState.Reconnecting
                    else LiveListenStats.ConnectionState.Stopped,
                    lastDisconnectedAtMillis = nowMillis(),
                    lastErrorMessage = reason,
                    statusText = "Disconnected: $reason",
                    isSending = false,
                )
            }
            log.w { "connection.lost reason=$reason" }

            if (!scope.isActive) return
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(MAX_RECONNECT_ATTEMPTS)
        }
    }

    private suspend fun runSingleSession(config: LiveListenConnectionConfig, url: Url) {
        log.i { "session.open url=$url" }
        val session = http.webSocketSession(
            urlString = url.toString(),
        ) {
            if (config.apiKey.isNotBlank()) {
                header("Authorization", "Bearer ${config.apiKey}")
            }
        }

        _stats.update {
            it.copy(
                connectionState = LiveListenStats.ConnectionState.Connected,
                webSocketUrl = url.toString(),
                lastConnectedAtMillis = nowMillis(),
                nextReconnectAtMillis = null,
                reconnectDelaySeconds = null,
                reconnectCount = it.reconnectCount + if (reconnectAttempt > 0) 1 else 0,
                statusText = "Connected",
                lastErrorMessage = null,
            )
        }
        reconnectAttempt = 0

        // Fire the state machine's ConnectionEstablished → emits device.hello
        apply(stateMachine.handle(LiveListenStateMachine.Input.ConnectionEstablished(currentMediaState), nowIso()))
        // Now that we're in Awaiting phase, re-push the latest media state
        // (the hello carried whatever was cached at connect time, but the
        // actual state may have been updated while the TCP handshake was
        // in flight). This ensures the server sees the real playback state.
        apply(stateMachine.handle(LiveListenStateMachine.Input.MediaStateChanged(currentMediaState), nowIso()))
        // Replay the last known track metadata so the server doesn't lag behind
        // after a reconnect / fresh connect.
        currentMedia?.let {
            apply(stateMachine.handle(LiveListenStateMachine.Input.MediaMetadataChanged(it), nowIso()))
        }

        try {
            coroutineScopeLike(
                inbound = { runInboundLoop(session) },
                outboundPump = { runOutboundPump(session) },
                pcmBatcher = { runPcmBatcher() },
            )
        } finally {
            runCatching { session.cancel() }
        }
    }

    private suspend fun runInboundLoop(session: ClientWebSocketSession) {
        for (frame in session.incoming) {
            when (frame) {
                is Frame.Text -> {
                    val text = frame.readText()
                    log.i { "ws.recv.text len=${text.length} payload=${text.take(500)}" }
                    handleInboundText(text)
                }
                is Frame.Binary -> log.i { "ws.recv.binary bytes=${frame.readBytes().size}" }
                is Frame.Close -> {
                    log.i { "ws.recv.close" }
                    return
                }
                else -> log.d { "ws.recv.other frameType=${frame::class.simpleName}" }
            }
        }
    }

    private suspend fun handleInboundText(raw: String) {
        val obj: JsonObject = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: run {
            log.w { "inbound.parse_failed len=${raw.length} raw=${raw.take(200)}" }
            return
        }
        val type = obj["type"]?.jsonPrimitive?.content
        if (type != "command") {
            log.i { "inbound.non_command type=$type keys=${obj.keys}" }
            return
        }
        val commandObj = obj["command"]?.jsonObject ?: run {
            log.w { "inbound.command.missing_command_obj keys=${obj.keys} raw=${raw.take(300)}" }
            return
        }
        val commandId = obj["commandId"]?.jsonPrimitive?.content ?: run {
            log.w { "inbound.command.missing_commandId keys=${obj.keys}" }
            return
        }
        val commandType = commandObj["type"]?.jsonPrimitive?.content ?: run {
            log.w { "inbound.command.missing_command_type commandKeys=${commandObj.keys}" }
            return
        }
        log.i { "inbound.command commandType=$commandType commandId=$commandId" }

        when (commandType) {
            "stream.start" -> {
                val streamId = commandObj["streamId"]!!.jsonPrimitive.content
                val generation = commandObj["generation"]!!.jsonPrimitive.content.toInt()
                val audio = commandObj["audio"]?.jsonObject?.toAudioOptions() ?: defaultAudio()
                reshapeChunkSize(audio.chunkDurationMs)
                apply(
                    stateMachine.handle(
                        LiveListenStateMachine.Input.StartCommand(commandId, streamId, generation, audio),
                        nowIso(),
                    ),
                )
            }
            "stream.resume" -> {
                val streamId = commandObj["streamId"]!!.jsonPrimitive.content
                val generation = commandObj["generation"]!!.jsonPrimitive.content.toInt()
                val fromSeq = commandObj["fromSeq"]!!.jsonPrimitive.content.toLong()
                val audio = commandObj["audio"]?.jsonObject?.toAudioOptions() ?: defaultAudio()
                reshapeChunkSize(audio.chunkDurationMs)
                apply(
                    stateMachine.handle(
                        LiveListenStateMachine.Input.ResumeCommand(commandId, streamId, generation, fromSeq, audio),
                        nowIso(),
                    ),
                )
            }
            "stream.stop" -> {
                val reason = commandObj["reason"]?.jsonPrimitive?.content ?: "server_stop"
                apply(
                    stateMachine.handle(
                        LiveListenStateMachine.Input.StopCommand(commandId, reason),
                        nowIso(),
                    ),
                )
            }
            else -> log.w { "inbound.command.unknown commandType=$commandType" }
        }
    }

    private suspend fun runOutboundPump(session: ClientWebSocketSession) {
        outbound.consumeEach { msg ->
            when (msg) {
                is OutboundMessage.Text -> {
                    val payload = encodeFrame(msg.frame)
                    log.i { "ws.send.text type=${msg.frame::class.simpleName} len=${payload.length} payload=${payload.take(500)}" }
                    session.send(Frame.Text(payload))
                    _stats.update { it.copy(lastSendAtMillis = nowMillis()) }
                }
                is OutboundMessage.Binary -> {
                    log.d { "ws.send.binary bytes=${msg.bytes.size} seq=${msg.seq}" }
                    session.send(Frame.Binary(fin = true, data = msg.bytes))
                    _stats.update {
                        it.copy(
                            lastSendAtMillis = nowMillis(),
                            chunksSent = it.chunksSent + 1L,
                            bytesSent = it.bytesSent + msg.bytes.size.toLong(),
                            lastChunkBytes = msg.bytes.size.toLong(),
                            lastSequence = msg.seq,
                            isSending = false,
                            queuedChunks = (it.queuedChunks - 1).coerceAtLeast(0),
                            statusText = "Chunk sent seq=${msg.seq}",
                        )
                    }
                }
            }
        }
    }

    private suspend fun runPcmBatcher() {
        pcmChannel.consumeEach { pcm ->
            _stats.update {
                it.copy(
                    acceptedFrames = it.acceptedFrames + (pcm.size / bytesPerFrame()).toLong(),
                    acceptedBytes = it.acceptedBytes + pcm.size.toLong(),
                )
            }
            pcmBuffer = pcmBuffer + pcm
            while (pcmBuffer.size >= chunkBytes) {
                val chunk = pcmBuffer.copyOfRange(0, chunkBytes)
                pcmBuffer = pcmBuffer.copyOfRange(chunkBytes, pcmBuffer.size)
                apply(stateMachine.handle(LiveListenStateMachine.Input.AudioChunkReady(wrapWav(chunk)), nowIso()))
            }
            _stats.update {
                it.copy(bufferedFrames = (pcmBuffer.size / bytesPerFrame()).toLong())
            }
        }
    }

    // --- state machine application -----------------------------------------

    private suspend fun apply(outputs: List<LiveListenStateMachine.Output>) {
        for (out in outputs) {
            when (out) {
                is LiveListenStateMachine.Output.SendFrame -> {
                    outbound.send(OutboundMessage.Text(out.frame))
                    log.d { "outbound.text type=${out.frame::class.simpleName}" }
                }
                is LiveListenStateMachine.Output.SendAudioChunk -> {
                    outbound.send(OutboundMessage.Binary(out.bytes, out.seq))
                    _stats.update { it.copy(isSending = true, queuedChunks = it.queuedChunks + 1) }
                }
                LiveListenStateMachine.Output.StartCapture -> log.i { "capture.start_requested" }
                LiveListenStateMachine.Output.StopCapture -> {
                    log.i { "capture.stop_requested" }
                    pcmBuffer = ByteArray(0)
                }
            }
        }
    }

    // --- helpers -----------------------------------------------------------

    private fun buildSessionUrl(config: LiveListenConnectionConfig): Url {
        val base = Url(config.baseUrl)
        val wsProtocol = if (base.protocol.name == "https") io.ktor.http.URLProtocol.WSS
        else io.ktor.http.URLProtocol.WS
        val builder = URLBuilder()
        builder.protocol = wsProtocol
        builder.host = base.host
        val resolvedPort = base.specifiedPort.takeIf { it != 0 && it != -1 }
        if (resolvedPort != null) builder.port = resolvedPort
        builder.pathSegments = listOf("", "api", "v1", "live-listen", "device-session")
        builder.parameters.append("workspaceId", config.workspaceId)
        builder.parameters.append("roomId", config.roomId)
        builder.parameters.append("deviceId", config.deviceId)
        return builder.build()
    }

    private fun encodeFrame(frame: LiveListenDeviceOutbound): String = when (frame) {
        is DeviceHelloFrame -> json.encodeToString(DeviceHelloFrame.serializer(), frame)
        is MediaStateUpdatedFrame -> json.encodeToString(MediaStateUpdatedFrame.serializer(), frame)
        is MediaUpdatedFrame -> json.encodeToString(MediaUpdatedFrame.serializer(), frame)
        is StreamHeartbeatFrame -> json.encodeToString(StreamHeartbeatFrame.serializer(), frame)
        is AckFrame -> json.encodeToString(AckFrame.serializer(), frame)
        is StreamStoppedFrame -> json.encodeToString(StreamStoppedFrame.serializer(), frame)
        is ErrorFrame -> json.encodeToString(ErrorFrame.serializer(), frame)
    }

    private fun wrapWav(pcm16: ByteArray): ByteArray {
        val out = ByteArray(44 + pcm16.size)
        // RIFF header
        out[0] = 'R'.code.toByte(); out[1] = 'I'.code.toByte(); out[2] = 'F'.code.toByte(); out[3] = 'F'.code.toByte()
        writeLE32(out, 4, 36 + pcm16.size)
        out[8] = 'W'.code.toByte(); out[9] = 'A'.code.toByte(); out[10] = 'V'.code.toByte(); out[11] = 'E'.code.toByte()
        out[12] = 'f'.code.toByte(); out[13] = 'm'.code.toByte(); out[14] = 't'.code.toByte(); out[15] = ' '.code.toByte()
        writeLE32(out, 16, 16)             // fmt chunk size
        writeLE16(out, 20, 1)              // PCM
        writeLE16(out, 22, channels)
        writeLE32(out, 24, sampleRate)
        writeLE32(out, 28, sampleRate * channels * 2)  // byte rate
        writeLE16(out, 32, channels * 2)                // block align
        writeLE16(out, 34, 16)                          // bits per sample
        out[36] = 'd'.code.toByte(); out[37] = 'a'.code.toByte(); out[38] = 't'.code.toByte(); out[39] = 'a'.code.toByte()
        writeLE32(out, 40, pcm16.size)
        pcm16.copyInto(out, 44)
        return out
    }

    private fun writeLE16(buf: ByteArray, off: Int, value: Int) {
        buf[off] = (value and 0xFF).toByte()
        buf[off + 1] = ((value shr 8) and 0xFF).toByte()
    }

    private fun writeLE32(buf: ByteArray, off: Int, value: Int) {
        buf[off] = (value and 0xFF).toByte()
        buf[off + 1] = ((value shr 8) and 0xFF).toByte()
        buf[off + 2] = ((value shr 16) and 0xFF).toByte()
        buf[off + 3] = ((value shr 24) and 0xFF).toByte()
    }

    private fun JsonObject.toAudioOptions(): DeviceCommand.AudioOptions = DeviceCommand.AudioOptions(
        codec = this["codec"]?.jsonPrimitive?.content ?: "pcm16-wav",
        chunkDurationMs = this["chunkDurationMs"]?.jsonPrimitive?.content?.toInt() ?: 500,
        targetLatencyMs = this["targetLatencyMs"]?.jsonPrimitive?.content?.toInt() ?: 3000,
    )

    private fun defaultAudio() = DeviceCommand.AudioOptions("pcm16-wav", 500, 3000)

    private fun reshapeChunkSize(chunkDurationMs: Int) {
        chunkBytes = chunkBytesFor(chunkDurationMs, sampleRate, channels)
        _stats.update { it.copy(chunkDurationMs = chunkDurationMs) }
    }

    private fun bytesPerFrame(): Int = channels * 2

    private fun defaultMediaState() = LiveListenNativeMediaState(
        permission = LiveListenMediaPermission.ALLOW,
        playback = LiveListenPlaybackWire.PAUSED,
        capture = LiveListenCaptureRuntime.NO_CAPTURE,
    )

    private fun nowIso(): String {
        val formatter = NSDateFormatter().apply { dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX" }
        return formatter.stringFromDate(NSDate())
    }

    private fun nowMillis(): Long = (NSDate().timeIntervalSinceReferenceDate * 1000.0).toLong()

    /**
     * Helper emulating structured concurrency for three concurrent jobs: if
     * any of them throw or complete we cancel the others. [kotlinx.coroutines.coroutineScope]
     * is the idiomatic answer but we want explicit names in logs.
     */
    private suspend fun coroutineScopeLike(
        inbound: suspend () -> Unit,
        outboundPump: suspend () -> Unit,
        pcmBatcher: suspend () -> Unit,
    ) = kotlinx.coroutines.coroutineScope {
        val jobs = listOf(
            launch { inbound() },
            launch { outboundPump() },
            launch { pcmBatcher() },
        )
        jobs.forEach { it.invokeOnCompletion { jobs.forEach { j -> j.cancel() } } }
    }

    private companion object {
        const val DEFAULT_CHUNK_BYTES = 48_000 * 2 * 2 / 2 // 500ms of 48k/16-bit/stereo
        const val MAX_QUEUED_CHUNKS = 30
        const val MAX_RECONNECT_ATTEMPTS = 6

        fun reconnectDelaySeconds(attempt: Int): Long {
            val schedule = longArrayOf(1, 2, 5, 10, 30, 60)
            return schedule[attempt.coerceIn(0, schedule.size - 1)]
        }

        fun chunkBytesFor(chunkDurationMs: Int, sampleRate: Int, channels: Int): Int {
            val frames = (sampleRate.toLong() * chunkDurationMs.toLong() / 1_000L).toInt().coerceAtLeast(1)
            return frames * channels * 2
        }
    }
}
