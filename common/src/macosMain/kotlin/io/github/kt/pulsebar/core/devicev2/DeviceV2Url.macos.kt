package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.stream.StreamConnectionConfig
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.Url

internal fun deviceV2CommonUrl(config: StreamConnectionConfig): Url =
    deviceV2Url(config, listOf("", "api", "v1", "device", "ws"), listOf("deviceId" to config.deviceId))

internal fun deviceV2MediaUrl(config: StreamConnectionConfig, deviceSessionId: String): Url =
    deviceV2Url(
        config,
        listOf("", "api", "v1", "device", "media", "ws"),
        listOf("deviceSessionId" to deviceSessionId),
    )

private fun deviceV2Url(
    config: StreamConnectionConfig,
    path: List<String>,
    params: List<Pair<String, String>>,
): Url {
    val base = Url(config.baseUrl)
    val builder = URLBuilder()
    builder.protocol = if (base.protocol.name == "https") URLProtocol.WSS else URLProtocol.WS
    builder.host = base.host
    val resolvedPort = base.specifiedPort.takeIf { it != 0 && it != -1 }
    if (resolvedPort != null) builder.port = resolvedPort
    builder.pathSegments = path
    params.forEach { (key, value) -> builder.parameters.append(key, value) }
    return builder.build()
}
