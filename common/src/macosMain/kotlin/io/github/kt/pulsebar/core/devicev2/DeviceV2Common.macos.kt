package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.livelisten.LiveListenConnectionConfig
import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal suspend fun DeviceV2Client.openCommon(config: LiveListenConnectionConfig): ClientWebSocketSession {
    val url = deviceV2CommonUrl(config)
    val session = http.webSocketSession(urlString = url.toString()) {
        if (config.apiKey.isNotBlank()) header("Authorization", "Bearer ${config.apiKey}")
    }
    session.send(Frame.Text(deviceV2CommonHello(config)))
    updateStats { connectedStats(it, url.toString()) }
    reconnectAttempt = 0
    log.i { "device.v2.common.connected url=$url" }
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
            log.i { "device.v2.common.ack deviceSessionId=$deviceSessionId" }
            return deviceSessionId
        }
        error("device common hello rejected")
    }
    error("device common closed before hello_ack")
}

internal suspend fun DeviceV2Client.runPresence(session: ClientWebSocketSession) {
    var seq = 0L
    try {
        while (session.isActive) {
            val now = deviceV2NowIso()
            session.send(Frame.Text(deviceV2PresenceFrame(deviceV2Presence(seq++, now))))
            delay(2_000L)
        }
    } finally {
        log.w { "device.v2.common.presence.end active=${session.isActive}" }
    }
}

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
