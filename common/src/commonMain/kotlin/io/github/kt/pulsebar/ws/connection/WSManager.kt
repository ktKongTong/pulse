package io.github.kt.pulsebar.ws.connection

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.http.Url
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.consumeAsFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal data class WSConfig(
    val url: Url,
    val apiKey: String,
    val handShakeTimeout: Duration = 3.seconds,
)

internal class WSManager(internal val http: HttpClient, internal val scope: CoroutineScope) {
    internal lateinit var listenJob: Job
    internal lateinit var session: ClientWebSocketSession
    internal lateinit var incomingFlow: Flow<Frame>
    private val connectMutex = Mutex()
    private val _state = MutableStateFlow(WsConnectionState())
    internal val state: StateFlow<WsConnectionState> = _state.asStateFlow()

    private fun transition(event: WsConnectionEvent) {
        _state.update { it.reduce(event) }
    }
    internal suspend fun <T>connect(
        config: WSConfig,
        getHelloMsg: (session: ClientWebSocketSession) -> WSPayload,
        onHandshake: (suspend (payload: JsonObject) -> T),
    ):T = connectMutex.withLock {
        if(::listenJob.isInitialized) {
            listenJob.cancelAndJoin()
//            logger.info("cancel old connection")
        }
        transition(WsConnectionEvent.Connecting(config.url.toString()))

//        logger.info("Connecting to $deviceSessionId")
        val newSession = http.webSocketSession(urlString = config.url.toString()) {
            if (config.apiKey.isNotBlank()) {
                header("Authorization", "Bearer ${config.apiKey}")
            }
        }
        session = newSession
        incomingFlow = newSession.incoming.consumeAsFlow()
            .onEach { transition(WsConnectionEvent.MessageReceived()) }

        transition(WsConnectionEvent.Opened)
        try {
            transition(WsConnectionEvent.HelloSent)
            val r = handshake(getHelloMsg, onHandshake, config.handShakeTimeout)
            transition(WsConnectionEvent.HelloAccepted)
            return@withLock r
        } catch (t: Throwable) {
            if (newSession.isActive) {
                newSession.close()
            }
            throw t
        }
        finally {

        }
    }

    internal suspend fun send(payload: WSPayload) {
        try {
            session.send(deviceV2Frame(payload))
            transition(WsConnectionEvent.MessageSent())
        } catch (t: Throwable) {
            transition(WsConnectionEvent.Failed(t.message ?: "unknown error"))
            throw t
        }
    }

    internal suspend fun send(bytes: ByteArray) {
        try {
            session.send(bytes)
            transition(WsConnectionEvent.MessageSent(binary = true))
        } catch (t: Throwable) {
            transition(WsConnectionEvent.Failed(t.message ?: "unknown error"))
            throw t
        }
    }

    internal suspend fun connect(
        config: WSConfig,
        getHelloMsg: (session: ClientWebSocketSession) -> WSPayload,) = connect(config, getHelloMsg) {}
    private suspend fun <T>handshake(
        getHelloMsg: (session: ClientWebSocketSession) -> WSPayload,
        onHandshake: suspend (payload: JsonObject) -> T,timeout: Duration = 3.seconds
    ): T {
        val payload = withTimeoutOrNull(timeout) {
            send(getHelloMsg(session))
            session.incoming
                .receiveAsFlow()
                .mapNotNull { frame ->
                    when (frame) {
                        is Frame.Text -> {
                            frame.readText().toHelloAckPayloadOrNull()
                        }

                        is Frame.Close -> {
                            val reason = frame.readReason()
                            error(
                                "device common closed before hello_ack: " +
                                        "code=${reason?.code} message=${reason?.message}"
                            )
                        }

                        else -> null
                    }
                }
                .firstOrNull()
        } ?: error("device hello_ack timeout after $timeout")
        val accepted = payload["accepted"]
            ?.jsonPrimitive
            ?.booleanOrNull
            ?: false
        if (!accepted) {
            error("device common hello rejected")
        }
        return onHandshake(payload)

    }

    internal suspend fun listen(listener: suspend (session: ClientWebSocketSession) -> Unit) = connectMutex.withLock {
        if (::listenJob.isInitialized) {
            listenJob.cancelAndJoin()
        }
        val currentSession = session
        listenJob = scope.launch {
            try {
                listener(currentSession)
            } finally {
                if (currentSession.isActive) {
                    currentSession.close()
                }
            }
        }
    }


}



internal fun String.toHelloAckPayloadOrNull(): JsonObject? {
    val obj = runCatching {
        deviceV2Json.parseToJsonElement(this).jsonObject
    }.getOrNull() ?: return null
    if (obj["type"]?.jsonPrimitive?.contentOrNull != "hello_ack") {
        return null
    }
    return obj["payload"]?.jsonObject
}
