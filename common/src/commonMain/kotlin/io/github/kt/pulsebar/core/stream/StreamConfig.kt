package io.github.kt.pulsebar.core.stream

import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.Url
import io.ktor.http.path



data class EndpointConfig(
    val roomId: String,
    val deviceId: String,
    val baseUrl: String,
    val workspaceId: String,
    val apiKey: String,
)

internal fun EndpointConfig.getCommonWSUrl(): Url {
    return deviceV2Url(this, "/api/v1/device/ws", listOf("deviceId" to this.deviceId))
}

internal fun EndpointConfig.getMediaWSUrl(deviceSessionId: String): Url {
    return deviceV2Url(this, "/api/v1/device/media/ws", listOf("deviceSessionId" to deviceSessionId))
}

data class CommonConfig(
    val native: String = ""
)

data class StreamConfig(
    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDurationMs: Int = 500,
)

data class PulseConfig(
    val endpoint: EndpointConfig,
    val stream: StreamConfig,
    val commonConfig: CommonConfig,
)

/**
 * Connection parameters for a single Stream session. The Swift layer
 * derived this from `StreamEndpointConfig`; now it's a plain data class
 * in shared code.
 */
//data class ConnectionConfig(
//    val roomId: String,
//    val deviceId: String,
//    val baseUrl: String,
//    val workspaceId: String,
//    val apiKey: String,
//    val sampleRate: Int = 48_000,
//    val channels: Int = 2,
//    val chunkDurationMs: Int = 500,
//)

data class ConnectionConfig(
    val endpoint: EndpointConfig,
    val sampleRate: Int = 48_000,
    val channels: Int = 2,
    val chunkDurationMs: Int = 500,
)


private fun deviceV2Url(
    config: EndpointConfig,
    path: String,
    params: List<Pair<String, String>>,
): Url {
    val base = Url(config.baseUrl)
    val builder = URLBuilder()
    builder.protocol = if (base.protocol.name == "https") URLProtocol.WSS else URLProtocol.WS
    builder.host = base.host
    val resolvedPort = base.specifiedPort.takeIf { it != 0 && it != -1 }
    if (resolvedPort != null) builder.port = resolvedPort
    builder.path(path)
    params.forEach { (key, value) -> builder.parameters.append(key, value) }
    return builder.build()
}
