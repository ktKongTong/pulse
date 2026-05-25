package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.stream.StreamConnectionConfig
import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.isActive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal suspend fun DeviceV2Client.openCommon(config: StreamConnectionConfig): ClientWebSocketSession {
    val url = deviceV2CommonUrl(config)
    val session = http.webSocketSession(urlString = url.toString()) {
        if (config.apiKey.isNotBlank()) header("Authorization", "Bearer ${config.apiKey}")
    }
    session.send(Frame.Text(deviceV2CommonHello(config)))
    updateStats {
        it.copy(
            webSocketUrl = url.toString(),
            statusText = "Device common websocket open, waiting for ack",
        )
    }
    log.i { "device.v2.common.open url=$url" }
    return session
}

internal suspend fun DeviceV2Client.readCommonAck(session: ClientWebSocketSession): String {
    for (frame in session.incoming) {
        if (frame !is Frame.Text) continue
        val text = frame.readText()
        val obj = runCatching { deviceV2Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: continue
        if (obj["type"]?.jsonPrimitive?.content != "hello_ack") continue
        val payload = obj["payload"]?.jsonObject ?: continue
        if (payload["accepted"]?.jsonPrimitive?.content == "true") {
            val deviceSessionId = payload["deviceSessionId"]!!.jsonPrimitive.content
            updateStats { it.copy(statusText = "Device common connected, connecting stream") }
            log.i { "device.v2.common.ack deviceSessionId=$deviceSessionId" }
            return deviceSessionId
        }
        error("device common hello rejected")
    }
    error("device common closed before hello_ack")
}

internal suspend fun DeviceV2Client.runPresence(session: ClientWebSocketSession) {
    var seq = 0L
    var lastSignature: String? = null
    try {
        while (session.isActive) {
            presenceOutbound.receive()
            val now = deviceV2NowIso()
            val presence = deviceV2Presence(seq, now)
            val signature = presence.state.focus.signature()
            if (signature != lastSignature) {
                session.send(Frame.Text(deviceV2PresenceFrame(presence)))
                lastSignature = signature
                seq++
            }
        }
    } finally {
        log.w { "device.v2.common.presence.end active=${session.isActive}" }
    }
}

private fun DeviceV2Focus.signature(): String =
    listOf(
        app?.id.orEmpty(),
        app?.name.orEmpty(),
        app?.category.orEmpty(),
    ).joinToString(separator = "\u001F")

internal suspend fun DeviceV2Client.runCommonInbound(session: ClientWebSocketSession) {
    for (frame in session.incoming) {
        if (frame is Frame.Close) {
            val reason = frame.readReason()
            log.w { "device.v2.common.close code=${reason?.code} message=${reason?.message}" }
            return
        }
    }
    log.w { "device.v2.common.inbound.end" }
}
