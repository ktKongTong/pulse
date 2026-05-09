package io.github.kt.pulsebar.core.livelisten

/**
 * Pure state machine for a Live Listen device session. The host (Swift on
 * macOS, or future platforms) drives [handle] with [Input] events and
 * applies the resulting [Output] effects. The state machine never performs
 * I/O itself — no WebSocket, no audio buffer, no filesystem — so it is fully
 * unit-testable.
 *
 * Lifecycle:
 *
 * ```
 * Idle ──(ConnectionEstablished)──▶ Handshake ──(StartCommand)──▶ Streaming
 *  ▲                                                                 │
 *  │                                                                 │
 *  └─────────────(StopCommand | ConnectionLost)──────────────────────┘
 * ```
 *
 * - The room can issue `stream.start` with a fresh `generation`, or
 *   `stream.resume` that carries the last server-known `seq`. Either way
 *   the state machine emits the right `ack` and drops back-buffered chunks
 *   from `0..fromSeq` before forwarding.
 * - Server-initiated `stream.stop` yields a `stream.stopped` ack (which we
 *   already send) and tears down the publisher.
 * - The audio pump tells us about PCM arrivals via [Input.AudioChunkReady].
 *   We batch into WAV chunks and hand them back as [Output.SendAudioChunk].
 * - If the socket drops, [Input.ConnectionLost] transitions back to Idle;
 *   the host reconnects and sends `device.hello` with the last known
 *   `streamId/generation/seq` so the server can decide to rebase.
 */
internal class LiveListenStateMachine(
    private val deviceId: String,
) {

    internal enum class Phase {
        Idle,
        Handshake,
        Awaiting, // connected, hello sent, waiting for the first stream.* command
        Streaming,
        Stopping,
    }

    internal data class StreamCursor(
        val streamId: String,
        val generation: Int,
        val nextSeq: Long, // seq that the NEXT audio chunk will carry
    )

    internal data class State(
        val phase: Phase = Phase.Idle,
        val stream: StreamCursor? = null,
        val listeningMediaState: LiveListenNativeMediaState? = null,
        val lastCursor: StreamCursor? = null, // preserved across reconnects for resume
    )

    private var _state: State = State()
    internal val state: State get() = _state

    internal sealed interface Input {
        /** Transport just connected. Device should emit `device.hello`. */
        data class ConnectionEstablished(val mediaState: LiveListenNativeMediaState) : Input

        /** Transport dropped. Everything tears down; we keep [State.lastCursor] for resume. */
        object ConnectionLost : Input

        /** User or native layer toggled media or permission state. */
        data class MediaStateChanged(val mediaState: LiveListenNativeMediaState) : Input

        /** `stream.start` command from the room. */
        data class StartCommand(
            val commandId: String,
            val streamId: String,
            val generation: Int,
            val audio: DeviceCommand.AudioOptions,
        ) : Input

        /** `stream.resume` command from the room. */
        data class ResumeCommand(
            val commandId: String,
            val streamId: String,
            val generation: Int,
            val fromSeq: Long,
            val audio: DeviceCommand.AudioOptions,
        ) : Input

        /** `stream.stop` command from the room. */
        data class StopCommand(val commandId: String, val reason: String) : Input

        /** PCM chunk captured and batched by the audio pump. `bytes` should already be WAV-framed. */
        data class AudioChunkReady(val bytes: ByteArray) : Input

        /** Host wants us to force-stop (user pressed stop, endpoint disconnect). */
        data class LocalStop(val reason: LiveListenStopReason) : Input
    }

    internal sealed interface Output {
        /** Serialize [frame] as JSON and send it over the text channel. */
        data class SendFrame(val frame: LiveListenDeviceOutbound) : Output

        /** Send [bytes] over the binary channel. */
        data class SendAudioChunk(val bytes: ByteArray, val seq: Long) : Output

        /** Host should begin pulling audio from the capture service. */
        object StartCapture : Output

        /** Host should stop the capture service. */
        object StopCapture : Output
    }

    /** Advance the state machine. Returns the outputs the host should apply in order. */
    internal fun handle(input: Input, nowIso: String): List<Output> = when (input) {
        is Input.ConnectionEstablished -> onConnectionEstablished(input, nowIso)
        Input.ConnectionLost -> onConnectionLost()
        is Input.MediaStateChanged -> onMediaStateChanged(input, nowIso)
        is Input.StartCommand -> onStartCommand(input, nowIso)
        is Input.ResumeCommand -> onResumeCommand(input, nowIso)
        is Input.StopCommand -> onStopCommand(input, nowIso)
        is Input.AudioChunkReady -> onAudioChunk(input)
        is Input.LocalStop -> onLocalStop(input, nowIso)
    }

    // --- event handlers -----------------------------------------------------

    private fun onConnectionEstablished(input: Input.ConnectionEstablished, nowIso: String): List<Output> {
        _state = _state.copy(
            phase = Phase.Handshake,
            listeningMediaState = input.mediaState,
        )
        val last = _state.lastCursor
        val hello = DeviceHelloFrame(
            deviceId = deviceId,
            sentAt = nowIso,
            mediaState = input.mediaState,
            lastStreamId = last?.streamId,
            lastGeneration = last?.generation,
            lastSeq = last?.let { it.nextSeq - 1 }?.takeIf { it >= 0 },
        )
        _state = _state.copy(phase = Phase.Awaiting)
        return listOf(Output.SendFrame(hello))
    }

    private fun onConnectionLost(): List<Output> {
        // Keep lastCursor for resume; tear capture down.
        val wasStreaming = _state.phase == Phase.Streaming
        _state = _state.copy(
            phase = Phase.Idle,
            stream = null,
            listeningMediaState = null,
            // lastCursor preserved
        )
        return if (wasStreaming) listOf(Output.StopCapture) else emptyList()
    }

    private fun onMediaStateChanged(input: Input.MediaStateChanged, nowIso: String): List<Output> {
        _state = _state.copy(listeningMediaState = input.mediaState)
        if (_state.phase == Phase.Idle) return emptyList()
        return listOf(
            Output.SendFrame(
                MediaStateUpdatedFrame(
                    deviceId = deviceId,
                    sentAt = nowIso,
                    mediaState = input.mediaState,
                ),
            ),
        )
    }

    private fun onStartCommand(input: Input.StartCommand, nowIso: String): List<Output> {
        val cursor = StreamCursor(
            streamId = input.streamId,
            generation = input.generation,
            nextSeq = 0L,
        )
        _state = _state.copy(
            phase = Phase.Streaming,
            stream = cursor,
            lastCursor = cursor,
        )
        return listOf(
            Output.SendFrame(
                AckFrame(
                    commandId = input.commandId,
                    status = "started",
                    streamId = input.streamId,
                    generation = input.generation,
                    firstSeq = 0L,
                    sentAt = nowIso,
                ),
            ),
            Output.StartCapture,
        )
    }

    private fun onResumeCommand(input: Input.ResumeCommand, nowIso: String): List<Output> {
        val last = _state.lastCursor
        val resumeMatches = last != null &&
            last.streamId == input.streamId &&
            last.generation == input.generation

        // If the server's fromSeq points to a seq we have, we report "resumed".
        // If we already moved past (last.nextSeq > fromSeq), same thing.
        // If the server is ahead of us (last.nextSeq < fromSeq), we acknowledge
        // "resumed_with_gap" and the server knows to mark missing chunks.
        val status = if (!resumeMatches) {
            "restarted"
        } else if (last.nextSeq < input.fromSeq) {
            "resumed_with_gap"
        } else {
            "resumed"
        }

        val cursor = StreamCursor(
            streamId = input.streamId,
            generation = input.generation,
            nextSeq = input.fromSeq,
        )
        _state = _state.copy(
            phase = Phase.Streaming,
            stream = cursor,
            lastCursor = cursor,
        )

        val missingBefore = if (status == "resumed_with_gap") input.fromSeq else null
        return listOf(
            Output.SendFrame(
                AckFrame(
                    commandId = input.commandId,
                    status = status,
                    streamId = input.streamId,
                    generation = input.generation,
                    firstSeq = input.fromSeq,
                    missingBeforeSeq = missingBefore,
                    sentAt = nowIso,
                ),
            ),
            Output.StartCapture,
        )
    }

    private fun onStopCommand(input: Input.StopCommand, nowIso: String): List<Output> {
        val stream = _state.stream
        _state = _state.copy(phase = Phase.Stopping, stream = null)
        val outputs = mutableListOf<Output>(
            Output.SendFrame(
                AckFrame(
                    commandId = input.commandId,
                    status = "stopped",
                    streamId = stream?.streamId,
                    generation = stream?.generation,
                    sentAt = nowIso,
                ),
            ),
            Output.StopCapture,
        )
        _state = _state.copy(phase = Phase.Awaiting)
        return outputs
    }

    private fun onAudioChunk(input: Input.AudioChunkReady): List<Output> {
        val stream = _state.stream ?: return emptyList() // dropped — not streaming
        val seq = stream.nextSeq
        _state = _state.copy(stream = stream.copy(nextSeq = seq + 1))
        _state = _state.copy(lastCursor = _state.stream)
        return listOf(Output.SendAudioChunk(bytes = input.bytes, seq = seq))
    }

    private fun onLocalStop(input: Input.LocalStop, nowIso: String): List<Output> {
        val stream = _state.stream ?: return emptyList()
        _state = _state.copy(phase = Phase.Awaiting, stream = null)
        return listOf(
            Output.SendFrame(
                StreamStoppedFrame(
                    streamId = stream.streamId,
                    generation = stream.generation,
                    reason = input.reason,
                    sentAt = nowIso,
                ),
            ),
            Output.StopCapture,
        )
    }
}
