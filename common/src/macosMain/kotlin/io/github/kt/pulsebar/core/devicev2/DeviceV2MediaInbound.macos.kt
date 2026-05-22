package io.github.kt.pulsebar.core.devicev2

import io.github.kt.pulsebar.core.livelisten.LiveListenCaptureRuntime
import io.github.kt.pulsebar.core.livelisten.LiveListenMediaPermission
import io.github.kt.pulsebar.core.livelisten.LiveListenPlaybackWire
import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal suspend fun DeviceV2Client.runMediaInbound(session: ClientWebSocketSession) {
    for (frame in session.incoming) {
        if (frame is Frame.Close) {
            val reason = frame.readReason()
            log.w { "device.v2.media.close code=${reason?.code} message=${reason?.message}" }
            return
        }
        if (frame !is Frame.Text) continue
        val text = frame.readText()
        val obj = runCatching { deviceV2Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: continue
        if (obj["type"]?.jsonPrimitive?.content == "hello_ack") continue
        if (obj["type"]?.jsonPrimitive?.content != "command") continue
        val payload = obj["payload"]?.jsonObject ?: continue
        val commandId = payload["commandId"]?.jsonPrimitive?.content ?: continue
        val command = payload["command"]?.jsonObject ?: continue
        when (command["type"]?.jsonPrimitive?.content) {
            "stream.requested" -> handleStreamRequested(session, commandId, "stream.requested", command)
            "stream.resume" -> handleStreamRequested(session, commandId, "stream.resume", command)
            "stream.stop" -> handleStreamStop(session, commandId)
        }
    }
    log.w { "device.v2.media.inbound.end" }
}

private suspend fun DeviceV2Client.handleStreamRequested(
    session: ClientWebSocketSession,
    commandId: String,
    commandType: String,
    command: kotlinx.serialization.json.JsonObject,
) {
    val streamId = command["streamId"]?.jsonPrimitive?.content ?: return
    val generation = command["generation"]?.jsonPrimitive?.content?.toIntOrNull() ?: return
    val reason = rejectionReason()
    if (reason != null) {
        session.send(Frame.Text(rejectedAck(commandId, commandType, reason)))
        activeStream = null
        updateStats { it.copy(captureRequested = false) }
        return
    }
    activeStream = DeviceV2ActiveStream(streamId, generation, 0L)
    session.send(Frame.Text(acceptedAck(commandId, commandType, streamId, generation, 0L)))
    updateStats { it.copy(captureRequested = true, statusText = "Stream requested") }
}

private suspend fun DeviceV2Client.handleStreamStop(session: ClientWebSocketSession, commandId: String) {
    val stream = activeStream ?: return
    activeStream = null
    pcmBuffer = ByteArray(0)
    session.send(
        Frame.Text(
            deviceV2StoppedAckFrame(
                DeviceV2StoppedAckPayload(
                    commandId = commandId,
                    commandType = "stream.stop",
                    status = "stopped",
                    streamId = stream.streamId,
                    generation = stream.generation,
                    sentAt = deviceV2NowIso(),
                ),
            ),
        ),
    )
    updateStats { it.copy(captureRequested = false, statusText = "Stream stopped") }
}

private fun DeviceV2Client.acceptedAck(
    commandId: String,
    commandType: String,
    streamId: String,
    generation: Int,
    firstSeq: Long,
): String = deviceV2AcceptedAckFrame(
    DeviceV2AcceptedAckPayload(
        commandId = commandId,
        commandType = commandType,
        status = "accepted",
        streamId = streamId,
        generation = generation,
        firstSeq = firstSeq,
        capture = DeviceV2CaptureInfo(provider = "macos", displayName = "Mac System Audio"),
        streamFormat = streamFormat(),
        sentAt = deviceV2NowIso(),
    ),
)

private fun rejectedAck(commandId: String, commandType: String, reason: DeviceV2RejectedReason): String =
    deviceV2RejectedAckFrame(
        DeviceV2RejectedAckPayload(
            commandId = commandId,
            commandType = commandType,
            status = "rejected",
            rejectedReason = reason,
            sentAt = deviceV2NowIso(),
        ),
    )

private fun DeviceV2Client.rejectionReason(): DeviceV2RejectedReason? = when {
    mediaState.permission != LiveListenMediaPermission.ALLOW -> DeviceV2RejectedReason.CAPTURE_PERMISSION_MISSING
    mediaState.playback != LiveListenPlaybackWire.PLAYING -> DeviceV2RejectedReason.NO_PLAYABLE_MEDIA
    mediaState.capture == LiveListenCaptureRuntime.CAPTURING -> null
    else -> null
}
