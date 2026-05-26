package io.github.kt.pulsebar.ws.common
import io.github.kt.pulsebar.core.stream.EndpointConfig
import io.github.kt.pulsebar.core.stream.PulseConfig
import io.github.kt.pulsebar.core.stream.getCommonWSUrl
import io.github.kt.pulsebar.ws.connection.WSConfig
import io.github.kt.pulsebar.ws.connection.WSManager
import io.ktor.client.HttpClient
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive


internal class CommonWS(
    http: HttpClient,
    scope: CoroutineScope
) {
    internal val presenceOutbound = Channel<DeviceV2PresencePayload>(capacity = Channel.CONFLATED)
    internal var wsManager: WSManager = WSManager(http, scope)
    private val _state = MutableStateFlow(CommonRuntimeState())
    private val runtimeState: StateFlow<CommonRuntimeState> = _state.asStateFlow()

    internal val state = combine(wsManager.state, runtimeState) { connection, runtime ->
        CommonWSState(
            connection = connection,
            runtimeState = runtime,
        )
    }

    internal fun transitionState(event: CommonRuntimeEvent) {
        _state.update { it.reduce(event) }
    }

    internal fun handshake(payload: JsonObject): String {
        val deviceSessionId = payload["deviceSessionId"]
            ?.jsonPrimitive
            ?.contentOrNull
            ?: error("device common hello_ack missing deviceSessionId")
        return deviceSessionId
    }

    internal suspend fun connect(config: EndpointConfig, onReady: (suspend () -> Unit)? = null, timeout: Duration = 3.seconds): String {
        transitionState(CommonRuntimeEvent.RuntimeReset("connect"))
        val deviceSessionId = wsManager.connect(
            WSConfig(
                config.getCommonWSUrl(),
                apiKey = config.apiKey,
                handShakeTimeout = timeout,
            ),
            { deviceV2CommonHello(config) }
        ) { handshake(it) }
        transitionState(CommonRuntimeEvent.HelloAccepted(deviceSessionId))
        onReady?.invoke()
        wsManager.listen { listen() }
        return deviceSessionId
    }

    internal suspend fun listen() {
        coroutineScope {
                val outboundJob = launch {
                    presenceOutbound.receiveAsFlow()
                        .takeWhile { wsManager.session.isActive }
                        .collect {
                            wsManager.send(it)
                            transitionState(CommonRuntimeEvent.PresenceSent(it.seq))
                        }
                }
                wsManager.incomingFlow
//                    .onEach { frame ->
//                        if (frame is Frame.Close) {
////                            val reason = frame.readReason()
////                    log.w {
////                        "device.v2.common.close code=${reason?.code} message=${reason?.message}"
////                    }
//                        }
//                    }
                    .onCompletion {
                        outboundJob.cancel()
                        // log.w { "device.v2.common.inbound.end" }
                    }
                    .collect()
            }

    }
}



//    suspend fun runPresence() {
//        presenceOutbound.receiveAsFlow().collect {
//            session.sendMessage(it)
//        }
//        // log.w { "device.v2.common.presence.end active=${session.isActive}" }
//        var seq = 0L
//        var lastSignature: String? = null
//        try {
//
//            while (session.isActive) {
//
//                val now = nowInIso8601()
//                val presence = deviceV2Presence(seq, now)
////                val signature = presence.state.focus.signature()
////                if (signature != lastSignature) {
//
////                    lastSignature = signature
////                    seq++
////                }
//            }
//        } finally {
//
//        }
//    }
//
//private fun String.toHelloAckPayloadOrNull(): JsonObject? {
//    val obj = runCatching {
//        deviceV2Json.parseToJsonElement(this).jsonObject
//    }.getOrNull() ?: return null
//
//    if (obj["type"]?.jsonPrimitive?.contentOrNull != "hello_ack") {
//        return null
//    }
//
//    return obj["payload"]?.jsonObject
//}
