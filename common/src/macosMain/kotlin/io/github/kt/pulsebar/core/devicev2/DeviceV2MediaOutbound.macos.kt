package io.github.kt.pulsebar.core.devicev2

import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.send

internal suspend fun DeviceV2Client.runMediaOutbound(session: ClientWebSocketSession) {
    for (payload in mediaOutbound) {
        session.send(Frame.Text(payload))
    }
}
