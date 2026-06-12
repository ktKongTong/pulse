package io.github.kt.pulsebar.ws.media


import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.model.PulseConfigItem
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.export.event.NativeRequestedCommandEvent
import io.github.kt.pulsebar.export.event.NativeStoppedCommandEvent
import io.github.kt.pulsebar.export.event.ServerCommandEvent

import io.github.kt.pulsebar.utils.deviceV2BytesPerFrame
import io.github.kt.pulsebar.utils.deviceV2ChunkBytesFor
import io.github.kt.pulsebar.utils.packPcm16
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.model.connection.ServerCommandType
import io.github.kt.pulsebar.model.connection.ServerStreamCommand
import io.github.kt.pulsebar.model.getEndpoint
import io.github.kt.pulsebar.model.stream.CaptureInfo
import io.github.kt.pulsebar.model.stream.MediaState
import io.github.kt.pulsebar.model.stream.getSnapshot
import io.github.kt.pulsebar.model.stream.rejectionReason

import io.github.kt.pulsebar.ws.connection.WSConfig
import io.github.kt.pulsebar.ws.connection.WSManager
import io.github.kt.pulsebar.ws.connection.WSPayload
import io.github.kt.pulsebar.ws.connection.deviceV2Json
import io.github.kt.pulsebar.ws.getMediaWSUrl
import io.ktor.client.HttpClient
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.getOrElse
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive


private class PcmSegmentBuffer {
    private val segments = ArrayDeque<ByteArray>()
    var size: Int = 0
        private set

    fun isEmpty(): Boolean = size == 0

    fun append(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        segments.addLast(bytes)
        size += bytes.size
    }

    fun take(byteCount: Int): ByteArray {
        require(byteCount <= size) { "requested $byteCount bytes from $size-byte PCM buffer" }
        val out = ByteArray(byteCount)
        var copied = 0
        while (copied < byteCount) {
            val segment = segments.removeFirst()
            val remaining = byteCount - copied
            val take = minOf(segment.size, remaining)
            segment.copyInto(out, destinationOffset = copied, startIndex = 0, endIndex = take)
            copied += take
            size -= take
            if (take < segment.size) {
                segments.addFirst(segment.copyOfRange(take, segment.size))
            }
        }
        return out
    }

    fun clear() {
        segments.clear()
        size = 0
    }
}

internal class MediaWS(
    http: HttpClient,
    scope: CoroutineScope,
    val mediaStateFlow: StateFlow<MediaState>,
    private val endpointId: String,
    private val hostCommandSink: (ServerCommandEvent) -> Unit,
) {
    private val pcmBuffer = PcmSegmentBuffer()
    private var pcmBufferStartMediaPositionMs: Long? = null
    internal val mediaOutbound = Channel<WSPayload>(capacity = 64)
    internal var activeStream: DeviceV2ActiveStream? = null
    internal var wsManager: WSManager = WSManager(http, scope)
    private var pcmAcceptedCount: Long = 0L
    private var pcmAcceptedBytes: Long = 0L
    private val log = logger(PulseLogCategory.StreamSession)
    private val _state = MutableStateFlow(MediaRuntimeState())
    private val runtimeState: StateFlow<MediaRuntimeState> = _state.asStateFlow()
    internal val state = combine(wsManager.state, runtimeState) { connection, runtime ->
        MediaWSState(
            connection = connection,
            runtimeState = runtime,
        )
    }

    init {
        // 当stream state 更新时
        scope.launch {
            mediaStateFlow
                .collect {
                    transitionState(MediaRuntimeEvent.MediaStateChanged(it.getSnapshot()))
                    mediaOutbound.trySend(DeviceV2StreamStatePayload(state = it.streamState))
                }
        }

        scope.launch {
            mediaStateFlow
                .distinctUntilChanged { old, new ->
                  old.streamState == new.streamState
                }
                .filter {
                    it.streamState.reason != null
                }
                .collect {
                    stopStream(StreamStopReason.MANUAL_STOP)
                }
        }
        // media 更新时
        scope.launch {
            mediaStateFlow.value.mediaFlow
                .collect {
                    transitionState(MediaRuntimeEvent.PlayingChanged(it))
                    mediaOutbound.trySend(DeviceV2MediaUpdatePayload(it)).getOrElse { error ->
                    }
                }
        }


    }

    internal suspend fun connect(deviceSessionId: String, config: PulseConfigItem, onReady: (suspend () -> Unit)? = null, timeout: Duration = 10.seconds) {
        resetConnection("connect")
        wsManager.connect(
            WSConfig(
                config.endpoint.getEndpoint().getMediaWSUrl(deviceSessionId),
                apiKey = config.endpoint.apiKey,
                handShakeTimeout = timeout,
            )
        ) { deviceV2MediaHello() }
        transitionState(MediaRuntimeEvent.HelloAccepted(deviceSessionId))
        onReady?.invoke()
        sendCurrentStateSnapshot()
        wsManager.listen { listen() }
    }

    internal fun resetConnection(reason: String) {
        wsManager.reset(reason)
        pcmBuffer.clear()
        pcmBufferStartMediaPositionMs = null
        transitionState(MediaRuntimeEvent.RuntimeReset(reason))
    }

    internal fun updateState(tran: (stats: MediaRuntimeState) -> MediaRuntimeState) {
        _state.update { tran(it) }
    }

    internal fun transitionState(event: MediaRuntimeEvent) {
        _state.update { it.reduce(event) }
    }

    private suspend fun sendCurrentStateSnapshot() {
        val state = mediaStateFlow.value

        transitionState(MediaRuntimeEvent.MediaStateChanged(state.getSnapshot()))
//        log.d { "media.state.send.snapshot endpointId=$endpointId playback=${state.mediaState.playback} capture=${state.mediaState.capture} media=${state.mediaState.media?.title ?: "nil"}" }
        wsManager.send(DeviceV2StreamStatePayload(state.streamState))
        val media = state.mediaFlow.value
        if (media != null) {
            transitionState(MediaRuntimeEvent.PlayingChanged(media))
            // log.d { "media.updated.send.snapshot endpointId=$endpointId title=${media.title ?: "nil"} playback=${media.playbackState}" }
            wsManager.send(DeviceV2MediaUpdatePayload(media))
        }
    }

    internal fun stopActiveStream(reason: StreamStopReason) {
        stopStream(reason)
    }

    private fun stopStream(reason: StreamStopReason) {
        val stream = activeStream ?: return
        activeStream = null
        pcmBuffer.clear()
        pcmBufferStartMediaPositionMs = null
        updateState { it.copy(captureRequested = false) }
        log.i {
            "media.stream.stopped.local endpointId=$endpointId streamId=${stream.streamId} " +
                "generation=${stream.generation} reason=$reason"
        }
        mediaOutbound.trySend(
            DeviceV2StreamStoppedPayload(
                streamId = stream.streamId,
                generation = stream.generation,
                reason = reason,
                sentAt = nowInIso8601(),
            )
        )
        transitionState(MediaRuntimeEvent.StreamStopped(reason))
        hostCommandSink(
            NativeStoppedCommandEvent(
                endpointId = endpointId,
                commandId = "local-${nowInMillis()}",
                streamId = stream.streamId,
                generation = stream.generation,
                reason = reason,
            )
        )
    }

    internal suspend fun sendFirstFrame(frame: Frame) {
//        session.sendMessage(currentStreamStateFrame())
//        currentMedia?.let { session.sendMessage(currentMediaFrame(it)) }
    }

    internal suspend fun listen() {
        coroutineScope {
            val inbound = launch {
                wsManager.incomingFlow
                    .takeWhile { frame ->
                        if (frame is Frame.Close) {
                            val reason = frame.readReason()
                            log.w { "media.inbound.close endpointId=$endpointId code=${reason?.code} message=${reason?.message}" }
                            false
                        } else {
                            true
                        }
                    }
                    .filterIsInstance<Frame.Text>()
                    .mapNotNull { frame ->
                        val text = frame.readText()
                        log.d { "media.inbound.raw endpointId=$endpointId text=$text" }
                        when (val parsed = text.toDeviceV2IncomingCommand()) {
                            is MediaCommandParseResult.Command -> parsed.command
                            is MediaCommandParseResult.Ignored -> {
                                log.d { "media.inbound.ignored endpointId=$endpointId reason=${parsed.reason}" }
                                null
                            }
                            is MediaCommandParseResult.Invalid -> {
                                log.w { "media.inbound.invalid endpointId=$endpointId reason=${parsed.reason} text=$text" }
                                null
                            }
                        }
                    }
                    .collect { message ->
                        log.d { "media.inbound.command endpointId=$endpointId commandId=${message.commandId} type=${message.type.cmd} payload=${message.command}" }
                        handleServerStreamCommand(message)
                    }
//        log.w { "device.v2.media.inbound.end" }
            }
            val pcm = launch {
                mediaStateFlow.value.pcmChannel.receiveAsFlow().collect { pcm ->
                    val mediaState = mediaStateFlow.value
                    pcmAcceptedCount += 1L
                    pcmAcceptedBytes += pcm.bytes.size
                    if (pcmAcceptedCount <= 3L || pcmAcceptedCount % 20L == 0L) {
                        log.i {
                            "media.pcm.accepted endpointId=$endpointId count=$pcmAcceptedCount " +
                                "bytes=$pcmAcceptedBytes lastBytes=${pcm.bytes.size} mediaStartPositionMs=${pcm.mediaStartPositionMs}"
                        }
                    }

                    val channels = mediaState.streamState.streamFormat?.channels ?: 2
                    val bytesPerFrame = deviceV2BytesPerFrame(channels)
                    val sampleRate = mediaState.streamState.streamFormat?.sampleRate ?: 44_100
                    transitionState(MediaRuntimeEvent.PcmAccepted(
                        pcm.bytes.size,
                        (pcm.bytes.size / bytesPerFrame),
                    ))
                    val chunkBytes = deviceV2ChunkBytesFor(
                        mediaState.chunkDuration.inWholeMilliseconds.toInt(),
                        sampleRate,
                        channels,
                    )
                    val expectedPosition = pcmBufferStartMediaPositionMs?.let { start ->
                        start + ((pcmBuffer.size / bytesPerFrame).toLong() * 1_000L / sampleRate.toLong())
                    }
                    if (expectedPosition != null && kotlin.math.abs(expectedPosition - pcm.mediaStartPositionMs) > 100L) {
                        log.w {
                            "media.pcm.timeline.discontinuity endpointId=$endpointId expectedMediaStartPositionMs=$expectedPosition " +
                                "actualMediaStartPositionMs=${pcm.mediaStartPositionMs} bufferedBytes=${pcmBuffer.size}"
                        }
                        pcmBuffer.clear()
                        pcmBufferStartMediaPositionMs = null
                    }
                    if (pcmBuffer.isEmpty()) {
                        pcmBufferStartMediaPositionMs = pcm.mediaStartPositionMs
                    }
                    // 本地 buffer / 统一 buffer？
                    // 每个 endpoint 单独 buffer
                    pcmBuffer.append(pcm.bytes)
                    while (pcmBuffer.size >= chunkBytes) {
                        val chunk = pcmBuffer.take(chunkBytes)
                        val mediaStartPositionMs = pcmBufferStartMediaPositionMs ?: pcm.mediaStartPositionMs
                        pcmBufferStartMediaPositionMs = mediaStartPositionMs + mediaState.chunkDuration.inWholeMilliseconds
                        sendChunk(packPcm16(chunk, sampleRate, channels), mediaStartPositionMs)
                    }
                    if (pcmBuffer.isEmpty()) {
                        pcmBufferStartMediaPositionMs = null
                    }
                    updateState { it.copy(bufferedFrames = (pcmBuffer.size / bytesPerFrame.toLong())) }
                }
            }
            val outbound = launch {
                mediaOutbound.receiveAsFlow().collect {
                    wsManager.send(it)
                }
            }
            inbound.join()
            pcm.cancel()
            outbound.cancel()
        }
    }

    suspend fun sendChunk(bytes: ByteArray, mediaStartPositionMs: Long) {
        val stream = activeStream ?: return
        val seq = stream.nextSeq
        activeStream = stream.copy(nextSeq = seq + 1)
        wsManager.sendBinaryPair(
            payload = DeviceV2AudioChunkPayload(
                streamId = stream.streamId,
                generation = stream.generation,
                seq = seq,
                durationMs = mediaStateFlow.value.chunkDuration.inWholeMilliseconds.toInt(),
                byteLength = bytes.size,
                mediaStartPositionMs = mediaStartPositionMs,
            ),
            bytes = bytes,
        )
        if (seq < 3L || seq % 20L == 0L) {
            log.i {
                "media.audio.chunk.sent endpointId=$endpointId streamId=${stream.streamId} " +
                    "generation=${stream.generation} seq=$seq bytes=${bytes.size} mediaStartPositionMs=$mediaStartPositionMs"
            }
        }
        transitionState(MediaRuntimeEvent.ChunkSent(seq = seq, bytes=bytes.size))
    }

    internal suspend fun handleServerStreamCommand(message: ServerStreamCommand) {
        when (message.type) {
            ServerCommandType.StreamRequest -> handleStreamRequested(message.commandId, message.command)
            ServerCommandType.StreamResume -> {
                handleStreamRequested(
                    message.commandId,
                    message.command,
                )
            }

            ServerCommandType.StreamStop -> {
                handleStreamStop(message.commandId)
            }
        }
    }

    suspend fun handleStreamRequested(
        commandId: String,
        command: JsonObject,
    ) {
        val streamId = command["streamId"]?.jsonPrimitive?.content ?: run {
            log.w { "media.command.stream.invalid endpointId=$endpointId commandId=$commandId missing=streamId payload=$command" }
            return
        }
        val generation = command["generation"]?.jsonPrimitive?.content?.toIntOrNull() ?: run {
            log.w { "media.command.stream.invalid endpointId=$endpointId commandId=$commandId missing=generation payload=$command" }
            return
        }
        val streamState = mediaStateFlow.value.streamState
        log.i {
            "media.command.stream.requested endpointId=$endpointId commandId=$commandId streamId=$streamId " +
                "generation=$generation permission=${streamState.permission} playback=${streamState.playbackStatus} " +
                "capture=${streamState.captureStatus} media=${mediaStateFlow.value.mediaFlow.value?.title ?: "nil"}"
        }
        val reason = mediaStateFlow.value.streamState.rejectionReason()
        if (reason != null) {
            val rejectedState = mediaStateFlow.value.streamState
            log.w {
                "media.command.stream.rejected endpointId=$endpointId commandId=$commandId streamId=$streamId " +
                    "generation=$generation reason=$reason permission=${rejectedState.permission} " +
                    "playback=${rejectedState.playbackStatus} capture=${rejectedState.captureStatus} media=${mediaStateFlow.value.mediaFlow.value?.title ?: "nil"}"
            }
            wsManager.send(
                DeviceV2RejectedAckPayload(
                    commandId = commandId,
                    commandType = ServerCommandType.StreamRequest.cmd,
                    rejectedReason = reason,
                )
            )
            activeStream = null
            transitionState(MediaRuntimeEvent.StreamRejected(reason))
            return
        }
        activeStream = DeviceV2ActiveStream(streamId, generation, 0L)
        log.i {
            "media.command.stream.accepted endpointId=$endpointId commandId=$commandId streamId=$streamId generation=$generation"
        }
        wsManager.send(
            DeviceV2AcceptedAckPayload(
                commandId = commandId,
                commandType = ServerCommandType.StreamRequest.cmd,
                streamId = streamId,
                generation = generation,
                firstSeq = 0L,
                capture = CaptureInfo(provider = "macos", displayName = "Mac System Audio"),
                streamFormat = mediaStateFlow.value.streamState.streamFormat
            )
        )
        transitionState(MediaRuntimeEvent.StreamRequested(streamId, generation))
        hostCommandSink(
            NativeRequestedCommandEvent(
                endpointId = endpointId,
                commandId = commandId,
                streamId = streamId,
                generation = generation,
            )
        )
    }

    suspend fun handleStreamStop(commandId: String) {
        val stream = activeStream ?: return
        activeStream = null
        pcmBuffer.clear()
        pcmBufferStartMediaPositionMs = null
        wsManager.send(
            DeviceV2StoppedAckPayload(
                commandId = commandId,
                streamId = stream.streamId,
                generation = stream.generation,
            )
        )
//        server_stream_stopped
        transitionState(MediaRuntimeEvent.StreamStopped(StreamStopReason.SERVER_STOPPED))
        hostCommandSink(
            NativeStoppedCommandEvent(
                endpointId = endpointId,
                commandId = commandId,
                streamId = stream.streamId,
                generation = stream.generation,
                reason = StreamStopReason.SERVER_STOPPED,
            )
        )
    }
}


private fun JsonObject.string(name: String): String? =
    this[name]?.jsonPrimitive?.contentOrNull



private sealed interface MediaCommandParseResult {
    data class Command(val command: ServerStreamCommand) : MediaCommandParseResult
    data class Ignored(val reason: String) : MediaCommandParseResult
    data class Invalid(val reason: String) : MediaCommandParseResult
}

private fun String.toDeviceV2IncomingCommand(): MediaCommandParseResult {
    val obj = runCatching {
        deviceV2Json.parseToJsonElement(this).jsonObject
    }.getOrNull() ?: return MediaCommandParseResult.Invalid("json_parse_failed")

    when (obj.string("type")) {
        "hello_ack" -> return MediaCommandParseResult.Ignored("hello_ack")
        "command" -> Unit
        else -> return MediaCommandParseResult.Invalid("unexpected_type:${obj.string("type")}")
    }

    val payload = obj["payload"]?.jsonObject ?: return MediaCommandParseResult.Invalid("missing_payload")
    val commandId = payload.string("commandId") ?: return MediaCommandParseResult.Invalid("missing_command_id")
    val command = payload["command"]?.jsonObject ?: return MediaCommandParseResult.Invalid("missing_command")
    val commandType = command.string("type") ?: return MediaCommandParseResult.Invalid("missing_command_type")

    return MediaCommandParseResult.Command(ServerStreamCommand(
        commandId = commandId,
        type = ServerCommandType.from(commandType) ?: return MediaCommandParseResult.Invalid("unknown_command_type:$commandType"),
        command = command,
    ))
}
