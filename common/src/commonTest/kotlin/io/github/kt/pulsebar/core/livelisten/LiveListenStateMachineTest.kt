package io.github.kt.pulsebar.core.livelisten

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val DEVICE_ID = "macos-test-device"
private const val NOW = "2026-05-10T12:00:00.000Z"

class LiveListenStateMachineTest {

    @Test
    fun helloAfterConnect() {
        val sm = LiveListenStateMachine(DEVICE_ID)
        val outputs = sm.handle(
            LiveListenStateMachine.Input.ConnectionEstablished(idleMediaState()),
            NOW,
        )
        assertEquals(1, outputs.size)
        val hello = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame
        assertIs<DeviceHelloFrame>(hello)
        assertEquals(DEVICE_ID, hello.deviceId)
        assertEquals(LIVE_LISTEN_DEVICE_PROTOCOL_V1, hello.protocol)
        assertNull(hello.lastStreamId)
        assertEquals(LiveListenStateMachine.Phase.Awaiting, sm.state.phase)
    }

    @Test
    fun startCommandMovesToStreamingAndEmitsAck() {
        val sm = connected()
        val outputs = sm.handle(startCommand("cmd-1", "stream-A", generation = 1), NOW)

        assertEquals(2, outputs.size)
        val ack = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame as AckFrame
        assertEquals("started", ack.status)
        assertEquals("stream-A", ack.streamId)
        assertEquals(1, ack.generation)
        assertEquals(0L, ack.firstSeq)
        assertIs<LiveListenStateMachine.Output.StartCapture>(outputs[1])

        assertEquals(LiveListenStateMachine.Phase.Streaming, sm.state.phase)
        assertEquals("stream-A", sm.state.stream?.streamId)
        assertEquals(0L, sm.state.stream?.nextSeq)
    }

    @Test
    fun audioChunksAdvanceSequence() {
        val sm = streaming()
        val outputs = (0 until 3).flatMap {
            sm.handle(LiveListenStateMachine.Input.AudioChunkReady(bytes = byteArrayOf(it.toByte())), NOW)
        }
        assertEquals(3, outputs.size)
        val seqs = outputs.map { (it as LiveListenStateMachine.Output.SendAudioChunk).seq }
        assertEquals(listOf(0L, 1L, 2L), seqs)
        assertEquals(3L, sm.state.stream?.nextSeq)
    }

    @Test
    fun audioChunkDroppedWhenNotStreaming() {
        val sm = connected() // no stream started yet
        val outputs = sm.handle(
            LiveListenStateMachine.Input.AudioChunkReady(byteArrayOf(0x01)),
            NOW,
        )
        assertTrue(outputs.isEmpty())
    }

    @Test
    fun stopCommandEmitsAckAndStopCapture() {
        val sm = streaming()
        val outputs = sm.handle(
            LiveListenStateMachine.Input.StopCommand(commandId = "cmd-stop", reason = "manual_stop"),
            NOW,
        )
        assertEquals(2, outputs.size)
        val ack = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame as AckFrame
        assertEquals("stopped", ack.status)
        assertIs<LiveListenStateMachine.Output.StopCapture>(outputs[1])
        assertEquals(LiveListenStateMachine.Phase.Awaiting, sm.state.phase)
        assertNull(sm.state.stream)
    }

    @Test
    fun localStopSendsStreamStoppedFrame() {
        val sm = streaming()
        val outputs = sm.handle(
            LiveListenStateMachine.Input.LocalStop(LiveListenStopReason.MANUAL_STOP),
            NOW,
        )
        assertEquals(2, outputs.size)
        val frame = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame
        assertIs<StreamStoppedFrame>(frame)
        assertEquals(LiveListenStopReason.MANUAL_STOP, frame.reason)
        assertEquals("stream-A", frame.streamId)
        assertEquals(1, frame.generation)
        assertIs<LiveListenStateMachine.Output.StopCapture>(outputs[1])
    }

    @Test
    fun connectionLostPreservesLastCursor() {
        val sm = streaming()
        // Advance by one chunk so nextSeq moves past 0.
        sm.handle(LiveListenStateMachine.Input.AudioChunkReady(byteArrayOf(1)), NOW)
        val outputs = sm.handle(LiveListenStateMachine.Input.ConnectionLost, NOW)
        assertEquals(1, outputs.size)
        assertIs<LiveListenStateMachine.Output.StopCapture>(outputs[0])

        assertEquals(LiveListenStateMachine.Phase.Idle, sm.state.phase)
        assertNull(sm.state.stream)
        assertEquals("stream-A", sm.state.lastCursor?.streamId)
        assertEquals(1L, sm.state.lastCursor?.nextSeq)
    }

    @Test
    fun helloAfterReconnectIncludesLastKnownCursor() {
        val sm = streaming()
        sm.handle(LiveListenStateMachine.Input.AudioChunkReady(byteArrayOf(1)), NOW)
        sm.handle(LiveListenStateMachine.Input.AudioChunkReady(byteArrayOf(2)), NOW)
        sm.handle(LiveListenStateMachine.Input.ConnectionLost, NOW)

        val outputs = sm.handle(
            LiveListenStateMachine.Input.ConnectionEstablished(idleMediaState()),
            NOW,
        )
        val hello = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame as DeviceHelloFrame
        assertEquals("stream-A", hello.lastStreamId)
        assertEquals(1, hello.lastGeneration)
        assertEquals(1L, hello.lastSeq) // nextSeq was 2 → lastSeq = 1
    }

    @Test
    fun resumeInSequenceMarksResumed() {
        val sm = streamingAndSentChunks(count = 5) // nextSeq = 5
        sm.handle(LiveListenStateMachine.Input.ConnectionLost, NOW)
        sm.handle(LiveListenStateMachine.Input.ConnectionEstablished(idleMediaState()), NOW)

        val outputs = sm.handle(
            LiveListenStateMachine.Input.ResumeCommand(
                commandId = "cmd-r",
                streamId = "stream-A",
                generation = 1,
                fromSeq = 4L, // server asks us to resume from 4 — we had 5 buffered already
                audio = defaultAudio(),
            ),
            NOW,
        )
        val ack = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame as AckFrame
        assertEquals("resumed", ack.status)
        assertNull(ack.missingBeforeSeq)
        assertEquals(4L, ack.firstSeq)
        // After resume, next chunk is seq=4
        val chunkOut = sm.handle(LiveListenStateMachine.Input.AudioChunkReady(byteArrayOf(9)), NOW)
        assertEquals(4L, (chunkOut[0] as LiveListenStateMachine.Output.SendAudioChunk).seq)
    }

    @Test
    fun resumeAheadOfDeviceEmitsResumedWithGap() {
        val sm = streamingAndSentChunks(count = 2) // nextSeq = 2
        sm.handle(LiveListenStateMachine.Input.ConnectionLost, NOW)
        sm.handle(LiveListenStateMachine.Input.ConnectionEstablished(idleMediaState()), NOW)

        val outputs = sm.handle(
            LiveListenStateMachine.Input.ResumeCommand(
                commandId = "cmd-gap",
                streamId = "stream-A",
                generation = 1,
                fromSeq = 10L, // server is 8 ahead of where device was when it dropped
                audio = defaultAudio(),
            ),
            NOW,
        )
        val ack = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame as AckFrame
        assertEquals("resumed_with_gap", ack.status)
        assertEquals(10L, ack.missingBeforeSeq)
        assertEquals(10L, sm.state.stream?.nextSeq)
    }

    @Test
    fun resumeWithDifferentStreamIdRestarts() {
        val sm = streamingAndSentChunks(count = 3)
        sm.handle(LiveListenStateMachine.Input.ConnectionLost, NOW)
        sm.handle(LiveListenStateMachine.Input.ConnectionEstablished(idleMediaState()), NOW)

        val outputs = sm.handle(
            LiveListenStateMachine.Input.ResumeCommand(
                commandId = "cmd-restart",
                streamId = "stream-B",
                generation = 1,
                fromSeq = 0L,
                audio = defaultAudio(),
            ),
            NOW,
        )
        val ack = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame as AckFrame
        assertEquals("restarted", ack.status)
        assertEquals("stream-B", sm.state.stream?.streamId)
    }

    @Test
    fun mediaStateBroadcastsWhileConnected() {
        val sm = connected()
        val newMediaState = idleMediaState().copy(playback = LiveListenPlaybackWire.PLAYING)
        val outputs = sm.handle(
            LiveListenStateMachine.Input.MediaStateChanged(newMediaState),
            NOW,
        )
        assertEquals(1, outputs.size)
        val frame = (outputs[0] as LiveListenStateMachine.Output.SendFrame).frame
        assertIs<MediaStateUpdatedFrame>(frame)
        assertEquals(LiveListenPlaybackWire.PLAYING, frame.mediaState.playback)
    }

    @Test
    fun mediaStateSuppressedWhileIdle() {
        val sm = LiveListenStateMachine(DEVICE_ID)
        val outputs = sm.handle(
            LiveListenStateMachine.Input.MediaStateChanged(idleMediaState()),
            NOW,
        )
        assertTrue(outputs.isEmpty())
    }

    // --- helpers ------------------------------------------------------------

    private fun idleMediaState() = LiveListenNativeMediaState(
        permission = LiveListenMediaPermission.ALLOW,
        playback = LiveListenPlaybackWire.PAUSED,
        capture = LiveListenCaptureRuntime.NO_CAPTURE,
    )

    private fun defaultAudio() = DeviceCommand.AudioOptions(
        codec = "pcm16-wav",
        chunkDurationMs = 500,
        targetLatencyMs = 3000,
    )

    private fun startCommand(
        commandId: String,
        streamId: String,
        generation: Int,
    ): LiveListenStateMachine.Input.StartCommand =
        LiveListenStateMachine.Input.StartCommand(
            commandId = commandId,
            streamId = streamId,
            generation = generation,
            audio = defaultAudio(),
        )

    private fun connected(): LiveListenStateMachine {
        val sm = LiveListenStateMachine(DEVICE_ID)
        sm.handle(LiveListenStateMachine.Input.ConnectionEstablished(idleMediaState()), NOW)
        return sm
    }

    private fun streaming(): LiveListenStateMachine {
        val sm = connected()
        sm.handle(startCommand("cmd-1", "stream-A", 1), NOW)
        return sm
    }

    private fun streamingAndSentChunks(count: Int): LiveListenStateMachine {
        val sm = streaming()
        repeat(count) {
            sm.handle(LiveListenStateMachine.Input.AudioChunkReady(byteArrayOf(it.toByte())), NOW)
        }
        return sm
    }
}
