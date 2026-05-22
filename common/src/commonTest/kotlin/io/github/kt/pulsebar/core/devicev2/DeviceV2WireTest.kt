package io.github.kt.pulsebar.core.devicev2

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class DeviceV2WireTest {
    @Test
    fun streamStateUsesPayloadEnvelope() {
        val raw = deviceV2Json.encodeToString(
            DeviceV2Frame.serializer(DeviceV2StreamStatePayload.serializer()),
            DeviceV2Frame(
                protocol = DEVICE_MEDIA_PROTOCOL_V1,
                type = "stream.state.updated",
                payload = DeviceV2StreamStatePayload(
                    sentAt = "2026-05-21T12:00:00.000Z",
                    state = DeviceV2StreamState(
                        permission = "allow",
                        playback = "playing",
                        capture = "no-capture",
                        streamFormat = DeviceV2StreamFormat("pcm16-wav", 48_000, 2, 16),
                    ),
                ),
            ),
        )
        val obj = deviceV2Json.parseToJsonElement(raw).jsonObject
        val payload = obj["payload"]!!.jsonObject
        val state = payload["state"]!!.jsonObject
        assertEquals(DEVICE_MEDIA_PROTOCOL_V1, obj.str("protocol"))
        assertEquals("stream.state.updated", obj.str("type"))
        assertEquals("allow", state.str("permission"))
        assertEquals("pcm16-wav", state["streamFormat"]!!.jsonObject.str("codec"))
    }

    @Test
    fun acceptedAckCarriesCommandTypeAndFormat() {
        val raw = deviceV2Json.encodeToString(
            DeviceV2Frame.serializer(DeviceV2AcceptedAckPayload.serializer()),
            DeviceV2Frame(
                protocol = DEVICE_MEDIA_PROTOCOL_V1,
                type = "ack",
                payload = DeviceV2AcceptedAckPayload(
                    commandId = "cmd-1",
                    commandType = "stream.requested",
                    status = "accepted",
                    streamId = "s-1",
                    generation = 1,
                    firstSeq = 0,
                    streamFormat = DeviceV2StreamFormat("pcm16-wav", 48_000, 2, 16),
                    sentAt = "2026-05-21T12:00:00.000Z",
                ),
            ),
        )
        val payload = deviceV2Json.parseToJsonElement(raw).jsonObject["payload"]!!.jsonObject
        assertEquals("stream.requested", payload.str("commandType"))
        assertEquals("accepted", payload.str("status"))
        assertEquals("s-1", payload.str("streamId"))
    }

    private fun JsonObject.str(key: String): String {
        val v = this[key] as? JsonPrimitive ?: return ""
        return v.content
    }
}
