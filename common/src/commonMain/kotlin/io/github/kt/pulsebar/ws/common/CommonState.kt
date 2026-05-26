package io.github.kt.pulsebar.ws.common

import io.github.kt.pulsebar.utils.nowInMillis
import io.github.kt.pulsebar.ws.connection.WsConnectionState

internal data class CommonRuntimeState(
    val deviceSessionId: String? = null,
    val presenceAccepted: Long = 0L,
    val presenceQueued: Long = 0L,
    val presenceSeq: Long = 0L,
    val presenceSent: Long = 0L,
    val lastPresenceSentAtMillis: Long? = null,
    val sessionEndSent: Boolean = false,
    val lastSessionEndReason: String? = null,
)

internal data class CommonWSState(
    val runtimeState: CommonRuntimeState = CommonRuntimeState(),
    val connection: WsConnectionState = WsConnectionState(),
)

internal sealed interface CommonRuntimeEvent {
    data class HelloAccepted(val deviceSessionId: String) : CommonRuntimeEvent

    data class PresenceQueued(val seq: Long) : CommonRuntimeEvent

    data class PresenceSent(
        val seq: Long,
        val sentAtMillis: Long = nowInMillis(),
    ) : CommonRuntimeEvent
    data class SessionEndSent(
        val reason: String,
        val sentAtMillis: Long = nowInMillis(),
    ) : CommonRuntimeEvent

    data class RuntimeReset(val reason: String) : CommonRuntimeEvent
}

internal fun CommonRuntimeState.reduce(event: CommonRuntimeEvent): CommonRuntimeState =
    when (event) {
        is CommonRuntimeEvent.HelloAccepted -> copy(
            deviceSessionId = event.deviceSessionId,
            sessionEndSent = false,
            lastSessionEndReason = null,
        )

        is CommonRuntimeEvent.PresenceQueued -> copy(
            presenceSeq = maxOf(presenceSeq, event.seq),
            presenceQueued = presenceQueued + 1,
        )

        is CommonRuntimeEvent.PresenceSent -> copy(
            presenceSeq = maxOf(presenceSeq, event.seq),
            presenceSent = presenceSent + 1,
            lastPresenceSentAtMillis = event.sentAtMillis,
        )

        is CommonRuntimeEvent.SessionEndSent -> copy(
            sessionEndSent = true,
            lastSessionEndReason = event.reason,
        )

        is CommonRuntimeEvent.RuntimeReset -> CommonRuntimeState()
    }
