package io.github.kt.pulsebar.ws.connection


import io.github.kt.pulsebar.ws.common.DeviceV2HelloPayload
import io.github.kt.pulsebar.ws.common.DeviceV2PresenceHeartbeatPayload
import io.github.kt.pulsebar.ws.common.DeviceV2PresencePayload
import io.github.kt.pulsebar.ws.DEVICE_WS_PROTOCOL_V2
import io.github.kt.pulsebar.ws.DEVICE_MEDIA_PROTOCOL_V1
import io.github.kt.pulsebar.ws.PRESENCE_PROTOCOL_V2
import io.github.kt.pulsebar.ws.media.DeviceV2AcceptedAckPayload
import io.github.kt.pulsebar.ws.media.DeviceV2AudioChunkPayload
import io.github.kt.pulsebar.ws.media.DeviceV2MediaUpdatePayload
import io.github.kt.pulsebar.ws.media.DeviceV2RejectedAckPayload
import io.github.kt.pulsebar.ws.media.DeviceV2StoppedAckPayload
import io.github.kt.pulsebar.ws.media.DeviceV2StreamStatePayload
import io.github.kt.pulsebar.ws.media.DeviceV2StreamStoppedPayload
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialInfo
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer


internal interface WSPayload

@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.BINARY)
internal annotation class MediaMessage(
    val type: String,
    val protocol: String = DEVICE_MEDIA_PROTOCOL_V1,
)

@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.BINARY)
internal annotation class CommonMessage(
    val type: String,
    val protocol: String = PRESENCE_PROTOCOL_V2,
)

@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.BINARY)
internal annotation class DeviceWsConnectionMessage(
    val type: String,
    val protocol: String = DEVICE_WS_PROTOCOL_V2,
)
@PublishedApi
internal data class DeviceV2MessageMeta(
    val protocol: String,
    val type: String,
)

@Serializable
internal data class DeviceV2Frame<T: WSPayload>(
    val protocol: String,
    val type: String,
    val payload: T,
)

@PublishedApi
internal fun List<Annotation>.deviceV2MessageMeta(): DeviceV2MessageMeta? =
    firstNotNullOfOrNull { annotation ->
        when (annotation) {
            is MediaMessage -> DeviceV2MessageMeta(annotation.protocol, annotation.type)
            is CommonMessage -> DeviceV2MessageMeta(annotation.protocol, annotation.type)
            is DeviceWsConnectionMessage -> DeviceV2MessageMeta(annotation.protocol, annotation.type)
            else -> null
        }
    }

internal fun deviceV2Frame(payload: WSPayload): String =
    when (payload) {
        is DeviceV2HelloPayload -> deviceV2FrameTyped(payload)
        is DeviceV2PresencePayload -> deviceV2FrameTyped(payload)
        is DeviceV2PresenceHeartbeatPayload -> deviceV2FrameTyped(payload)
        is DeviceV2StreamStatePayload -> deviceV2FrameTyped(payload)
        is DeviceV2MediaUpdatePayload -> deviceV2FrameTyped(payload)
        is DeviceV2AcceptedAckPayload -> deviceV2FrameTyped(payload)
        is DeviceV2RejectedAckPayload -> deviceV2FrameTyped(payload)
        is DeviceV2StoppedAckPayload -> deviceV2FrameTyped(payload)
        is DeviceV2AudioChunkPayload -> deviceV2FrameTyped(payload)
        is DeviceV2StreamStoppedPayload -> deviceV2FrameTyped(payload)
        else -> error("Unsupported WS payload: ${payload::class.simpleName}")
    }

private inline fun <reified P: WSPayload> deviceV2FrameTyped(payload: P): String {
    val payloadSerializer = serializer<P>()

    val message = payloadSerializer.descriptor.annotations
        .deviceV2MessageMeta()
        ?: error(
            "Missing message annotation on ${payloadSerializer.descriptor.serialName}. " +
                    "Expected one of @MediaMessage, @CommonMessage, @DeviceWsConnectionMessage."
        )

    return deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(payloadSerializer),
        DeviceV2Frame(
            protocol = message.protocol,
            type = message.type,
            payload = payload,
        ),
    )
}

internal val deviceV2Json: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}
