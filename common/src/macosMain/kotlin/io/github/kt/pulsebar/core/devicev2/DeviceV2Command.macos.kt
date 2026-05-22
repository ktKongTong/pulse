package io.github.kt.pulsebar.core.devicev2

import kotlinx.serialization.Serializable

@Serializable
internal data class DeviceV2CommandPayload(
    val commandId: String,
    val sentAt: String,
    val expiresAt: String,
    val command: DeviceV2CommandBody,
)

@Serializable
internal data class DeviceV2CommandBody(
    val type: String,
    val streamId: String? = null,
    val generation: Int? = null,
    val fromSeq: Long? = null,
    val reason: String? = null,
)

internal data class DeviceV2ActiveStream(
    val streamId: String,
    val generation: Int,
    val nextSeq: Long,
)

