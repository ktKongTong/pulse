package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.livelisten.LiveListenConnectionConfig
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal suspend fun DeviceV2Client.runMedia(config: LiveListenConnectionConfig, deviceSessionId: String) {
    val url = deviceV2MediaUrl(config, deviceSessionId)
    log.i { "device.v2.media.open url=$url" }
    val session = http.webSocketSession(urlString = url.toString()) {
        if (config.apiKey.isNotBlank()) header("Authorization", "Bearer ${config.apiKey}")
    }
    log.i { "device.v2.media.connected url=$url" }
    session.send(Frame.Text(deviceV2MediaHello(chunkDurationMs)))
    readMediaAck(session)
    session.send(Frame.Text(currentStreamStateFrame()))
    currentMedia?.let { session.send(Frame.Text(currentMediaFrame(it))) }
    coroutineScope {
        val inbound = launch { runMediaInbound(session) }
        val pcm = launch { runPcmBatcher(session) }
        val outbound = launch { runMediaOutbound(session) }
        inbound.join()
        pcm.cancel()
        outbound.cancel()
    }
}

private suspend fun DeviceV2Client.readMediaAck(session: io.ktor.client.plugins.websocket.ClientWebSocketSession) {
    for (frame in session.incoming) {
        if (frame is Frame.Close) {
            val reason = frame.readReason()
            error("device media closed before hello_ack code=${reason?.code} message=${reason?.message}")
        }
        if (frame !is Frame.Text) continue;
        val obj = runCatching { deviceV2Json.parseToJsonElement(frame.readText()).jsonObject }.getOrNull() ?: continue
        if (obj["type"]?.jsonPrimitive?.content != "hello_ack") continue
        val payload = obj["payload"]?.jsonObject ?: continue
        if (payload["accepted"]?.jsonPrimitive?.content == "true") {
            log.i { "device.v2.media.ack" }
            return
        }
        error("device media hello rejected")
    }
    error("device media closed before hello_ack")
}

internal fun DeviceV2Client.streamFormat() =
    DeviceV2StreamFormat("pcm16-wav", sampleRate, channels, 16)

internal fun DeviceV2Client.currentStreamStateFrame(): String =
    deviceV2StreamStateFrame(
        DeviceV2StreamStatePayload(
            sentAt = deviceV2NowIso(),
            state = mediaState.toDeviceV2StreamState(streamFormat()),
        ),
    )

internal fun DeviceV2Client.currentMediaFrame(media: io.github.kt.pulsebar.core.livelisten.LiveListenMedia): String =
    deviceV2MediaUpdateFrame(
        deviceV2NowIso().let { now ->
        DeviceV2MediaUpdatePayload(
            sentAt = now,
            media = media.toDeviceV2MediaItem(),
            clock = DeviceV2MediaClock(
                mediaProgressSeconds = media.progressSeconds.takeIf { it >= 0.0 },
                durationSeconds = media.durationSeconds,
                updatedAt = now,
            ),
        )
        },
    )
