package io.github.kt.pulsebar.ws.connection

import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.ws.common.CommonWSState
import io.github.kt.pulsebar.ws.media.MediaWSState


data class WsConnectionState(
    val phase: WsPhase = WsPhase.Idle,
    val url: String? = null,
    val lastConnectedAtMillis: Long? = null,
    val lastDisconnectedAtMillis: Long? = null,
    val nextReconnectAtMillis: Long? = null,
    val reconnectDelaySeconds: Double? = null,
    val reconnectCount: Long = 0L,
    val reconnectAttempt: Int = 0,
    val lastSendAtMillis: Long? = null,
    val lastReceiveAtMillis: Long? = null,
    val messagesSent: Long = 0L,
    val messagesReceived: Long = 0L,
    val outboundDroppedMessages: Long = 0L,
    val lastErrorMessage: String? = null,
)

enum class WsPhase {
    Idle,
    Connecting,
    Open,
    HelloAccepted,
    Listening,
    Reconnecting,
    Closing,
    Closed,
    Failed,
}

internal sealed interface WsConnectionEvent {
    data class Reset(val reason: String) : WsConnectionEvent
    data class Connecting(val url: String) : WsConnectionEvent
    data object Opened : WsConnectionEvent
    data object HelloSent : WsConnectionEvent
    data object HelloAccepted : WsConnectionEvent
    data object Listening : WsConnectionEvent
    data class MessageReceived(val text: Boolean = true) : WsConnectionEvent
    data class MessageSent(val binary: Boolean = false) : WsConnectionEvent
    data class Closed(val reason: String?) : WsConnectionEvent
    data class Failed(val message: String) : WsConnectionEvent
}

internal fun WsConnectionState.reduce(event: WsConnectionEvent): WsConnectionState =
    when (event) {
        is WsConnectionEvent.Reset -> WsConnectionState()

        is WsConnectionEvent.Connecting -> copy(
            phase = WsPhase.Connecting,
            url = event.url,
            lastErrorMessage = null,
        )

        WsConnectionEvent.Opened -> copy(
            phase = WsPhase.Open,
        )

        WsConnectionEvent.HelloSent -> copy(
            messagesSent = messagesSent + 1,
            lastSendAtMillis = nowInMillis(),
        )

        WsConnectionEvent.HelloAccepted -> copy(
            phase = WsPhase.HelloAccepted,
            lastConnectedAtMillis = nowInMillis(),
            reconnectDelaySeconds = null,
            nextReconnectAtMillis = null,
            lastErrorMessage = null,
        )

        WsConnectionEvent.Listening -> copy(
            phase = WsPhase.Listening,
        )

        is WsConnectionEvent.MessageReceived -> copy(
            messagesReceived = messagesReceived + 1,
            lastReceiveAtMillis = nowInMillis(),
        )

        is WsConnectionEvent.MessageSent -> copy(
            messagesSent = messagesSent + 1,
            lastSendAtMillis = nowInMillis(),
        )

        is WsConnectionEvent.Closed -> copy(
            phase = WsPhase.Closed,
            lastDisconnectedAtMillis = nowInMillis(),
            lastErrorMessage = event.reason,
        )

        is WsConnectionEvent.Failed -> copy(
            phase = WsPhase.Failed,
            lastDisconnectedAtMillis = nowInMillis(),
            lastErrorMessage = event.message,
        )
    }



data class DeviceWsState(
    val phase: ConnectionStatus = ConnectionStatus.Idle,
    val common: CommonWSState = CommonWSState(),
    val media: MediaWSState = MediaWSState(),
    val deviceSessionId: String? = common.runtimeState.deviceSessionId,
    val reconnectAttempt: Int = 0,
    val reconnectCount: Long = 0L,
    val nextReconnectAtMillis: Long? = null,
    val reconnectDelaySeconds: Double? = null,
    val lastErrorMessage: String? =
        media.connection.lastErrorMessage ?: common.connection.lastErrorMessage,
)

enum class ConnectionStatus {
    Idle,
    Connecting,
    Connected,
    Reconnecting,
    Offline,
    Closing,
    Closed,
    Failed,
}
