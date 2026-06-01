package io.github.kt.pulsebar.ws


import io.github.kt.pulsebar.model.Endpoint
import io.ktor.http.URLBuilder
import io.ktor.http.URLProtocol
import io.ktor.http.Url
import io.ktor.http.path

internal fun Endpoint.getCommonWSUrl(): Url {
    return deviceV2Url(this, "/api/v1/device/ws", listOf("deviceId" to this.deviceId))
}

internal fun Endpoint.getMediaWSUrl(deviceSessionId: String): Url {
    return deviceV2Url(
        this,
        "/api/v1/device/media/ws",
        listOf(
            "deviceId" to this.deviceId,
            "deviceSessionId" to deviceSessionId,
        ),
    )
}

private fun deviceV2Url(
    config: Endpoint,
    path: String,
    params: List<Pair<String, String>>,
): Url {
    val base = Url(config.url)
    val builder = URLBuilder()
    builder.protocol = if (base.protocol.name == "https") URLProtocol.WSS else URLProtocol.WS
    builder.host = base.host
    val resolvedPort = base.specifiedPort.takeIf { it != 0 && it != -1 }
    if (resolvedPort != null) builder.port = resolvedPort
    builder.path(path)
    params.forEach { (key, value) -> builder.parameters.append(key, value) }
    return builder.build()
}