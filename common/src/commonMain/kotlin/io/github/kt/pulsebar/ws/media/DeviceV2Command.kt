package io.github.kt.pulsebar.ws.media

internal data class DeviceV2ActiveStream(
    val streamId: String,
    val generation: Int,
    val nextSeq: Long,
)