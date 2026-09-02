package io.github.kt.pulsebar.ws

import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.github.kt.pulsebar.model.Endpoint
import io.github.kt.pulsebar.model.stream.CaptureInfo
import io.github.kt.pulsebar.model.stream.MediaState
import io.github.kt.pulsebar.model.stream.StreamStopReason
import io.github.kt.pulsebar.model.stream.getSnapshot
import io.github.kt.pulsebar.model.stream.rejectionReason
import io.github.kt.pulsebar.export.event.NativeRequestedCommandEvent
import io.github.kt.pulsebar.export.event.NativeStoppedCommandEvent
import io.github.kt.pulsebar.export.event.ServerCommandEvent
import io.github.kt.pulsebar.utils.deviceV2BytesPerFrame
import io.github.kt.pulsebar.utils.deviceV2ChunkBytesFor
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.utils.packPcm16
import io.github.kt.pulsebar.model.connection.ServerCommandType
import io.github.kt.pulsebar.model.connection.ServerStreamCommand
import io.github.kt.pulsebar.ws.common.CommonRuntimeEvent
import io.github.kt.pulsebar.ws.common.CommonRuntimeState
import io.github.kt.pulsebar.ws.common.CommonWSState
import io.github.kt.pulsebar.ws.common.DeviceV2PresenceHeartbeatPayload
import io.github.kt.pulsebar.ws.common.DeviceV2PresencePayload
import io.github.kt.pulsebar.ws.common.deviceV2Hello
import io.github.kt.pulsebar.ws.common.reduce as reduceCommon
import io.github.kt.pulsebar.ws.connection.WSConfig
import io.github.kt.pulsebar.ws.connection.WSManager
import io.github.kt.pulsebar.ws.connection.WSPayload
import io.github.kt.pulsebar.ws.connection.deviceV2Json
import io.github.kt.pulsebar.ws.media.DeviceV2AcceptedAckPayload
import io.github.kt.pulsebar.ws.media.DeviceV2ActiveStream
import io.github.kt.pulsebar.ws.media.DeviceV2AudioChunkPayload
import io.github.kt.pulsebar.ws.media.DeviceV2MediaUpdatePayload
import io.github.kt.pulsebar.ws.media.DeviceV2RejectedAckPayload
import io.github.kt.pulsebar.ws.media.DeviceV2StoppedAckPayload
import io.github.kt.pulsebar.ws.media.DeviceV2StreamStatePayload
import io.github.kt.pulsebar.ws.media.DeviceV2StreamStoppedPayload
import io.github.kt.pulsebar.ws.media.MediaRuntimeEvent
import io.github.kt.pulsebar.ws.media.MediaRuntimeState
import io.github.kt.pulsebar.ws.media.MediaWSState
import io.github.kt.pulsebar.ws.media.reduce as reduceMedia
import io.ktor.client.HttpClient
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.getOrElse
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
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

internal class DeviceWS(
    http: HttpClient,
    scope: CoroutineScope,
    val mediaStateFlow: StateFlow<MediaState>,
    private val endpointId: String,
    private val hostCommandSink: (ServerCommandEvent) -> Unit,
) {
    private val heartbeatInterval = 60.seconds
    internal val presenceOutbound = Channel<DeviceV2PresencePayload>(capacity = Channel.CONFLATED)
    internal val mediaOutbound = Channel<WSPayload>(capacity = 64)
    internal var activeStream: DeviceV2ActiveStream? = null
    internal var wsManager: WSManager = WSManager(http, scope)
    private val log = logger(PulseLogCategory.StreamSession)

    private val pcmBuffer = PcmSegmentBuffer()
    private var pcmBufferStartMediaPositionMs: Long? = null
    private var pcmAcceptedCount: Long = 0L
    private var pcmAcceptedBytes: Long = 0L

    private val _commonRuntime = MutableStateFlow(CommonRuntimeState())
    private val _mediaRuntime = MutableStateFlow(MediaRuntimeState())

    internal val commonState = combine(wsManager.state, _commonRuntime) { connection, runtime ->
        CommonWSState(connection = connection, runtimeState = runtime)
    }
    internal val mediaState = combine(wsManager.state, _mediaRuntime) { connection, runtime ->
        MediaWSState(connection = connection, runtimeState = runtime)
    }

    init {
        scope.launch {
            mediaStateFlow.collect {
                _mediaRuntime.update { s -> s.reduceMedia(MediaRuntimeEvent.MediaStateChanged(it.getSnapshot())) }
                mediaOutbound.trySend(DeviceV2StreamStatePayload(state = it.streamState))
            }
        }
        scope.launch {
            mediaStateFlow
                .distinctUntilChanged { old, new -> old.streamState == new.streamState }
                .filter { it.streamState.reason != null }
                .collect { stopStream(StreamStopReason.MANUAL_STOP) }
        }
        scope.launch {
            mediaStateFlow.value.mediaFlow.collect {
                transitionMediaState(MediaRuntimeEvent.PlayingChanged(it))
                if (it != null) {
                    mediaOutbound.trySend(DeviceV2MediaUpdatePayload(it)).getOrElse {}
                }
            }
        }
    }

    internal fun transitionCommonState(event: CommonRuntimeEvent) {
        _commonRuntime.update { it.reduceCommon(event) }
    }

    internal fun transitionMediaState(event: MediaRuntimeEvent) {
        _mediaRuntime.update { it.reduceMedia(event) }
    }

    internal fun resetConnection(reason: String) {
        wsManager.reset(reason)
        pcmBuffer.clear()
        pcmBufferStartMediaPositionMs = null
        transitionCommonState(CommonRuntimeEvent.RuntimeReset(reason))
        transitionMediaState(MediaRuntimeEvent.RuntimeReset(reason))
    }

    internal suspend fun connect(config: Endpoint, onReady: (suspend () -> Unit)? = null, timeout: Duration = 10.seconds): String {
        resetConnection("connect")
        val deviceSessionId = wsManager.connect(
            WSConfig(
                config.getDeviceWsUrl(),
                apiKey = config.apiKey,
                handShakeTimeout = timeout,
            ),
            { deviceV2Hello(config) }
        ) { handshake(it) }
        transitionCommonState(CommonRuntimeEvent.HelloAccepted(deviceSessionId))
        transitionMediaState(MediaRuntimeEvent.HelloAccepted(deviceSessionId))
        log.d { "onReady.invoke.start endpointId=$endpointId" }
        onReady?.invoke()
        log.d { "onReady.invoke.done endpointId=$endpointId" }
        log.d { "sendCurrentStateSnapshot.start endpointId=$endpointId" }
        sendCurrentStateSnapshot()
        log.d { "sendCurrentStateSnapshot.done endpointId=$endpointId" }
        wsManager.listen { listen() }
        return deviceSessionId
    }

    private fun handshake(payload: JsonObject): String {
        val deviceSessionId = payload["deviceSessionId"]
            ?.jsonPrimitive
            ?.contentOrNull
            ?: error("device hello_ack missing deviceSessionId")
        return deviceSessionId
    }

    internal suspend fun listen() {
        coroutineScope {
            val presenceJob = launch {
                try {
                    presenceOutbound.receiveAsFlow()
                        .takeWhile { wsManager.session.isActive }
                        .collect {
                            wsManager.send(it)
                            transitionCommonState(CommonRuntimeEvent.PresenceSent(it.seq))
                        }
                } catch (t: Throwable) {
                    if (t is CancellationException) throw t
                    log.e(t) { "presenceJob.failed endpointId=$endpointId" }
                    throw t
                }
            }
            val heartbeatJob = launch {
                try {
                    while (wsManager.session.isActive) {
                        delay(heartbeatInterval)
                        if (wsManager.session.isActive) {
                            wsManager.send(DeviceV2PresenceHeartbeatPayload())
                        }
                    }
                } catch (t: Throwable) {
                    if (t is CancellationException) throw t
                    log.e(t) { "heartbeatJob.failed endpointId=$endpointId" }
                    throw t
                }
            }
            val mediaOutboundJob = launch {
                try {
                    mediaOutbound.receiveAsFlow().collect {
                        log.d { "mediaOutbound.send endpointId=$endpointId type=${it::class.simpleName}" }
                        wsManager.send(it)
                    }
                } catch (t: Throwable) {
                    if (t is CancellationException) throw t
                    log.e(t) { "mediaOutboundJob.failed endpointId=$endpointId" }
                    throw t
                }
            }
            val pcmJob = launch {
                try {
                    mediaStateFlow.value.pcmChannel.receiveAsFlow().collect { pcm ->
                        val mediaState = mediaStateFlow.value
                        val streamFormat = mediaState.streamState.streamFormat
                        if (streamFormat == null) {
                            log.w {
                                "media.pcm.dropped_missing_format endpointId=$endpointId bytes=${pcm.bytes.size} " +
                                    "mediaStartPositionMs=${pcm.mediaStartPositionMs}"
                            }
                            return@collect
                        }
                        if (streamFormat.channels <= 0 || streamFormat.sampleRate <= 0) {
                            log.w {
                                "media.pcm.dropped_invalid_format endpointId=$endpointId bytes=${pcm.bytes.size} " +
                                    "sampleRate=${streamFormat.sampleRate} channels=${streamFormat.channels}"
                            }
                            return@collect
                        }
                        pcmAcceptedCount += 1L
                        pcmAcceptedBytes += pcm.bytes.size
                        if (pcmAcceptedCount <= 3L || pcmAcceptedCount % 20L == 0L) {
                            log.i {
                                "media.pcm.accepted endpointId=$endpointId count=$pcmAcceptedCount " +
                                    "bytes=$pcmAcceptedBytes lastBytes=${pcm.bytes.size} mediaStartPositionMs=${pcm.mediaStartPositionMs}"
                            }
                        }

                        val channels = streamFormat.channels
                        val bytesPerFrame = deviceV2BytesPerFrame(channels)
                        val sampleRate = streamFormat.sampleRate
                        transitionMediaState(MediaRuntimeEvent.PcmAccepted(
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
                        _mediaRuntime.update { it.copy(bufferedFrames = (pcmBuffer.size / bytesPerFrame.toLong())) }
                    }
                } catch (t: Throwable) {
                    if (t is CancellationException) throw t
                    log.e(t) { "pcmJob.failed endpointId=$endpointId" }
                    throw t
                }
            }
            val inboundJob = launch {
                try {
                    wsManager.incomingFlow
                        .onCompletion { cause ->
                            if (cause == null) log.w { "inbound.completed endpointId=$endpointId cause=flow_completed" }
                            else log.w { "inbound.completed endpointId=$endpointId cause=$cause" }
                        }
                        .takeWhile { frame ->
                            if (frame is Frame.Close) {
                                val reason = frame.readReason()
                                log.w { "device.inbound.close endpointId=$endpointId code=${reason?.code} message=${reason?.message}" }
                                false
                            } else {
                                true
                            }
                        }
                        .filterIsInstance<Frame.Text>()
                        .mapNotNull { frame ->
                            val text = frame.readText()
                            log.d { "device.inbound.raw endpointId=$endpointId text=$text" }
                            when (val parsed = text.toDeviceV2IncomingCommand()) {
                                is DeviceCommandParseResult.Command -> parsed.command
                                is DeviceCommandParseResult.Ignored -> {
                                    log.d { "device.inbound.ignored endpointId=$endpointId reason=${parsed.reason}" }
                                    null
                                }
                                is DeviceCommandParseResult.Invalid -> {
                                    log.w { "device.inbound.invalid endpointId=$endpointId reason=${parsed.reason} text=$text" }
                                    null
                                }
                            }
                        }
                        .collect { message ->
                            log.d { "device.inbound.command endpointId=$endpointId commandId=${message.commandId} type=${message.type.cmd} payload=${message.command}" }
                            handleServerStreamCommand(message)
                        }
                } catch (t: Throwable) {
                    if (t is CancellationException) throw t
                    log.e(t) { "inboundJob.failed endpointId=$endpointId" }
                    throw t
                }
            }
            log.d { "listen.jobs.started endpointId=$endpointId" }
            inboundJob.join()
            log.d { "listen.inboundJob.joined endpointId=$endpointId" }
            presenceJob.cancel()
            heartbeatJob.cancel()
            mediaOutboundJob.cancel()
            pcmJob.cancel()
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
        _mediaRuntime.update { it.copy(captureRequested = false) }
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
        transitionMediaState(MediaRuntimeEvent.StreamStopped(reason))
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

    private suspend fun sendCurrentStateSnapshot() {
        val state = mediaStateFlow.value
        transitionMediaState(MediaRuntimeEvent.MediaStateChanged(state.getSnapshot()))
        wsManager.send(DeviceV2StreamStatePayload(state.streamState))
        val media = state.mediaFlow.value
        if (media != null) {
            transitionMediaState(MediaRuntimeEvent.PlayingChanged(media))
            wsManager.send(DeviceV2MediaUpdatePayload(media))
        }
    }

    internal suspend fun sendChunk(bytes: ByteArray, mediaStartPositionMs: Long) {
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
        transitionMediaState(MediaRuntimeEvent.ChunkSent(seq = seq, bytes = bytes.size))
    }

    internal suspend fun handleServerStreamCommand(message: ServerStreamCommand) {
        when (message.type) {
            ServerCommandType.StreamRequest -> handleStreamRequested(message.commandId, message.command)
            ServerCommandType.StreamResume -> handleStreamRequested(message.commandId, message.command)
            ServerCommandType.StreamStop -> handleStreamStop(message.commandId)
        }
    }

    private suspend fun handleStreamRequested(commandId: String, command: JsonObject) {
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
            transitionMediaState(MediaRuntimeEvent.StreamRejected(reason))
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
        transitionMediaState(MediaRuntimeEvent.StreamRequested(streamId, generation))
        hostCommandSink(
            NativeRequestedCommandEvent(
                endpointId = endpointId,
                commandId = commandId,
                streamId = streamId,
                generation = generation,
            )
        )
    }

    private suspend fun handleStreamStop(commandId: String) {
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
        transitionMediaState(MediaRuntimeEvent.StreamStopped(StreamStopReason.SERVER_STOPPED))
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


private sealed interface DeviceCommandParseResult {
    data class Command(val command: ServerStreamCommand) : DeviceCommandParseResult
    data class Ignored(val reason: String) : DeviceCommandParseResult
    data class Invalid(val reason: String) : DeviceCommandParseResult
}

private fun String.toDeviceV2IncomingCommand(): DeviceCommandParseResult {
    val obj = runCatching {
        deviceV2Json.parseToJsonElement(this).jsonObject
    }.getOrNull() ?: return DeviceCommandParseResult.Invalid("json_parse_failed")

    when (obj.string("type")) {
        "hello_ack" -> return DeviceCommandParseResult.Ignored("hello_ack")
        "heartbeat_ack" -> return DeviceCommandParseResult.Ignored("heartbeat_ack")
        "command" -> Unit
        else -> return DeviceCommandParseResult.Invalid("unexpected_type:${obj.string("type")}")
    }

    val payload = obj["payload"]?.jsonObject ?: return DeviceCommandParseResult.Invalid("missing_payload")
    val commandId = payload.string("commandId") ?: return DeviceCommandParseResult.Invalid("missing_command_id")
    val command = payload["command"]?.jsonObject ?: return DeviceCommandParseResult.Invalid("missing_command")
    val commandType = command.string("type") ?: return DeviceCommandParseResult.Invalid("missing_command_type")

    return DeviceCommandParseResult.Command(ServerStreamCommand(
        commandId = commandId,
        type = ServerCommandType.from(commandType) ?: return DeviceCommandParseResult.Invalid("unknown_command_type:$commandType"),
        command = command,
    ))
}
