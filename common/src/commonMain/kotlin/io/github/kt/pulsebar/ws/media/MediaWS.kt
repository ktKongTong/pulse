package io.github.kt.pulsebar.ws.media

import io.github.kt.pulsebar.core.devicev2.DeviceV2CaptureInfo
import io.github.kt.pulsebar.core.devicev2.DeviceV2RejectedReason
import io.github.kt.pulsebar.core.devicev2.DeviceV2StreamFormat
import io.github.kt.pulsebar.core.devicev2.toDeviceV2MediaItem
import io.github.kt.pulsebar.core.devicev2.toDeviceV2StreamState
import io.github.kt.pulsebar.core.log.PulseLogCategory
import io.github.kt.pulsebar.core.log.logger
import io.github.kt.pulsebar.core.stream.StreamCaptureRuntime
import io.github.kt.pulsebar.core.stream.ConnectionConfig
import io.github.kt.pulsebar.core.stream.EndpointConfig
import io.github.kt.pulsebar.core.stream.PulseConfig
import io.github.kt.pulsebar.core.stream.StreamConfig
import io.github.kt.pulsebar.core.stream.StreamMedia
import io.github.kt.pulsebar.core.stream.StreamMediaPermission
import io.github.kt.pulsebar.core.stream.StreamNativeMediaState
import io.github.kt.pulsebar.core.stream.StreamPlaybackWire
import io.github.kt.pulsebar.core.stream.StreamStopReason
import io.github.kt.pulsebar.core.stream.getMediaWSUrl
import io.github.kt.pulsebar.export.NativeHostCommand
import io.github.kt.pulsebar.export.NativeStreamRequestedCommand
import io.github.kt.pulsebar.export.NativeStreamStoppedCommand
import io.github.kt.pulsebar.media.StreamState
import io.github.kt.pulsebar.media.deviceV2BytesPerFrame
import io.github.kt.pulsebar.media.deviceV2ChunkBytesFor
import io.github.kt.pulsebar.media.deviceV2WrapWav
import io.github.kt.pulsebar.utils.nowInIso8601
import io.github.kt.pulsebar.ws.connection.WSConfig
import io.github.kt.pulsebar.ws.connection.WSManager
import io.github.kt.pulsebar.ws.connection.WSPayload
import io.github.kt.pulsebar.ws.connection.deviceV2Json
import io.ktor.client.HttpClient
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import kotlin.collections.plus
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.consumeAsFlow
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


internal class MediaWS(
    http: HttpClient,
    scope: CoroutineScope,
    val streamStateFlow: StateFlow<StreamState>,
    private val endpointId: String,
    private val hostCommandSink: (NativeHostCommand) -> Unit,
) {
    internal var pcmBuffer = ByteArray(0)
    internal val mediaOutbound = Channel<WSPayload>(capacity = 64)
    internal var activeStream: DeviceV2ActiveStream? = null
    internal var wsManager: WSManager = WSManager(http, scope)
    private val log = logger(PulseLogCategory.StreamSession)
    private val _state = MutableStateFlow(MediaRuntimeState())
    private val runtimeState: StateFlow<MediaRuntimeState> = _state.asStateFlow()
    internal val state = combine(wsManager.state, runtimeState) { connection, runtime ->
        MediaWSState(
            connection = connection,
            runtimeState = runtime,
        )
    }
    internal suspend fun connect(deviceSessionId: String, config: PulseConfig, onReady: (suspend () -> Unit)? = null, timeout: Duration = 10.seconds) {
        wsManager.connect(
            WSConfig(
                config.endpoint.getMediaWSUrl(deviceSessionId),
                apiKey = config.endpoint.apiKey,
                handShakeTimeout = timeout,
            )
        ) {
            deviceV2MediaHello(config.stream.chunkDurationMs)
        }
        onReady?.invoke()
        sendCurrentStateSnapshot()
        wsManager.listen { listen() }
    }

    internal fun updateState(tran: (stats: MediaRuntimeState) -> MediaRuntimeState) {
        _state.update { tran(it) }
    }

    internal fun transitionState(event: MediaRuntimeEvent) {
        _state.update { it.reduce(event) }
    }

    internal fun updateNativeMediaState(next: StreamNativeMediaState) {
        transitionState(MediaRuntimeEvent.MediaStateChanged(next))
        log.d { "media.state.enqueue endpointId=$endpointId playback=${next.playback} capture=${next.capture} media=${next.media?.title ?: "nil"}" }
        mediaOutbound.trySend(
            DeviceV2StreamStatePayload(
                sentAt = nowInIso8601(),
                state = next.toDeviceV2StreamState(streamStateFlow.value.streamFormat),
            )
        )
    }

    internal fun updateNowPlaying(next: StreamMedia?) {
        transitionState(MediaRuntimeEvent.PlayingChanged(next))
        if (next != null) {
            log.d { "media.updated.enqueue endpointId=$endpointId title=${next.title ?: "nil"} playback=${next.playbackState}" }
            mediaOutbound.trySend(DeviceV2MediaUpdatePayload(next.toDeviceV2MediaItem()))
        }
    }

    private suspend fun sendCurrentStateSnapshot() {
        val state = streamStateFlow.value
        val media = state.mediaState.media ?: state.mediaFlow.value
        transitionState(MediaRuntimeEvent.MediaStateChanged(state.mediaState))
        log.d { "media.state.send.snapshot endpointId=$endpointId playback=${state.mediaState.playback} capture=${state.mediaState.capture} media=${state.mediaState.media?.title ?: "nil"}" }
        wsManager.send(
            DeviceV2StreamStatePayload(
                sentAt = nowInIso8601(),
                state = state.mediaState.toDeviceV2StreamState(state.streamFormat),
            )
        )
        if (media != null) {
            transitionState(MediaRuntimeEvent.PlayingChanged(media))
            log.d { "media.updated.send.snapshot endpointId=$endpointId title=${media.title ?: "nil"} playback=${media.playbackState}" }
            wsManager.send(DeviceV2MediaUpdatePayload(media.toDeviceV2MediaItem()))
        }
    }

    internal fun stopStream(reason: StreamStopReason) {
        val stream = activeStream ?: return
//        transitionState(MediaRuntimeEvent.StreamStopped("server_stop"))
        updateState { it.copy(captureRequested = false) }
            mediaOutbound.trySend(
                DeviceV2StreamStoppedPayload(
                    streamId = stream.streamId,
                    generation = stream.generation,
                    reason = "manual_stop",
                    sentAt = nowInIso8601(),
                )
            )
//        log.i { "local.stop reason=$reason streamId=${stream.streamId}" }
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
                val streamState = streamStateFlow.value
                streamState.pcmChannel.consumeAsFlow().collect { pcm ->
                    transitionState(MediaRuntimeEvent.PcmAccepted(
                        pcm.size,
                        (pcm.size / deviceV2BytesPerFrame(streamState.channels)),
                    ))
                    val chunkBytes = deviceV2ChunkBytesFor(
                    streamState.chunkDuration.inWholeMilliseconds.toInt(),
                        streamState.sampleRate,
                        streamState.channels,
                    )
                    // 本地 buffer / 统一 buffer？
                    // 每个 endpoint 单独 buffer
                    pcmBuffer += pcm
                    while (pcmBuffer.size >= chunkBytes) {
                        val chunk = pcmBuffer.copyOfRange(0, chunkBytes)
                        // TODO 低效 copy
                        pcmBuffer = pcmBuffer.copyOfRange(chunkBytes, pcmBuffer.size)
                        sendChunk(deviceV2WrapWav(chunk, streamState.sampleRate, streamState.channels))
                    }
                    updateState { it.copy(bufferedFrames = (pcmBuffer.size / deviceV2BytesPerFrame(streamState.channels)).toLong()) }
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

   suspend fun sendChunk(bytes: ByteArray) {
        val stream = activeStream ?: return
        val seq = stream.nextSeq
        activeStream = stream.copy(nextSeq = seq + 1)
       wsManager.send(
           DeviceV2AudioChunkPayload(
               streamId = stream.streamId,
               generation = stream.generation,
               seq = seq,
               durationMs = streamStateFlow.value.chunkDuration.inWholeMilliseconds.toInt(),
               byteLength = bytes.size,
           )
       )
       wsManager.send(bytes)
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
        val mediaState = streamStateFlow.value.mediaState
        log.i {
            "media.command.stream.requested endpointId=$endpointId commandId=$commandId streamId=$streamId " +
                "generation=$generation permission=${mediaState.permission} playback=${mediaState.playback} " +
                "capture=${mediaState.capture} media=${mediaState.media?.title ?: "nil"}"
        }
        val reason = rejectionReason()
        if (reason != null) {
            val rejectedState = streamStateFlow.value.mediaState
            log.w {
                "media.command.stream.rejected endpointId=$endpointId commandId=$commandId streamId=$streamId " +
                    "generation=$generation reason=$reason permission=${rejectedState.permission} " +
                    "playback=${rejectedState.playback} capture=${rejectedState.capture} media=${rejectedState.media?.title ?: "nil"}"
            }
            wsManager.send(
                DeviceV2RejectedAckPayload(
                    commandId = commandId,
                    commandType = ServerCommandType.StreamRequest.cmd,
                    rejectedReason = reason,
                )
            )
            activeStream = null
            transitionState(MediaRuntimeEvent.StreamRejected(reason.toString()))
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
                capture = DeviceV2CaptureInfo(provider = "macos", displayName = "Mac System Audio"),
                streamFormat = streamStateFlow.value.streamFormat
            )
        )
        transitionState(MediaRuntimeEvent.StreamRequested(streamId, generation))
        hostCommandSink(
            NativeStreamRequestedCommand(
                endpointId = endpointId,
                commandId = commandId,
                streamId = streamId,
                generation = generation,
            )
        )
    }

    fun rejectionReason(): DeviceV2RejectedReason? = when {
        streamStateFlow.value.mediaState.permission != StreamMediaPermission.ALLOW -> DeviceV2RejectedReason.CAPTURE_PERMISSION_MISSING
        streamStateFlow.value.mediaState.playback != StreamPlaybackWire.PLAYING -> DeviceV2RejectedReason.NO_PLAYABLE_MEDIA
        streamStateFlow.value.mediaState.capture == StreamCaptureRuntime.CAPTURING -> null
        else -> null
    }

    suspend fun handleStreamStop(commandId: String) {
        val stream = activeStream ?: return
        activeStream = null
        pcmBuffer = ByteArray(0)
        wsManager.send(
            DeviceV2StoppedAckPayload(
                commandId = commandId,
                streamId = stream.streamId,
                generation = stream.generation,
            )
        )
        transitionState(MediaRuntimeEvent.StreamStopped("server_stream_stopped"))
        hostCommandSink(
            NativeStreamStoppedCommand(
                endpointId = endpointId,
                commandId = commandId,
                streamId = stream.streamId,
                generation = stream.generation,
                reason = "server_stream_stopped",
            )
        )
    }
}


private fun JsonObject.string(name: String): String? =
    this[name]?.jsonPrimitive?.contentOrNull

internal data class ServerStreamCommand(val commandId: String, val command: JsonObject, val type: ServerCommandType)

enum class ServerCommandType(val cmd: String) {
    StreamRequest("stream.requested"),
    StreamResume("stream.resume"),
    StreamStop("stream.stop"),
    ;
    companion object {
        private val byCmd: Map<String, ServerCommandType> =
            entries.associateBy(ServerCommandType::cmd)

        fun from(value: String): ServerCommandType? =
            byCmd[value]
    }
}

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
