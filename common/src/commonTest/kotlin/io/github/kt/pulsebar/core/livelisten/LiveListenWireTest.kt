package io.github.kt.pulsebar.core.livelisten

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Wire-format tests. The contract under test is that the on-the-wire JSON
 * matches `packages/realtime-protocol/src/live-listen-v1.ts`. If either the
 * TypeScript schema or these encoders drift, these tests are the first place
 * to fail.
 */
class LiveListenWireTest {

    private val parser = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun deviceHelloShape() {
        val hello = DeviceHelloFrame(
            deviceId = "macos-kt",
            sentAt = "2026-05-10T12:00:00Z",
            mediaState = LiveListenNativeMediaState(
                permission = LiveListenMediaPermission.ALLOW,
                playback = LiveListenPlaybackWire.PLAYING,
                capture = LiveListenCaptureRuntime.NO_CAPTURE,
            ),
            lastStreamId = "stream-X",
            lastGeneration = 3,
            lastSeq = 42L,
        )
        val encoded: JsonElement = liveListenWireJson.encodeToJsonElement(DeviceHelloFrame.serializer(), hello)
        val obj = encoded.jsonObject

        assertEquals("live-listen.device.v1", obj.str("protocol"))
        assertEquals("device.hello", obj.str("type"))
        assertEquals("macos-kt", obj.str("deviceId"))
        assertEquals("stream-X", obj.str("lastStreamId"))
        assertEquals("3", obj.str("lastGeneration"))
        assertEquals("42", obj.str("lastSeq"))
        assertEquals("allow", obj["mediaState"]!!.jsonObject.str("permission"))
        assertEquals("playing", obj["mediaState"]!!.jsonObject.str("playback"))
        assertEquals("no-capture", obj["mediaState"]!!.jsonObject.str("capture"))
    }

    @Test
    fun streamHeartbeatShape() {
        val hb = StreamHeartbeatFrame(
            deviceId = "macos-kt",
            streamId = "stream-A",
            generation = 2,
            sentAt = "2026-05-10T12:00:01Z",
            lastSeq = 17L,
        )
        val obj = liveListenWireJson.encodeToJsonElement(StreamHeartbeatFrame.serializer(), hb).jsonObject
        assertEquals("stream.heartbeat", obj.str("type"))
        assertEquals("stream-A", obj.str("streamId"))
        assertEquals("2", obj.str("generation"))
        assertEquals("17", obj.str("lastSeq"))
        assertNull(obj["clock"]) // clock optional, explicitNulls=false
    }

    @Test
    fun streamStoppedShape() {
        val stopped = StreamStoppedFrame(
            streamId = "stream-A",
            generation = 2,
            reason = LiveListenStopReason.LAST_LISTENER_DISCONNECTED,
            sentAt = "2026-05-10T12:00:02Z",
        )
        val obj = liveListenWireJson.encodeToJsonElement(StreamStoppedFrame.serializer(), stopped).jsonObject
        assertEquals("stream.stopped", obj.str("type"))
        assertEquals("last_listener_disconnected", obj.str("reason"))
    }

    @Test
    fun ackStartedShape() {
        val ack = AckFrame(
            commandId = "cmd-1",
            status = "started",
            sentAt = "2026-05-10T12:00:03Z",
            streamId = "stream-A",
            generation = 1,
            firstSeq = 0L,
        )
        val obj = liveListenWireJson.encodeToJsonElement(AckFrame.serializer(), ack).jsonObject
        assertEquals("ack", obj.str("type"))
        assertEquals("cmd-1", obj.str("commandId"))
        assertEquals("started", obj.str("status"))
        assertEquals("stream-A", obj.str("streamId"))
        assertEquals("0", obj.str("firstSeq"))
    }

    @Test
    fun ackResumedWithGapIncludesMissingBeforeSeq() {
        val ack = AckFrame(
            commandId = "cmd-gap",
            status = "resumed_with_gap",
            sentAt = "2026-05-10T12:00:04Z",
            streamId = "stream-A",
            generation = 1,
            firstSeq = 10L,
            missingBeforeSeq = 10L,
        )
        val obj = liveListenWireJson.encodeToJsonElement(AckFrame.serializer(), ack).jsonObject
        assertEquals("resumed_with_gap", obj.str("status"))
        assertEquals("10", obj.str("missingBeforeSeq"))
    }

    @Test
    fun commandDeserializationStreamStart() {
        val raw = """
            {
              "protocol": "live-listen.device.v1",
              "type": "command",
              "commandId": "c-1",
              "sentAt": "2026-05-10T12:00:05Z",
              "expiresAt": "2026-05-10T12:01:05Z",
              "command": {
                "type": "stream.start",
                "streamId": "stream-A",
                "generation": 1,
                "capture": { "mode": "auto" },
                "audio": { "codec": "pcm16-wav", "chunkDurationMs": 500, "targetLatencyMs": 3000 }
              }
            }
        """.trimIndent()
        val env = liveListenWireJson.decodeFromString(DeviceCommandEnvelope.serializer(), raw)
        val cmd = env.command as DeviceCommand.StreamStart
        assertEquals("stream-A", cmd.streamId)
        assertEquals(1, cmd.generation)
        assertEquals("pcm16-wav", cmd.audio.codec)
        assertEquals("auto", cmd.capture.mode)
    }

    @Test
    fun commandDeserializationStreamResume() {
        val raw = """
            {
              "protocol": "live-listen.device.v1",
              "type": "command",
              "commandId": "c-2",
              "sentAt": "2026-05-10T12:00:06Z",
              "expiresAt": "2026-05-10T12:01:06Z",
              "command": {
                "type": "stream.resume",
                "streamId": "stream-A",
                "generation": 2,
                "fromSeq": 42,
                "audio": { "codec": "pcm16-wav", "chunkDurationMs": 500, "targetLatencyMs": 3000 }
              }
            }
        """.trimIndent()
        val env = liveListenWireJson.decodeFromString(DeviceCommandEnvelope.serializer(), raw)
        val cmd = env.command as DeviceCommand.StreamResume
        assertEquals(42L, cmd.fromSeq)
    }

    @Test
    fun commandDeserializationStreamStop() {
        val raw = """
            {
              "protocol": "live-listen.device.v1",
              "type": "command",
              "commandId": "c-3",
              "sentAt": "2026-05-10T12:00:07Z",
              "expiresAt": "2026-05-10T12:01:07Z",
              "command": { "type": "stream.stop", "reason": "last_listener_disconnected" }
            }
        """.trimIndent()
        val env = liveListenWireJson.decodeFromString(DeviceCommandEnvelope.serializer(), raw)
        val cmd = env.command as DeviceCommand.StreamStop
        assertEquals("last_listener_disconnected", cmd.reason)
        assertNull(cmd.streamId)
    }

    private fun JsonObject.str(key: String): String {
        val v = this[key] as? JsonPrimitive ?: return ""
        return v.content
    }
}
