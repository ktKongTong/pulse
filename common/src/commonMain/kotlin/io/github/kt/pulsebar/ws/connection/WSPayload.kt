package io.github.kt.pulsebar.ws.connection


import io.github.kt.pulsebar.ws.DEVICE_CONNECTION_PROTOCOL_V1
import io.github.kt.pulsebar.ws.DEVICE_MEDIA_CONNECTION_PROTOCOL_V1
import io.github.kt.pulsebar.ws.DEVICE_MEDIA_PROTOCOL_V1
import io.github.kt.pulsebar.ws.PRESENCE_PROTOCOL_V2
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
internal annotation class CommonConnectionMessage(
    val type: String,
    val protocol: String = DEVICE_CONNECTION_PROTOCOL_V1,
)


@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.BINARY)
internal annotation class MediaConnectionMessage(
    val type: String,
    val protocol: String = DEVICE_MEDIA_CONNECTION_PROTOCOL_V1,
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
            is CommonConnectionMessage -> DeviceV2MessageMeta(annotation.protocol, annotation.type)
            is MediaConnectionMessage -> DeviceV2MessageMeta(annotation.protocol, annotation.type)
            else -> null
        }
    }

internal inline fun <reified P: WSPayload> deviceV2Frame(payload: P): String {
    val payloadSerializer = serializer<P>()

    val message = payloadSerializer.descriptor.annotations
        .deviceV2MessageMeta()
        ?: error(
            "Missing message annotation on ${payloadSerializer.descriptor.serialName}. " +
                    "Expected one of @MediaMessage, @CommonMessage, " +
                    "@CommonConnectionMessage, @MediaConnectionMessage."
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
