package io.github.kt.pulsebar.core.devicev2

internal fun deviceV2CommonHello(config: io.github.kt.pulsebar.core.stream.StreamConnectionConfig): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2CommonHelloPayload.serializer()),
        DeviceV2Frame(
            protocol = DEVICE_CONNECTION_PROTOCOL_V1,
            type = "hello",
            payload = DeviceV2CommonHelloPayload(
                device = DeviceV2DeviceInfo(
                    name = config.deviceId,
                    platform = "macos",
                    displayName = config.deviceId,
                ),
                capabilities = DeviceV2PresenceCapabilities(
                    focusApp = true,
                    windowTitle = false,
                    pageTitle = false,
                    pageUrl = false,
                ),
                supportedProtocols = listOf(DEVICE_CONNECTION_PROTOCOL_V1),
            ),
        ),
    )

internal fun deviceV2MediaHello(chunkDurationMs: Int): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2MediaHelloPayload.serializer()),
        DeviceV2Frame(
            protocol = DEVICE_MEDIA_CONNECTION_PROTOCOL_V1,
            type = "hello",
            payload = DeviceV2MediaHelloPayload(
                capabilities = DeviceV2MediaCapabilities(
                    media = true,
                    localPlayback = true,
                    remotePlayback = false,
                    binaryAudio = true,
                    localRingBuffer = false,
                ),
                audio = DeviceV2AudioCapabilities(
                    codecs = listOf("pcm16-wav"),
                    chunkDurationMs = chunkDurationMs,
                ),
                supportedProtocols = listOf(DEVICE_MEDIA_PROTOCOL_V1),
            ),
        ),
    )

internal fun deviceV2PresenceFrame(payload: DeviceV2PresencePayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2PresencePayload.serializer()),
        DeviceV2Frame(PRESENCE_PROTOCOL_V2, "snapshot", payload),
    )

internal fun deviceV2StreamStateFrame(payload: DeviceV2StreamStatePayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2StreamStatePayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "stream.state.updated", payload),
    )

internal fun deviceV2MediaUpdateFrame(payload: DeviceV2MediaUpdatePayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2MediaUpdatePayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "media.updated", payload),
    )

internal fun deviceV2AcceptedAckFrame(payload: DeviceV2AcceptedAckPayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2AcceptedAckPayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "ack", payload),
    )

internal fun deviceV2RejectedAckFrame(payload: DeviceV2RejectedAckPayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2RejectedAckPayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "ack", payload),
    )

internal fun deviceV2StoppedAckFrame(payload: DeviceV2StoppedAckPayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2StoppedAckPayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "ack", payload),
    )

internal fun deviceV2AudioChunkFrame(payload: DeviceV2AudioChunkPayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2AudioChunkPayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "audio.chunk", payload),
    )

internal fun deviceV2StreamStoppedFrame(payload: DeviceV2StreamStoppedPayload): String =
    deviceV2Json.encodeToString(
        DeviceV2Frame.serializer(DeviceV2StreamStoppedPayload.serializer()),
        DeviceV2Frame(DEVICE_MEDIA_PROTOCOL_V1, "stream.stopped", payload),
    )

